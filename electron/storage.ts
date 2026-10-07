import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS, MUSIC_EXTENSIONS, PHOTO_EXTENSIONS } from '../shared/defaults.js';
import type { Album, ImportProgress, ImportResult, Library, PlaybackSettings } from '../shared/types.js';

interface StoredPhoto {
  id: string; name: string; originalFile: string; displayFile: string; thumbnailFile: string;
  width: number; height: number; size: number; digest: string; format: string;
}
interface StoredMusic { id: string; name: string; file: string; }
interface StoredAlbum {
  id: string; name: string; createdAt: string; updatedAt: string; coverId: string | null;
  photos: StoredPhoto[]; music: StoredMusic | null; settings: PlaybackSettings; isDemo?: boolean;
}
interface StoredLibrary { version: 1; albums: StoredAlbum[]; }
export interface ProcessedImage { displayFile: string; thumbnailFile: string; width: number; height: number; }
export type ProcessImage = (original: string, directory: string, id: string, ext: string) => Promise<ProcessedImage>;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = /^[0-9a-f-]+(?:-display|-thumb)?\.[a-z0-9]+$/i;
const EFFECTS = ['random', 'fade', 'slide-x', 'slide-y', 'zoom', 'kenburns', 'flip', 'cube', 'blinds-x', 'blinds-y', 'mosaic'];

export function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请输入相册名称');
  const name = value.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 80);
  if (!name) throw new Error('相册名称不能为空');
  return name;
}

export function checkedSettings(value: unknown, base = DEFAULT_SETTINGS): PlaybackSettings {
  if (!value || typeof value !== 'object') throw new Error('播放设置无效');
  const input = value as Partial<PlaybackSettings>;
  const next = { ...base };
  for (const key of Object.keys(input)) {
    const v = input[key as keyof PlaybackSettings];
    switch (key) {
      case 'theme': if (!['warm', 'cinematic', 'electric'].includes(String(v))) throw new Error('主题无效'); next.theme = v as PlaybackSettings['theme']; break;
      case 'effect': if (!EFFECTS.includes(String(v))) throw new Error('动效无效'); next.effect = v as PlaybackSettings['effect']; break;
      case 'fit': if (!['contain', 'cover'].includes(String(v))) throw new Error('显示方式无效'); next.fit = v as PlaybackSettings['fit']; break;
      case 'holdSeconds': if (typeof v !== 'number' || !Number.isFinite(v) || v < 3 || v > 30) throw new Error('停留时间应为 3–30 秒'); next.holdSeconds = v; break;
      case 'volume': if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new Error('音量无效'); next.volume = v; break;
      case 'randomOrder': case 'loop': case 'muted': if (typeof v !== 'boolean') throw new Error('播放设置无效'); next[key] = v; break;
      default: throw new Error('未知的播放设置');
    }
  }
  return next;
}

function validateLibrary(value: unknown): StoredLibrary {
  const lib = value as StoredLibrary;
  if (!lib || lib.version !== 1 || !Array.isArray(lib.albums)) throw new Error('相册索引格式无效');
  const ids = new Set<string>();
  for (const album of lib.albums) {
    if (!album || !ID.test(album.id) || ids.has(album.id) || !Array.isArray(album.photos)) throw new Error('相册索引损坏');
    ids.add(album.id); album.name = cleanName(album.name); album.settings = checkedSettings(album.settings);
    if (typeof album.createdAt !== 'string' || typeof album.updatedAt !== 'string' || !Number.isFinite(Date.parse(album.createdAt)) || !Number.isFinite(Date.parse(album.updatedAt))) throw new Error('相册索引损坏');
    const photoIds = new Set<string>();
    for (const photo of album.photos) {
      if (!photo || !ID.test(photo.id) || photoIds.has(photo.id) || !FILE.test(photo.originalFile) || !FILE.test(photo.displayFile) || !FILE.test(photo.thumbnailFile) || typeof photo.digest !== 'string' || typeof photo.name !== 'string' || !Number.isFinite(photo.width) || !Number.isFinite(photo.height)) throw new Error('照片索引损坏');
      photoIds.add(photo.id);
    }
    if (album.coverId && !photoIds.has(album.coverId)) album.coverId = album.photos[0]?.id ?? null;
    if (album.music && (!ID.test(album.music.id) || !FILE.test(album.music.file) || typeof album.music.name !== 'string')) throw new Error('音乐索引损坏');
  }
  return lib;
}

