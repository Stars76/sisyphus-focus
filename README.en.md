# 西西弗斯 (Sisyphus) · Focus Workbench

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Platform: Windows 10/11](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)
![Electron: 33.4.11](https://img.shields.io/badge/Electron-33.4.11-47848F)
![Version: 2.0.0](https://img.shields.io/badge/version-2.0.0-blue)
![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20deps-0-success)

[中文](README.md) · English

Two small focus tools, packed into a single **frameless Electron desktop app**:

- **今日事** (Today, the task view) — task management (daily task templates, a month calendar, grouping by date, sub-steps)
- **专注钟** (Focus Clock) — a vertical "character sea" countdown (the water level sinks as progress advances), which can pop out into an always-resident desk-corner mini window

No system title bar: the drag region, navigation, and minimize/maximize/close all live in the app's own title bar; timer status is visible in real time in the main window's title bar and can stay resident in the **system tray**.

**Fully local**: not a single network request, no accounts, no telemetry. All your data is one JSON file on your disk.

## UI Preview

| 今日事 (Today) | 专注钟 (Focus Clock) | 专注统计 (Focus stats) |
|---|---|---|
| ![今日事](docs/screenshots/tasks.png) | ![专注钟](docs/screenshots/timer.png) | ![专注统计](docs/screenshots/statistics.png) |

---

## Download & Install (No Command Line Needed)

Download the Windows x64 artifacts from this repository's **Releases** page and double-click:

| File | Notes |
|------|-------|
| `Sisyphus-2.0.0-setup.exe` | Installer: installs to `%LOCALAPPDATA%\Programs`, creates Desktop and Start Menu shortcuts (named "西西弗斯"), **user data is preserved on uninstall** |
| `Sisyphus-2.0.0-portable.exe` | Portable: double-click to run directly; data likewise lives in `%APPDATA%\Sisyphus` |

> **The artifacts are not code-signed** (this project has not purchased a code-signing certificate), so on first run SmartScreen may warn "Unknown publisher" —
> just click "More info → Run anyway". To verify integrity, compare against `SHA256SUMS.txt` in the Release.
> The repo **contains no .cmd launcher scripts**: everyday use is simply double-clicking the exe above; `npm start` is only for running from source (see below).
>
> The signing pipeline is already wired up (`CSC_LINK` / Azure Trusted Signing / `npm run verify:signature`);
> once a certificate is in hand, build artifacts will carry a trusted signature — see [docs/release.md](docs/release.md#代码签名).

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
| Data reliability | The main process is the sole writer (`src/main/store.js`) → `%APPDATA%\Sisyphus\sisy-store.json`, atomic writes + rolling backups + import/export |
| Single files stuffed with logic | Split into `shared/` + `main/` + `todo/` + `timer/` modules; page HTML keeps only structure and styling |

```
小程序/
├── index.html                  # Main-window shell: self-drawn title bar + 今日事 iframe + live timer status strip
├── main.js                     # Process assembly: windows / lifecycle / power events / single-instance lock
├── preload.js                  # Purpose-grouped bridges: dshWindow dshStore dshTimer dshData dshLog dshApp
├── smoke.js                    # Smoke-test entry (must be launched with the project root as the app path)
├── package.json                # Electron 33.4.11 pinned; zero runtime dependencies (dependencies is empty)
├── assets/                     # App icon + title-bar logo
├── electron/                   # Unpacked Electron runtime (not committed; npm start prefers reusing it)
├── src/
│   ├── main/
│   │   ├── store.js            # Authoritative storage (atomic writes / backups / import validation / corruption recovery / per-partition wipes)
│   │   ├── schema.js           # Structure validation for known storage keys + import summary + partition map
│   │   ├── migrations.js       # Versioned migration chain (idempotent, keeps a migration log)
│   │   ├── timer.js            # The one timer state machine (explicit transitions / pause / statistics / clock-tamper resistance)
│   │   ├── tray.js             # System tray
│   │   ├── ipc.js              # IPC registration + dialogs + log files
│   │   └── util.js             # Date and time formatting
│   ├── shared/
│   │   ├── log.js              # Unified logging (replaces empty catches; forwards to userData/logs)
│   │   ├── date.js             # Date keys (zero-padded YYYY-MM-DD)
│   │   ├── storage.js          # Renderer-side storage adapter (main process only)
│   │   ├── toast.js            # Toasts (save failures, etc.)
│   │   ├── dialog.js           # Lightweight dialogs (focus trap / Esc to close)
│   │   ├── icons.js            # Hand-written sisy-icon icons
│   │   └── statistics.js       # Calendar week/month stat aggregation (pure functions, unit-testable)
│   ├── todo/                   # 今日事: state.js data layer / render.js rendering / app.js interactions
│   └── timer/                  # 专注钟: flow.js character sea / ui.js interface / audio.js chime / state.js read-only mirror
├── tools/
│   ├── check-syntax.js         # Syntax + script references + id existence (tools included) + load order
│   ├── check-links.js          # Markdown link and anchor checks
│   ├── selftest.js             # Pure-Node logic self-test (119 assertions)
│   ├── smoke-test.js           # Real-machine smoke test (actually opens both windows to verify consistency)
│   ├── ui-review.cjs           # Real-Electron UI acceptance (31 checks + screenshots)
│   └── check-asar-runtime.js   # Verifies new files actually made it into the asar
├── tests/                      # Regression suites (8 suites, 387 assertions total)
├── docs/                       # Data & recovery / release packaging / troubleshooting / repo configuration
└── build/                      # Windows one-click build + signature-verification scripts
```

---

## Running from Source (Development)

> If you just want to **use the app**, you can skip this — double-click the exe from the Release.

```powershell
npm install        # First time: fetches the Electron runtime
npm start          # Launch the main window (今日事)
npm run compact    # Launch the 专注钟 mini window directly
```

- The launcher `tools/launch.js` prefers the repo's unpacked `electron/` runtime (no download needed when present), falling back to `node_modules` otherwise.
- To package an exe: `powershell -File build\win-build.ps1`; artifacts land in `release\` (see [docs/release.md](docs/release.md) for details).

### Verification Commands

| Command | What it does | Verified locally |
|---------|--------------|------------------|
| `npm run check` | Static checks: syntax / script references / id existence (including element ids referenced from `tools/*.cjs`) / load order | 43 JS·CJS files, 3 pages and 61 tool-script id references all pass |
| `npm run check:links` | Docs check: every relative path and `#anchor` in the Markdown actually exists | 12 files / 60 links all valid |
| `npm test` | Pure-Node logic self-test: dates, storage, timer state machine, task data layer | 119 assertions pass |
| `npm run test:regression` | Regression suite | 8 suites / 387 assertions |
| `npm run verify` | Chains the checks above (**the master gate before committing — it's what CI runs**) | — |
| `npm run smoke` | Real-machine smoke test: actually opens both windows to verify one shared timer state | 29 checks pass; results written to `tools/smoke-result.json` |
| `electron tools/ui-review.cjs after` | Real-Electron UI acceptance: screenshots + layout assertions | 31/31 checks pass; artifacts in `.tmp/ui-review-out/after/` |
| `npm run verify:signature` | Verifies the signing status of artifacts in `release/` | See [docs/release.md](docs/release.md#代码签名) |

> `tests/packaging-parity.test.js` requires an environment with **dependencies installed** (it calls asar to check packaging parity);
> without dependencies it errors out, while the remaining 7 suites — 381 assertions in total — depend on no third-party packages.

---

## 专注钟 (Focus Clock)

### One Timer State, Two Displays

```
main.js
  └── src/main/timer.js  ← the single state (memory + %APPDATA%\Sisyphus\sisy-store.json)
        ├── Main-window title-bar status strip     read-only subscription
        └── 专注钟 mini window (can be kept on top)   read-only subscription
```

- Renderer processes can only send commands via `dshTimer.cmd(type, payload)`; the main process computes and then broadcasts
- Closing the mini window, refreshing the main window, or reopening windows never affects timing
- Statistics accumulate only once, in the main process: **with both windows open at once, a round is still counted exactly once**

### The Interface

A status badge (`待机中 (Idle) / 专注中 (Focusing) / 已暂停 (Paused) / 恢复中 (Resuming) / 短休息 (Short break) / 长休息 (Long break)` — in-progress states also carry the remaining time), the task name, a large remaining-time readout, this-round duration buttons, and start/pause/reset; the settings panel can enable a chime, system notifications, animation levels, high contrast, showing seconds, and tray residency. **When paused, the character sea is completely still** (even the rAF loop is stopped), so it can never look like it's still running.

### Phases (Switched Manually, No Auto-Chaining)

`Focus 25 / Short break 5 / Long break 15`, with presets of 5/10/15/25/45 or a custom 1–180 minutes. When a break ends it only notifies — it never auto-starts the next round.

### Completion Flow

- **再来一轮 (One more round)** / **休息 5 分钟 (Break for 5 minutes)** / **返回专注钟 (Back to the Focus Clock)**
- Expand "查看本轮记录" (view this round's record): planned duration / actual time / whether it was paused (count + total paused time) / start and end moments

### Interruption History

At the end of every round (completed or abandoned) one entry is appended to `sisy-timer-history` (at most 300 entries): `date / phase / start time / end time / planned minutes / actual minutes / pause count / paused minutes / outcome`. The "专注统计" (focus stats) view inside 今日事 totals minutes, rounds, and task counts by **calendar week / calendar month**, along with streak days and the peak time of day (rounds completed after resuming are included, grouped by their starting time slot).

### Robustness Against Time Anomalies

- Timer commands go through an **explicit state machine**: any transition outside `idle / running / paused` is rejected and logged (e.g., pressing pause while idle)
- While running, remaining time is derived from the **monotonic clock** (`process.uptime()`), unaffected by system clock changes; detected jumps are logged and surfaced in the UI
- Falls back to the wall clock automatically if the monotonic clock misbehaves
- Runs keep going across midnight; statistics are recorded under **the date of the moment of completion**
- Sleep/wake and lock/unlock both trigger an immediate recalculation
- The timer expires while the window is closed → **silently back-filled after restart** (no chime, no notification)
- Completion events / statistics accumulation / history writes each **happen exactly once** (regression-covered in `tests/timer-correctness.test.js`)
- Changing duration / switching phase / resetting mid-run: the in-progress round automatically gets an abandoned history entry — no more rounds vanishing without a trace

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

- Tasks grouped by date with month-calendar navigation, plus sub-steps (small steps + minutes)
- All sub-steps done → the parent task auto-completes; unchecking any sub-step → the parent task reverts
- **Daily tasks**: configured in ⚙ settings; on first entry each day they automatically "materialize" into ordinary tasks in that day's list; **once deleted for the day they are not re-added** (recorded via `dismissedDaily`), and a fresh set is generated for each new day
- Past dates remain editable: you can tick tasks complete, rename them, and add/remove/edit sub-steps and minutes; "add task / drag to reorder / tap to focus" is still limited to today
- Every task has a one-click **Start Focus**: it binds the task title to the current timer round and credits the minutes back to that task on completion
- Date keys are uniformly zero-padded `2026-09-08`; legacy `2026-9-8` keys are migrated automatically at load (merged under the same key)
- Corrupt data is recognized, saved aside as `<key>__corrupt_<timestamp>`, and reset, with a log entry written

## Data

**All data lives in the main process**, in the file `%APPDATA%\Sisyphus\sisy-store.json` (`userData` is named after productName; the path is visible under "今日事 → ⚙ 设置 → 数据备份" (Today → ⚙ Settings → Data backup)):

| Key | Contents |
|-----|----------|
| `sisy-focus-state-v2` | 今日事 tasks (by date; includes daily-task materialization + `dismissedDaily`) |
| `sisy-daily-config` | Daily task templates |
| `sisy-timer-state` | 专注钟 current state (phase / remaining / pause statistics) |
| `sisy-timer-stats` | Today's focus statistics (rounds, minutes) |
| `sisy-timer-run` | A running-state mirror kept for legacy-version reads |
| `sisy-timer-prefs` | Sound / notifications / animation / high contrast / tray settings |
| `sisy-timer-history` | Completion and interruption records (at most 300 entries) |

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

After editing, `Ctrl+R` inside the app applies changes immediately (main-process code requires an app restart).

| Location | What it is |
|----------|------------|
| `src/timer/flow.js` → `draw()` | Character-sea rendering: `RAMP` symbol ramp, `COLORS` palette, `cell` auto-sizing, sprite cache |
| `src/timer/ui.js` → `render()` | Status badge / time / buttons / settings panel / completion screen |
| `src/main/timer.js` | Timer state machine: commands, completion, statistics, time-anomaly resistance |
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

- **Windows 10/11 x64 only**: the frameless window's self-drawn title bar, tray, and power events are all tuned for Windows; other platforms are unverified
- **Artifacts are unsigned by default** (this project has no code signing certificate) → SmartScreen will warn "Unknown publisher"; the signing pipeline is ready; free routes (Microsoft Store re-signing / SignPath Foundation), paid routes and their eligibility limits are in [docs/release.md](docs/release.md#代码签名)
- When Windows Developer Mode is off locally, winCodeSign fails to extract its symlink → the build script automatically degrades to `signAndEditExecutable=false` (the exe's embedded icon/metadata fall back to Electron defaults; the artifact still runs; CI takes the full path)
- The tray does **not** do "prevent system sleep while idle": closing the lid or manually sleeping still interrupts a focus round (completions during suspension are back-filled on wake)
- Interruption records are persisted and summarized visually, but there is not yet a fine-grained "when do I usually interrupt" analysis
- 2.0.0 is a **breaking** release: technical naming is unified under `sisy-*`, **no automatic 1.x data migration is provided** — manual migration steps are in [docs/data.md](docs/data.md#7-从-1x-手工迁移)

## License

[MIT](LICENSE) © 2026 GenZ. Use, modify, and distribute freely — just keep the copyright notice.

Issues and PRs are welcome — and so is forking it outright into your own rhythm tool.
