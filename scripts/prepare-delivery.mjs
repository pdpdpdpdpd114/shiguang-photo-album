import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

// Build a self-contained, offline guide from the source document and demo screenshot.
const root = path.resolve('release'); await mkdir(root, { recursive: true });
const image = (await readFile('docs/screenshots/home.png')).toString('base64');
const html = (await readFile('docs/使用说明.html', 'utf8')).replace('src="screenshots/home.png"', `src="data:image/png;base64,${image}"`);
await writeFile(path.join(root, '拾光相册-使用说明.html'), html);
await copyFile('README.md', path.join(root, '使用说明.md'));
await copyFile('docs/QA.md', path.join(root, '验收记录.md'));
await copyFile('docs/RELEASE-NOTES-v1.0.0.md', path.join(root, '版本说明.md'));
await copyFile('resources/THIRD-PARTY-NOTICES.md', path.join(root, '第三方许可说明.md'));
console.log('Offline guide and delivery documents prepared.');
