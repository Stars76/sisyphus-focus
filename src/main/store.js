/* ============================================================
 * src/main/store.js · 主进程权威数据存储（唯一写者）
 * ------------------------------------------------------------
 * 为什么搬到主进程：
 *   1) 主窗内嵌专注钟 + 独立小窗是两个渲染进程，各自维护内存状态，
 *      共用同一批 localStorage 键 → 互相覆盖、统计重复累加。
 *   2) localStorage 会被「清理浏览数据 / 换用户目录」清掉。
 *   3) 主进程只有一个，天然串行化写入，导出/导入/备份也更好做。
 *
 * 文件：<userData>/sisy-store.json
 *   { schema, updatedAt, data: { "sisy-xxx": <value>, ... } }
 *
 * 可靠性策略（v1.2 起）：
 *   - 启动加载：主文件损坏 → 另存 .corrupt- 现场 → 依次尝试 .tmp、最近备份恢复
 *   - 加载时对已知键跑 schema 校验 + migrations 版本化迁移（幂等）
 *   - 写入：内存即时生效 + 250ms 去抖落盘 + 原子替换（.tmp -> rename）
 *   - 导入：解析→校验→摘要→只备份一次→写入→验证→（IPC 层）刷新
 *   - 启动时滚动备份到 <userData>/backups/sisy-store-<日期>.json（保留最近 10 份）
 *   - 恢复路径（损坏文件 / 未替换的 .tmp / 导入前备份）通过 listRecovery() 可枚举
 * ============================================================ */
'use strict';

const defaultFs = require('fs');
const path = require('path');

const schema = require('./schema');
const migrations = require('./migrations');

const SCHEMA = schema.SCHEMA;          // 2
const KEY_PREFIX = schema.KEY_PREFIX;  // 'sisy-'
const MAX_BACKUPS = 10;
const FLUSH_DEBOUNCE = 250;
/** 已知存储键集合：store.set 对这组键做值结构校验 */
const KNOWN_STORE_KEYS = new Set(Object.values(schema.KEYS));

