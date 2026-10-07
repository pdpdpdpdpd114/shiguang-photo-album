import type { AlbumApi, ImportProgress, ImportResult, Library, PlaybackSettings, Photo } from '../shared/types';
import { DEFAULT_SETTINGS, PHOTO_EXTENSIONS } from '../shared/defaults';

// Browser preview uses its own IndexedDB; desktop always uses the restricted Electron bridge.
const urls = new Map<string, string>();
let db: IDBDatabase;
let state: Library;
let initializing: Promise<void> | null = null;
let cancelled = false;
const listeners = new Set<(progress: ImportProgress) => void>();
const files = ['01-湖山之间.jpg', '02-远山来信.jpg', '03-森林慢行.jpg', '04-湖畔日光.jpg', '05-星夜雪山.jpg', '06-旷野旅途.jpg'];

function transaction<T>(store: string, mode: IDBTransactionMode, work: (object: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), request = work(tx.objectStore(store)); let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(result!); tx.onabort = () => reject(tx.error || new Error('浏览器存储失败'));
  });
}
async function init(): Promise<void> {
  if (initializing) return initializing;
  initializing = initializeDatabase();
  return initializing;
}
async function initializeDatabase(): Promise<void> {
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('shiguang-album-preview', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('meta'); request.result.createObjectStore('assets'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  state = await transaction<Library>('meta', 'readonly', object => object.get('library'));
  if (!state) {
    const now = new Date().toISOString(), id = crypto.randomUUID();
    state = { version: 1, albums: [{ id, name: '山海之间', createdAt: now, updatedAt: now, coverId: 'demo-0', isDemo: true,
      music: null, settings: { ...DEFAULT_SETTINGS }, photos: files.map((name, i) => ({ id: `demo-${i}`, name, src: `/resources/demo/${encodeURIComponent(name)}`,
        thumbnailSrc: `/resources/demo/${encodeURIComponent(name)}`, width: 1600, height: 1067, size: 0, format: 'JPG' })) }] };
    await persist();
  }
}
async function persist(): Promise<void> { await transaction('meta', 'readwrite', object => object.put(state, 'library')); }
async function view(): Promise<Library> {
  await init(); const library = structuredClone(state);
  const resolve = async (src: string) => {
    if (!src.startsWith('browser-asset:')) return src;
    const key = src.slice('browser-asset:'.length);
    if (!urls.has(key)) { const blob = await transaction<Blob>('assets', 'readonly', object => object.get(key)); if (blob) urls.set(key, URL.createObjectURL(blob)); }
    return urls.get(key) || '';
  };
  for (const album of library.albums) {
    for (const photo of album.photos) { photo.src = await resolve(photo.src); photo.thumbnailSrc = await resolve(photo.thumbnailSrc); }
    if (album.music) album.music.src = await resolve(album.music.src);
  }
  return library;
}
function album(id: string) { const item = state.albums.find(a => a.id === id); if (!item) throw new Error('相册不存在'); return item; }
function pick(accept: string, multiple: boolean, folder = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple;
    if (folder) input.setAttribute('webkitdirectory', '');
    input.onchange = () => { resolve(Array.from(input.files || [])); input.remove(); };
    input.oncancel = () => { resolve([]); input.remove(); };
    input.style.display = 'none'; document.body.append(input); input.click();
  });
}
async function importFiles(id: string, selected: File[]): Promise<ImportResult | null> {
  if (!selected.length) return null; cancelled = false; const target = album(id);
  const result: ImportResult = { imported: 0, skipped: 0, failed: [], library: await view() };
  for (const [index, file] of selected.entries()) {
    if (cancelled) { result.cancelled = true; break; }
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    try {
      if (!PHOTO_EXTENSIONS.includes(ext)) throw new Error('不支持的图片格式');
      if (ext === '.heic' || ext === '.heif') throw new Error('HEIC 原图请使用桌面版导入');
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
      if (target.photos.some(p => p.id === hash)) { result.skipped++; continue; }
      const src = URL.createObjectURL(file); const image = new Image(); image.src = src;
      try { await image.decode(); } catch { URL.revokeObjectURL(src); throw new Error('图片损坏或无法解码'); }
      await transaction('assets', 'readwrite', object => object.put(file, hash)); urls.set(hash, src);
      const photo: Photo = { id: hash, name: file.name, src: `browser-asset:${hash}`, thumbnailSrc: `browser-asset:${hash}`, width: image.naturalWidth, height: image.naturalHeight, size: file.size, format: ext.slice(1).toUpperCase() };
      target.photos.push(photo); target.coverId ??= hash; result.imported++;
    } catch (error) { result.failed.push({ name: file.name, reason: (error as Error).message }); }
    finally { listeners.forEach(listener => listener({ albumId: id, done: index + 1, total: selected.length, name: file.name })); }
  }
  target.updatedAt = new Date().toISOString(); await persist(); result.library = await view(); return result;
}

export const browserApi: AlbumApi = {
  isDesktop: false,
  getLibrary: view,
  async createAlbum(name) { await init(); const now = new Date().toISOString(); state.albums.unshift({ id: crypto.randomUUID(), name: name.trim(), createdAt: now, updatedAt: now, coverId: null, photos: [], music: null, settings: { ...DEFAULT_SETTINGS } }); await persist(); return view(); },
  async renameAlbum(id, name) { album(id).name = name.trim(); await persist(); return view(); },
  async deleteAlbum(id) { if (!confirm('移除这个相册？导入前的原文件会保留。')) return null; state.albums = state.albums.filter(a => a.id !== id); await persist(); return view(); },
  async importPhotos(id, kind) { return importFiles(id, await pick(PHOTO_EXTENSIONS.join(','), true, kind === 'folder')); },
  importDropped: importFiles,
  async cancelImport() { cancelled = true; },
  async reorderPhotos(id, ids) { const item = album(id), byId = new Map(item.photos.map(p => [p.id, p])); item.photos = ids.map(photoId => byId.get(photoId)!); await persist(); return view(); },
  async setCover(id, photoId) { album(id).coverId = photoId; await persist(); return view(); },
  async removePhotos(id, ids) { if (!confirm(`移除 ${ids.length} 张照片？`)) return null; const item = album(id); item.photos = item.photos.filter(p => !ids.includes(p.id)); if (ids.includes(item.coverId || '')) item.coverId = item.photos[0]?.id || null; await persist(); return view(); },
  async selectMusic(id) { const [file] = await pick('.mp3,.wav,.ogg,.m4a', false); if (!file) return null; const key = crypto.randomUUID(); await transaction('assets', 'readwrite', object => object.put(file, key)); album(id).music = { id: key, name: file.name, src: `browser-asset:${key}` }; await persist(); return view(); },
  async removeMusic(id) { album(id).music = null; await persist(); return view(); },
  async saveSettings(id, settings: Partial<PlaybackSettings>) { Object.assign(album(id).settings, settings); await persist(); return view(); },
  async toggleFullscreen() { if (document.fullscreenElement) { await document.exitFullscreen(); return false; } await document.documentElement.requestFullscreen(); return true; },
  async setPlaybackActive() {},
  onImportProgress(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
};
