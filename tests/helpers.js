/* ============================================================
 * tests/helpers.js · 回归测试共用工具（纯 Node，不依赖 Electron）
 * ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
const failures = [];
let currentGroup = '';

function group(title) { currentGroup = title; console.log('\n── ' + title); }
function ok(name) { pass++; console.log('  ✓ ' + name); }
function assert(cond, name, extra) {
  if (cond) { ok(name); return; }
  failures.push((currentGroup ? currentGroup + ' / ' : '') + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
  console.error('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
function eq(a, b, name) { assert(a === b, name, { got: a, want: b }); }
function near(a, b, tol, name) { assert(Math.abs(a - b) <= tol, name, { got: a, want: b, tol: tol }); }

function finish() {
  console.log('\n' + '='.repeat(52));
  if (failures.length) {
    console.error('失败 ' + failures.length + ' / ' + (pass + failures.length));
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过 ✅  ' + pass + ' 项断言');
  process.exit(0);
}

function mkTmp(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sisy-' + tag + '-'));
}

/* 故障注入文件系统：指定方法在被调用第 failAt 次时抛 EIO */
function faultFs(opts) {
  const counters = {};
  const targets = opts.fail || {};
  const wrapped = {};
  for (const key of Object.getOwnPropertyNames(fs)) {
    if (typeof fs[key] !== 'function') continue;
    wrapped[key] = fs[key].bind(fs);
  }
  wrapped.__calls = counters;
  Object.keys(targets).forEach((m) => {
    const spec = targets[m];
    const orig = wrapped[m];
    wrapped[m] = function () {
      counters[m] = (counters[m] || 0) + 1;
      if (spec.at === 'all' || (typeof spec.at === 'number' && counters[m] === spec.at)) {
        const err = new Error(spec.message || 'injected ' + m + ' failure');
        err.code = spec.code || 'EIO';
        throw err;
      }
      return orig.apply(null, arguments);
    };
  });
  return wrapped;
}

/* 可注入时钟 */
function fakeClock(startWall, startMono) {
  const c = {
    wall: startWall === undefined ? Date.parse('2026-09-08T09:00:00') : startWall,
    mono: startMono === undefined ? 1000 : startMono,
    now() { return c.wall; },
    monoNow() { return c.mono; },
    advance(ms) { c.wall += ms; c.mono += ms; },          // 正常流逝（含休眠）
    jumpWall(ms) { c.wall += ms; },                        // 只改系统时间
    setWall(ms) { c.wall = ms; }
  };
  return c;
}

/* 假 electron：记录 on/handle 通道，供 IPC 回归测试直接调用。 */
function fakeElectron(userData) {
  const onChannels = {};
  const handleChannels = {};
  const calls = { reveal: [], notifyShown: 0, relaunch: 0, exit: 0 };
  const root = path.resolve(__dirname, '..');
  const fileUrl = (p) => 'file://' + path.join(root, p).split(path.sep).join('/');
  const makeEvent = () => ({ returnValue: undefined });
  const fake = {
    ipcMain: {
      on: (ch, fn) => { onChannels[ch] = fn; },
      handle: (ch, fn) => { handleChannels[ch] = fn; }
    },
    dialog: {
      showSaveDialog: async () => ({ canceled: true }),
      showOpenDialog: async () => ({ canceled: true })
    },
    shell: {
      showItemInFolder: (p) => { calls.reveal.push(p); }
    },
    app: {
      getPath: (name) => (name === 'documents' ? path.join(userData, 'docs') : userData),
      getVersion: () => '1.2.0',
      relaunch: () => { calls.relaunch++; },
      exit: () => { calls.exit++; },
      isPackaged: false
    },
    BrowserWindow: {
      getAllWindows: () => [],
      fromWebContents: () => null
    },
    Notification: class FakeNotification {
      static isSupported() { return true; }
      constructor(o) { this.o = o; }
      show() { calls.notifyShown++; }
    }
  };
  return { electron: fake, onChannels, handleChannels, calls, makeEvent, fileUrl };
}

/* 渲染层共享命名空间垫片（storage.js / state.js 的宿主环境） */
function freshRendererEnv() {
  delete globalThis.DSH;
  delete globalThis.dshStore;
  delete globalThis.dshTimer;
  delete globalThis.dshLog;
  delete globalThis.window;
  return globalThis;
}

module.exports = { group, ok, assert, eq, near, finish, mkTmp, faultFs, fakeClock, fakeElectron, freshRendererEnv };
