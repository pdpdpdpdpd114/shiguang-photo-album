import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';

const soak = process.argv.includes('--soak');
const exeArg = process.argv.find(arg => arg.startsWith('--exe='));
const testName = process.argv.find(arg => arg.startsWith('--name='))?.slice(7) || (soak ? 'soak' : 'desktop');
const reuseArg = process.argv.find(arg => arg.startsWith('--reuse='));
const root = reuseArg ? path.resolve(reuseArg.slice(8)) : path.resolve('.test-data', `${testName}-${Date.now()}`); await mkdir(root, { recursive: true });
console.log(`Test data: ${root}`);
const args = [...(exeArg ? [] : ['.']), `--album-diagnostics=${root}`, ...(soak ? ['--soak'] : [])];
const childEnv = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }; delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(exeArg ? path.resolve(exeArg.slice(6)) : electron, args, { stdio: 'inherit', windowsHide: true, env: childEnv });
let finished = false;
const timeout = setTimeout(() => { child.kill(); console.error('Desktop test timed out'); }, soak ? 40 * 60 * 1000 : 5 * 60 * 1000);
const interval = soak ? setInterval(async () => {
  if (finished) return;
  try { const status = JSON.parse(await readFile(path.join(root, 'soak-progress.json'), 'utf8')); console.log(`Playback ${status.elapsedSeconds}/${status.targetSeconds}s; ${status.samples.at(-1)?.transitions} transitions`); } catch {}
}, 60000) : null;
child.on('error', error => { console.error(error); });
child.on('close', async (code, signal) => {
  finished = true; clearTimeout(timeout); if (interval) clearInterval(interval);
  console.log(`Desktop process exited: code=${code}, signal=${signal}`);
  let reported = false;
  try { const result = JSON.parse(await readFile(path.join(root, 'results.json'), 'utf8')); reported = result.checks.every(check => check.passed); console.log(JSON.stringify({ packaged: result.packaged, passed: result.checks.length, root })); }
  catch { try { console.error(await readFile(path.join(root, 'failure.txt'), 'utf8')); } catch { console.error('No test report was produced.'); } }
  process.exitCode = code === 0 && reported ? 0 : 1;
});
