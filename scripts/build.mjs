import { spawnSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

function run(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json']);
run('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.electron.json']);
run('node_modules/vite/bin/vite.js', ['build']);
await mkdir('dist-electron/electron', { recursive: true });
for (const file of ['preload.cjs', 'media-worker.cjs']) {
  await cp(path.join('electron', file), path.join('dist-electron/electron', file));
}
