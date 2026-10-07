import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('release');
const files = (await readdir(root)).filter(name => /\.(exe|zip|md|html|tar\.gz)$/.test(name) && !name.startsWith('SHA256')).sort();
const lines = [];
for (const name of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(root, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile(path.join(root, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`SHA-256 checksums saved for ${files.length} release files.`);
