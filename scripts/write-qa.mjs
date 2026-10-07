import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [portableRoot, installedFreshFile, installedRestartFile] = process.argv.slice(2);
if (!portableRoot || !installedFreshFile || !installedRestartFile) throw new Error('Provide the completed portable soak directory and both installer reports.');
const portable = JSON.parse(await readFile(path.join(portableRoot, 'results.json'), 'utf8'));
const fresh = JSON.parse(await readFile(installedFreshFile, 'utf8'));
const restart = JSON.parse(await readFile(installedRestartFile, 'utf8'));
for (const report of [portable, fresh, restart]) {
  if (!report.packaged || !report.checks.every(check => check.passed) || report.consoleErrors.length) throw new Error('A packaged verification report has not passed.');
}
const longRun = portable.checks.find(check => check.check.includes('持续播放 30 分钟'))?.detail;
if (!longRun || longRun.seconds < 1800) throw new Error('The 30 minute playback check is incomplete.');
const samples = longRun.samples;
const renderer = samples.map(sample => sample.memory.privateBytes);
const total = samples.map(sample => sample.totalPrivateBytes);
const secondHalf = renderer.slice(Math.floor(renderer.length / 2));
const mb = value => (value / 1024).toFixed(1);
const heic = portable.checks.filter(check => check.check.startsWith('HEIC 离线转换')).map(check => `| ${check.check.replace('HEIC 离线转换：', '')} | ${check.detail.width} × ${check.detail.height} | 通过 |`).join('\n');
const qaDirectory = path.resolve('docs/qa'); await mkdir(qaDirectory, { recursive: true });
await copyFile(path.join(portableRoot, 'results.json'), path.join(qaDirectory, 'portable-soak.json'));
await copyFile(installedFreshFile, path.join(qaDirectory, 'installed-fresh.json'));
await copyFile(installedRestartFile, path.join(qaDirectory, 'installed-restart.json'));
const artifacts = {};
for (const name of ['Shiguang-Album-1.0.0-x64-portable.exe', 'Shiguang-Album-1.0.0-x64-nsis.exe']) {
  artifacts[name] = createHash('sha256').update(await readFile(path.join('release', name))).digest('hex');
}
await writeFile(path.join(qaDirectory, 'artifacts.json'), JSON.stringify({ version: '1.0.0', artifacts }, null, 2) + '\n');
await writeFile('docs/QA.md', `# 拾光相册 v1.0.0 验收记录

验收环境：Windows 11 x64（10.0.26200），Electron 44.6.0。目标系统为 Windows 10 / 11 x64；Windows 10 未在独立机器上实测。仅使用公开样例和生成的测试图片、音频，没有使用个人相册。

## 结果

| 检查 | 结果 |
| --- | --- |
| 数据保存与播放顺序测试 | 9 项通过 |
| 实际安装包安装及启动 | 安装返回 0，${fresh.checks.length} 项通过 |
| 安装版跨进程重启 | ${restart.checks.length} 项通过，完整相册状态一致，重新回到首页 |
| 实际便携版 | ${portable.checks.length} 项通过 |
| 离线使用 | 屏蔽 HTTP / HTTPS，完成导入、转换、图片和音乐播放；外部请求为 0 |
| 500 张 JPG / PNG 持续随机播放 | ${longRun.seconds} 秒，${longRun.transitions} 次自动转场，图片读取失败为 0 |
| 内存与清理 | 照片缓存最多 3 张，转场碎片及时移除，退出后计时器与动画清理 |
| 文件签名 | 首版未数字签名，SHA-256 随交付提供 |

数据测试覆盖多相册隔离、创建与重命名、排序、封面、原件复制与移动、音乐持久化、移除不改原文件、内容去重、中文文件名、坏文件、取消导入、递归文件夹和备份恢复。磁盘不足采用注入 ENOSPC 模拟，未填满真实磁盘。短暂 Windows 文件占用会重试原子替换，持续失败保留原索引；写入失败后已有相册保持可读。

真实桌面检查逐项验证 JPG、PNG、WebP、GIF、BMP、AVIF、旋转 EXIF JPEG，以及损坏 HEIC 的单独失败提示。十种动效、四十次快速切换、二十四次重叠切换、暂停恢复、减少动态效果、全屏和退出清理均通过。配乐检查包含实际解码、循环、音量、静音、同步暂停恢复，以及开始放映时停止整理页试听。导入结束后 HEIC 线程与图片解码进程会自动释放。

## HEIC 样例

| 公开测试样例 | 转换尺寸 | 结果 |
| --- | --- | --- |
${heic}

普通样例来自 libheif，iPhone 15 Pro 样例来自 PhotoPrism；iOS 18 样例来自 libheif issue 1213 的公开附件。打包后的程序保留原件并生成 JPEG 与缩略图，竖图方向通过尺寸及缩略图检查。测试 HEIC 不随源码或发行交付。

## 半小时播放数据

每 30 秒记录一次，共 ${samples.length} 个样本。播放器进程私有内存为 ${mb(Math.min(...renderer))}–${mb(Math.max(...renderer))} MB，后半段波动 ${mb(Math.max(...secondHalf) - Math.min(...secondHalf))} MB；各进程合计私有内存为 ${mb(Math.min(...total))}–${mb(Math.max(...total))} MB。这是本次测试的观测值，会随图片尺寸、显卡和系统变化。测试使用默认 700 毫秒转场、3 秒停留、主题内随机动效及随机照片顺序。

程序没有发生图片解码失败或停止播放。每次抽样检查当前照片已完成解码、图层数量在预期范围内、缓存不增长。首版测试曾受安装程序关闭运行实例及验收窗口提前关闭影响，这两轮不计入通过记录；最终结果来自完整独立运行。

## 交付核对

便携版、NSIS 安装包实际启动；测试安装完成后使用其卸载程序清理测试安装，相册数据保留策略已确认。安装版与便携版使用相同程序载荷。源码及程序包已检查，不含本机相册索引、个人照片、音乐、授权资料或测试 HEIC。仅包含六张公开授权的示例照片。

示例截图见 [首页](screenshots/home.png)、[整理页](screenshots/editor.png) 和 [播放页](screenshots/player.png)。第三方许可和 HEIC 对应源代码随程序与源码包附带。

原始通过报告：[便携版半小时](qa/portable-soak.json)、[安装版首次运行](qa/installed-fresh.json)、[安装版重启](qa/installed-restart.json)。程序校验值另存于 [验收程序指纹](qa/artifacts.json)。完整测试素材保存在忽略的 .test-data，不随交付。GitHub 发布按用户要求暂缓。
`);
console.log('Verified QA record and public test reports written.');
