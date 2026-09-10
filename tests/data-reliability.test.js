/* ============================================================
 * tests/data-reliability.test.js · 数据可靠性回归（任务 1）
 * 覆盖：导入校验（非法 JSON / 缺字段 / 非法键）、只备份一次、
 *       导入后验证与回滚、损坏文件/临时文件/备份的恢复路径、
 *       分区清空、旧结构迁移、恢复键保留。
 * 用法：node tests/data-reliability.test.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const { createStore } = require('../src/main/store');
const schema = require('../src/main/schema');

function silentStore(dir, fsImpl) {
  const logs = [];
  const s = createStore({ dir, fs: fsImpl, log: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)) });
  s.__logs = logs;
  return s;
}
function countBackups(dir) {
  try {
    return fs.readdirSync(path.join(dir, 'backups')).filter((f) => /^sisy-store-.*\.json$/.test(f)).length;
  } catch (e) { return 0; }
}

/* ---------------- 准备一份有代表性的数据 ---------------- */
const dir = H.mkTmp('data-rel');
const store = silentStore(dir);
store.load();
store.set('sisy-focus-state-v2', {
  viewDay: '2026-09-08',
  days: { '2026-09-08': { tasks: [{ id: 't1', title: '写验收材料', done: false, subtasks: [{ id: 's1', title: '列大纲', minutes: 5, done: false }] }], dismissedDaily: {} } }
});
store.set('sisy-timer-stats', { day: '2026-09-08', rounds: 3, minutes: 75 });
store.flush();

H.group('1. 导入校验：非法输入一律拒绝且零副作用');
const bad1 = store.importAll('这不是 JSON，只是一段字符串', 'merge');
assertImportFail(bad1, '非法 JSON 字符串被拒绝', 'JSON');
assertImportFail(store.importAll({ noData: 1 }, 'merge'), '缺 data 字段被拒绝', 'data');
assertImportFail(store.importAll({ data: { 'sisy-focus-state-v2': { viewDay: '2026-09-08' } } }, 'merge'), '缺 days 必需字段被拒绝', 'days');
assertImportFail(store.importAll({ data: { 'sisy-timer-stats': { day: '2026-09-08', minutes: 10 } } }, 'merge'), 'stats 缺 rounds 被拒绝', 'rounds');
assertImportFail(store.importAll({ data: { '../../../../windows/system32/evil': 1 } }, 'merge'), '路径穿越键名被拒绝', '非法键名');
assertImportFail(store.importAll({ data: { 'sisy-timer-state': { phase: 'sleep', totalSec: 100 } } }, 'merge'), 'phase 非法被拒绝', 'phase');
assertImportFail(store.importAll({ data: { 'sisy-timer-prefs': { phases: { focus: 'long' } } } }, 'merge'), 'phases 非数字被拒绝', 'phases');

function assertImportFail(r, name, expectInMsg) {
  H.assert(r && r.ok === false, name, r);
  H.assert(String(r.error || '').indexOf(expectInMsg) !== -1, name + '：错误信息包含「' + expectInMsg + '」', r.error);
}
H.eq(store.get('sisy-timer-stats').rounds, 3, '全部失败后原统计未被动');
H.eq(countBackups(dir), 0, '失败的导入一个备份都没产生（数据未动不需要备份）');

H.group('2. 合法导入：解析→校验→摘要→只备份一次→写入→验证');
const legacy = {
  app: 'sisy', schema: 2, exportedAt: new Date().toISOString(),
  data: {
    'sisy-focus-state-v2': { viewDay: '2026-9-8', days: { '2026-9-8': { tasks: [{ id: 'L1', title: '旧结构任务', done: true }], dismissedDaily: { } } } },
    'sisy-timer-stats': { day: '2026-9-8', rounds: 12, minutes: 300 },
    'sisy-unknown-future-key': { keep: true }
  }
};
const before = countBackups(dir);
const r = store.importAll(legacy, 'merge');
H.assert(r.ok, '旧格式备份导入成功', r);
H.eq(countBackups(dir), before + 1, '只新增一份 pre-import 备份');
H.assert(/pre-import/.test(String(r.backup)), '备份文件带 pre-import 标记', r.backup);
H.assert(r.summary && r.summary.days === 1 && r.summary.tasks === 1, '导入摘要可读', r.summary);
H.assert(!!r.verified, '导入后经过磁盘验证');
const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'sisy-store.json'), 'utf8'));
H.assert(onDisk.data['sisy-focus-state-v2'].days['2026-09-08'], '补零迁移已落盘（2026-9-8 -> 2026-09-08）');
H.eq(onDisk.data['sisy-timer-stats'].rounds, 12, '统计已按导入值更新');
H.eq(onDisk.data['sisy-unknown-future-key'].keep, true, '未知键按向前兼容保留');

