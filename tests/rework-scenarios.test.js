/* ============================================================
 * tests/rework-scenarios.test.js · 返工场景正常回归（R1–R9）
 * 覆盖独立验收报告复现的八个场景及其扩展：
 *   R1 日期键两种顺序合并（含同 ID 冲突与幂等）
 *   R2 昨天统计冷启动归零落盘 + 运行中计时恢复
 *   R3 tmp/备份结构校验（null/数组/错误容器/最近失效→更早有效/合法空备份）
 *   R4 清空 stats/prefs 后实时权威恢复默认（含 replace 导入缺键）
 *   R5 已知键非法值拒绝（内存/文件/重开三处核对）与合法/受控迁移
 *   R6 暂停起点跨重启持久（两次重启）
 *   R8 导出授权 reveal（shell 真被调、取消不授权、未授权路径拒绝）
 * 用法：node tests/rework-scenarios.test.js（随 tests/run-all.js 执行）
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const { createStore } = require('../src/main/store');
const { createTimer } = require('../src/main/timer');
const { createIpc } = require('../src/main/ipc');
const util = require('../src/main/util');

const clockAt = (iso) => {
  const wall = Date.parse(iso || '2026-09-09T09:00:00');
  let mono = 1000;
  const c = { wall, mono, advance: (ms) => { c.wall += ms; c.mono += ms; },
    date: { todayKey: () => util.todayKey(new Date(c.wall)), normalizeKey: util.normalizeKey }, now: () => c.wall, monoNow: () => c.mono };
  return c;
};
const mkTimer = (store, c) => {
  const t = createTimer({ store, log: () => { }, date: c.date, now: c.now, mono: c.monoNow, onBroadcast: () => { }, onEvent: () => { }, notify: () => { } });
  t.init(); return t;
};
const task = (id) => ({ id, title: id, done: false, subtasks: [] });
const day = (tasks, dismissedDaily) => ({ tasks, dismissedDaily: dismissedDaily || {} });
const writeStore = (dir, dataMap) => fs.writeFileSync(path.join(dir, 'sisy-store.json'), JSON.stringify({ schema: 2, data: dataMap }), 'utf8');

async function main() {
  H.group('R1. 日期键统一合并（两种顺序、双方内容、幂等）');
  {
    const legacyDay = day([task('legacy-task')], { hid1: true });
    const canonicalDay = day([task('canonical-task')], { hid2: true });
    for (const legacyFirst of [true, false]) {
      const p = H.mkTmp('r1');
      const days = legacyFirst ? { '2026-9-8': legacyDay, '2026-09-08': canonicalDay } : { '2026-09-08': canonicalDay, '2026-9-8': legacyDay };
      writeStore(p, { 'sisy-focus-state-v2': { viewDay: '2026-09-08', days } });
      const s = createStore({ dir: p, log: () => { }, warn: () => { } }); s.load(); s.flush();
      const out = s.get('sisy-focus-state-v2');
      const ids = out.days['2026-09-08'].tasks.map((x) => x.id).sort();
      H.eq(ids.join(','), 'canonical-task,legacy-task', 'R1 两种顺序都保留双方任务 (legacyFirst=' + legacyFirst + ')', { ids });
      H.assert(out.days['2026-09-08'].dismissedDaily.hid1 === true && out.days['2026-09-08'].dismissedDaily.hid2 === true, 'R1 双方隐藏记录都保留', out.days['2026-09-08'].dismissedDaily);
      const s2 = createStore({ dir: p, log: () => { }, warn: () => { } }); s2.load();
      H.eq(s2.get('sisy-focus-state-v2').days['2026-09-08'].tasks.length, 2, 'R1 重开后任务仍在');
    }
    const p = H.mkTmp('r1-conflict');
    writeStore(p, { 'sisy-focus-state-v2': { viewDay: '2026-09-08', days: {
      '2026-9-8': day([Object.assign(task('same'), { title: 'legacy-same' })]),
      '2026-09-08': day([Object.assign(task('same'), { title: 'canonical-same' }), task('only-canonical')])
    } } });
    const s = createStore({ dir: p, log: () => { }, warn: () => { } }); s.load();
    const once = s.get('sisy-focus-state-v2').days['2026-09-08'].tasks;
    H.eq(once.length, 2, 'R1 同 ID 冲突只保留一条', once.map((t) => t.title));
    H.eq(once.filter((t) => t.id === 'same')[0].title, 'legacy-same', 'R1 冲突规则稳定：先合并者胜');
    s.flush();
    const s2 = createStore({ dir: p, log: () => { }, warn: () => { } }); s2.load();
    H.eq(s2.get('sisy-focus-state-v2').days['2026-09-08'].tasks.length, 2, 'R1 幂等：再次加载不改变');
  }

  H.group('R2. 昨天统计冷启动归零落盘；运行中计时恢复');
  {
    const p = H.mkTmp('r2');
    const s = createStore({ dir: p, log: () => { }, warn: () => { } }); s.load();
    s.set('sisy-timer-stats', { day: '2026-09-08', rounds: 5, minutes: 125 }); s.flush();
    const t = mkTimer(s, clockAt()); t.pauseTicker();
    const snap = t.snapshot();
    H.eq(snap.stats.day, '2026-09-09', 'R2 昨天统计冷启动归到新日期');
    H.eq(snap.stats.rounds, 0, 'R2 轮次归零');
    H.eq(s.get('sisy-timer-stats').day, '2026-09-09', 'R2 跨日归零真实落盘');
    H.eq(s.get('sisy-timer-stats').rounds, 0, 'R2 落盘轮次为 0');
    s.flush();
    const s3 = createStore({ dir: p, log: () => { }, warn: () => { } }); s3.load();
    H.eq(s3.get('sisy-timer-stats').rounds, 0, 'R2 重开核对已落盘');

    const p2 = H.mkTmp('r2-running');
    const s2 = createStore({ dir: p2, log: () => { }, warn: () => { } }); s2.load();
    const c2 = clockAt('2026-09-09T08:00:00');
    const t2 = mkTimer(s2, c2); t2.pauseTicker(); t2.command('setDuration', { sec: 720 }); t2.command('start');
    c2.advance(60000);
    s2.flush();
    const s2b = createStore({ dir: p2, log: () => { }, warn: () => { } }); s2b.load();
    const t2b = mkTimer(s2b, c2); t2b.pauseTicker();
    H.eq(t2b.snapshot().timer.running, true, 'R2 运行中计时重启恢复');
    H.eq(t2b.snapshot().timer.leftSec, 660, 'R2 运行中剩余恢复（720-1min）', t2b.snapshot().timer.leftSec);
  }

  H.group('R3. tmp/备份候选结构校验；最近失效继续找更早；合法空备份');
  {
    const p = H.mkTmp('r3');
    const s = createStore({ dir: p, log: () => { }, warn: () => { } }); s.load();
    s.set('sisy-marker', { original: true }); s.flush(); s.backup('good');
    fs.writeFileSync(s.file, '{broken'); fs.writeFileSync(s.file + '.tmp', 'null');
    const b = createStore({ dir: p, log: () => { }, warn: () => { } }); const res = b.load();
    H.eq(res.recovered, 'backup', 'R3 非法 tmp 被跳过，恢复有效备份', res);
    H.assert(b.get('sisy-marker') && b.get('sisy-marker').original === true, 'R3 原始数据恢复');
    b.flush();
    H.assert(fs.readdirSync(p).some((f) => f.includes('.corrupt-') || f.includes('.tmp-invalid-')), 'R3 损坏现场保留', fs.readdirSync(p));

    for (const bad of ['[]', '"str"', '42', '{"data":[]}']) {
      const p2 = H.mkTmp('r3-container');
      const s2 = createStore({ dir: p2, log: () => { }, warn: () => { } }); s2.load();
      s2.set('sisy-marker', { v: 1 }); s2.flush(); s2.backup('ok');
      fs.writeFileSync(s2.file, '{broken2'); fs.writeFileSync(s2.file + '.tmp', bad);
      const b2 = createStore({ dir: p2, log: () => { }, warn: () => { } }); const r2 = b2.load();
      H.eq(r2.recovered, 'backup', 'R3 tmp=' + bad + ' 不被采用', r2);
      H.eq(b2.get('sisy-marker').v, 1, 'R3 数据仍在');
    }

    const p3 = H.mkTmp('r3-stale');
    const s3 = createStore({ dir: p3, log: () => { }, warn: () => { } }); s3.load();
    s3.set('sisy-marker', { v: 9 }); s3.flush(); s3.backup('earlier');
    fs.writeFileSync(s3.file, '{broken3'); fs.writeFileSync(s3.file + '.tmp', 'not json');
    const newer = path.join(p3, 'backups', 'sisy-store-newer.json');
    fs.writeFileSync(newer, '{"data":[]}', 'utf8');
    fs.utimesSync(newer, new Date(Date.now() - 100000), new Date(Date.now() - 100000));
    const b3 = createStore({ dir: p3, log: () => { }, warn: () => { } }); const r3 = b3.load();
    H.eq(r3.recovered, 'backup', 'R3 最近损坏备份被跳过，恢复更早有效备份', r3);
    H.eq(b3.get('sisy-marker').v, 9, 'R3 更早有效备份数据恢复');

    const p4 = H.mkTmp('r3-empty');
    const s4 = createStore({ dir: p4, log: () => { }, warn: () => { } }); s4.load();
    s4.set('sisy-marker', { v: 3 }); s4.flush(); s4.backup('empty-ok');
    fs.unlinkSync(s4.file); fs.writeFileSync(s4.file + '.tmp', JSON.stringify({ schema: 2, data: {} }));
    const b4 = createStore({ dir: p4, log: () => { }, warn: () => { } }); const r4 = b4.load();
    H.eq(r4.recovered, 'tmp', 'R3 合法空备份(tmp data:{})视为有效恢复源', r4);
    H.eq(b4.get('sisy-marker'), null, 'R3 空备份不含旧数据（按空数据启动）');
    b4.flush();
    const b4b = createStore({ dir: p4, log: () => { }, warn: () => { } }); b4b.load();
    H.eq(b4b.get('sisy-marker'), null, 'R3 空数据重开一致');
  }

  H.group('R4. 清空 stats/prefs 后 live 权威恢复默认');
  {
    const p = H.mkTmp('r4');
    const s = createStore({ dir: p, log: () => { }, warn: () => { } }); s.load();
    s.set('sisy-timer-stats', { day: '2026-09-09', rounds: 4, minutes: 100 });
    s.set('sisy-timer-prefs', { sound: false, phases: { focus: 600 } });
    s.set('sisy-focus-state-v2', { viewDay: '2026-09-09', days: { '2026-09-09': day([task('keep')]) } });
    s.flush();
    const c = clockAt(); const t = mkTimer(s, c); t.pauseTicker();
    const fx = H.fakeElectron(p);
    const ipc = createIpc({ store: s, timer: t, log: () => { }, getWin: () => null, getTimerWin: () => null, createTimerWindow: () => { }, showMainWindow: () => { }, reloadAll: () => { }, logDir: path.join(p, 'logs'), electron: fx.electron });
    ipc.register();
    const r = await fx.handleChannels['data:clear-all'](fx.makeEvent(), ['stats', 'prefs']);
    const snap = t.snapshot();
    H.assert(r.ok === true, 'R4 分区清空成功', r);
    H.eq(snap.stats.rounds, 0, 'R4 stats 实时恢复默认');
    H.eq(snap.prefs.sound, true, 'R4 sound 实时恢复默认');
    H.eq(snap.phases.focus, 1500, 'R4 focus 时长实时恢复默认');
    H.assert(s.get('sisy-focus-state-v2') !== null, 'R4 未选分区保留');
    H.eq(s.get('sisy-timer-stats'), null, 'R4 stats 键已删（clear 语义保留）');
    H.eq(s.get('sisy-timer-prefs'), null, 'R4 prefs 键已删');
    // replace 导入缺关键键 → init 后 live 默认
    const p5 = H.mkTmp('r4-replace');
    const s5 = createStore({ dir: p5, log: () => { }, warn: () => { } }); s5.load();
    s5.set('sisy-timer-stats', { day: '2026-09-09', rounds: 9, minutes: 200 });
    s5.set('sisy-timer-prefs', { sound: false, phases: { focus: 600 } }); s5.flush();
    const t5 = mkTimer(s5, clockAt()); t5.pauseTicker();
    const r5 = s5.importAll({ data: { 'sisy-focus-state-v2': { viewDay: '2026-09-09', days: { '2026-09-09': day([]) } } } }, 'replace');
    H.assert(r5.ok, 'R4 replace 导入成功（缺 stats/prefs 键）', r5);
    t5.init(); t5.pauseTicker();
    const snap5 = t5.snapshot();
    H.eq(snap5.stats.rounds, 0, 'R4 replace 缺 stats 键后恢复默认');
    H.eq(snap5.prefs.sound, true, 'R4 replace 缺 prefs 键后恢复默认');
    H.eq(snap5.phases.focus, 1500, 'R4 replace 缺 prefs 时长默认');
  }

  H.group('R5. 已知键非法值拒绝且旧值不变（内存/文件/重开）');
  {
    const p = H.mkTmp('r5');
    const s = createStore({ dir: p, log: () => { }, warn: () => { } }); s.load();
    s.set('sisy-focus-state-v2', { viewDay: '2026-09-09', days: { '2026-09-09': day([task('keep-me')]) } }); s.flush();
    for (const bad of [null, [], { days: [] }, { viewDay: '2026-09-09', days: 'nope' }, { days: { '2026-09-09': { tasks: 'oops' } } }]) {
      H.eq(s.set('sisy-focus-state-v2', bad).ok, false, 'R5 已知键非法值被拒绝', bad && Object.keys(bad || {}));
    }
    H.eq(s.get('sisy-focus-state-v2').days['2026-09-09'].tasks[0].id, 'keep-me', 'R5 旧值内存仍在');
    s.flush();
    const disk = JSON.parse(fs.readFileSync(path.join(p, 'sisy-store.json'), 'utf8'));
    H.eq(disk.data['sisy-focus-state-v2'].days['2026-09-09'].tasks[0].id, 'keep-me', 'R5 文件未被污染');
    const s2 = createStore({ dir: p, log: () => { }, warn: () => { } }); s2.load();
    H.eq(s2.get('sisy-focus-state-v2').days['2026-09-09'].tasks[0].id, 'keep-me', 'R5 重开后任务仍在');
    H.eq(s.set('sisy-focus-state-v2', { viewDay: '2026-09-09', days: { '2026-09-09': day([task('keep-me'), task('plus')]) } }).ok, true, 'R5 合法值正常保存');
    H.eq(s.set('sisy-timer-stats', { day: '2026-9-9', rounds: 3, minutes: 44 }).ok, true, 'R5 受控旧格式写入成功');
    H.eq(s.get('sisy-timer-stats').day, '2026-09-09', 'R5 旧格式被规范化为零填充');
    H.eq(s.get('sisy-timer-stats').rounds, 3, 'R5 旧格式同天数据保留');
  }

  H.group('R6. 暂停起点跨重启持久（两次重启）');
  {
    const p = H.mkTmp('r6'); const c = clockAt();
    const s = createStore({ dir: p, log: () => { }, warn: () => { } }); s.load();
    const a = mkTimer(s, c); a.pauseTicker(); a.command('start'); c.advance(10000); a.command('pause'); c.advance(30000); a.flush(); s.flush();
    const reload = () => { const st = createStore({ dir: p, log: () => { }, warn: () => { } }); st.load(); const t = mkTimer(st, c); t.pauseTicker(); return { st, t }; };
    const b = reload();
    b.t.command('start');
    H.eq(b.t.snapshot().timer.pausedMs, 30000, 'R6 重启后暂停时长保留并累计', b.t.snapshot().timer.pausedMs);
    b.t.command('pause'); c.advance(5000); b.t.flush(); b.st.flush();
    const b2 = reload();
    b2.t.command('start');
    H.eq(b2.t.snapshot().timer.pausedMs, 35000, 'R6 两次重启后暂停时长累计正确');
  }

  H.group('R8. 导出授权 reveal');
  {
    const p = H.mkTmp('r7'); const c = clockAt();
    const s = createStore({ dir: p, log: () => { }, warn: () => { } }); s.load();
    const t = mkTimer(s, c); t.pauseTicker();
    const fx = H.fakeElectron(p);
    const ipc = createIpc({ store: s, timer: t, log: () => { }, getWin: () => null, getTimerWin: () => null, createTimerWindow: () => { }, showMainWindow: () => { }, reloadAll: () => { }, logDir: path.join(p, 'logs'), electron: fx.electron });
    ipc.register();
    const handle = fx.handleChannels, calls = fx.calls;

    const target = path.join(H.mkTmp('r8-target'), 'b.json');
    const origSave = fx.electron.dialog.showSaveDialog;
    fx.electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    const exp = await handle['data:export-file'](fx.makeEvent()); H.assert(exp.ok, 'R8 导出成功');
    const revOk = await handle['data:reveal'](fx.makeEvent(), exp.path);
    H.eq(revOk.ok, true, 'R8 授权导出文件可 reveal');
    H.eq(calls.reveal[calls.reveal.length - 1], exp.path, 'R8 shell 确实收到导出文件');
    const revBad = await handle['data:reveal'](fx.makeEvent(), path.join(path.dirname(target), 'other.json'));
    H.eq(revBad.ok, false, 'R8 未授权路径仍拒绝');
    fx.electron.dialog.showSaveDialog = origSave;
    const cancel = await handle['data:export-file'](fx.makeEvent());
    H.eq(cancel.canceled, true, 'R8 取消对话框不授权');
  }
}

main().then(() => H.finish()).catch((e) => { console.error('测试异常', e); process.exit(1); });