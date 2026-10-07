import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('resources/licenses'); await mkdir(root, { recursive: true });
const packages = ['react', 'react-dom', 'scheduler', 'lucide-react', 'heic-convert', 'heic-decode', 'libheif-js', 'jpeg-js', 'pngjs', '@types/react', 'csstype'];
const entries = [];
for (const name of packages) {
  const directory = path.resolve('node_modules', name);
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const license = (await readdir(directory)).find(file => /^licen[sc]e(?:\.|$)/i.test(file));
  const destination = `${name.replaceAll('/', '-').replace('@', '')}-${pkg.version}.txt`;
  if (license) await copyFile(path.join(directory, license), path.join(root, destination));
  else if (pkg.license === 'ISC') await writeFile(path.join(root, destination), `Component: ${name} ${pkg.version}\nAuthor: ${pkg.author}\nThe upstream package declares ISC in package.json and does not include a separate license file. The standard ISC permission text is reproduced below. Copyright remains with the component author.\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n`);
  else throw new Error(`No license text for ${name}`);
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || pkg.homepage;
  entries.push(`| ${name} | ${pkg.version} | ${pkg.license} | [源码](${url.replace(/^git\+/, '').replace(/\.git$/, '')}) | [许可全文](licenses/${destination}) |`);
}
await copyFile('node_modules/electron/dist/LICENSE', path.join(root, 'Electron-44.6.0.txt'));
await copyFile('node_modules/electron/dist/LICENSES.chromium.html', path.join(root, 'Chromium-third-party.html'));
await copyFile('node_modules/libheif-js/LICENSE', path.join(root, 'LGPL-3.0.txt'));
const notices = `# 第三方许可说明

拾光相册自身源码使用 MIT 许可。以下组件保留原作者的版权和许可，不能因拾光相册的 MIT 许可而更改。许可证全文位于本目录的 licenses 文件夹。

| 组件 | 版本 | 许可 | 上游 | 全文 |
| --- | --- | --- | --- | --- |
${entries.join('\n')}
| Electron | 44.6.0 | MIT / Chromium 多种第三方许可 | [源码](https://github.com/electron/electron/tree/v44.6.0) | [MIT](licenses/Electron-44.6.0.txt)、[Chromium](licenses/Chromium-third-party.html) |

## HEIC 解码组件

HEIC 转换使用 heic-convert 2.1.0、heic-decode 2.1.0 和未修改的 libheif-js 1.23.5（LGPL-3.0）。libheif-js 内含 libheif 及其解码器，原始许可证和完整对应源代码、构建说明附在 third-party-source 目录。GPL-3.0 与 LGPL-3.0 全文均附在 licenses 目录。

libheif-js 以独立 CommonJS 模块加载，安装版的 resources/app.asar.unpacked/node_modules/libheif-js 可以替换为 API 兼容的修改版本；便携版可先解包为普通目录。源代码构建也可替换 node_modules/libheif-js 后重新打包。应用不限制为调试这些 LGPL 组件而进行修改或逆向工程。替换组件仅需兼容现有 API，不需要签名或访问网络。

构建 libheif-js 使用的代码版本：catdad-experiments/libheif-js 提交 d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d；catdad-experiments/libheif-emscripten v1.23.5（5c8968a44e9c68ae677e24790d77d001ed7fe7cc）；内嵌 libheif 提交 413e2a87e6a70b3eccc3a3adc5801179dd2d9e00。详情见对应源代码说明。

## 示例照片

六张公开示例照片来自 Unsplash，采用 Unsplash License；见 [照片来源](demo/CREDITS.md)。这些照片不适用应用源码的 MIT 许可。

## 构建工具

开发时还使用 TypeScript、Vite、electron-builder 等构建工具，具体版本锁定在 package-lock.json。它们不会作为应用功能运行；重新分发这些工具时请保留其上游许可。
`;
await writeFile('resources/THIRD-PARTY-NOTICES.md', notices);
console.log(`Collected ${packages.length + 1} component license files.`);