H.group('3. 写入失败 / 验证失败：必须回滚不留脏数据');
const dir2 = H.mkTmp('data-rel-fault');
const store2 = silentStore(dir2);
store2.load();
store2.set('sisy-timer-stats', { day: '2026-09-08', rounds: 5, minutes: 125 });
store2.flush();
const fault = H.faultFs({ fail: { renameSync: { at: 'all', message: 'injected disk failure' } } });
const store3 = silentStore(dir2, fault);
store3.load();
const impFail = store3.importAll({ data: { 'sisy-timer-stats': { day: '2026-09-08', rounds: 99, minutes: 999 } } }, 'merge');
H.eq(impFail.ok, false, '落盘被注入故障时导入返回失败');
H.assert(/回滚|写入失败/.test(String(impFail.error)), '错误信息说明已回滚', impFail.error);
H.eq(store3.get('sisy-timer-stats').rounds, 5, '内存数据回滚为导入前值');

// 验证失败路径：rename “成功”但写入的是损坏内容
const badRenameFs = Object.create(fs);
const realRename = fs.renameSync.bind(fs);
badRenameFs.writeFileSync = fs.writeFileSync.bind(fs);
badRenameFs.existsSync = fs.existsSync.bind(fs);
badRenameFs.mkdirSync = fs.mkdirSync.bind(fs);
badRenameFs.readFileSync = fs.readFileSync.bind(fs);
badRenameFs.readdirSync = fs.readdirSync.bind(fs);
badRenameFs.statSync = fs.statSync.bind(fs);
badRenameFs.unlinkSync = fs.unlinkSync.bind(fs);
badRenameFs.copyFileSync = fs.copyFileSync.bind(fs);
badRenameFs.renameSync = function (from, to) { fs.writeFileSync(to, '{{{ broken after rename', 'utf8'); };

const dir3 = H.mkTmp('data-rel-verify');
const store4 = silentStore(dir3);
store4.load();
store4.set('sisy-timer-stats', { day: '2026-09-08', rounds: 7, minutes: 175 });
store4.flush();
const store5 = silentStore(dir3, badRenameFs);
store5.load();   // 正常应用生命周期：创建后必 load（main.js 如此）
// 让 backup() 能写成功（writeFileSync 正常），rename 会毁掉主文件 -> 验证失败 -> 从备份恢复
const verifyFail = store5.importAll({ data: { 'sisy-timer-stats': { day: '2026-09-08', rounds: 88, minutes: 880 } } }, 'merge');
H.eq(verifyFail.ok, false, '磁盘验证不通过时导入判为失败');
H.assert(/验证失败/.test(String(verifyFail.error)), '错误信息说明验证失败', verifyFail.error);
H.assert(fs.existsSync(verifyFail.backup), '导入前备份仍在，可作恢复来源');
H.eq(store5.get('sisy-timer-stats').rounds, 7, '已从导入前备份回滚到原值');
H.eq(JSON.parse(fs.readFileSync(path.join(dir3, 'sisy-store.json'), 'utf8')).data['sisy-timer-stats'].rounds, 7, '磁盘也被恢复到导入前状态');