function createStore(opts) {
  opts = opts || {};
  const dir = opts.dir;
  const fs = opts.fs || defaultFs;      // 可注入（测试用故障文件系统）
  const file = path.join(dir, 'sisy-store.json');
  const backupDir = path.join(dir, 'backups');
  const log = opts.log || function () { };
  const warn = opts.warn || log;

  let data = {};
  let dirty = false;
  let timer = null;
  let lastError = null;
  let appliedMigrations = [];

  function ensureDir(p) {
    try { fs.mkdirSync(p, { recursive: true }); return true; }
    catch (e) { warn('创建目录失败 ' + p, e); return false; }
  }

  function readFileSafe(p) {
    try { return fs.readFileSync(p, 'utf8'); }
    catch (e) { return null; }
  }

  function parseJson(text) {
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  }

  /** 损坏键隔离：保留原文到 __corrupt_ 键，主键删除 */
  function quarantineKey(key, value, why) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const side = key + '__corrupt_' + stamp;
    data[side] = { raw: JSON.stringify(value), recoveredAt: new Date().toISOString(), reason: why };
    delete data[key];
    warn('键 ' + key + ' 数据非法（' + why + '），已另存为 ' + side);
  }

  /** 加载后对已知键做校验；可修复的取修复值，硬错误的隔离。
   * 返回是否有任何数据改动（调用方须据此标记 dirty 并落盘，否则损坏键每次启动重复出现）。 */
  function sanitizeKnownKeys() {
    let changed = false;
    Object.keys(schema.KEYS).forEach(function (key) {
      const known = schema.KEYS[key];
      if (!Object.prototype.hasOwnProperty.call(data, known)) return;
      const r = schema.validateValue(known, data[known]);
      if (!r.ok) {
        quarantineKey(known, data[known], (r.errors || []).join('; ').slice(0, 200));
        changed = true;
        return;
      }
      if (r.repaired.length) {
        log('加载修复：' + r.repaired.join(' | '));
        data[known] = r.value;
        changed = true;
      }
    });
    return changed;
  }

  /** 从任意一份已解析的外层内容装载数据（含迁移），返回 {loaded, changes} */
  function adoptParsed(parsed) {
    const env = migrations.migrateEnvelope(parsed);
    env.notes.forEach(function (n) { log('迁移：' + n); });
    appliedMigrations = appliedMigrations.concat(env.notes);
    data = env.data;
    const sanitizeChanged = sanitizeKnownKeys();
    if (env.notes.length || sanitizeChanged) dirty = true;   // H3：任何修复/隔离/迁移都要落盘
    return { changes: env.notes, schema: env.schema, sanitizeChanged };
  }

  /**
   * 存储文件结构有效性：必须是 object（非数组、非 null）。
   * 有 data 键 → data 必须是 object（合法空 data:{} 通过）；
   * 无 data 键 → 视为旧版裸键值表，要求键全为 sisy-*（或 envelope 元字段）。
   * JSON 可解析不等于「有效存储」：字面量 null / 数组 / 字符串 / 数字都算无效。
   */
  function storeShapeOk(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    if (Object.prototype.hasOwnProperty.call(parsed, 'data')) {
      const d = parsed.data;
      return !!d && typeof d === 'object' && !Array.isArray(d);
    }
    return Object.keys(parsed).every(function (k) { return k === 'schema' || k === 'updatedAt' || /^sisy-/.test(k); });
  }

  /**
   * 候选（tmp / 备份）能否作为恢复源：外层结构有效 且 每个数据键都通过 schema 结构校验。
   * 已知键的硬错误（如 day 为 null、days 为数组、tasks 为字符串等）→ 语义损坏候选，
   * 不得采用（否则会把坏备份压过更早的有效备份）。未知合法键与恢复键、合法空 data 放行。
   */
  function candidateSemanticallyValid(parsed) {
    if (!storeShapeOk(parsed)) return false;
    const data = Object.prototype.hasOwnProperty.call(parsed, 'data') ? parsed.data : parsed;
    if (data === null || typeof data !== 'object') return false;
    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!schema.isValidStoreKey(k)) return false;        // 非 sisy-* 键 → 无效候选
      if (schema.isCorruptKey(k)) continue;                // 恢复键保留
      const r = schema.validateValue(k, data[k]);
      if (!r.ok) return false;                             // 已知键语义损坏 → 无效候选
    }
    return true;
  }

  /** 从 tmp / 备份恢复候选（先结构与语义校验；无效候选保留现场并继续找更早备份） */
  function adoptFromCandidates(mainCorrupt) {
    const tmpRaw = readFileSafe(file + '.tmp');
    if (tmpRaw !== null) {
      const tj = parseJson(tmpRaw);
      if (tj.ok && candidateSemanticallyValid(tj.value)) {
        adoptParsed(tj.value);
        dirty = true;
        scheduleFlush(0);
        log('已从 .tmp 恢复（主文件缺失/损坏）');
        return { loaded: true, recovered: 'tmp', corrupt: !!mainCorrupt };
      }
      // 非法/语义损坏 tmp（解析失败 / null / 数组 / 错误容器 / 已知键损坏）：保留现场，继续找备份
      const side = file.replace(/\.json$/, '') + '.tmp-invalid-' + Date.now() + '.json';
      try { fs.writeFileSync(side, String(tmpRaw), 'utf8'); } catch (e) { }
      warn('tmp 文件无效，已另存 ' + path.basename(side) + '，尝试备份');
    }
    const bak = findRestorableBackup();
    if (bak) {
      adoptParsed(bak.parsed);
      dirty = true;
      scheduleFlush(0);
      log('已从备份恢复：' + bak.name);
      return { loaded: true, recovered: 'backup', backup: bak.path, corrupt: !!mainCorrupt };
    }
    return null;
  }

  /** 找到「结构与语义都可读回」的最近备份；最近失效则继续找更早的有效备份 */
  function findRestorableBackup() {
    try {
      const list = fs.readdirSync(backupDir)
        .filter(function (f) { return /^sisy-store-.*\.json$/.test(f); })
        .map(function (f) { return { f: f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }; })
        .sort(function (a, b) { return b.t - a.t; });
      for (let i = 0; i < list.length; i++) {
        const p = path.join(backupDir, list[i].f);
        const raw = readFileSafe(p);
        if (raw === null) continue;
        const j = parseJson(raw);
        if (j.ok && candidateSemanticallyValid(j.value)) return { path: p, parsed: j.value, name: list[i].f };
      }
    } catch (e) { /* 没有备份目录 */ }
    return null;
  }

  function load() {
    ensureDir(dir);
    const raw = readFileSafe(file);
    if (raw === null) {
      const recovered = adoptFromCandidates(false);
      if (recovered) return recovered;
      data = {};
      dirty = true;
      scheduleFlush(0);
      return { loaded: false };
    }
    const parsed = parseJson(raw);
    if (!parsed.ok || !storeShapeOk(parsed.value)) {
      // 损坏：JSON 非法 或 结构非法（字面量 null / 数组 / 字符串 / 数字 / 错误容器）
      const side = file.replace(/\.json$/, '') + '.corrupt-' + Date.now() + '.json';
      try { fs.writeFileSync(side, raw, 'utf8'); } catch (e2) { warn('损坏现场另存失败', e2); }
      warn('存储文件损坏，已另存为 ' + path.basename(side) + '，尝试恢复');
      const recovered = adoptFromCandidates(true);
      if (recovered) return recovered;
      warn('没有可用备份，按空数据启动（损坏现场已保留）');
      data = {};
      dirty = true;
      scheduleFlush(0);
      return { loaded: false, corrupt: true };
    }
    adoptParsed(parsed.value);
    if (appliedMigrations.length) dirty = true;   // 迁移过就落一次盘
    scheduleFlush(0);
    return { loaded: true, schema: SCHEMA, migrated: appliedMigrations.slice() };
  }

  /** 启动时的滚动备份（每天最多一份，保留最近 10 份） */
  function rollingBackup() {
    if (!fs.existsSync(file)) return null;
    if (!ensureDir(backupDir)) return null;
    const d = new Date();
    const p2 = (n) => (n < 10 ? '0' : '') + n;
    const name = 'sisy-store-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.json';
    const dest = path.join(backupDir, name);
    if (fs.existsSync(dest)) return dest;   // 今天已经备份过
    try {
      fs.copyFileSync(file, dest);
      pruneBackups();
      log('已生成启动备份 ' + path.basename(dest));
      return dest;
    } catch (e) { warn('启动备份失败 ' + (e && e.message), e); return null; }
  }

  function pruneBackups() {
    try {
      const list = fs.readdirSync(backupDir)
        .filter((f) => /^sisy-store-.*\.json$/.test(f))
        .map((f) => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      list.slice(MAX_BACKUPS).forEach((it) => {
        try { fs.unlinkSync(path.join(backupDir, it.f)); } catch (e) { }
      });
    } catch (e) { warn('清理旧备份失败', e); }
  }

  function serialize() {
    return JSON.stringify({ schema: SCHEMA, updatedAt: new Date().toISOString(), data }, null, 2);
  }

  function writeNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return { ok: true };
    if (!ensureDir(dir)) { lastError = '目录不可写'; return { ok: false, error: lastError }; }
    const tmp = file + '.tmp';
    try {
      fs.writeFileSync(tmp, serialize(), 'utf8');
      fs.renameSync(tmp, file);       // 原子替换
      dirty = false;
      lastError = null;
      return { ok: true };
    } catch (e) {
      lastError = (e && e.message) || String(e);
      warn('写入存储失败', e);
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e2) { }
      return { ok: false, error: lastError };
    }
  }

  /** 落盘后验证：重新读文件，与内存比对；不一致返回 false */
  function verifyOnDisk() {
    const raw = readFileSafe(file);
    if (raw === null) return false;
    const j = parseJson(raw);
    if (!j.ok || !j.value || !j.value.data) return false;
    try {
      return JSON.stringify(sortish(j.value.data)) === JSON.stringify(sortish(clone(data)));
    } catch (e) { return false; }
  }
  function sortish(o) {
    if (Array.isArray(o)) return o.map(sortish);
    if (o && typeof o === 'object') {
      const out = {};
      Object.keys(o).sort().forEach(function (k) { out[k] = sortish(o[k]); });
      return out;
    }
    return o;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function scheduleFlush(delay) {
    if (timer) return;
    timer = setTimeout(function () { timer = null; writeNow(); }, delay === undefined ? FLUSH_DEBOUNCE : delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function isOurKey(k) { return schema.isValidStoreKey(k); }

  const api = {
    SCHEMA,
    file,
    backupDir,

    load,
    rollingBackup,
    flush: writeNow,

    getMigrationLog() { return appliedMigrations.slice(); },

    get(key) {
      if (!isOurKey(key)) return null;
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },

    set(key, value) {
      if (typeof key !== 'string' || !isOurKey(key)) return { ok: false, error: '非法键名' };
      if (value === undefined) return { ok: false, error: '值不能是 undefined' };
      // 已知键：值结构先校验（与加载/导入同一套规则）。
      // 硬错误 → 拒绝且不改内存/不落盘；可修复项（旧日期键补零等受控迁移）→ 采用修复值。
      if (KNOWN_STORE_KEYS.has(key)) {
        const vr = schema.validateValue(key, value);
        if (!vr.ok) return { ok: false, error: '值不符合结构要求：' + vr.errors.slice(0, 3).join('；') };
        if (vr.repaired.length) value = vr.value;
      }
      // 结构化克隆一次，避免渲染进程后续改动共享引用
      let safe;
      try { safe = JSON.parse(JSON.stringify(value)); }
      catch (e) { return { ok: false, error: '值无法序列化: ' + ((e && e.message) || e) }; }
      try {
        if (JSON.stringify(safe).length > schema.MAX_VALUE_BYTES) {
          return { ok: false, error: '值超过 5MB 上限，拒绝写入' };
        }
      } catch (e) { return { ok: false, error: '值序列化失败' }; }
      data[key] = safe;
      dirty = true;
      scheduleFlush();
      return { ok: true };
    },

    remove(key) {
      if (typeof key !== 'string' || !isOurKey(key)) return { ok: false, error: '非法键名' };
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        delete data[key];
        dirty = true;
        scheduleFlush();
      }
      return { ok: true };
    },

    keys() {
      return Object.keys(data).filter(isOurKey).sort();
    },

    snapshot() {
      return clone(data);
    },

    exportAll() {
      return {
        app: 'sisyphus',
        schema: SCHEMA,
        exportedAt: new Date().toISOString(),
        backend: 'main',
        data: api.snapshot()
      };
    },

    /**
     * 导入（唯一入口）：解析→校验→摘要→只备份一次→写入→验证
     * 任一步失败：不写数据 / 从备份回滚，并返回错误。
     */
    importAll(bundle, mode) {
      if (mode !== undefined && mode !== 'merge' && mode !== 'replace') {
        return { ok: false, error: '非法导入模式：' + String(mode).slice(0, 24) };
      }
      let validation;
      try {
        validation = schema.validateBundle(bundle);
      } catch (e) {
        return { ok: false, error: '校验异常：' + ((e && e.message) || e) };
      }
      if (!validation.ok) {
        warn('导入校验失败（未做任何改动）：' + validation.errors.join(' | ').slice(0, 500));
        return { ok: false, error: validation.errors.join('；').slice(0, 500), errors: validation.errors };
      }

      const pre = api.backup('pre-import');     // 只在这里备份这一次
      if (!pre.ok) {
        warn('导入前备份失败，中止导入（数据未动）', pre.error);
        return { ok: false, error: '导入前备份失败，已中止：' + pre.error };
      }

      const incoming = validation.perKey;
      const prev = clone(data);
      const keys = Object.keys(incoming);
      let applied = 0;
      keys.forEach((k) => { data[k] = incoming[k]; applied++; });
      // 损坏恢复键也搬运过来（保留恢复路径）
      Object.keys(bundle.data).forEach(function (k) {
        if (schema.isCorruptKey(k) && schema.isValidStoreKey(k)) { data[k] = bundle.data[k]; applied++; }
      });
      if (mode === 'replace') {
        Object.keys(data).filter(isOurKey).forEach((k) => {
          if (keys.indexOf(k) === -1 && !schema.isCorruptKey(k)) delete data[k];
        });
      }
      // 导入的内容再过一遍数据级迁移（旧包导入后即为新结构）
      const mig = migrations.migrateData(data, { log: function () { } });
      appliedMigrations = appliedMigrations.concat(mig.changes);
      dirty = true;
      const w = writeNow();
      if (!w.ok) {
        data = prev;
        dirty = true; writeNow();   // 尽力把内存回滚也落盘
        warn('导入落盘失败，已回滚：' + w.error);
        return { ok: false, error: '写入失败已回滚：' + w.error, backup: pre.path };
      }
      if (!verifyOnDisk()) {
        try { fs.copyFileSync(pre.path, file); } catch (e2) { warn('回滚备份失败', e2); }
        const back = parseJson(readFileSafe(file));
        if (back.ok) adoptParsed(back.value);
        warn('导入后验证失败，已从导入前备份回滚');
        return { ok: false, error: '导入后验证失败，已从备份回滚', backup: pre.path };
      }
      log('导入完成 applied=' + applied + ' mode=' + (mode || 'merge') + ' 摘要=' + JSON.stringify(validation.summary));
      return {
        ok: true, applied, skipped: [], mode: mode || 'merge',
        backup: pre.path, summary: validation.summary,
        repaired: validation.repaired, verified: true
      };
    },

    /**
     * 清空指定键（keys 为存储键数组；null/空 = 全部业务键）。
     * 分区清空（tasks/daily/stats/history/prefs/timerState）由 IPC 层解析成键列表后调用。
     * 写入失败时内存回滚，避免「界面说清了、文件没清」的假象。
     */
    clear(keys) {
      const target = (Array.isArray(keys) && keys.length) ? keys.filter(isOurKey) : Object.keys(data).filter(isOurKey);
      if (Array.isArray(keys) && keys.length && target.length !== keys.length) {
        return { ok: false, error: '包含非法键名，已拒绝' };
      }
      const prev = clone(data);
      let removed = 0;
      target.forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(data, k)) { delete data[k]; removed++; }
      });
      dirty = true;
      const w = writeNow();
      if (!w.ok) {
        data = prev;
        dirty = true; writeNow();
        warn('清空落盘失败，已回滚：' + w.error);
        return { ok: false, error: '清空失败已回滚：' + w.error, removed: 0 };
      }
      return { ok: true, removed };
    },

    /** 手动备份，返回文件路径 */
    backup(tag) {
      if (typeof tag === 'string' && !/^[A-Za-z0-9_-]{1,32}$/.test(tag)) tag = 'manual';
      if (tag != null && typeof tag !== 'string') tag = 'manual';
      if (!ensureDir(backupDir)) return { ok: false, error: '备份目录不可写' };
      writeNow();
      const d = new Date();
      const p2 = (n) => (n < 10 ? '0' : '') + n;
      const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' +
        p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
      const dest = path.join(backupDir, 'sisy-store-' + stamp + (tag ? '-' + tag : '') + '.json');
      try {
        fs.writeFileSync(dest, serialize(), 'utf8');
        pruneBackups();
        return { ok: true, path: dest };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    },

    /** 可恢复文件清单：损坏现场 / 未替换的 tmp / 备份列表 */
    listRecovery() {
      const out = { corrupt: [], temp: [], backups: [] };
      try {
        out.corrupt = fs.readdirSync(dir).filter((f) => f.indexOf('.corrupt-') !== -1).sort();
        out.temp = fs.readdirSync(dir).filter((f) => f.indexOf('.tmp') !== -1).sort();
      } catch (e) { }
      try {
        out.backups = fs.readdirSync(backupDir)
          .filter((f) => /^sisy-store-.*\.json$/.test(f))
          .map((f) => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, MAX_BACKUPS)
          .map((x) => x.name);
      } catch (e) { }
      return out;
    },

    get lastError() { return lastError; }
  };

  return api;
}

module.exports = { createStore, SCHEMA, KEY_PREFIX };