export function assertWithin(root: string, target: string): string {
  const absolute = path.resolve(target);
  const relative = path.relative(path.resolve(root), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('拒绝访问相册库之外的文件');
  return absolute;
}

function readableError(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  if (e.code === 'ENOSPC') return '磁盘空间不足';
  if (e.code === 'EACCES' || e.code === 'EPERM') return '没有读取或写入权限';
  if (e.code === 'ENOENT') return '文件不存在或已移动';
  return e.message?.slice(0, 200) || '文件处理失败';
}

async function digestFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Windows antivirus and file indexers can briefly deny replacement of a closed file.
// Retry the atomic rename itself; never delete the old index to make room.
export async function atomicReplace(source: string, target: string, rename = fs.rename): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, target); return; }
    catch (error) {
      if (attempt >= 9 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(200, 25 * 2 ** attempt)));
    }
  }
}

export class LibraryStore {
  private data: StoredLibrary = { version: 1, albums: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private warning?: string;
  readonly manifest: string;
  readonly albumsDirectory: string;

  constructor(readonly root: string, private processImage: ProcessImage) {
    this.root = path.resolve(root);
    this.manifest = path.join(this.root, 'library.json');
    this.albumsDirectory = path.join(this.root, 'albums');
  }

  async initialize(): Promise<boolean> {
    await fs.mkdir(this.albumsDirectory, { recursive: true });
    try {
      this.data = validateLibrary(JSON.parse(await fs.readFile(this.manifest, 'utf8')));
      return false;
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      try {
        this.data = validateLibrary(JSON.parse(await fs.readFile(this.manifest + '.bak', 'utf8')));
        this.warning = '上次保存的索引未能读取，已恢复最近一次备份。';
        await this.persist(this.data, false);
        return false;
      } catch {
        if (!missing) throw new Error('相册索引及备份均未能读取。数据已保留，请先备份相册库后再恢复。');
        await this.persist(this.data, false);
        return true;
      }
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(work, work);
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async persist(next: StoredLibrary, backup = true): Promise<void> {
    const temp = this.manifest + '.tmp';
    const handle = await fs.open(temp, 'w');
    try { await handle.writeFile(JSON.stringify(next, null, 2), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    if (backup) {
      await fs.copyFile(this.manifest, this.manifest + '.bak.tmp');
      await atomicReplace(this.manifest + '.bak.tmp', this.manifest + '.bak');
    }
    await atomicReplace(temp, this.manifest);
    this.data = next;
  }

  private album(id: string, data = this.data): StoredAlbum {
    if (!ID.test(id)) throw new Error('相册不存在');
    const album = data.albums.find(a => a.id === id);
    if (!album) throw new Error('相册不存在');
    return album;
  }

  snapshot(): Library {
    return {
      version: 1, warning: this.warning,
      albums: this.data.albums.map(a => ({
        id: a.id, name: a.name, createdAt: a.createdAt, updatedAt: a.updatedAt,
        coverId: a.coverId, settings: { ...a.settings }, isDemo: a.isDemo,
        photos: a.photos.map(p => ({ id: p.id, name: p.name, width: p.width, height: p.height, size: p.size, format: p.format,
          src: `album://media/${a.id}/${p.id}/display`, thumbnailSrc: `album://media/${a.id}/${p.id}/thumbnail` })),
        music: a.music ? { id: a.music.id, name: a.music.name, src: `album://media/${a.id}/${a.music.id}/music` } : null,
      })),
    };
  }

  private update(id: string, edit: (album: StoredAlbum) => void): Promise<Library> {
    return this.enqueue(async () => {
      const next = structuredClone(this.data);
      const album = this.album(id, next); edit(album); album.updatedAt = new Date().toISOString();
      await this.persist(next); return this.snapshot();
    });
  }

  createAlbum(name: string, isDemo = false): Promise<Library> {
    const clean = cleanName(name);
    return this.enqueue(async () => {
      const next = structuredClone(this.data); const now = new Date().toISOString();
      const album: StoredAlbum = { id: randomUUID(), name: clean, createdAt: now, updatedAt: now, coverId: null,
        photos: [], music: null, settings: { ...DEFAULT_SETTINGS }, isDemo };
      await fs.mkdir(this.albumDirectory(album.id), { recursive: true });
      next.albums.unshift(album); await this.persist(next); return this.snapshot();
    });
  }

  renameAlbum(id: string, name: string): Promise<Library> { return this.update(id, a => { a.name = cleanName(name); }); }
  saveSettings(id: string, settings: Partial<PlaybackSettings>): Promise<Library> { return this.update(id, a => { a.settings = checkedSettings(settings, a.settings); }); }
  setCover(id: string, photoId: string): Promise<Library> { return this.update(id, a => {
    if (!a.photos.some(p => p.id === photoId)) throw new Error('照片不存在'); a.coverId = photoId;
  }); }
  reorderPhotos(id: string, ids: string[]): Promise<Library> { return this.update(id, a => {
    if (!Array.isArray(ids) || ids.length !== a.photos.length || new Set(ids).size !== ids.length) throw new Error('照片顺序无效');
    const byId = new Map(a.photos.map(p => [p.id, p]));
    a.photos = ids.map(photoId => { const photo = byId.get(photoId); if (!photo) throw new Error('照片顺序无效'); return photo; });
  }); }

  private albumDirectory(id: string): string {
    if (!ID.test(id)) throw new Error('相册路径无效');
    return assertWithin(this.albumsDirectory, path.join(this.albumsDirectory, id));
  }

  async deleteAlbum(id: string): Promise<Library> {
    return this.enqueue(async () => {
      this.album(id); const next = structuredClone(this.data);
      next.albums = next.albums.filter(a => a.id !== id); await this.persist(next);
      // Validate the final absolute target before recursive deletion on Windows.
      const directory = this.albumDirectory(id);
      await fs.rm(assertWithin(this.albumsDirectory, directory), { recursive: true, force: true });
      return this.snapshot();
    });
  }

  async removePhotos(id: string, ids: string[]): Promise<Library> {
    return this.enqueue(async () => {
      if (!Array.isArray(ids) || !ids.length) throw new Error('请选择要移除的照片');
      const next = structuredClone(this.data), album = this.album(id, next);
      if (ids.some(photoId => !album.photos.some(p => p.id === photoId))) throw new Error('照片不存在');
      const removed = album.photos.filter(p => ids.includes(p.id)); album.photos = album.photos.filter(p => !ids.includes(p.id));
      if (album.coverId && ids.includes(album.coverId)) album.coverId = album.photos[0]?.id ?? null;
      album.updatedAt = new Date().toISOString(); await this.persist(next);
      for (const photo of removed) for (const file of new Set([photo.originalFile, photo.displayFile, photo.thumbnailFile])) {
        await fs.unlink(assertWithin(this.albumDirectory(id), path.join(this.albumDirectory(id), file))).catch(() => undefined);
      }
      return this.snapshot();
    });
  }

  async importPaths(id: string, paths: string[], onProgress?: (progress: ImportProgress) => void, cancelled = () => false): Promise<ImportResult> {
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string') || paths.length > 20000) throw new Error('导入文件列表无效');
    return this.enqueue(async () => {
      const next = structuredClone(this.data), album = this.album(id, next), directory = this.albumDirectory(id);
      const known = new Set(album.photos.map(p => p.digest));
      const result: ImportResult = { library: this.snapshot(), imported: 0, skipped: 0, failed: [] };
      const created: string[] = [];
      let done = 0;
      for (const file of paths) {
        if (cancelled()) { result.cancelled = true; break; }
        const name = path.basename(file); const ext = path.extname(file).toLowerCase();
        const photoId = randomUUID(); const originalFile = `${photoId}${ext}`;
        const originalPath = assertWithin(directory, path.join(directory, originalFile));
        const perFile: string[] = [];
        try {
          if (!PHOTO_EXTENSIONS.includes(ext)) throw new Error('不支持的图片格式');
          const stat = await fs.stat(file);
          if (!stat.isFile() || stat.size === 0) throw new Error('不是有效的图片文件');
          if (stat.size > 200 * 1024 * 1024) throw new Error('单张照片不能超过 200 MB');
          const digest = await digestFile(file);
          if (known.has(digest)) { result.skipped++; continue; }
          await this.ensureSpace(stat.size * (ext === '.heic' || ext === '.heif' ? 4 : 1) + 5 * 1024 * 1024);
          await fs.copyFile(file, originalPath); perFile.push(originalPath);
          const processed = await this.processImage(originalPath, directory, photoId, ext);
          for (const output of [processed.displayFile, processed.thumbnailFile]) {
            if (!FILE.test(output)) throw new Error('图片输出路径无效');
            perFile.push(assertWithin(directory, path.join(directory, output)));
          }
          album.photos.push({ id: photoId, name, originalFile, ...processed, size: stat.size, digest, format: ext.slice(1).toUpperCase() });
          known.add(digest); result.imported++; created.push(...perFile);
        } catch (error) {
          result.failed.push({ name, reason: readableError(error) });
          // The processor can fail after creating one of its outputs.
          for (const output of new Set([...perFile, path.join(directory, `${photoId}-display.jpg`), path.join(directory, `${photoId}-thumb.jpg`)])) {
            await fs.unlink(assertWithin(directory, output)).catch(() => undefined);
          }
        } finally { done++; onProgress?.({ albumId: id, done, total: paths.length, name }); }
      }
      if (result.imported) {
        album.coverId ??= album.photos[0]?.id ?? null; album.updatedAt = new Date().toISOString();
        try { await this.persist(next); }
        catch (error) { for (const file of new Set(created)) await fs.unlink(assertWithin(directory, file)).catch(() => undefined); throw error; }
      }
      result.library = this.snapshot(); return result;
    });
  }

  private async ensureSpace(bytes: number): Promise<void> {
    const stat = await fs.statfs(this.root);
    if (stat.bavail * stat.bsize < bytes + 16 * 1024 * 1024) {
      const error = new Error('磁盘空间不足') as NodeJS.ErrnoException; error.code = 'ENOSPC'; throw error;
    }
  }

  async selectMusic(id: string, file: string): Promise<Library> {
    return this.enqueue(async () => {
      const next = structuredClone(this.data), album = this.album(id, next), directory = this.albumDirectory(id);
      const ext = path.extname(file).toLowerCase();
      if (!MUSIC_EXTENSIONS.includes(ext)) throw new Error('请选择 MP3、WAV、OGG 或 M4A 音乐');
      const stat = await fs.stat(file); if (!stat.isFile() || stat.size === 0 || stat.size > 500 * 1024 * 1024) throw new Error('音乐文件无效或超过 500 MB');
      await this.ensureSpace(stat.size); const musicId = randomUUID(), filename = `${musicId}${ext}`;
      const destination = assertWithin(directory, path.join(directory, filename));
      await fs.copyFile(file, destination); const previous = album.music;
      album.music = { id: musicId, name: path.basename(file), file: filename }; album.updatedAt = new Date().toISOString();
      try { await this.persist(next); } catch (error) { await fs.unlink(destination).catch(() => undefined); throw error; }
      if (previous) await fs.unlink(assertWithin(directory, path.join(directory, previous.file))).catch(() => undefined);
      return this.snapshot();
    });
  }

  async removeMusic(id: string): Promise<Library> {
    return this.enqueue(async () => {
      const next = structuredClone(this.data), album = this.album(id, next), previous = album.music;
      album.music = null; album.updatedAt = new Date().toISOString(); await this.persist(next);
      if (previous) await fs.unlink(assertWithin(this.albumDirectory(id), path.join(this.albumDirectory(id), previous.file))).catch(() => undefined);
      return this.snapshot();
    });
  }

  mediaPath(albumId: string, assetId: string, kind: string): string {
    const album = this.album(albumId); let filename: string | undefined;
    if (kind === 'music' && album.music?.id === assetId) filename = album.music.file;
    else {
      const photo = album.photos.find(p => p.id === assetId);
      if (photo && kind === 'display') filename = photo.displayFile;
      if (photo && kind === 'thumbnail') filename = photo.thumbnailFile;
    }
    if (!filename || !FILE.test(filename)) throw new Error('资源不存在');
    return assertWithin(this.albumDirectory(albumId), path.join(this.albumDirectory(albumId), filename));
  }
}

export async function collectFolder(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function scan(folder: string): Promise<void> {
    const entries = await fs.readdir(folder, { withFileTypes: true }); entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) await scan(fullPath);
      else if (entry.isFile() && PHOTO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) files.push(fullPath);
      if (files.length > 20000) throw new Error('单次最多导入 20000 张照片，请分批导入');
    }
  }
  await scan(directory); return files;
}
