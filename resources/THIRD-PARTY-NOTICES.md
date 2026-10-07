# 第三方许可说明

拾光相册自身源码使用 MIT 许可。以下组件保留原作者的版权和许可，不能因拾光相册的 MIT 许可而更改。许可证全文位于本目录的 licenses 文件夹。

| 组件 | 版本 | 许可 | 上游 | 全文 |
| --- | --- | --- | --- | --- |
| react | 19.3.0 | MIT | [源码](https://github.com/react/react) | [许可全文](licenses/react-19.3.0.txt) |
| react-dom | 19.3.0 | MIT | [源码](https://github.com/react/react) | [许可全文](licenses/react-dom-19.3.0.txt) |
| scheduler | 0.28.0 | MIT | [源码](https://github.com/react/react) | [许可全文](licenses/scheduler-0.28.0.txt) |
| lucide-react | 1.52.0 | ISC | [源码](https://github.com/lucide-icons/lucide) | [许可全文](licenses/lucide-react-1.52.0.txt) |
| heic-convert | 2.1.0 | ISC | [源码](https://github.com/catdad-experiments/heic-convert) | [许可全文](licenses/heic-convert-2.1.0.txt) |
| heic-decode | 2.1.0 | ISC | [源码](https://github.com/catdad-experiments/heic-decode) | [许可全文](licenses/heic-decode-2.1.0.txt) |
| libheif-js | 1.23.5 | LGPL-3.0 | [源码](https://github.com/catdad-experiments/libheif-js) | [许可全文](licenses/libheif-js-1.23.5.txt) |
| jpeg-js | 0.4.4 | BSD-3-Clause | [源码](https://github.com/eugeneware/jpeg-js) | [许可全文](licenses/jpeg-js-0.4.4.txt) |
| pngjs | 6.0.0 | MIT | [源码](git://github.com/lukeapage/pngjs) | [许可全文](licenses/pngjs-6.0.0.txt) |
| @types/react | 19.3.0 | MIT | [源码](https://github.com/DefinitelyTyped/DefinitelyTyped) | [许可全文](licenses/types-react-19.3.0.txt) |
| csstype | 3.2.3 | MIT | [源码](https://github.com/frenic/csstype) | [许可全文](licenses/csstype-3.2.3.txt) |
| Electron | 44.6.0 | MIT / Chromium 多种第三方许可 | [源码](https://github.com/electron/electron/tree/v44.6.0) | [MIT](licenses/Electron-44.6.0.txt)、[Chromium](licenses/Chromium-third-party.html) |

## HEIC 解码组件

HEIC 转换使用 heic-convert 2.1.0、heic-decode 2.1.0 和未修改的 libheif-js 1.23.5（LGPL-3.0）。libheif-js 内含 libheif 及其解码器，原始许可证和完整对应源代码、构建说明附在 third-party-source 目录。GPL-3.0 与 LGPL-3.0 全文均附在 licenses 目录。

libheif-js 以独立 CommonJS 模块加载，安装版的 resources/app.asar.unpacked/node_modules/libheif-js 可以替换为 API 兼容的修改版本；便携版可先解包为普通目录。源代码构建也可替换 node_modules/libheif-js 后重新打包。应用不限制为调试这些 LGPL 组件而进行修改或逆向工程。替换组件仅需兼容现有 API，不需要签名或访问网络。

构建 libheif-js 使用的代码版本：catdad-experiments/libheif-js 提交 d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d；catdad-experiments/libheif-emscripten v1.23.5（5c8968a44e9c68ae677e24790d77d001ed7fe7cc）；内嵌 libheif 提交 413e2a87e6a70b3eccc3a3adc5801179dd2d9e00。详情见对应源代码说明。

## 示例照片

六张公开示例照片来自 Unsplash，采用 Unsplash License；见 [照片来源](demo/CREDITS.md)。这些照片不适用应用源码的 MIT 许可。

## 构建工具

开发时还使用 TypeScript、Vite、electron-builder 等构建工具，具体版本锁定在 package-lock.json。它们不会作为应用功能运行；重新分发这些工具时请保留其上游许可。
