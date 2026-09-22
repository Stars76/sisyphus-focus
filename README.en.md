# 西西弗斯 (Sisyphus) · Focus Workbench

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Platform: Windows 10/11 · macOS 12+](https://img.shields.io/badge/platform-Windows%2010%2F11%20%C2%B7%20macOS%2012%2B-blue)
![Electron: 33.4.11](https://img.shields.io/badge/Electron-33.4.11-47848F)
![Version: 2.1.0](https://img.shields.io/badge/version-2.1.0-blue)
![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20deps-0-success)

[中文](README.md) · English

Two small focus tools, packed into a single **frameless Electron desktop app**:

- **今日事** (Today, the task view) — task management (daily task templates, a month calendar, grouping by date, sub-steps, per-task alarms, unfinished tasks roll over to the next day)
- **专注钟** (Focus Clock) — a vertical "character sea" countdown (the water level sinks as progress advances), with multi-round pomodoro plans that advance automatically, which can pop out into an always-resident desk-corner mini window
- **每日时间轴** (Daily timeline) — what you did in which time slices of the day; customizable MD templates export notes with one click (Obsidian / Notion ready)

No system title bar: on Windows the drag region, navigation, and minimize/maximize/close all live in the app's own title bar, with timer status visible in real time there, and the app can stay resident in the **system tray**. On macOS the app uses the native traffic lights instead (`titleBarStyle: 'hidden'`), the tray icon is a monochrome menu-bar template image, and the remaining time can be shown directly in the menu bar.

**Fully local**: not a single network request, no accounts, no telemetry. All your data is one JSON file on your disk.

## UI Preview

| 今日事 (Today) | 专注钟 (Focus Clock) | 专注统计 (Focus stats) |
|---|---|---|
| ![今日事](docs/screenshots/tasks.png) | ![专注钟](docs/screenshots/timer.png) | ![专注统计](docs/screenshots/statistics.png) |

---

## Download & Install (No Command Line Needed)

**Windows**: download the x64 artifacts from this repository's **Releases** page and double-click:

| File | Notes |
|------|-------|
| `Sisyphus-2.1.0-setup.exe` | Installer: installs to `%LOCALAPPDATA%\Programs`, creates Desktop and Start Menu shortcuts (named "西西弗斯"), **user data is preserved on uninstall** |
| `Sisyphus-2.1.0-portable.exe` | Portable: double-click to run directly; data likewise lives in `%APPDATA%\Sisyphus` |

> **The artifacts are not code-signed** (this project has not purchased a code-signing certificate), so on first run SmartScreen may warn "Unknown publisher" —
> just click "More info → Run anyway". To verify integrity, compare against `SHA256SUMS.txt` in the Release.
> The repo **contains no .cmd launcher scripts**: everyday use is simply double-clicking the exe above; `npm start` is only for running from source (see below).
>
> The signing pipeline is already wired up (`CSC_LINK` / Azure Trusted Signing / `npm run verify:signature`);
> once a certificate is in hand, build artifacts will carry a trusted signature — see [docs/release.md](docs/release.md#代码签名).

**macOS**: Releases currently ship Windows artifacts only (CI runs Windows only — see "Known Limitations"),
so macOS is a local source build. Both Apple Silicon and Intel are supported; the output is a dmg + zip:

```bash
git clone https://github.com/Stars76/sisyphus-focus.git
cd sisyphus-focus
bash build/mac-build.sh          # runs the four test gates, then packages into release/
open release/mac-arm64/Sisyphus.app
```

When no certificate is found the build script applies an **ad-hoc signature** automatically — on Apple Silicon an
unsigned `.app` is reported as damaged by the system and will not open on double-click, so this step is not optional.
For signing and notarization of a real public distribution (`CSC_LINK` / hardened runtime / entitlements),
see [docs/release.md](docs/release.md#代码签名).

---

## Why It's Different from Other Pomodoro Timers

| The usual approach | This app's approach |
|---|---|
| Timer state follows the page: refresh, close the window, or navigate away and it's gone | **The one authoritative timer state machine lives in the main process** (`src/main/timer.js`). Windows are just read-only displays — closing the mini window, refreshing the main window, or restarting the app never affects timing |
| Data scattered across localStorage / each window writes its own copy | **The main process is the sole writer** (`src/main/store.js`): atomic writes (`.tmp` + rename), rolling backups on startup, a mandatory backup before every import, automatic rollback on disk-verification failure |
| "Does this round count?" is anyone's guess | An explicit state machine + completion events/statistics/history each **happen exactly once** (re-entry protection); rounds crossing midnight are attributed to the date of **the moment of completion** |
| Move the mouse away and you lose track of what's happening | The character sea, the title-bar status strip, and the tray tooltip all display the same state in sync; when paused, the animation is **completely still** |
| Silent network calls, uploaded statistics | Zero network: page CSP `default-src 'none'`, `connect-src 'none'`; no telemetry, no update checks, no crash reporting |

## Architecture

The old version's problem: the focus clock embedded in the main window and the standalone mini window were **two timer instances**, sharing the same set of localStorage keys while each kept its own in-memory state — having both open meant they overwrote each other, double-counted statistics, and drifted on pause.

The three main threads now:

| Problem | The approach now |
|---------|------------------|
| Dual-instance timer conflicts | There is exactly one copy of timer state, living in the main process (`src/main/timer.js`); both windows can only send commands and subscribe to broadcasts |
| Data reliability | The main process is the sole writer (`src/main/store.js`) → `sisy-store.json` in the data directory (Windows `%APPDATA%\Sisyphus`, macOS `~/Library/Application Support/Sisyphus`), atomic writes + rolling backups + import/export |
| Single files stuffed with logic | Split into `shared/` + `main/` + `todo/` + `timer/` modules; page HTML keeps only structure and styling |

```
小程序/
├── index.html                  # Main-window shell: self-drawn title bar + 今日事 iframe + live timer status strip
├── main.js                     # Process assembly: windows / lifecycle / power events / single-instance lock
├── preload.js                  # Purpose-grouped bridges: dshWindow dshStore dshTimer dshData dshLog dshApp
├── smoke.js                    # Smoke-test entry (must be launched with the project root as the app path)
├── package.json                # Electron 33.4.11 pinned; zero runtime dependencies (dependencies is empty)
├── assets/                     # App icon + title-bar logo + macOS menu-bar template icon
├── electron/                   # Unpacked Electron runtime (not committed; npm start prefers reusing it)
├── src/
│   ├── main/
│   │   ├── store.js            # Authoritative storage (atomic writes / backups / import validation / corruption recovery / per-partition wipes)
│   │   ├── schema.js           # Structure validation for known storage keys + import summary + partition map
│   │   ├── migrations.js       # Versioned migration chain (idempotent, keeps a migration log)
│   │   ├── timer.js            # The one timer state machine (explicit transitions / pause / statistics / clock-tamper resistance / multi-round plan advance)
│   │   ├── alarm.js            # Task-alarm scheduler (scans "today" every 15s by HH:MM, fires a system notification once per day per moment)
│   │   ├── tray.js             # System tray
│   │   ├── menu.js             # Application menu template (macOS only: without it Cmd+Q/C/V and friends stop working)
│   │   ├── ipc.js              # IPC registration + dialogs + log files
│   │   └── util.js             # Date and time formatting
│   ├── shared/
│   │   ├── log.js              # Unified logging (replaces empty catches; forwards to userData/logs)
│   │   ├── date.js             # Date keys (zero-padded YYYY-MM-DD)
│   │   ├── storage.js          # Renderer-side storage adapter (main process only)
│   │   ├── toast.js            # Toasts (save failures, etc.)
│   │   ├── dialog.js           # Lightweight dialogs (focus trap / Esc to close)
│   │   ├── icons.js            # Hand-written sisy-icon icons
│   │   ├── statistics.js       # Calendar week/month stat aggregation + daily timeline derivation (pure functions, unit-testable)
│   │   └── template.js         # Note-template engine (scalar/loop substitution, shared by main and renderer)
│   ├── todo/                   # 今日事: state.js data layer / render.js rendering / app.js interactions
│   └── timer/                  # 专注钟: flow.js character sea / ui.js interface / audio.js chime / state.js read-only mirror
├── tools/
│   ├── check-syntax.js         # Syntax + script references + id existence (tools included) + load order
│   ├── check-links.js          # Markdown link and anchor checks
│   ├── selftest.js             # Pure-Node logic self-test (119 assertions)
│   ├── smoke-test.js           # Real-machine smoke test (actually opens both windows to verify consistency)
│   ├── ui-review.cjs           # Real-Electron UI acceptance (31 checks + screenshots)
│   └── check-asar-runtime.js   # Verifies new files actually made it into the asar
├── tests/                      # Regression suites (10 suites, 474 assertions total)
├── docs/                       # Data & recovery / release packaging / troubleshooting / repo configuration
└── build/                      # One-click build + signature-verification scripts (Windows: win-build.ps1 / macOS: mac-build.sh)
```

---

## Running from Source (Development)

> If you just want to **use the app**, you can skip this — on Windows double-click the exe from the Release;
> on macOS build a local `.app` with `build/mac-build.sh` as described above.

```bash
npm install        # First time: fetches the Electron runtime
npm start          # Launch the main window (今日事)
npm run compact    # Launch the 专注钟 mini window directly
```

- The launcher `tools/launch.js` prefers the repo's unpacked `electron/` runtime (no download needed when present), falling back to `node_modules` otherwise.
- To package: on Windows `powershell -File build\win-build.ps1` (artifacts in `release\`);
  on macOS `bash build/mac-build.sh` (artifacts in `release/mac-arm64/`).
  Both run the same set of test gates first — see [docs/release.md](docs/release.md).

### Verification Commands

| Command | What it does | Verified locally (macOS 26 / Apple Silicon) |
|---------|--------------|------------------|
| `npm run check` | Static checks: syntax / script references / id existence (including element ids referenced from `tools/*.cjs`) / load order | 49 JS·CJS files, 3 pages and tool-script id references all pass |
| `npm run check:links` | Docs check: every relative path and `#anchor` in the Markdown actually exists | 12 files / 65 links all valid |
| `npm test` | Pure-Node logic self-test: dates, storage, timer state machine, task data layer | 119 assertions pass |
| `npm run test:regression` | Regression suite | 10 suites / 474 assertions |
| `npm run verify` | Chains the checks above (**the master gate before committing — it's what CI runs**) | — |
| `npm run smoke` | Real-machine smoke test: actually opens both windows to verify one shared timer state | 29 checks pass; results written to `tools/smoke-result.json` |
| `electron tools/ui-review.cjs after` | Real-Electron UI acceptance: screenshots + layout assertions | 34/34 checks pass; artifacts in `.tmp/ui-review-out/after/` |
| `npm run verify:signature` | Verifies the signing status of Windows artifacts in `release/` | See [docs/release.md](docs/release.md#代码签名) |

> `tests/packaging-parity.test.js` requires an environment with **dependencies installed** (it calls asar to check packaging parity);
> without dependencies it errors out, while the remaining suites depend on no third-party packages.

---

## 专注钟 (Focus Clock)

### One Timer State, Two Displays

```
main.js
  └── src/main/timer.js  ← the single state (memory + sisy-store.json in the data directory)
        ├── Main-window title-bar status strip     read-only subscription
        └── 专注钟 mini window (can be kept on top)   read-only subscription
```

- Renderer processes can only send commands via `dshTimer.cmd(type, payload)`; the main process computes and then broadcasts
- Closing the mini window, refreshing the main window, or reopening windows never affects timing
- Statistics accumulate only once, in the main process: **with both windows open at once, a round is still counted exactly once**

### The Interface

A status badge (`待机中 (Idle) / 专注中 (Focusing) / 已暂停 (Paused) / 恢复中 (Resuming) / 短休息 (Short break) / 长休息 (Long break)` — in-progress states also carry **this round's configured duration** (e.g. `专注中 · 45:00`, fixed; the remaining countdown lives in the large central digits), a large remaining-time readout, the plan/duration button (showing the current plan name or minutes), and start/pause/reset; the Focus Clock no longer shows the task name (the binding is kept — completed minutes are still credited back to the task). The settings panel can enable a chime, system notifications, animation levels, high contrast, showing seconds, and tray residency. **When paused, the character sea is completely still** (even the rAF loop is stopped), so it can never look like it's still running.

### Single Segments & Multi-Round Plans

**Single segment**: `Focus 25 / Short break 5 / Long break 15`, with quick presets of 25/45 or a custom 1–180 minutes. When a break ends it only notifies — it never auto-starts the next round.

**Multi-round plans** (pomodoro method): each of four presets expands into a segment queue that **advances automatically** (focus → short break → … → focus → long break), no intervention needed:

| Plan | Structure | Segments |
|------|-----------|----------|
| 标准番茄 (Classic) | 25 focus ×4, 5 short breaks between, 15 long break at the end | 8 |
| 深专注 (Deep) | 45 focus ×2, 5 short breaks between, 15 long break at the end | 4 |
| 短冲刺 (Sprint) | 15 focus ×4, 3 short breaks between, 10 long break at the end | 8 |
| 长跑 (Marathon) | 50 focus ×2, 10 short breaks between, 20 long break at the end | 4 |

Mid-plan segments **do not show the completion screen** (a toast + system notification announces the next segment); the completion screen only appears when the whole plan finishes. Abandoning / resetting / changing duration / switching phase / switching plans mid-way terminates the plan (the in-progress round first gets an abandoned history entry); if the timer expires while the app is closed it is silently back-filled, which also ends the plan.

### Completion Flow

(Shown in single-segment mode or when a whole plan finishes; mid-plan segments skip it)

- **再来一轮 (One more round)** / **休息 5 分钟 (Break for 5 minutes)** / **返回专注钟 (Back to the Focus Clock)**
- Expand "查看本轮记录" (view this round's record): planned duration / actual time / whether it was paused (count + total paused time) / start and end moments

### Interruption History

At the end of every segment (completed or abandoned; break segments inside a plan each get their own entry) one entry is appended to `sisy-timer-history` (at most 300 entries): `date / phase / start time / end time / planned minutes / actual minutes / pause count / paused minutes / outcome`. The "专注统计" (focus stats) view inside 今日事 totals minutes, rounds, and task counts by **calendar week / calendar month**, along with streak days and the peak time of day (rounds completed after resuming are included, grouped by their starting time slot).

### Robustness Against Time Anomalies

- Timer commands go through an **explicit state machine**: any transition outside `idle / running / paused` is rejected and logged (e.g., pressing pause while idle)
- While running, remaining time is derived from the **monotonic clock** (`process.uptime()`), unaffected by system clock changes; detected jumps are logged and surfaced in the UI
- Falls back to the wall clock automatically if the monotonic clock misbehaves
- Runs keep going across midnight; statistics are recorded under **the date of the moment of completion**
- Sleep/wake and lock/unlock both trigger an immediate recalculation
- The timer expires while the window is closed → **silently back-filled after restart** (no chime, no notification; a multi-round plan ends at the back-fill and does not auto-advance)
- Completion events / statistics accumulation / history writes each **happen exactly once** (regression-covered in `tests/timer-correctness.test.js`)
- Changing duration / switching phase / switching plans / resetting mid-run: the in-progress round automatically gets an abandoned history entry — no more rounds vanishing without a trace

### Animation & Readability

- **Targets 120 FPS**: an accumulator keeps the average frame rate steady (a 165Hz screen won't be quantized down to 82 FPS)
- **Glyph sprite cache**: `symbol × color` pairs are pre-rendered onto small offscreen canvases, so each frame does `drawImage` instead of `fillText`
- **Adaptive density**: cell size and maximum cell count are decided by window area; the mini window automatically lowers density
- **Automatic degradation**: consecutive slow stretches reduce density and log it (never freezes)
- Animation can be set to `流畅 (Smooth) / 舒缓 (Gentle) / 关闭 (Off)`; **when Off, rAF stops entirely**, drawing a single frame only on state or size changes
- The digits sit on a stable backdrop + an optional **high-contrast mode**
- The system `prefers-reduced-motion` setting is respected

### Tray Residency

- The tray tooltip shows `专注中 12:34` (Focusing) / `已暂停 …` (Paused) / `待开始` (Ready to start) in real time
- Menu: start/pause, reset this round, switch phase, open the mini window, show the main window, quit
- Closing the main window with ✕ **stays in the tray and keeps timing** by default (can be turned off in settings); the first time it happens, a one-time system notification explains this

---

## 今日事 (Today)

- Tasks grouped by date with month-calendar navigation, plus sub-steps (a simple checklist)
- **Unfinished tasks roll over automatically**: a regular task (not a daily one) that isn't finished moves into today's list the next day with a "顺延" (rolled-over) badge showing its origin day, pinned to the top until it's done or deleted. Daily tasks regenerate each day on their own and never roll over
- All sub-steps done → the parent task auto-completes; unchecking any sub-step → the parent task reverts
- **Task alarms**: set an `HH:MM` reminder on any task row; the main process fires a system notification when the moment arrives (scanned every 15 seconds, ±15 s accuracy). Completed tasks never fire, and the same task at the same moment rings at most once per day
- Status summaries (⏱ focus minutes, step progress, alarm time) live in compact pills at the right of the title row, without taking space from the task body
- **Daily tasks**: configured in ⚙ settings; on first entry each day they automatically "materialize" into ordinary tasks in that day's list; **once deleted for the day they are not re-added** (recorded via `dismissedDaily`), and a fresh set is generated for each new day
- Past dates remain editable: you can tick tasks complete, rename them, and add/remove/edit sub-steps; "add task / drag to reorder / tap to focus" is still limited to today
- Every task has a one-click **Start Focus**: it first binds the task and opens the Focus Clock's plan picker — pick a plan or duration and press "Start" to begin; clicking again on a task bound to the current round simply **resumes it**; on completion the minutes are credited back to that task

## 每日时间轴 (Daily Timeline)

The "每日" (Daily) tab inside focus stats answers "what did I do in which time slices of this day":

- Slices are **derived purely from `sisy-timer-history`** (no extra bookkeeping): adjacent focus segments of the same task (gap ≤ 15 minutes, planned breaks included) merge into one continuous slice (e.g. `08:00–10:20 writing the report`); interruptions (abandoned) get their own marked block; untagged focus shows as "未定任务的专注" (untagged focus)
- A vertical timeline positions blocks by the minute; **overlapping slices sit side by side** (overlap is allowed); navigate across days
- **The timeline is customizable**: edit a block's start/end, hide a mistaken block, or add a manual slice. Fixes live in the `sisy-timeline-overrides` overlay — they only correct the display; authoritative history and derived data stay untouched, and fixes survive recomputation

## 笔记模板导出 (Note Templates — Obsidian / Notion)

Minimal integration with **no API calls and zero network**: an **editable Markdown template with standard variable names**, rendered and then copied to the clipboard (paste into Notion / Obsidian) or saved as a `.md` file (drop it straight into an Obsidian vault).

- Three built-in starters: **每日复盘 (Daily review) / 单任务记录 (Task record) / 周报 (Weekly report)**; edit, live-preview and reset under "⚙ 设置 → 笔记模板" (⚙ Settings → Note templates)
- Variables (snake_case): `{{date}}` `{{date_cn}}` `{{weekday}}` `{{focus_minutes}}` `{{focus_rounds}}` `{{tasks_done_count}}` `{{task_title}}` `{{task_minutes}}` `{{week_since}}` `{{week_until}}` `{{streak}}` `{{peak_range}}` and more; loops `{{#timeline}}…{{/timeline}}`, `{{#tasks_done}}…{{/tasks_done}}` (inside: `{{start}}` `{{end}}` `{{title}}` `{{minutes}}`; `{{^list}}` empty-state supported); unknown variables are kept verbatim
- Entry points: the daily-timeline toolbar (copy daily review / save .md / copy weekly report) and the "任务记录" (task record) button on each timeline block (single-task template)
- Templates live in `sisy-export-template` (≤32KB each, falls back to defaults when corrupt) and travel with your backups/imports
- Date keys are uniformly zero-padded `2026-09-08`; legacy `2026-9-8` keys are migrated automatically at load (merged under the same key)
- Corrupt data is recognized, saved aside as `<key>__corrupt_<timestamp>`, and reset, with a log entry written

## Data

**All data lives in the main process**, in `sisy-store.json` inside the data directory (`userData` is named after productName: `%APPDATA%\Sisyphus` on Windows, `~/Library/Application Support/Sisyphus` on macOS; the path is visible under "今日事 → ⚙ 设置 → 数据备份" (Today → ⚙ Settings → Data backup)):

| Key | Contents |
|-----|----------|
| `sisy-focus-state-v2` | 今日事 tasks (by date; includes daily-task materialization + `dismissedDaily` + per-task alarms `alarm` + roll-over origin `rolledFrom`) |
| `sisy-daily-config` | Daily task templates |
| `sisy-timer-state` | 专注钟 current state (phase / remaining / pause statistics / multi-round plan `plan`) |
| `sisy-timer-stats` | Today's focus statistics (rounds, minutes) |
| `sisy-timer-run` | A running-state mirror kept for legacy-version reads |
| `sisy-timer-prefs` | Sound / notifications / animation / high contrast / tray settings |
| `sisy-timer-history` | Completion and interruption records (at most 300 entries) |
| `sisy-timeline-overrides` | Timeline overlay (edited start/end, hidden blocks, manual slices) |
| `sisy-export-template` | Note templates (daily review / task record / weekly report) |

- Schema validation (`src/main/schema.js`) + versioned migrations (`src/main/migrations.js`); imports run "parse → validate → summarize → **back up exactly once** → write → verify on disk → refresh", rolling back automatically on failure, so bad data never enters the store
- Each launch produces one `backups/sisy-store-YYYYMMDD.json`, keeping at most 10; if the main file is corrupt, recovery automatically tries `.tmp` / the most recent backup, and the corrupted original is preserved forever (recovery manual: [docs/data.md](docs/data.md) / [docs/diagnostics.md](docs/diagnostics.md))
- Under "数据备份" (Data backup) you can: **export JSON / import from a backup / open the backups folder / open logs / wipe all data**
- Imports offer **merge** or **replace wholesale**; wiping likewise backs up first; the underlying layer supports **per-partition wipes** (tasks / daily / stats / history / prefs / timerState — the blast radius of each partition is in [docs/data.md](docs/data.md))
- A failed save pops up "数据保存失败，请导出备份" ("Data save failed — please export a backup"); data is never lost silently

## Security & Privacy

- **Zero network**: all three pages carry a CSP (`default-src 'none'` / `connect-src 'none'`); the code contains no `fetch` / `XMLHttpRequest` / third-party scripts, and no update checks or telemetry
- **Full IPC argument validation**: storage key names, durations, phases, preferences, import modes, and a file-path allowlist (`reveal` is only allowed inside the app data directory; export files are authorized individually)
- Renderer processes run with `nodeIntegration` disabled and are only exposed grouped, allowlisted APIs through `preload.js`
- `sandbox:false` + `nodeIntegrationInSubFrames:true` are **deliberate** (local file pages + subframes need the preload bridge); the rationale and threat model are in [SECURITY.md](SECURITY.md)
- Logs never contain task text; the vulnerability-reporting process is in [SECURITY.md](SECURITY.md)

## Development

After editing, `Ctrl+R` inside the app (`⌘R` on macOS) applies changes immediately (main-process code requires an app restart).

| Location | What it is |
|----------|------------|
| `src/timer/flow.js` → `draw()` | Character-sea rendering: `RAMP` symbol ramp, `COLORS` palette, `cell` auto-sizing, sprite cache |
| `src/timer/ui.js` → `render()` | Status badge / time / buttons / settings panel / completion screen |
| `src/main/timer.js` | Timer state machine: commands, completion, multi-round plan advance, statistics, time-anomaly resistance |
| `src/main/alarm.js` | Task-alarm scheduler |
| `src/main/store.js` | Storage: atomic writes, backups, import/export, corruption recovery |
| `src/todo/state.js` / `render.js` | Task data layer / render layer |

After changes, run `npm run verify`; for desktop-interaction changes, follow up with `electron tools/ui-review.cjs after`.
Commit conventions, branch naming, and the official line on "why there is no ESLint" are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/data.md](docs/data.md) | Data file inventory, migration chain, import flow, backup & corruption recovery, per-partition wipe impact |
| [docs/release.md](docs/release.md) | Packaging, code signing (two routes), CI, install/upgrade/uninstall data behavior |
| [docs/diagnostics.md](docs/diagnostics.md) | Troubleshooting manual (log clue → meaning → action) |
| [docs/github-setup.md](docs/github-setup.md) | Checklist for publishing the repo on GitHub properly (description, topics, branch protection, placeholder replacement) |
| [ROADMAP.md](ROADMAP.md) | Future plans and the "explicitly not doing" boundary |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution process and verification gates |
| [SECURITY.md](SECURITY.md) | Threat model, security boundaries, vulnerability reporting |
| [CHANGELOG.md](CHANGELOG.md) | Version history (including the 1.x past) |

## Known Limitations

- **Platforms**: Windows 10/11 x64 and macOS 12+ (arm64 / x64) are adapted and verified on real hardware; Linux is not done and unverified
- **No macOS binaries are published**: CI only runs `windows-2022` (macOS runners bill at 10× the Linux rate; whether to adopt them is the maintainer's call), so macOS users build locally with `bash build/mac-build.sh`. Without a certificate the script ad-hoc signs, which is enough to double-click and run locally
- **Notifications on macOS need a signature**: on unsigned or un-notarized builds the system may silently drop notifications (a local ad-hoc signature usually works); a real distribution needs a Developer ID signature plus notarization
- **Artifacts are unsigned by default** (this project has no code signing certificate) → SmartScreen will warn "Unknown publisher"; the signing pipeline is ready; free routes (Microsoft Store re-signing / SignPath Foundation), paid routes and their eligibility limits are in [docs/release.md](docs/release.md#代码签名)
- When Windows Developer Mode is off locally, winCodeSign fails to extract its symlink → the build script automatically degrades to `signAndEditExecutable=false` (the exe's embedded icon/metadata fall back to Electron defaults; the artifact still runs; CI takes the full path)
- The tray does **not** do "prevent system sleep while idle": closing the lid or manually sleeping still interrupts a focus round (completions during suspension are back-filled on wake)
- Task alarms only fire while the app is running (closing windows to the tray still counts): they never fire while the app is closed, and moments missed during sleep/shutdown are not back-filled
- Interruption records are persisted and summarized visually, but there is not yet a fine-grained "when do I usually interrupt" analysis
- 2.0.0 is a **breaking** release: technical naming is unified under `sisy-*`, **no automatic 1.x data migration is provided** — manual migration steps are in [docs/data.md](docs/data.md#7-从-1x-手工迁移)

## License

[MIT](LICENSE) © 2026 GenZ. Use, modify, and distribute freely — just keep the copyright notice.

Issues and PRs are welcome — and so is forking it outright into your own rhythm tool.
