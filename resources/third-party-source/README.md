# HEIC 组件对应源代码

这些未经修改的源码随拾光相册 1.0.0 分发。下载目录中的 tar.gz 文件是完整的源码存档，不是应用的个人数据。

| 文件 | 来源与准确版本 | 许可 |
| --- | --- | --- |
| libheif-js-d8ec4bc3.tar.gz | [catdad-experiments/libheif-js](https://github.com/catdad-experiments/libheif-js/tree/d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d)，npm 1.23.5 的 gitHead | LGPL-3.0 |
| libheif-emscripten-5c8968a4.tar.gz | [catdad-experiments/libheif-emscripten v1.23.5](https://github.com/catdad-experiments/libheif-emscripten/tree/v1.23.5)，包含构建工作流与发布整理脚本 | LGPL 组件的构建脚本 |
| libheif-413e2a87.tar.gz | [strukturag/libheif](https://github.com/strukturag/libheif/tree/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00)，上面构建仓库锁定的子模块版本 | LGPL-3.0；部分示例 MIT |
| libde265-1.0.15.tar.gz | [strukturag/libde265 v1.0.15](https://github.com/strukturag/libde265/tree/v1.0.15)，libheif Emscripten 构建脚本指定的 HEVC 解码器 | LGPL-3.0（详见源码 COPYING） |

重建方法：使用 Emscripten 3.1.61、Node.js 24 和 CMake / Autotools，遵照 libheif-emscripten 的 `.github/workflows/emscripten.yml`。其子模块文件夹填入附带的 libheif 源码；libheif 的 `build-emscripten.sh` 默认启用 libde265 1.0.15，默认不启用 AOM、OpenJPEG 或 WebCodecs。可将附带的 libde265 源码归档放到构建目录，避免重复下载。

工作流为 JS 与 WASM 分别执行 `scripts/install-ci-linux.sh`、`scripts/prepare-ci.sh` 和修改了 `USE_WASM` / `USE_UNSAFE_EVAL=0` / `USE_TYPESCRIPT=1` 的 `scripts/run-ci.sh`，再通过 `dist-prep.sh` 生成分发目录。

在 libheif-js 源码目录安装其开发依赖，运行 `node scripts/install.js /path/to/libheif.tar.gz`，该脚本会整理编译文件并生成 Node.js 与浏览器用的 WASM bundle。然后把重建的 libheif-js 放到拾光相册的 `node_modules/libheif-js`，运行 `npm run dist`。

安装版中组件解包到 `resources/app.asar.unpacked/node_modules/libheif-js`，可以替换同 API 的修改版本，无须云服务或签名。项目 MIT 许可不限制为调试 LGPL 组件而进行修改和逆向工程。

许可证全文位于上一级 `licenses` 文件夹及各源码存档内部。源代码文件的 SHA-256 见本目录 `SHA256SUMS.txt`。
