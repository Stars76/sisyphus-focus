/* ============================================================
 * tests/h-boundaries.test.js · 存储边界回归 H1/H3
 * H1 恢复候选「完整结构（语义）校验」：最新语义损坏备份不得压过更早有效备份；
 *    所有候选语义损坏→空数据+现场；合法空备份 {data:{}} 可恢复；恢复后重开。
 * H3 加载时 schema 修复/键隔离/迁移必须标记 dirty 并落盘：load→flush→重开三步、
 *    隔离现场键、未损坏键保留、写失败保留内存与现场并有明确错误。
 * 用法：node tests/h-boundaries.test.js（随 tests/run-all.js 执行）
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const { createStore } = require('../src/main/store');
const util = require('../src/main/util');

H.freshRendererEnv();

H.group('H1. 恢复候选完整结构校验（语义损坏跳过，继续找更早有效备份）');
{
  // 旧有效备份(sisy-marker) + 更新但语义损坏备份(sisy-focus-state-v2.days=[] 空数据) + 主文件/tmp 损坏
  const p = H.mkTmp('h1-semantic');
  const s = createStore({ dir: p, log: () => { }, warn: () => { } }); s.load();
  s.set('sisy-marker', { version: 'good' }); s.flush(); s.backup('earlier');
  const newer = path.join(p, 'backups', 'sisy-store-newer.json');
  fs.writeFileSync(newer, JSON.stringify({ schema: 2, data: { 'sisy-focus-state-v2': { viewDay: '2026-09-09', days: [] } } }), 'utf8');
  fs.utimesSync(newer, new Date(Date.now() + 1000), new Date(Date.now() + 1000));  // 让它看起来更新
  fs.writeFileSync(s.file, '{broken'); fs.writeFileSync(s.file + '.tmp', 'null');
  const b = createStore({ dir: p, log: () => { }, warn: () => { } }); const res = b.load();
  H.eq(res.recovered, 'backup', 'H1 语义损坏最新备份被跳过（仍恢复 backup）', res);
  H.assert(b.get('sisy-marker') && b.get('sisy-marker').version === 'good', 'H1 更早有效 marker 被找回', b.get('sisy-marker'));
  b.flush();
  const b2 = createStore({ dir: p, log: () => { }, warn: () => { } }); b2.load();
  H.eq(b2.get('sisy-marker').version, 'good', 'H1 重开后 marker 仍在');

  // 所有候选都语义损坏（唯一候选是坏备份）→ 空数据启动 + 现场保留
  const p3 = H.mkTmp('h1-all-bad');
  const s3 = createStore({ dir: p3, log: () => { }, warn: () => { } }); s3.load();
  s3.set('sisy-marker', { v: 7 }); s3.flush(); s3.backup('ok');
  fs.writeFileSync(s3.file, '{broken'); fs.writeFileSync(s3.file + '.tmp', 'null');
  // 把所有既有备份改成语义损坏，作为唯一候选
  for (const f of fs.readdirSync(path.join(p3, 'backups'))) {
    fs.unlinkSync(path.join(p3, 'backups', f));
  }
  fs.writeFileSync(path.join(p3, 'backups', 'sisy-store-bad.json'),
    JSON.stringify({ schema: 2, data: { 'sisy-timer-stats': { day: null, rounds: 1, minutes: 1 } } }), 'utf8');
  const b3 = createStore({ dir: p3, log: () => { }, warn: () => { } }); const r3 = b3.load();
  H.assert(r3.corrupt === true && !r3.backup, 'H1 所有候选语义损坏→空数据启动', r3);
  H.assert(fs.readdirSync(p3).some((f) => f.includes('corrupt') || f.includes('tmp-invalid')), 'H1 损坏现场保留', fs.readdirSync(p3));

  // 合法空备份 {data:{}} 仍可恢复（不因“空”被拒）
  const p4 = H.mkTmp('h1-empty');
  const s4 = createStore({ dir: p4, log: () => { }, warn: () => { } }); s4.load();
  s4.set('sisy-marker', { v: 3 }); s4.flush(); s4.backup('empty-ok');
  fs.unlinkSync(s4.file); fs.writeFileSync(s4.file + '.tmp', JSON.stringify({ schema: 2, data: {} }));
  const b4 = createStore({ dir: p4, log: () => { }, warn: () => { } }); const r4 = b4.load();
  H.eq(r4.recovered, 'tmp', 'H1 合法空备份被视为有效恢复源', r4);
  b4.flush();
  const b4b = createStore({ dir: p4, log: () => { }, warn: () => { } }); b4b.load();
  H.eq(b4b.get('sisy-marker'), null, 'H1 空备份重开一致（无旧 marker）');

  // 未知合法键 + 恢复键仍可恢复（不误拒）
  const p5 = H.mkTmp('h1-forward');
  const s5 = createStore({ dir: p5, log: () => { }, warn: () => { } }); s5.load();
  s5.set('sisy-unknown-future', { keep: 1 }); s5.flush(); s5.backup('ok');
  fs.writeFileSync(s5.file, '{broken');
  const b5 = createStore({ dir: p5, log: () => { }, warn: () => { } }); const r5 = b5.load();
  H.eq(r5.recovered, 'backup', 'H1 未知合法键候选被采用', r5);
  H.eq(b5.get('sisy-unknown-future').keep, 1, 'H1 未知键数据恢复');
}

H.group('H3. 加载时 schema 修复/隔离必须落盘（load→flush→重开）');
{
  const p = H.mkTmp('h3');
  const good = { schema: 2, data: {
    'sisy-timer-stats': { day: 'not-a-day', rounds: 5, minutes: 125 },   // 非法 day
    'sisy-focus-state-v2': { viewDay: '2026-09-09', days: { '2026-09-09': { tasks: [{ id: 'ok1', title: 't', done: false, subtasks: [] }], dismissedDaily: {} } } }
  } };
  fs.writeFileSync(path.join(p, 'sisy-store.json'), JSON.stringify(good), 'utf8');
  const s = createStore({ dir: p, log: () => { }, warn: () => { } });
  const res = s.load();
  H.eq(s.get('sisy-timer-stats'), null, 'H3 内存中非法键已隔离（主键删除）');
  const corruptKey = Object.keys(s.snapshot()).find((k) => k.includes('__corrupt_'));
  H.assert(!!corruptKey, 'H3 内存中有隔离现场键', Object.keys(s.snapshot()));
  H.eq(s.get('sisy-focus-state-v2').days['2026-09-09'].tasks[0].id, 'ok1', 'H3 未损坏键保留');
  H.assert(res.loaded === true, 'H3 load 成功（已加载，非空启动）', res);
  // 立即落盘（不依赖后续普通写入）
  const w = s.flush();
  H.eq(w.ok, true, 'H3 隔离后 flush 成功');
  const disk = JSON.parse(fs.readFileSync(path.join(p, 'sisy-store.json'), 'utf8'));
  H.eq(disk.data['sisy-timer-stats'], undefined, 'H3 磁盘主键已删除');
  H.assert(Object.keys(disk.data).some((k) => k.includes('__corrupt_')), 'H3 磁盘含隔离现场键', Object.keys(disk.data));
  // 重开：损坏键不再重复出现（隔离现场已持久）
  const s2 = createStore({ dir: p, log: () => { }, warn: () => { } }); s2.load();
  H.eq(s2.get('sisy-timer-stats'), null, 'H3 重开后主键仍未出现');
  H.assert(Object.keys(s2.snapshot()).some((k) => k.includes('__corrupt_')), 'H3 重开后隔离键仍在（一次修复，不再重复隔离）', Object.keys(s2.snapshot()));

  // 写失败：保留内存现场 + 明确错误
  const p2 = H.mkTmp('h3-writefail');
  const badFs = H.faultFs({ fail: { renameSync: { at: 'all', message: 'injected' } } });
  fs.writeFileSync(path.join(p2, 'sisy-store.json'), JSON.stringify({ schema: 2, data: { 'sisy-timer-stats': { day: 'junk' } } }), 'utf8');
  const s3 = createStore({ dir: p2, fs: badFs, log: () => { }, warn: () => { } });
  s3.load();
  const w3 = s3.flush();
  H.eq(w3.ok, false, 'H3 注入写失败返回错误');
  H.eq(s3.get('sisy-timer-stats'), null, 'H3 写失败后内存仍保持隔离（主键删除+现场键在内存）');
  H.assert(Object.keys(s3.snapshot()).some((k) => k.includes('__corrupt_')), 'H3 写失败后内存现场键保留', Object.keys(s3.snapshot()));
}

H.finish();