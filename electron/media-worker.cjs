const { parentPort } = require('node:worker_threads');
const convert = require('heic-convert');

parentPort.on('message', async ({ id, buffer }) => {
  try {
    const result = await convert({ buffer: Buffer.from(buffer), format: 'JPEG', quality: 0.92 });
    const bytes = new Uint8Array(result);
    parentPort.postMessage({ id, buffer: bytes }, [bytes.buffer]);
  } catch (error) {
    parentPort.postMessage({ id, error: `HEIC 转换失败：${error.message || '无法解码此照片'}` });
  }
});
