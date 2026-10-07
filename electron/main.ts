import { app, BrowserWindow, dialog, ipcMain, protocol, powerSaveBlocker, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { LibraryStore, assertWithin, collectFolder } from './storage.js';
import { closeMediaWorker, processImage } from './media.js';
import { MUSIC_EXTENSIONS, PHOTO_EXTENSIONS } from '../shared/defaults.js';

app.setName('ShiguangPhotoAlbum');
protocol.registerSchemesAsPrivileged([{ scheme: 'album', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
const diagnosticArg = process.argv.find(arg => arg.startsWith('--album-diagnostics='));
const diagnosticRoot = diagnosticArg?.slice('--album-diagnostics='.length);
if (diagnosticRoot) app.setPath('userData', path.join(path.resolve(diagnosticRoot), 'user-data'));
const dev = process.argv.includes('--dev') && !app.isPackaged;
let window: BrowserWindow | null = null;
let store: LibraryStore;
let importing = false, importCancelled = false;
let playbackBlocker: number | null = null;
function setPlaybackActive(active: boolean): void {
  if (active && playbackBlocker === null) playbackBlocker = powerSaveBlocker.start('prevent-display-sleep');
  if (!active && playbackBlocker !== null) { powerSaveBlocker.stop(playbackBlocker); playbackBlocker = null; }
}

const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' album: data: blob:; media-src 'self' album: blob:; connect-src 'self' album:; object-src 'none'; frame-src 'none'; base-uri 'none'";
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

async function serveFile(file: string, request: Request, immutable = false): Promise<Response> {
  try {
    const stat = await fs.stat(file); if (!stat.isFile()) return new Response(null, { status: 404 });
    const headers = new Headers({ 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': immutable ? 'private, max-age=31536000, immutable' : 'no-cache' });
    const range = request.headers.get('range'); let start = 0, end = stat.size - 1, status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`); status = 206;
    }
    headers.set('Content-Length', String(end - start + 1));
    if (request.method === 'HEAD' || stat.size === 0) return new Response(null, { status, headers });
    const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  } catch { return new Response(null, { status: 404 }); }
}

function trusted(event: IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('拒绝未授权的请求');
  const url = new URL(event.senderFrame.url);
  if (dev ? url.origin !== 'http://127.0.0.1:5173' : url.protocol !== 'album:' || url.hostname !== 'app') throw new Error('拒绝未授权的请求');
}

function handler(channel: string, callback: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => { trusted(event); return callback(...args); });
}

async function importPhotos(albumId: string, paths: string[]) {
  if (importing) throw new Error('已有照片正在导入，请稍候');
  importing = true; importCancelled = false;
  try { return await store.importPaths(albumId, paths, progress => window?.webContents.send('import:progress', progress), () => importCancelled); }
  finally { importing = false; }
}

function registerHandlers(): void {
  handler('library:get', () => store.snapshot());
  handler('album:create', name => store.createAlbum(name));
  handler('album:rename', (id, name) => store.renameAlbum(id, name));
  handler('album:delete', async id => {
    const album = store.snapshot().albums.find(a => a.id === id); if (!album) throw new Error('相册不存在');
    const answer = await dialog.showMessageBox(window!, { type: 'question', title: '移除相册', message: `移除“${album.name}”？`,
      detail: '相册库中的照片和音乐副本会被移除。你导入前的原文件仍然保留。', buttons: ['保留相册', '移除相册'], defaultId: 0, cancelId: 0, noLink: true });
    return answer.response === 1 ? store.deleteAlbum(id) : null;
  });
  handler('photos:pick', async (id, kind) => {
    if (kind !== 'files' && kind !== 'folder') throw new Error('导入方式无效');
    const answer = await dialog.showOpenDialog(window!, kind === 'folder'
      ? { title: '选择照片文件夹', properties: ['openDirectory'] }
      : { title: '把照片装进回忆里', properties: ['openFile', 'multiSelections'], filters: [{ name: '照片', extensions: PHOTO_EXTENSIONS.map(ext => ext.slice(1)) }] });
    if (answer.canceled) return null;
    const paths = kind === 'folder' ? await collectFolder(answer.filePaths[0]) : answer.filePaths;
    if (!paths.length) throw new Error('这个文件夹里没有支持的照片');
    return importPhotos(id, paths);
  });
  handler('photos:drop', async (id, paths) => {
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string') || paths.length > 20000) throw new Error('拖入文件无效');
    const all: string[] = [];
    for (const file of paths) {
      const stat = await fs.stat(file); if (stat.isDirectory()) all.push(...await collectFolder(file)); else all.push(file);
      if (all.length > 20000) throw new Error('单次最多导入 20000 张照片');
    }
    return importPhotos(id, all);
  });
  handler('photos:cancel', () => { importCancelled = true; });
  handler('photos:reorder', (id, ids) => store.reorderPhotos(id, ids));
  handler('photos:cover', (id, photoId) => store.setCover(id, photoId));
  handler('photos:remove', async (id, ids) => {
    if (!Array.isArray(ids) || !ids.length) throw new Error('请选择照片');
    const answer = await dialog.showMessageBox(window!, { type: 'question', title: '移除照片', message: `从相册移除 ${ids.length} 张照片？`,
      detail: '只移除相册库中的副本，导入前的原文件仍然保留。', buttons: ['保留照片', '移除照片'], defaultId: 0, cancelId: 0, noLink: true });
    return answer.response === 1 ? store.removePhotos(id, ids) : null;
  });
  handler('music:pick', async id => {
    const answer = await dialog.showOpenDialog(window!, { title: '给回忆配一首歌', properties: ['openFile'], filters: [{ name: '背景音乐', extensions: MUSIC_EXTENSIONS.map(ext => ext.slice(1)) }] });
    return answer.canceled ? null : store.selectMusic(id, answer.filePaths[0]);
  });
  handler('music:remove', id => store.removeMusic(id));
  handler('settings:save', (id, settings) => store.saveSettings(id, settings));
  handler('window:fullscreen', () => { if (!window) return false; window.setFullScreen(!window.isFullScreen()); return window.isFullScreen(); });
  handler('playback:active', active => { if (typeof active !== 'boolean') throw new Error('播放状态无效'); setPlaybackActive(active); });
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1024, minHeight: 700, title: '拾光相册',
    backgroundColor: '#101416', icon: path.join(app.getAppPath(), 'resources', 'icon.ico'),
    show: !diagnosticRoot, autoHideMenuBar: true,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      backgroundThrottling: false, offscreen: Boolean(diagnosticRoot) } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  if (diagnosticRoot) window.webContents.on('render-process-gone', (_event, details) => {
    void fs.writeFile(path.join(diagnosticRoot, 'renderer-exit.json'), JSON.stringify(details));
  });
  window.on('closed', () => { setPlaybackActive(false); window = null; app.quit(); });
  await window.loadURL(dev ? 'http://127.0.0.1:5173' : `album://app/index.html${diagnosticRoot ? '?diagnostics=1' : ''}`);
  if (diagnosticRoot) {
    try {
      const { runDiagnostics } = await import('./diagnostics.js');
      await runDiagnostics({ root: diagnosticRoot, store, window, soak: process.argv.includes('--soak'), appPath: app.getAppPath() });
      app.exit(0);
    } catch (error) {
      await fs.mkdir(diagnosticRoot, { recursive: true });
      await fs.writeFile(path.join(diagnosticRoot, 'failure.txt'), String((error as Error).stack || error));
      app.exit(1);
    }
  }
}

app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
if (!diagnosticRoot && !app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  store = new LibraryStore(path.join(app.getPath('userData'), 'library'), processImage);
  const firstRun = await store.initialize();
  if (firstRun) {
    const initial = await store.createAlbum('山海之间', true); const albumId = initial.albums[0].id;
    const demoPath = path.join(app.getAppPath(), 'resources', 'demo');
    await store.importPaths(albumId, await collectFolder(demoPath));
  }
  protocol.handle('album', async request => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    try {
      const url = new URL(request.url);
      if (url.hostname === 'app') {
        const root = path.join(app.getAppPath(), 'dist');
        const name = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        return serveFile(assertWithin(root, path.join(root, name)), request);
      }
      if (url.hostname === 'media') {
        const [albumId, assetId, kind, extra] = url.pathname.slice(1).split('/');
        if (extra || !albumId || !assetId || !kind) return new Response(null, { status: 404 });
        return serveFile(store.mediaPath(albumId, assetId, kind), request, true);
      }
      return new Response(null, { status: 404 });
    } catch { return new Response(null, { status: 404 }); }
  });
  registerHandlers(); await createWindow();
}).catch(async error => {
  if (diagnosticRoot) { await fs.mkdir(diagnosticRoot, { recursive: true }); await fs.writeFile(path.join(diagnosticRoot, 'failure.txt'), String(error.stack || error)); }
  else dialog.showErrorBox('拾光相册未能启动', error.message || String(error));
  app.exit(1);
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { setPlaybackActive(false); closeMediaWorker(); });
