import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, access, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { LibraryStore, assertWithin, checkedSettings, collectFolder, atomicReplace } from '../dist-electron/electron/storage.js';
import { PlaybackOrder } from '../dist-electron/shared/playback.js';

async function fixture(t) {
  const base = path.resolve('.test-data/unit'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'library-'));
  const process = async (original, directory, id) => {
    const bytes = await readFile(original);
    if (!bytes.toString().startsWith('valid:')) throw new Error('图片损坏');
    const thumbnailFile = `${id}-thumb.jpg`; await writeFile(path.join(directory, thumbnailFile), bytes);
    return { displayFile: path.basename(original), thumbnailFile, width: 640, height: 480 };
  };
  const store = new LibraryStore(path.join(root, 'library'), process); await store.initialize();
  t.after(async () => { await rm(assertWithin(base, root), { recursive: true, force: true }); });
  async function file(name, content = `valid:${name}`) { const file = path.join(root, name); await writeFile(file, content); return file; }
  return { root, store, process, file };
}

test('相册隔离、去重、坏文件和原件移动', async t => {
  const { root, store, file } = await fixture(t);
  const first = (await store.createAlbum('旅行')).albums[0].id;
  const second = (await store.createAlbum('家人')).albums[0].id;
  const source = await file('中文 图片.jpg', 'valid:photo-one');
  const duplicate = await file('同名内容.jpg', 'valid:photo-one');
  const broken = await file('损坏.jpg', 'not an image');
  const imported = await store.importPaths(first, [source, duplicate, broken]);
  assert.equal(imported.imported, 1); assert.equal(imported.skipped, 1); assert.equal(imported.failed.length, 1);
  const photo = imported.library.albums.find(a => a.id === first).photos[0];
  await rename(source, path.join(root, '移动后.jpg'));
  assert.equal((await readFile(store.mediaPath(first, photo.id, 'display'))).toString(), 'valid:photo-one');
  assert.equal(store.snapshot().albums.find(a => a.id === second).photos.length, 0);
  assert.equal((await store.importPaths(second, [duplicate])).imported, 1);
  const directoryFiles = await readdir(path.join(store.albumsDirectory, first)); assert.equal(directoryFiles.length, 2);
  const folderA = path.join(root, '同名来源甲'), folderB = path.join(root, '同名来源乙');
  await Promise.all([mkdir(folderA), mkdir(folderB)]);
  const sameNameA = path.join(folderA, '照片.jpg'), sameNameB = path.join(folderB, '照片.jpg');
  await Promise.all([writeFile(sameNameA, 'valid:distinct-a'), writeFile(sameNameB, 'valid:distinct-b')]);
  assert.equal((await store.importPaths(first, [sameNameA, sameNameB])).imported, 2);
  const sameNames = store.snapshot().albums.find(a => a.id === first).photos.slice(-2);
  assert.deepEqual(sameNames.map(photo => photo.name), ['照片.jpg', '照片.jpg']); assert.notEqual(sameNames[0].id, sameNames[1].id);
  assert.deepEqual(await Promise.all(sameNames.map(photo => readFile(store.mediaPath(first, photo.id, 'display'), 'utf8'))), ['valid:distinct-a', 'valid:distinct-b']);
});

test('重启保存顺序、封面、配乐和设置；移除不修改原文件', async t => {
  const { store, process, file } = await fixture(t); const id = (await store.createAlbum('我们的日常')).albums[0].id;
  const originals = await Promise.all(['1.jpg', '2.png', '3.webp'].map(name => file(name)));
  await store.importPaths(id, originals); const photos = store.snapshot().albums[0].photos;
  await store.reorderPhotos(id, photos.map(p => p.id).reverse()); await store.setCover(id, photos[1].id);
  await store.saveSettings(id, { theme: 'warm', holdSeconds: 12, effect: 'flip', randomOrder: true, muted: true });
  const music = await file('我的音乐.wav', 'RIFF example'); await store.selectMusic(id, music);
  const reopened = new LibraryStore(store.root, process); assert.equal(await reopened.initialize(), false);
  const album = reopened.snapshot().albums[0]; assert.deepEqual(album.photos.map(p => p.id), photos.map(p => p.id).reverse());
  assert.equal(album.coverId, photos[1].id); assert.equal(album.music.name, '我的音乐.wav'); assert.equal(album.settings.holdSeconds, 12); assert.equal(album.settings.muted, true);
  await reopened.removePhotos(id, [photos[1].id]); assert.equal(reopened.snapshot().albums[0].coverId, photos[2].id);
  await reopened.deleteAlbum(id); assert.equal(reopened.snapshot().albums.length, 0);
  for (const original of [...originals, music]) await access(original);
});

test('受限资源路径、顺序和设置拒绝非法输入', async t => {
  const { store, file } = await fixture(t); const id = (await store.createAlbum('安全边界')).albums[0].id;
  await store.importPaths(id, [await file('照片.jpg')]); const photo = store.snapshot().albums[0].photos[0];
  assert.throws(() => assertWithin(store.root, store.root)); assert.throws(() => assertWithin(store.root, path.join(store.root, '..', 'secret.jpg')));
  assert.throws(() => store.mediaPath(id, '../library.json', 'display')); assert.throws(() => store.mediaPath(id, photo.id, 'original'));
  await assert.rejects(store.reorderPhotos(id, [photo.id, photo.id]));
  await assert.rejects(store.saveSettings(id, { holdSeconds: 0 })); await assert.rejects(store.saveSettings(id, { volume: Infinity }));
  assert.throws(() => checkedSettings({ unexpected: true })); await assert.rejects(store.renameAlbum(id, '   '));
  assert.equal(store.snapshot().albums[0].name, '安全边界');
});

