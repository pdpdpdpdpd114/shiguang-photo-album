import type { BrowserWindow } from 'electron';
import { app, nativeImage, screen } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { LibraryStore } from './storage.js';

type Context = { root: string; store: LibraryStore; window: BrowserWindow; soak: boolean; soakSeconds: number; appPath: string; };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runDiagnostics(context: Context): Promise<void> {
  const { store, window, soak, soakSeconds, appPath } = context;
  const externalRequests: string[] = [];
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    externalRequests.push(new URL(details.url).hostname); callback({ cancel: true });
  });
  const root = path.resolve(context.root); await fs.mkdir(root, { recursive: true });
  const results: { check: string; passed: boolean; detail?: unknown }[] = [];
  function passed(check: string, detail?: unknown) { results.push({ check, passed: true, detail }); }
  async function evaluate<T>(code: string): Promise<T> { return window.webContents.executeJavaScript(code); }
  async function until(code: string, timeout = 15000): Promise<void> {
    const started = Date.now(); while (Date.now() - started < timeout) { if (await evaluate<boolean>(code)) return; await wait(100); }
    throw new Error(`Timed out: ${code}`);
  }
  await until('Boolean(window.__albumDiagnostics)');
  assert.equal(await evaluate('window.albumApi.isDesktop'), true);
  assert.equal(await evaluate('typeof window.require'), 'undefined');
  assert.equal(await evaluate('window.__albumDiagnostics.state().selectedId'), null);
  assert.equal(await evaluate('window.__albumDiagnostics.state().playing'), null);
  passed('隔离页面与桌面接口');
  const restartExpected = await fs.readFile(path.join(root, 'restart-expected.json'), 'utf8').catch(() => null);
  if (restartExpected) {
    assert.deepEqual(JSON.parse(JSON.stringify(store.snapshot())), JSON.parse(restartExpected));
    assert.deepEqual(await evaluate('window.albumApi.getLibrary().then(library => JSON.parse(JSON.stringify(library)))'), JSON.parse(restartExpected));
    passed('跨进程重启保存完整相册、照片顺序、封面、音乐与设置');
  }
  const errors: string[] = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  const demo = store.snapshot().albums.find(a => a.isDemo)!; assert(demo && demo.photos.length === 6);
  await wait(600);
  await fs.writeFile(path.join(root, '01-home.png'), (await window.webContents.capturePage()).toPNG());
  passed('首次启动与六张离线示例');
  await evaluate(`window.__albumDiagnostics.select(${JSON.stringify(demo.id)})`); await wait(350);
  await fs.writeFile(path.join(root, '02-editor.png'), (await window.webContents.capturePage()).toPNG());

  let library = await store.createAlbum('测试：中文文件与音乐'); let albumId = library.albums[0].id;
  const fixtureDirectory = path.join(root, 'fixtures'); await fs.mkdir(fixtureDirectory, { recursive: true });
  const demoDirectory = path.join(appPath, 'resources', 'demo');
  const names = (await fs.readdir(demoDirectory)).filter(n => n.endsWith('.jpg'));
  const source = path.join(fixtureDirectory, '中文 照片.jpg'); await fs.copyFile(path.join(demoDirectory, names[0]), source);
  const duplicate = path.join(fixtureDirectory, '另一个名字.jpg'); await fs.copyFile(source, duplicate);
  const broken = path.join(fixtureDirectory, '损坏.jpg'); await fs.writeFile(broken, 'invalid JPEG');
  const imported = await store.importPaths(albumId, [source, duplicate, broken]);
  assert.equal(imported.imported, 1); assert.equal(imported.skipped, 1); assert.equal(imported.failed.length, 1);
  await fs.rename(source, path.join(fixtureDirectory, '已移动的原件.jpg'));
  assert(!nativeImage.createFromPath(store.mediaPath(albumId, imported.library.albums[0].photos[0].id, 'display')).isEmpty());
  passed('中文文件、重名重复、损坏文件与原件移动');

  // A short generated WAV is a test fixture, never a user's music.
  const samples = 44100 * 3, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / 44100 * Math.PI * 2 * 220) * 500), 44 + i * 2);
  const music = path.join(fixtureDirectory, '测试 音乐.wav'); await fs.writeFile(music, wav); await store.selectMusic(albumId, music);
  await fs.rename(music, path.join(fixtureDirectory, '移动后的音乐.wav'));
  const savedAlbum = store.snapshot().albums.find(a => a.id === albumId)!; assert(savedAlbum.music);
  const { processImage, mediaWorkerStatus } = await import('./media.js'); const reopened = new LibraryStore(store.root, processImage); await reopened.initialize();
  const afterRestart = reopened.snapshot().albums.find(a => a.id === albumId)!;
  assert.equal(afterRestart.photos.length, 1); assert.equal(afterRestart.music?.name, '测试 音乐.wav');
  passed('照片与音乐持久化');

  const formatDirectory = path.join(path.dirname(root), 'format-fixtures');
  const formatFiles = (await fs.readdir(formatDirectory).catch(() => [])).filter(n => !n.endsWith('.heic'));
  for (const name of formatFiles) {
    const result = await store.importPaths(albumId, [path.join(formatDirectory, name)]);
    assert.equal(result.failed.length, 0, JSON.stringify(result.failed)); assert.equal(result.imported, 1);
    const photo = result.library.albums.find(a => a.id === albumId)!.photos.at(-1)!;
    assert.equal(photo.width, 480, `图片方向不符：${name}`); assert.equal(photo.height, 640, `图片方向不符：${name}`);
    passed(`图片解码与竖图方向：${name}`, { width: photo.width, height: photo.height });
  }
  if (formatFiles.length) {
    const failed = await store.importPaths(albumId, [path.join(formatDirectory, '转换失败.heic')]);
    assert.equal(failed.failed.length, 1); assert.equal(failed.imported, 0); passed('HEIC 转换失败单独提示');
  }

  // HEIC fixtures are downloaded separately, outside the release and source tree.
  const externalFixtures = path.join(path.dirname(root), 'heic-fixtures');
  const heicFiles = (await fs.readdir(externalFixtures).catch(() => [])).filter(n => /\.hei[cf]$/i.test(n));
  for (const name of heicFiles) {
    const result = await store.importPaths(albumId, [path.join(externalFixtures, name)]);
    assert.equal(result.failed.length, 0, JSON.stringify(result.failed)); assert.equal(result.imported, 1);
    const photo = result.library.albums.find(a => a.id === albumId)!.photos.at(-1)!;
    assert(photo.width > 0 && photo.height > 0);
    assert(!nativeImage.createFromPath(store.mediaPath(albumId, photo.id, 'thumbnail')).isEmpty());
    passed(`HEIC 离线转换：${name}`, { width: photo.width, height: photo.height });
  }

  await wait(5500);
  assert.deepEqual(mediaWorkerStatus(), { converter: false, decoder: false, activeConversions: 0, activeImages: 0 });
  passed('导入结束后释放 HEIC 转换线程与图片解码进程');

  await evaluate('window.__albumDiagnostics.reload()'); await evaluate(`window.__albumDiagnostics.select(${JSON.stringify(demo.id)})`); await wait(350);
  // Verify actual audio decoding and custom-protocol byte ranges before playback.
  const song = store.snapshot().albums.find(a => a.id === albumId)!.music!;
  const audioCheck = await evaluate<{ length: number; range: number }>(`(async () => {
    const audio = new Audio(${JSON.stringify(song.src)});
    const length = await new Promise((resolve, reject) => { audio.onloadedmetadata = () => resolve(audio.duration); audio.onerror = () => reject(new Error('audio metadata failed')); });
    const response = await fetch(${JSON.stringify(song.src)}, {headers: {Range: 'bytes=0-43'}});
    audio.pause(); audio.removeAttribute('src'); audio.load(); return {length, range: response.status};
  })()`);
  assert(Math.abs(audioCheck.length - 3) < .1); assert.equal(audioCheck.range, 206); passed('本地音乐解码与分段读取', audioCheck);

  const effects = ['fade', 'slide-x', 'slide-y', 'zoom', 'kenburns', 'flip', 'cube', 'blinds-x', 'blinds-y', 'mosaic'];
  await evaluate(`window.__albumDiagnostics.play(${JSON.stringify(demo.id)})`);
  await until('Boolean(window.__playerDiagnostics) && window.__playerDiagnostics.debug().phase === "hold"');
  for (const effect of effects) {
    await evaluate(`window.__albumDiagnostics.settings(${JSON.stringify(demo.id)}, {effect: ${JSON.stringify(effect)}})`); await wait(50);
    await evaluate('window.__playerDiagnostics.advance(1)');
    const debug = await evaluate<any>('window.__playerDiagnostics.debug()');
    assert.equal(debug.effect, effect); assert.equal(debug.phase, 'hold'); assert.equal(debug.layers, 1); assert(debug.animations <= 1); assert(debug.cache <= 3);
    passed(`动效：${effect}`);
  }
  await fs.writeFile(path.join(root, '03-player.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate('window.__playerDiagnostics.engine.pause()'); const paused = await evaluate<any>('window.__playerDiagnostics.debug()');
  await wait(3300); const still = await evaluate<any>('window.__playerDiagnostics.debug()'); assert.equal(still.index, paused.index); assert.equal(still.hasTimer, false);
  await evaluate('window.__playerDiagnostics.engine.play()');
  await evaluate('(async () => { for (let i=0;i<40;i++) await window.__playerDiagnostics.advance(1, true); })()');
  const rapid = await evaluate<any>('window.__playerDiagnostics.debug()'); assert.equal(rapid.layers, 1); assert(rapid.cache <= 3);
  passed('暂停、继续与四十次快速切换');
  await evaluate('Promise.all(Array.from({length: 24}, () => window.__playerDiagnostics.advance(1)))');
  assert.equal((await evaluate<any>('window.__playerDiagnostics.debug()')).layers, 1); passed('二十四次重叠切换清理旧动画');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await wait(100); await evaluate('window.__playerDiagnostics.advance(1)');
  assert.equal((await evaluate<any>('window.__playerDiagnostics.debug()')).effect, 'fade'); passed('减少动态效果时柔和淡化');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); window.webContents.debugger.detach();
  await evaluate('window.__albumDiagnostics.stop()'); await wait(150); assert.equal(await evaluate('Boolean(window.__playerDiagnostics)'), false); passed('退出后清理动画与计时器');

  await evaluate(`window.__albumDiagnostics.select(${JSON.stringify(albumId)})`); await wait(100);
  await evaluate('(async () => { window.__previewAudio = document.querySelector("main audio"); await window.__previewAudio.play(); })()');
  assert.equal(await evaluate('window.__previewAudio.paused'), false);
  await evaluate(`window.__albumDiagnostics.play(${JSON.stringify(albumId)})`);
  await until('Boolean(window.__playerDiagnostics?.audio()?.currentTime > .2)');
  assert.equal(await evaluate('window.__previewAudio.paused'), true); await evaluate('delete window.__previewAudio');
  passed('开始放映时停止整理页的音乐试听');
  assert.equal(await evaluate('window.__playerDiagnostics.audio().loop'), true);
  await wait(3400); assert.equal(await evaluate('window.__playerDiagnostics.audio().paused'), false);
  await evaluate('window.__playerDiagnostics.engine.pause()'); await wait(150);
  const stoppedMusic = await evaluate<any>('window.__playerDiagnostics.audio()'); assert.equal(stoppedMusic.paused, true);
  await wait(900); assert(Math.abs((await evaluate<any>('window.__playerDiagnostics.audio()')).currentTime - stoppedMusic.currentTime) < .05);
  await evaluate('window.__playerDiagnostics.engine.play()'); await wait(300); assert.equal(await evaluate('window.__playerDiagnostics.audio().paused'), false);
  await evaluate(`window.__albumDiagnostics.settings(${JSON.stringify(albumId)}, {volume: .25, muted: true})`); await wait(100);
  assert.equal(await evaluate('window.__playerDiagnostics.audio().volume'), .25); assert.equal(await evaluate('window.__playerDiagnostics.audio().muted'), true);
  passed('音乐实际播放、循环、同步暂停恢复、音量与静音');
  const beforeFullscreen = window.getBounds();
  const displayBounds = screen.getDisplayMatching(beforeFullscreen).bounds;
  const savedFit = await evaluate('window.__albumDiagnostics.state().library.albums.find(a => a.id === window.__albumDiagnostics.state().playing.id).settings.fit');
  await evaluate(`window.__albumDiagnostics.settings(${JSON.stringify(albumId)}, { fit: "cover" })`);
  await until('document.querySelector(".slide-image")?.style.objectFit === "cover"');
  await evaluate('document.querySelector(".player").dispatchEvent(new KeyboardEvent("keydown", { code: "F11", bubbles: true }))');
  await until('document.querySelector(".player.is-fullscreen .player-chrome")?.getAttribute("aria-hidden") === "true"');
  await wait(250); assert(window.isFullScreen());
  assert.deepEqual(window.getBounds(), displayBounds);
  assert.deepEqual(window.getContentBounds(), displayBounds);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".player")).cursor'), 'none');
  assert.equal(await evaluate('document.querySelector(".player-show-controls").getAttribute("aria-hidden")'), 'true');
  assert.equal(await evaluate('document.querySelector(".slide-image").style.objectFit'), 'contain');
  assert.equal(await evaluate('window.__albumDiagnostics.state().library.albums.find(a => a.id === window.__albumDiagnostics.state().playing.id).settings.fit'), 'cover');
  await fs.writeFile(path.join(root, '04-fullscreen.png'), (await window.webContents.capturePage()).toPNG());
  passed('F11 全屏覆盖屏幕与任务栏区域、隐藏边框文字和鼠标、完整显示照片', { displayBounds, fit: 'contain' });
  await evaluate('document.querySelector(".player").dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }))');
  await until('!document.querySelector(".player.is-fullscreen") && document.querySelector(".player-chrome")?.getAttribute("aria-hidden") === "false"');
  await wait(250); assert.equal(window.isFullScreen(), false);
  assert.deepEqual(window.getBounds(), beforeFullscreen);
  assert.equal(await evaluate('document.querySelector(".slide-image").style.objectFit'), 'cover');
  await evaluate(`window.__albumDiagnostics.settings(${JSON.stringify(albumId)}, { fit: ${JSON.stringify(savedFit)} })`);
  passed('Esc 退出全屏并恢复原窗口大小、控制栏与照片显示设置');
  // Native fullscreen can make an offscreen test window visible on Windows.
  // Return it to the background as soon as the fullscreen assertion finishes.
  window.hide();
  await evaluate('window.__albumDiagnostics.stop()'); await wait(150);

  if (soak) {
    library = await store.createAlbum('500 张混合图片 · 持续播放测试'); albumId = library.albums[0].id;
    const folder = path.join(root, 'soak-fixtures'); await fs.mkdir(folder, { recursive: true });
    const image = nativeImage.createFromPath(path.join(demoDirectory, names[0]));
    const paths: string[] = [];
    for (let i = 0; i < 500; i++) {
      const ext = i % 2 ? '.png' : '.jpg'; const filename = path.join(folder, `测试-${String(i).padStart(3, '0')}${ext}`);
      const smaller = image.resize({ width: 640 + i, height: 360 + i });
      await fs.writeFile(filename, ext === '.png' ? smaller.toPNG() : smaller.toJPEG(80 + i % 10)); paths.push(filename);
    }
    const result = await store.importPaths(albumId, paths); assert.equal(result.imported, 500); assert.equal(result.failed.length, 0);
    await store.saveSettings(albumId, { holdSeconds: 3, effect: 'random', theme: 'electric', randomOrder: true });
    await evaluate('window.__albumDiagnostics.reload()'); await evaluate(`window.__albumDiagnostics.play(${JSON.stringify(albumId)})`);
    await until('Boolean(window.__playerDiagnostics) && window.__playerDiagnostics.debug().phase === "hold"');
    const started = Date.now(), duration = soakSeconds * 1000;
    const samples: object[] = [];
    while (Date.now() - started < duration) {
      await wait(30000);
      const debug = await evaluate<any>('window.__playerDiagnostics.debug()'); assert.equal(debug.failed, 0); assert(debug.layers <= 26); assert(debug.cache <= 3); assert.equal(debug.playing, true);
      assert(await evaluate('Array.from(document.querySelectorAll(".slide-stage .slide-image")).every(image => image.complete && image.naturalWidth > 0)'));
      const metrics = app.getAppMetrics();
      const memory = metrics.find(metric => metric.pid === window.webContents.getOSProcessId())!.memory;
      const totalPrivateBytes = metrics.reduce((sum, metric) => sum + (metric.memory.privateBytes || 0), 0);
      samples.push({ seconds: Math.round((Date.now() - started) / 1000), ...debug, memory, totalPrivateBytes });
      await fs.writeFile(path.join(root, 'soak-progress.json'), JSON.stringify({ elapsedSeconds: Math.round((Date.now() - started) / 1000), targetSeconds: soakSeconds, samples }, null, 2));
    }
    const final = await evaluate<any>('window.__playerDiagnostics.debug()'); assert(final.transitions > Math.floor(duration / 30000 * 6));
    const privateMemory = samples.map((s: any) => s.memory.privateBytes ?? s.memory.workingSetSize);
    const secondHalf = privateMemory.slice(Math.floor(privateMemory.length / 2));
    assert(Math.max(...secondHalf) - Math.min(...secondHalf) < 250 * 1024, '持续播放后内存增长超过 250 MB');
    const durationLabel = soakSeconds % 3600 === 0 ? `${soakSeconds / 3600} 小时` : `${Math.round(soakSeconds / 60)} 分钟`;
    passed(`500 张混合图片持续播放 ${durationLabel}`, { seconds: Math.round((Date.now() - started) / 1000), transitions: final.transitions, samples });
    await evaluate('window.__albumDiagnostics.stop()');
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(externalRequests.length, 0); passed('屏蔽 HTTP 与 HTTPS 后全流程离线运行');
  await fs.writeFile(path.join(root, 'restart-expected.json'), JSON.stringify(store.snapshot(), null, 2));
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ packaged: appPath.includes('app.asar'), version: '1.0.0', checks: results, consoleErrors: errors }, null, 2));
}
