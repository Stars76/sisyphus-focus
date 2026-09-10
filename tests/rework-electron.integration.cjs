// tests/rework-electron.integration.cjs · 真实 Electron 集成证据（R2 冷启动 / 子框架广播 / 落盘）
// 可复现命令（app path 固定为项目根，主窗口 loadFile 指向根 index.html）：
//   .\electron\electron.exe tests/rework-electron.integration.cjs
// 无需任何未提交的临时入口文件；隔离 userData 位于系统临时目录并在退出前自清理。
// 覆盖：
//   1) 真实主窗 IPC（store:get / timer:get）可用
//   2) 昨天统计 + 今天启动：stats 归零且落盘、真实窗口可开
//   3) 隔离 userData（临时目录），不触碰真实用户数据
//   4) todo iframe（子框架）能收到 timer:state 广播（webContents.send 到不了子框架，须显式路由）
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, ipcMain } = require('electron');

// 强制 app path = 项目根：main.js 的 loadFile('index.html') 与 preload 相对路径全部由此解析
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.stdout.write('DBG boot\n');
app.setAppPath(PROJECT_ROOT);
process.stdout.write('DBG setAppPath ok\n');

const OUT = path.join(path.resolve(PROJECT_ROOT, '.tmp'), 'rework-electron-integration');
fs.mkdirSync(OUT, { recursive: true });

// ---- 隔离 userData 且预置“昨天统计”的 store 文件，再启动真实主进程 ----
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sisy-rework-e2e-'));
app.setPath('userData', TMP);
const util = require('../src/main/util');
let y = new Date(); y.setDate(y.getDate() - 1);
const yesterday = util.todayKey(y);
const storeFile = path.join(TMP, 'sisy-store.json');
fs.writeFileSync(storeFile, JSON.stringify({
  schema: 2, updatedAt: new Date().toISOString(),
  data: {
    'sisy-timer-stats': { day: yesterday, rounds: 5, minutes: 125 },
    'sisy-focus-state-v2': { viewDay: util.todayKey(), days: { [util.todayKey()]: { tasks: [{ id: 'legacy-upgrade', title: '旧数据里的任务', done: false, subtasks: [] }], dismissedDaily: {} } } }
  }
}), 'utf8');

const results = [];
const check = (name, cond, detail) => { results.push({ name, pass: !!cond, detail: detail === undefined ? null : detail }); console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 自清理临时 userData：调度 detached 清理进程（系统自带 PowerShell），待主进程（含 Chromium
// 子进程）退出后删除；不依赖主进程是否仍持有句柄；多次幂等。启动时也会清历史残留兜底。
function scheduleCleanup() {
  // 先即时尝试（Chromium 已释放句柄时常可同步删掉）
  try { fs.rmSync(TMP, { recursive: true, force: true }); return; } catch (e) { }
  // 失败则调度 detached PowerShell 延迟删（主进程退出后独立执行）
  try {
    const { spawn } = require('child_process');
    spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2; Remove-Item -LiteralPath \'' + TMP.replace(/'/g, "''") + '\' -Recurse -Force'],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) { console.log('cleanup spawn failed: ' + e.message); }
}
// 启动兜底：清理上一轮遗留的隔离 userData（主进程退出后 Chromium 句柄已释放，可删）
try {
  const cur = path.basename(TMP);
  const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => f.indexOf('sisy-rework-e2e-') === 0 && f !== cur);
  for (const l of leftovers) { try { fs.rmSync(path.join(os.tmpdir(), l), { recursive: true, force: true }); } catch (e) { } }
} catch (e) { }
require('../main.js');   // 真实主进程装配（唯一真窗口/tray/ipc）

app.whenReady().then(async () => {
  for (let i = 0; i < 60 && !BrowserWindow.getAllWindows().length; i++) await sleep(100);
  const win = BrowserWindow.getAllWindows()[0];
  for (let i = 0; i < 30 && win.webContents.isLoading(); i++) await sleep(100);
  await sleep(800);

  // 1) 真实受信 IPC
  const top = await win.webContents.executeJavaScript(`(function(){
    const g = window.dshStore ? window.dshStore.get('sisy-focus-state-v2') : null;
    return { ok: !!window.dshStore, task: g && g.days && Object.keys(g.days).some(k => (g.days[k].tasks||[]).some(t => t.id === 'legacy-upgrade')) };
  })()`);
  check('真实主窗 store:get 通过（受信）', top.ok && top.task === true, top);

  const tState = await win.webContents.executeJavaScript('window.dshTimer.getState ? window.dshTimer.getState() : Promise.resolve(null)');
  const today = util.todayKey();
  check('真实主窗计时快照可用', !!(tState && tState.stats), tState && tState.stats);
  check('昨天统计 → 今天归零（R2 冷启动）', !!(tState && tState.stats && tState.stats.day === today && tState.stats.rounds === 0), tState && tState.stats);

  // 回归：todo iframe（子框架）必须收到计时状态广播。
  // main.js broadcast() 的 webContents.send 只可靠送达顶层帧，需要显式 sendToFrame 路由子框架，
  // 否则任务 focus 后的 current-task 高亮与历史自动刷新在桌面版失效（真实桌面验收复现）。
  const todoFrameOf = () => win.webContents.mainFrame.frames.find((f) => f.url.includes('/todo/'));
  const iframeExec = (js) => { const f = todoFrameOf(); if (!f) throw new Error('Todo frame missing'); return f.executeJavaScript(js); };
  await iframeExec("window.__timerBcast=0; window.dshTimer.onState(function(){ window.__timerBcast++; }); 'ok'");
  await win.webContents.executeJavaScript("window.dshTimer.cmd('setDuration', { sec: 1230 })");
  await sleep(600);
  const bcast = await iframeExec('window.__timerBcast');
  check('todo iframe 收到计时状态广播（子框架路由）', bcast >= 1, bcast);

  // 2) 落盘核对
  const disk = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  check('隔离 userData 中 stats 已更新为今天0', !!(disk.data['sisy-timer-stats'] && disk.data['sisy-timer-stats'].day === today), disk.data['sisy-timer-stats']);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n=== 集成结果：' + (results.length - failed) + '/' + results.length + ' 通过 ===');
  console.log('临时 userData: ' + TMP + '（调度延迟清理）');
  scheduleCleanup();
  process.exit(failed ? 1 : 0);
}).catch((e) => { console.error('集成异常', e); fs.writeFileSync(path.join(OUT, 'error.txt'), String(e && e.stack || e), 'utf8'); scheduleCleanup(); process.exit(1); });
setTimeout(() => { console.error('集成整体超时'); app.exit(2); }, 40000);