test('索引损坏恢复备份，双份损坏保留数据并停止', async t => {
  const { store, process } = await fixture(t); await store.createAlbum('恢复前的相册'); await store.renameAlbum(store.snapshot().albums[0].id, '改名之后');
  await writeFile(store.manifest, '{incomplete'); const reopened = new LibraryStore(store.root, process); await reopened.initialize();
  assert.equal(reopened.snapshot().albums[0].name, '恢复前的相册'); assert(reopened.snapshot().warning);
  await writeFile(store.manifest, '{bad'); await writeFile(store.manifest + '.bak', '{also bad');
  await assert.rejects(new LibraryStore(store.root, process).initialize(), /数据已保留/);
});

test('取消批量导入保留已完成照片，停止处理后续文件', async t => {
  const { store, file } = await fixture(t); const id = (await store.createAlbum('取消测试')).albums[0].id;
  const paths = await Promise.all(['a.jpg', 'b.jpg', 'c.jpg'].map(name => file(name))); let cancel = false;
  const result = await store.importPaths(id, paths, () => { cancel = true; }, () => cancel);
  assert.equal(result.imported, 1); assert.equal(result.cancelled, true); assert.equal(store.snapshot().albums[0].photos.length, 1);
});

test('磁盘不足和索引提交失败不污染已有相册', async t => {
  const { store, file } = await fixture(t); const id = (await store.createAlbum('已有回忆')).albums[0].id;
  await store.importPaths(id, [await file('已有.jpg')]); const originalState = store.snapshot();
  const ensure = store.ensureSpace;
  store.ensureSpace = async () => { const error = new Error('磁盘不足'); error.code = 'ENOSPC'; throw error; };
  const result = await store.importPaths(id, [await file('新图.jpg')]); assert.equal(result.imported, 0); assert.equal(result.failed[0].reason, '磁盘空间不足');
  assert.deepEqual(store.snapshot(), originalState); store.ensureSpace = ensure;
  await mkdir(store.manifest + '.tmp'); await assert.rejects(store.renameAlbum(id, '不应提交的名字')); assert.deepEqual(store.snapshot(), originalState);
  const existingFiles = (await readdir(path.join(store.albumsDirectory, id))).sort();
  const notCommitted = await file('提交失败的新图.jpg');
  await assert.rejects(store.importPaths(id, [notCommitted])); assert.deepEqual(store.snapshot(), originalState);
  assert.deepEqual((await readdir(path.join(store.albumsDirectory, id))).sort(), existingFiles); await access(notCommitted);
  await rm(assertWithin(store.root, store.manifest + '.tmp'), { recursive: true });
  await store.renameAlbum(id, '队列仍可使用'); assert.equal(store.snapshot().albums[0].name, '队列仍可使用');
});

test('Windows 短暂文件占用会重试，持续失败仍保留原索引', async t => {
  const { root } = await fixture(t);
  const original = path.join(root, 'index.json'), temp = original + '.tmp';
  await writeFile(original, 'old'); await writeFile(temp, 'new'); let attempts = 0;
  await atomicReplace(temp, original, async (...args) => {
    if (++attempts < 3) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
    return rename(...args);
  });
  assert.equal(attempts, 3); assert.equal(await readFile(original, 'utf8'), 'new');
  await writeFile(temp, 'uncommitted'); attempts = 0;
  await assert.rejects(atomicReplace(temp, original, async () => {
    attempts++; throw Object.assign(new Error('busy'), { code: 'EBUSY' });
  }), /busy/);
  assert.equal(attempts, 10); assert.equal(await readFile(original, 'utf8'), 'new'); assert.equal(await readFile(temp, 'utf8'), 'uncommitted');
});

test('文件夹递归过滤、自然排序和不处理其他文档', async t => {
  const { root } = await fixture(t); const folder = path.join(root, 'folder'); await mkdir(path.join(folder, 'sub'), { recursive: true });
  await Promise.all(['10.jpg', '2.jpg', '1.png', 'notes.txt'].map(name => writeFile(path.join(folder, name), 'data')));
  await writeFile(path.join(folder, 'sub', 'phone.HEIC'), 'heic'); const files = await collectFolder(folder);
  assert.deepEqual(files.map(f => path.basename(f)), ['1.png', '2.jpg', '10.jpg', 'phone.HEIC']);
});

test('顺序播放边界、随机轮次和有界历史', () => {
  const upcoming = new PlaybackOrder(5, true, true, 0, () => .3);
  for (let i = 0; i < 30; i++) { const current = upcoming.current, next = upcoming.peekNext(); assert.equal(upcoming.current, current); assert.equal(upcoming.peekNext(), next); assert.equal(upcoming.next(), next); }
  const sequential = new PlaybackOrder(3, false, false); assert.equal(sequential.next(), 1); assert.equal(sequential.next(), 2); assert.equal(sequential.next(), null); assert.equal(sequential.next(-1), 1);
  const one = new PlaybackOrder(1, false, false); assert.equal(one.next(), null);
  let seed = 21; const random = new PlaybackOrder(10, true, true, 0, () => ((seed = seed * 16807 % 2147483647) / 2147483647));
  const firstRound = [random.current, ...Array.from({ length: 9 }, () => random.next())]; assert.equal(new Set(firstRound).size, 10);
  const secondRound = Array.from({ length: 10 }, () => random.next()); assert.equal(new Set(secondRound).size, 10); assert.notEqual(secondRound[0], firstRound.at(-1));
  const before = random.current; const previous = random.next(-1); assert.notEqual(previous, before); assert.equal(random.next(), before);
  for (let i = 0; i < 5000; i++) random.next(); assert(random.history.length <= 20);
});