H.group('4. 损坏文件 / .tmp / 备份的恢复路径');
const dir4 = H.mkTmp('data-rel-corrupt');
const s4 = silentStore(dir4);
s4.load();
s4.set('sisy-a-keep', { v: 1 });
s4.flush();
s4.rollingBackup();
s4.set('sisy-b-later', { v: 2 });
s4.flush();
fs.writeFileSync(path.join(dir4, 'sisy-store.json'), '{{{ 彻底损坏', 'utf8');
const s5 = silentStore(dir4);
const l5 = s5.load();
H.eq(l5.corrupt, true, '损坏被识别');
H.eq(l5.recovered, 'backup', '自动从最近备份恢复');
H.eq(s5.get('sisy-a-keep').v, 1, '恢复后原数据仍可读（备份时点的键）');
H.eq(s5.get('sisy-b-later'), null, '备份时点之后的键丢失（预期：日备机制）');
H.assert(fs.readdirSync(dir4).some((f) => f.includes('.corrupt-')), '损坏现场文件被保留');
const rec = s5.listRecovery();
H.assert(rec.corrupt.length >= 1 && rec.backups.length >= 1, 'listRecovery 能枚举恢复路径', rec);

// 主文件丢失但 .tmp 完好（上次崩溃在 rename 之前）
const dir5 = H.mkTmp('data-rel-tmp');
const s6 = silentStore(dir5);
s6.load();
s6.set('sisy-a-keep', { v: 42 });
s6.flush();
fs.writeFileSync(path.join(dir5, 'sisy-store.json.tmp'), fs.readFileSync(path.join(dir5, 'sisy-store.json'), 'utf8'), 'utf8');
fs.unlinkSync(path.join(dir5, 'sisy-store.json'));
const s7 = silentStore(dir5);
const l7 = s7.load();
H.eq(l7.recovered, 'tmp', '主文件缺失时从 .tmp 恢复');
H.eq(s7.get('sisy-a-keep').v, 42, '.tmp 恢复的数据正确');

H.group('5. 分区清空');
const sc = schema.resolveClearScopes(['tasks', 'stats']);
H.assert(sc.bad.length === 0 && sc.keys.indexOf('sisy-focus-state-v2') !== -1 && sc.keys.indexOf('sisy-timer-stats') !== -1, 'tasks+stats 分区解析正确', sc);
const badScope = schema.resolveClearScopes(['evil', 'daily']);
H.assert(badScope.bad.indexOf('evil') !== -1, '未知分区被标记', badScope);
const dir6 = H.mkTmp('data-rel-clear');
const s8 = silentStore(dir6);
s8.load();
s8.set('sisy-focus-state-v2', { viewDay: '2026-09-08', days: { '2026-09-08': { tasks: [{ id: 'x', title: 't', subtasks: [] }], dismissedDaily: {} } } });
s8.set('sisy-timer-stats', { day: '2026-09-08', rounds: 2, minutes: 50 });
s8.set('sisy-daily-config', { tasks: [{ id: 'd1', title: '喝水' }] });
s8.flush();
H.assert(!s8.clear(['not-ours']).ok, 'clear 拒绝非法键名');
H.eq(s8.get('sisy-timer-stats').rounds, 2, '被拒绝的 clear 没动数据');
const cleared = s8.clear(schema.resolveClearScopes(['tasks']).keys);
H.eq(cleared.removed, 1, '只清任务分区');
H.eq(s8.get('sisy-focus-state-v2'), null, '任务已清空');
H.eq(s8.get('sisy-timer-stats').rounds, 2, '统计不受影响');
H.eq(s8.get('sisy-daily-config').tasks.length, 1, '每日任务不受影响');

H.group('6. 恢复键与超大值');
const withRecovery = store.importAll({ data: { 'sisy-x__corrupt_2026-09-01T00-00-00-000Z': { raw: '{bad', recoveredAt: 'now' } } }, 'merge');
H.assert(withRecovery.ok, '损坏恢复键可以随备份搬运回来', withRecovery);
H.assert(Object.keys(store.snapshot()).some((k) => k.indexOf('__corrupt_') !== -1), '恢复键保存在存储中');
const big = 'x'.repeat(6 * 1024 * 1024);
H.assert(!store.set('sisy-huge', big).ok, '超过 5MB 的单值被拒绝写入');

H.finish();
