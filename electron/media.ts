import { BrowserWindow } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ProcessImage } from './storage.js';

let worker: Worker | null = null;
let imageWindow: BrowserWindow | null = null;
let imageWindowReady: Promise<BrowserWindow> | null = null;
let sequence = 0;
let activeConversions = 0;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;
let decoderIdleTimer: ReturnType<typeof setTimeout> | null = null;
let activeImages = 0;

function stopConverter(): void {
  if (workerIdleTimer) clearTimeout(workerIdleTimer); workerIdleTimer = null;
  const previous = worker; worker = null; void previous?.terminate();
}

export function closeMediaWorker(): void {
  stopConverter();
  if (decoderIdleTimer) clearTimeout(decoderIdleTimer); decoderIdleTimer = null;
  imageWindow?.destroy(); imageWindow = null; imageWindowReady = null;
}

export function mediaWorkerStatus() { return { converter: Boolean(worker), decoder: Boolean(imageWindow), activeConversions, activeImages }; }

// Chromium handles the same image formats and EXIF orientation as the player.
// This separate sandboxed renderer has no preload, IPC bridge or network access.
async function imageDecoder(): Promise<BrowserWindow> {
  if (!imageWindowReady) imageWindowReady = (async () => {
    const decoder = new BrowserWindow({ show: false, skipTaskbar: true, width: 16, height: 16,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, devTools: false } });
    imageWindow = decoder;
    decoder.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    decoder.webContents.on('will-navigate', event => event.preventDefault());
    decoder.on('closed', () => { imageWindow = null; imageWindowReady = null; });
    await decoder.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; object-src \'none\'; base-uri \'none\'">'));
    return decoder;
  })();
  return imageWindowReady;
}

export function convertHeic(input: Buffer): Promise<Buffer> {
  if (workerIdleTimer) clearTimeout(workerIdleTimer); workerIdleTimer = null;
  if (!worker) worker = new Worker(path.join(import.meta.dirname, 'media-worker.cjs'));
  const current = worker, id = ++sequence; activeConversions++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { cleanup(); stopConverter(); reject(new Error('HEIC 转换超时，请尝试更小的照片')); }, 60000);
    const message = (result: { id: number; buffer?: Uint8Array; error?: string }) => {
      if (result.id !== id) return; cleanup();
      if (result.error) reject(new Error(result.error)); else resolve(Buffer.from(result.buffer!));
    };
    const error = (reason: Error) => { cleanup(); if (worker === current) stopConverter(); reject(reason); };
    const exited = () => error(new Error('HEIC 转换线程意外结束'));
    const cleanup = () => {
      if (settled) return; settled = true; activeConversions--;
      clearTimeout(timer); current.off('message', message); current.off('error', error); current.off('exit', exited);
      if (!activeConversions && worker === current) workerIdleTimer = setTimeout(() => { if (!activeConversions && worker === current) stopConverter(); }, 5000);
    };
    current.on('message', message); current.once('error', error); current.once('exit', exited);
    try { const bytes = new Uint8Array(input); current.postMessage({ id, buffer: bytes }, [bytes.buffer]); }
    catch (reason) { error(reason as Error); }
  });
}

export const processImage: ProcessImage = async (original, directory, id, ext) => {
  let displayFile = path.basename(original);
  if (ext === '.heic' || ext === '.heif') {
    displayFile = `${id}-display.jpg`;
    await fs.writeFile(path.join(directory, displayFile), await convertHeic(await fs.readFile(original)));
  }
  const mime = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif' } as Record<string, string>)[path.extname(displayFile).toLowerCase()];
  const data = `data:${mime};base64,${(await fs.readFile(path.join(directory, displayFile))).toString('base64')}`;
  if (decoderIdleTimer) clearTimeout(decoderIdleTimer); decoderIdleTimer = null; activeImages++;
  try {
  const decoder = await imageDecoder();
  const decoded = await decoder.webContents.executeJavaScript(`(async () => {
    const image = new Image(); image.src = ${JSON.stringify(data)};
    try {
      await image.decode(); const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width * height > 100000000) throw new Error('照片尺寸过大（最多 1 亿像素）');
      const canvas = document.createElement('canvas'), ratio = Math.min(1, 512 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
      const context = canvas.getContext('2d'); context.fillStyle = '#161c18'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const thumbnail = canvas.toDataURL('image/jpeg', .84).split(',')[1]; canvas.width = canvas.height = 1;
      return { width, height, thumbnail };
    } catch (error) { throw new Error(error.message.includes('尺寸过大') ? error.message : '图片损坏或无法解码'); }
    finally { image.removeAttribute('src'); }
  })()`) as { width: number; height: number; thumbnail: string };
  const thumbnailFile = `${id}-thumb.jpg`;
  await fs.writeFile(path.join(directory, thumbnailFile), Buffer.from(decoded.thumbnail, 'base64'));
  return { displayFile, thumbnailFile, width: decoded.width, height: decoded.height };
  } finally {
    activeImages--;
    if (!activeImages) decoderIdleTimer = setTimeout(() => {
      if (!activeImages) { imageWindow?.destroy(); imageWindow = null; imageWindowReady = null; }
      decoderIdleTimer = null;
    }, 5000);
  }
};
