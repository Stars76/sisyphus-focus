/* ============================================================
 * tests/ipc-validation.test.js · IPC 参数与路径校验回归（任务 3）
 * 用假 electron 桥 + 真 store/timer 直接调注册的 handler，
 * 验证：非法键 / 非法路径 / 非法时长 / 非法负载一律返回失败且
 * 不写数据；reveal 只允许 userData 内；日志截断且单行。
 * 用法：node tests/ipc-validation.test.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const { createStore } = require('../src/main/store');
const { createTimer } = require('../src/main/timer');
const util = require('../src/main/util');
const { createIpc } = require('../src/main/ipc');

const dir = H.mkTmp('ipc-val');
const store = createStore({ dir, log: () => { }, warn: () => { } });
store.load();
let timerInits = 0;
const baseTimer = createTimer({ store, log: () => { }, date: util, onBroadcast: () => { }, onEvent: () => { }, notify: () => { } });
baseTimer.init();
const timer = Object.create(baseTimer, {
  init: { value: () => { timerInits++; return baseTimer.init(); } }
});

const fx = H.fakeElectron(dir);
let reloads = 0;
const ipc = createIpc({
  store, timer, log: () => { }, getWin: () => null, getTimerWin: () => null,
  createTimerWindow: () => { }, showMainWindow: () => { }, reloadAll: () => { reloads++; },
  logDir: path.join(dir, 'logs'), electron: fx.electron
});
ipc.register();
const { onChannels, handleChannels, calls, makeEvent } = fx;

function sync(ch, ...args) { const e = makeEvent(); onChannels[ch](e, ...args); return e.returnValue; }
function syncEv(ch, ev, ...args) { const e = Object.assign(makeEvent(), ev); onChannels[ch](e, ...args); return e.returnValue; }
function invoke(ch, ...args) { return handleChannels[ch](makeEvent(), ...args); }
function backupCount() {
  try { return fs.readdirSync(path.join(dir, 'backups')).length; } catch (e) { return 0; }
}

store.set('sisy-focus-state-v2', { viewDay: '2026-09-08', days: { '2026-09-08': { tasks: [{ id: 't', title: 'X', subtasks: [] }], dismissedDaily: {} } } });
store.set('sisy-timer-stats', { day: '2026-09-08', rounds: 4, minutes: 100 });
store.flush();
const statsBefore = JSON.stringify(store.get('sisy-timer-stats'));

async function main() {
  H.group('1. 存储键校验：非法键名一律拒绝');
  {
    const badKeys = ['../../windows/evil', 'not-prefixed', 'SISY-UPPER?x', 'a'.repeat(200), '', 123, null, { toString() { return 'sisy-x'; } }];
    for (const k of badKeys) {
      const r = sync('store:set', k, 1);
      H.assert(r && r.ok === false, 'store:set 拒绝非法键 ' + JSON.stringify(String(k).slice(0, 20)), r);
      H.eq(sync('store:get', k), null, 'store:get 非法键返回 null');
      H.assert(sync('store:remove', k).ok === false, 'store:remove 拒绝非法键');
    }
    H.eq(JSON.stringify(store.get('sisy-timer-stats')), statsBefore, '非法键操作没碰到任何现有数据');
  }

  H.group('2. 计时命令与时长校验');
  {
    for (const bad of ['rm -rf', 'constructor', '__proto__', 'start ', '']) {
      const r = await invoke('timer:cmd', bad, {});
      H.assert(r && r.ok === false && /未知计时命令/.test(r.error), '未知/恶意命令被拒绝: ' + JSON.stringify(bad), r && r.error);
    }
    for (const badSec of [-5, 0, 59, 10801, '120', null, NaN, Infinity, 1.5]) {
      const r = await invoke('timer:cmd', 'setDuration', { sec: badSec });
      H.assert(r && r.ok === false && /sec/.test(r.error), '非法时长被拒绝: ' + String(badSec), r && r.error);
    }
    H.eq(store.get('sisy-timer-prefs'), null, '非法时长没有写入任何偏好（无 prefs 键）');
    const r2 = await invoke('timer:cmd', 'setPhase', { phase: 'sleep' });
    H.assert(r2 && r2.ok === false, '非法阶段被拒绝');
    const r3 = await invoke('timer:cmd', 'setDuration', { sec: '300"; DROP' });
    H.assert(r3 && r3.ok === false, '字符串时长即使像数字也被拒绝');
    const ok1 = await invoke('timer:cmd', 'setDuration', { sec: 300 });
    H.assert(ok1 && ok1.timer, '合法时长正常执行');
    H.eq(ok1.phases.focus, 300, '合法时长生效');
    H.assert((await invoke('timer:cmd', 'setPhase', 'focus')).ok === false, 'payload 非对象被拒绝');
    H.assert((await invoke('timer:cmd', 'setPhase', ['focus'])).ok === false, 'payload 数组被拒绝');
  }

  H.group('3. 偏好负载校验');
  {
    const p0 = JSON.stringify(baseTimer.getPrefs());
    for (const patch of [{ sound: 'yes' }, { notify: 1 }, { motion: 'wild' }, { phases: { focus: 5 } }, { phases: { nap: 300 } }, { phases: 'x' }, null, 'x', []]) {
      const r = await invoke('timer:prefs-set', patch);
      H.assert(r && r.ok === false, '非法偏好被拒绝: ' + JSON.stringify(patch), r && r.error);
    }
    H.eq(JSON.stringify(baseTimer.getPrefs()), p0, '所有非法偏好都没改变现有偏好');
    const ok = await invoke('timer:prefs-set', { sound: false });
    H.assert(ok && ok.prefs, '合法偏好正常执行');
    H.eq(ok.prefs.sound, false, '合法偏好生效');
  }

  H.group('4. 路径边界：reveal 只允许应用数据目录内');
  {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\config' : '/etc';
    H.assert((await invoke('data:reveal', outside)).ok === false, 'reveal 拒绝 userData 之外的路径');
    H.assert((await invoke('data:reveal', path.join(dir, '..', 'outside.json'))).ok === false, 'reveal 拒绝 .. 逃逸');
    H.assert((await invoke('data:reveal', 'https://evil.example/x')).ok === false, 'reveal 拒绝 URL');
    H.assert((await invoke('data:reveal', null)).ok === false, 'reveal 拒绝空参数');
    const r5 = await invoke('data:reveal', path.join(dir, 'sisy-store.json'));
    H.assert(r5 && r5.ok === true, 'reveal 允许应用数据目录内文件', r5);
    H.eq(calls.reveal.length, 1, 'shell 只在合法路径时被调用一次');
  }

  H.group('4b. 导出授权 reveal（R8）');
  {
    const expDir = H.mkTmp('ipc-export');
    const target = path.join(expDir, 'backup.json');
    const original = fx.electron.dialog.showSaveDialog;
    fx.electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    try {
      const exp = await invoke('data:export-file');
      H.assert(exp.ok === true, '导出成功', exp && exp.error);
      H.assert(ipc.authorizedExportCount() >= 1, '导出成功后登记了授权路径');
      const before = calls.reveal.length;
      const rOk = await invoke('data:reveal', exp.path);
      H.assert(rOk.ok === true, '已授权导出文件可 reveal', rOk);
      H.eq(calls.reveal.length, before + 1, 'shell.showItemInFolder 确实被调用');
      H.eq(calls.reveal[calls.reveal.length - 1], exp.path, 'shell 收到的正是导出文件路径');
      const rBad = await invoke('data:reveal', path.join(expDir, 'other.json'));
      H.eq(rBad.ok, false, '未授权的同目录其它文件仍被拒绝');
      H.eq(calls.reveal.length, before + 1, '拒绝的 reveal 没有触发 shell');
    } finally { fx.electron.dialog.showSaveDialog = original; }
    const cancel = await invoke('data:export-file');
    H.eq(cancel.canceled, true, '取消对话框不导出、不授权');
  }

  H.group('5. 导入模式与分区清空');
  {
    const backups0 = backupCount();
    const r1 = sync('store:import', { data: { 'sisy-timer-stats': { day: '2026-09-08', rounds: 1, minutes: 1 } } }, 'zap');
    H.assert(r1 && r1.ok === false, 'store:import 非法 mode 被拒绝');
    const r2 = await invoke('data:apply-import', { data: 'not-an-object' }, 'merge');
    H.assert(r2 && r2.ok === false, '损坏 bundle 导入被拒绝');
    H.eq(backupCount(), backups0, '失败的导入没有产生任何备份（成功才备份，且只一次）');
    H.eq(store.get('sisy-timer-stats').rounds, 4, '失败的导入没有改数据');

    const r3 = await invoke('data:clear-all', ['evil-scope']);
    H.assert(r3 && r3.ok === false, '未知分区被拒绝');
    H.assert(store.get('sisy-focus-state-v2') !== null, '被拒的分区清空没动任务');
    H.assert(store.get('sisy-timer-stats') !== null, '被拒的分区清空没动统计');
    const r4 = await invoke('data:clear-all', []);
    H.assert(r4 && r4.ok === false, '空列表被拒绝（防误触全清）');

    const r5 = await invoke('data:clear-all', ['stats']);
    H.assert(r5 && r5.ok === true, '分区清空 stats 成功', r5);
    H.eq(store.get('sisy-timer-stats'), null, '统计分区已清');
    H.assert(store.get('sisy-focus-state-v2') !== null, '任务分区未受影响');
    H.assert(r5.preBackup && fs.existsSync(r5.preBackup), '分区清空前也自动备份，可恢复');
    const restored = createStore({ dir, log: () => { }, warn: () => { } });
    const raw = fs.readFileSync(r5.preBackup, 'utf8');
    const back = JSON.parse(raw);
    H.eq(back.data['sisy-timer-stats'].rounds, 4, 'pre-clear 备份里统计数据完好（恢复路径可用）');
    H.assert(reloads > 0, '清空成功后触发了窗口刷新');

    const okBundle = { app: 'sisy', schema: 2, data: { 'sisy-timer-prefs': { sound: true, phases: { focus: 600 } } } };
    const bBefore = backupCount();
    const r6 = await invoke('data:apply-import', okBundle, 'merge');
    H.assert(r6 && r6.ok === true, '合法导入成功', r6 && r6.error);
    H.eq(backupCount(), bBefore + 1, '一次成功导入恰好产生 1 份备份（旧实现在这会是 2 份）');
    H.assert(r6.backup && r6.preBackup === r6.backup, 'IPC 与 store 共用同一份 pre-import 备份，无重复');
  }

  H.group('6. 备份标签消毒与日志隐私');
  {
    const r1 = sync('store:backup', '../../evil');
    H.assert(r1.ok, '恶意标签被消毒而不是崩溃', r1);
    H.assert(path.basename(r1.path).includes('-manual') && path.dirname(r1.path) === path.join(dir, 'backups'), '恶意标签落为 manual 且仍在备份目录内', r1.path);
    H.assert(!sync('store:backup', 12345).ok, '非字符串标签经 IPC 被拒绝');

    const evil = [{ t: '2026-09-08 12:00:00.000', level: 'error', text: 'x'.repeat(5000) + '\n第二行\n第三行' }];
    const many = [];
    for (let i = 0; i < 500; i++) many.push({ t: 'x', level: 'weird', text: 'line' + i });
    ipc.appendLog(['直接 ' + 'y'.repeat(2000)]);
    onChannels['log:report'](makeEvent(), many);
    onChannels['log:report'](makeEvent(), evil);
    onChannels['log:report'](makeEvent(), '不是数组');
    const logText = fs.readFileSync(ipc.logFile, 'utf8');
    const lines = logText.split('\n').filter(Boolean);
    H.assert(lines.length <= 210, '500 条日志被上限截断', lines.length);
    H.assert(!lines.some((l) => l === '第二行' || l === '第三行'), '上报日志中的换行被压平，不能伪造多行');
    const maxLen = Math.max(...lines.map((l) => l.length));
    H.assert(maxLen <= 700, '单行日志被截断（≤700）', maxLen);
    H.assert(lines.some((l) => l.includes('INFO line0')), '未知 level 归一为 INFO');
  }

  H.group('7. 通知负载');
  {
    H.assert((await invoke('notify:show', '标题', 'x'.repeat(2000))).ok === false, '超长通知被拒绝');
    H.assert((await invoke('notify:show', { obj: 1 }, 'ok')).ok === false, '非字符串通知被拒绝');
  }

  H.group('8. Atomic task IPC validation');
  {
    timer.command('reset');
    const today = util.todayKey();
    store.set('sisy-focus-state-v2', { viewDay: today, days: { [today]: { tasks: [{id:'atomic', title:'Canonical task', done:false, subtasks:[]}], dismissedDaily:{} } } });
    for (const ref of [null,[],{},'atomic']) H.eq((await invoke('timer:task-start',ref)).ok,false,'Malformed task-start rejected');
    const result = await invoke('timer:task-start',{id:'atomic',day:today,title:'forged'});
    H.eq(result.ok,true,'Valid task-start accepted');
    H.eq(timer.snapshot().timer.task.title,'Canonical task','IPC binds authoritative title');
    H.eq(handleChannels['timer:task-set'],undefined,'Loose context write channel removed');
    timer.command('reset');
  }

  H.group('9. app:info 诊断信息完整且不泄露正文');
  {
    const info = await invoke('app:info');
    H.assert(Array.isArray(info.recovery.backups), 'app:info 含备份清单');
    H.assert(typeof info.storeFile === 'string', 'app:info 含存储路径');
    H.assert(Array.isArray(info.migrations), 'app:info 含迁移记录');
    H.assert(!JSON.stringify(info).includes('"X"'), 'app:info 不泄露任务正文（只有键名）');
  }

  H.group('10. 源码里用到的存储键必须合法（前缀拼错会被静默拒绝）');
  {
    const schema = require('../src/main/schema');
    const srcRoot = path.join(__dirname, '..', 'src');
    const jsFiles = [];
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (f.endsWith('.js')) jsFiles.push(f);
      });
    })(srcRoot);

    const bad = [];
    let seen = 0;
    // 实际用法：store.set('key', v) / NS.store.get('key', d) / dshStore.remove('key')
    const callRe = /(?:store|dshStore|NS\.store)\.(?:set|get|remove)\(\s*'([^']+)'/g;
    for (const f of jsFiles) {
      const text = fs.readFileSync(f, 'utf8');
      let m;
      while ((m = callRe.exec(text))) {
        seen++;
        if (!schema.isValidStoreKey(m[1])) bad.push(path.basename(f) + ' → ' + m[1]);
      }
      // 历史上的真实 bug：renderer 写了 'sisyphus-hint-edit'，前缀不匹配被静默拒绝；
      // 这里同时兜住旧前缀残留（adhd-* 已随 2.0 改名清空）。
      const legacy = /'(adhd-[A-Za-z0-9._-]*)'/.exec(text);
      if (legacy) bad.push(path.basename(f) + ' → 旧前缀残留 ' + legacy[1]);
    }
    H.assert(seen >= 5, '至少扫到若干存储键字面量', seen);
    H.eq(bad.length, 0, '源码里的键全部满足 sisy- 前缀规则', bad);

    const known = Object.keys(schema.KEYS).map((k) => schema.KEYS[k]);
    const invalidKnown = known.filter((k) => !schema.isValidStoreKey(k));
    H.eq(invalidKnown.length, 0, 'schema.KEYS 里声明的键自身合法', invalidKnown);
  }
}

main().then(() => H.finish()).catch((e) => { console.error('测试异常', e); process.exit(1); });
