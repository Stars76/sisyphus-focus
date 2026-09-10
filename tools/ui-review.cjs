// Real Electron UI review with an isolated store. Run: electron tools/ui-review.cjs before|after
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

// CI / 无 GPU 环境更稳：Windows runner 没有真实显卡，走软件渲染 + 锁 1x 缩放，
// 让布局断言与截图在两处环境里读数一致。
if (process.env.CI) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

const label = process.argv.includes('before') ? 'before' : 'after';
if (!/^[a-z-]+$/.test(label)) throw new Error('Invalid output label');
const out = path.join(root, '.tmp/ui-review-out', label);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(root,'.tmp'), {recursive:true});
const temp = fs.mkdtempSync(path.join(root, '.tmp/ui-review-'));
app.setPath('userData', temp);
app.setAppPath(root);
const today = require('../src/main/util').todayKey();
fs.writeFileSync(path.join(temp, 'sisy-store.json'), JSON.stringify({ schema: 2, data: {
  'sisy-timer-stats': { day: today, rounds: 3, minutes: 75 },
  'sisy-focus-state-v2': { viewDay: today, days: { [today]: { tasks: [
    { id: 'a', title: '把产品想法整理成一页说明', done: false, subtasks: [
      { id: 'a1', title: '写下要解决的那个问题', minutes: 5, done: true },
      { id: 'a2', title: '列出第一次打开时最需要的三个功能', minutes: 10, done: false }
    ] },
    { id: 'b', title: '读完昨天标记的那篇文章，留下三条笔记', done: false, subtasks: [] },
    { id: 'c', title: '整理桌面，倒一杯水', done: true, subtasks: [] }
  ], dismissedDaily: {} } } },
  'sisy-timer-prefs': { sound: false, notify: false, motion: 'off', highContrast: false, showSeconds: true, tray: false, closeToTray: true, phases: { focus: 1500, short: 300, long: 900 } }
} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
const checks = [], errors = [];
setTimeout(() => { console.error('UI review timed out'); app.exit(2); }, 90000).unref();
app.on('web-contents-created', (_e, wc) => {
  wc.on('did-fail-load', (_e, code, desc) => errors.push({ code, desc }));
  wc.on('console-message', (_e, level, message) => { if (level === 3) errors.push(message); });
});
function check(name, pass, detail) { checks.push({ name, pass: !!pass, detail }); console.log(JSON.stringify(checks[checks.length - 1])); }
require('../main');
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  for (let i = 0; i < 80 && (!win || win.webContents.isLoading()); i++) await wait(100);
  await wait(700);
  const main = js => win.webContents.executeJavaScript(js);
  const todo = async js => {
    const frame = win.webContents.mainFrame.frames.find(f => f.url.includes('/todo/'));
    if (!frame) throw new Error('Todo frame missing');
    return frame.executeJavaScript(js);
  };
  const shot = async (w, name) => { await wait(180); fs.writeFileSync(path.join(out, name + '.png'), (await w.webContents.capturePage()).toPNG()); };
  win.setContentSize(1060, 780);
  await shot(win, '01-tasks');
  await todo("document.getElementById('settingsBtn').click()");
  await shot(win, '02-settings');
  await todo("document.getElementById('backBtn').click(); document.getElementById('calToggle').click()");
  await shot(win, '03-calendar');
  await todo("document.getElementById('calClose').click()");
  win.setContentSize(720, 560);
  await shot(win, '04-small-main');
  await main('window.dshWindow.openTimerCompact()');
  await wait(800);
  const tw = BrowserWindow.getAllWindows().find(w => w.id !== win.id);
  if (!tw) throw new Error('Timer window missing');
  const timer = js => tw.webContents.executeJavaScript(js);
  tw.setContentSize(320, 430);
  await shot(tw, '05-timer');
  await timer("document.getElementById('setBtn').focus(); document.getElementById('setBtn').click()");
  await shot(tw, '06-timer-settings');
  await timer("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  if (label === 'after') {
    const verify = async (name, exec, code) => { const detail = await exec(code); check(name, detail === true, detail); };
    // 轮询渲染端镜像直到满足或超时：Space 后主进程→渲染镜像同步有数百 ms 抖动，
    // 单一 wait(250) 在该边界上不稳定（实测偶发失败而权威状态始终正确）。
    const waitTrue = async (code, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await timer(code)) === true) return true; await wait(100); } return (await timer(code)) === true; };
    const key = (wc, code) => { wc.sendInputEvent({ type: 'keyDown', keyCode: code }); wc.sendInputEvent({ type: 'keyUp', keyCode: code }); };
    await verify('shared stylesheet applied', todo, "getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() === '#FFFFFF' && getComputedStyle(document.querySelector('.bottom-actions')).position === 'static'");
    await verify('task count represents actual state', todo, "document.getElementById('taskCount').textContent === '1 / 3 已完成'");
    await verify('toggle preserves keyboard focus and progress', todo, `(() => {
      const b=document.querySelector('[data-id="b"] [data-act="toggle"]'); b.focus(); b.click();
      return document.activeElement.dataset.act==='toggle' && document.activeElement.closest('.todo-item').dataset.id==='b' && document.getElementById('taskCount').textContent==='2 / 3 已完成';
    })()`);
    await verify('add and edit task through UI', todo, `(() => {
      const i=document.getElementById('addInput'); i.value='待修改的任务'; document.getElementById('addForm').requestSubmit();
      const row=Array.from(document.querySelectorAll('.todo-item')).find(n=>n.textContent.includes('待修改的任务'));
      row.querySelector('button[data-act="edit"]').click(); const edit=row.querySelector('input'); edit.value='已经修改的任务';
      edit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      return document.getElementById('taskList').textContent.includes('已经修改的任务');
    })()`);
    await verify('settings isolates underlying controls', todo, `(() => { document.getElementById('settingsBtn').focus(); document.getElementById('settingsBtn').click(); return document.getElementById('addForm').inert && document.activeElement.id==='backBtn'; })()`);
    await verify('Escape works inside settings input and restores focus', todo, `(() => { document.getElementById('dailyInput').focus(); document.getElementById('dailyInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return !document.getElementById('settingsPanel').classList.contains('show') && !document.getElementById('addForm').inert && document.activeElement.id==='settingsBtn'; })()`);
    await verify('calendar keeps Tab within dialog', todo, `(() => { document.getElementById('calToggle').click(); document.getElementById('calClose').focus(); document.getElementById('calClose').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})); return document.activeElement.id==='calPrev'; })()`);
    await verify('history empty state and return', todo, `(() => { document.getElementById('calClose').click(); document.getElementById('prevDay').click(); return document.querySelector('.todo-empty').textContent.includes('这一天没有记录') && document.getElementById('addForm').classList.contains('readonly'); })()`);
    await shot(win, '07-history-empty');
    await todo("document.getElementById('todayBtn').click()");
    await verify('settings closes with focus restoration', timer, "document.activeElement.id==='setBtn' && !document.querySelector('.dock').inert");
    await verify('duration setup isolates timer controls', timer, `(() => { document.getElementById('setupBtn').click(); return document.querySelector('.dock').inert && document.getElementById('setupPanel').contains(document.activeElement); })()`);
    await shot(tw, '08-duration');
    await verify('invalid duration remains editable', timer, `(() => { document.getElementById('customMin').value='1.5'; document.getElementById('applyCustomMin').click(); return document.getElementById('customMin').getAttribute('aria-invalid')==='true' && !document.getElementById('setupPanel').hidden; })()`);
    await timer("document.getElementById('customMin').value='12'; document.getElementById('applyCustomMin').click()");
    await wait(250);
    await verify('valid custom duration reaches authority', timer, "DSH.timer.state.snapshot().timer.totalSec===720 && document.getElementById('setupPanel').hidden && !document.querySelector('.dock').inert");
    await timer("document.getElementById('startBtn').focus()");
    key(tw.webContents, 'Space');
    const startedOnce = await waitTrue("DSH.timer.state.snapshot().timer.running", 1500);
    check('Space on start button activates exactly once', startedOnce === true, startedOnce);
    key(tw.webContents, 'Space');
    const pausedOnce = await waitTrue("DSH.timer.state.snapshot().timer.paused", 1500);
    check('Space on pause button pauses exactly once', pausedOnce === true, pausedOnce);
    await shot(tw, '09-paused');
    await timer("document.getElementById('setBtn').click(); document.getElementById('setHC').click()");
    await wait(200);
    await timer("document.getElementById('closeSettings').click()");
    await shot(tw, '10-high-contrast');
    await verify('high contrast provides solid digit backing', timer, "document.body.classList.contains('hc') && getComputedStyle(document.getElementById('timeText')).textShadow==='none'");
    tw.setContentSize(230, 300);
    await wait(200);
    await verify('minimum timer controls stay inside viewport', timer, `(() => { const nodes=['startBtn','resetBtn','stateChip','timeText']; return nodes.every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}) && document.getElementById('timeText').getBoundingClientRect().bottom<=document.querySelector('.dock').getBoundingClientRect().top; })()`);
    await shot(tw, '11-minimum-timer');
    await timer("DSH.timer.state.cmd('reset')");
    await wait(3500); // Let the legitimate abandonment toast finish before photographing completion.
    await timer("DSH.timer.__ui.showDone({phase:'focus',plannedMinutes:25,minutesToday:75,rounds:3,actualMinutes:25,pauseCount:0,pausedMs:0,startedAt:Date.now()-1500000,finishedAt:Date.now()})");
    await shot(tw, '12-completion-small');
    await timer("document.getElementById('doneEnd').click()");
    await verify('leaving completion preserves today statistics', timer, "DSH.timer.state.snapshot().stats.minutes===75 && document.getElementById('doneScreen').hidden && !document.querySelector('.dock').inert");
    tw.setContentSize(320,430);
    await timer("DSH.timer.state.setPrefs({motion:'calm'})");
    tw.webContents.debugger.attach('1.3');
    await tw.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name:'prefers-reduced-motion', value:'reduce' }] });
    await wait(200);
    const beforeFrames=await timer('DSH.timer.flow.metrics.drawCount');
    await wait(400);
    const afterFrames=await timer('DSH.timer.flow.metrics.drawCount');
    check('system reduced motion stops calm animation', beforeFrames === afterFrames, {beforeFrames, afterFrames});
    tw.webContents.debugger.detach();
    await verify('keyboard reorder moves task to next visible position', todo, `(() => {
      const handle=document.querySelector('[data-id="a"] .drag-handle');handle.focus();handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true}));
      const ids=Array.from(document.querySelectorAll('.todo-item')).map(n=>n.dataset.id);
      return ids.indexOf('a')>ids.indexOf('b') && document.activeElement.closest('.todo-item').dataset.id==='a';
    })()`);
    await verify('fold and filter saved to durable preferences', todo, `(() => {
      document.querySelector('[data-id="a"] [data-act="collapse"]').click();document.getElementById('filterBtn').click();
      const saved=DSH.store.get('sisy-todo-view',{});
      return saved.onlyOpen===true&&saved.collapsed.some(k=>k.endsWith('/a'))&&!document.querySelector('.todo-item.done');
    })()`);
    const frame=win.webContents.mainFrame.frames.find(f=>f.url.includes('/todo/'));
    await frame.executeJavaScript('location.reload()'); await wait(700);
    await verify('fold and filter survive renderer reload',todo,`document.querySelector('[data-id="a"]').classList.contains('collapsed')&&document.getElementById('filterBtn').getAttribute('aria-pressed')==='true'&&!document.querySelector('.todo-item.done')`);
    await verify('adding a step expands collapsed task for editing',todo,`(() => {document.querySelector('[data-id="a"] [data-act="addstep"]').click();const row=document.querySelector('[data-id="a"]');return !row.classList.contains('collapsed')&&row.contains(document.activeElement)&&document.activeElement.tagName==='INPUT';})()`);
    await todo("document.activeElement.value='补充一个步骤';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.getElementById('filterBtn').click();document.querySelector('[data-id=\"b\"] [data-act=\"toggle\"]').click()");
    await todo(`(() => {const row=document.querySelector('[data-id="a"]');row.querySelector('button[data-act="edit"]').click();const input=row.querySelector('input');input.value='一条很长的任务名称，用来检查小窗里的标题换行与计时按钮布局'.repeat(4);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.querySelector('[data-id="a"] [data-act="focus"]').click();})()`);
    await wait(500);
    await verify('task focus action starts authoritative timer',timer,"DSH.timer.state.snapshot().timer.running && DSH.timer.state.snapshot().timer.task.id==='a'");
    await verify('shell displays bound task title',main,"document.getElementById('shellTask').textContent.includes('一条很长的任务名称')");
    await verify('active row visually distinguished',todo,"document.querySelector('[data-id=\"a\"]').classList.contains('current-task')");
    await verify('trusted renderer cannot switch an ongoing task',todo,`(async()=>{const result=await dshTimer.startTask({id:'b',day:${JSON.stringify(today)}});return result.ok===false&&result.code==='timer-busy';})()`);
    tw.setContentSize(230,300);await wait(200);
    await verify('bound long title leaves time and buttons unobstructed at 230x300',timer,`(() => {
      // 只断言当前 markup 里真实存在的元素：id 写错时要显式失败，而不是抛 TypeError
      const ids=['activeTaskName','timeText','startBtn','resetBtn','stateChip'];
      const box=id=>{const el=document.getElementById(id);return el?el.getBoundingClientRect():null;};
      const insideViewport=ids.every(id=>{const r=box(id);return !!r&&r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;});
      if(!insideViewport) return false;
      return box('activeTaskName').bottom<=box('timeText').top&&box('timeText').bottom<=document.querySelector('.dock').getBoundingClientRect().top;
    })()`);
    await shot(tw,'15-bound-minimum-timer');
    await shot(win,'16-bound-task-list');
    await timer("DSH.timer.state.cmd('pause')");await wait(150);
    await todo("document.querySelector('[data-id=\"a\"] [data-act=\"focus\"]').click()");await wait(200);
    await verify('same task resumes through task row',timer,"DSH.timer.state.snapshot().timer.running && DSH.timer.state.snapshot().timer.task.id==='a'");
    await timer("DSH.timer.state.cmd('reset')");await wait(200);
    await todo(`(() => {const end=new Date(),start=new Date(end.getTime()-25*60000);const d=${JSON.stringify(today)};dshStore.set('sisy-timer-history',[{id:'ui-recovered',day:d,phase:'focus',result:'recovered',plannedMinutes:25,actualMinutes:25,startedAt:start.toISOString(),finishedAt:end.toISOString(),pauseCount:0,pausedMinutes:0,taskId:'a',taskDay:d,taskTitle:'test'}]);document.getElementById('statsBtn').click();})()`);
    await wait(200);
    await verify('statistics include recovered rounds and twelve hour bins',todo,"document.getElementById('statMinutes').textContent==='25'&&document.getElementById('statHours').children.length===12&&Array.from(document.getElementById('statHours').children).some(n=>n.getAttribute('aria-label').includes('25 分钟'))");
    await shot(win,'17-week-statistics');
    await todo("document.querySelector('[data-range=\"month\"]').click()");await wait(150);
    await verify('month tab stays selected after closing and reopening',todo,`(() => {document.getElementById('statsBack').click();document.getElementById('statsBtn').click();return document.querySelector('[data-range="month"]').getAttribute('aria-pressed')==='true'&&document.querySelector('[data-range="week"]').getAttribute('aria-pressed')==='false';})()`);
    await todo("document.getElementById('statsBack').click()");

  }
  check('renderer errors', errors.length === 0, errors);
  const failed = checks.filter(c => !c.pass);
  const summary = {
    when: new Date().toISOString(),
    label,
    out,
    userData: temp,
    passed: checks.length - failed.length,
    total: checks.length,
    failed: failed.map(c => ({ name: c.name, detail: c.detail })),
    checks,
    errors
  };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== UI review (' + label + ')：' + summary.passed + '/' + summary.total + ' 项通过 ===');
  if (failed.length) {
    console.log('失败项：');
    failed.forEach(c => console.log('  ✗ ' + c.name + '  ' + JSON.stringify(c.detail)));
    console.log('截图与明细：' + out);
  }
  console.log(JSON.stringify({ out, passed: summary.passed, total: summary.total }));
  app.exit(failed.length ? 1 : 0);
}).catch(e => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, error: String(e && e.stack || e) }, null, 2)); console.error(e && e.stack || e); app.exit(1); });
