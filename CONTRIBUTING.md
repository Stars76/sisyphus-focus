# Contributing to 西西弗斯 (Sisyphus)

## Welcome

Thanks for your interest in contributing! 西西弗斯 is a small, deliberately
simple app: a Windows / macOS desktop focus workspace with a task manager ("今日事")
and a character-rain countdown timer ("专注钟"). It is plain HTML/CSS/JS on
Electron — no bundler, no framework, no runtime dependencies — and it is meant
to stay that way. There is plenty of room for improvements, and contributions
of all sizes are welcome.

## Ways to contribute

- **Bugs** — open an issue with the bug report form (use the app's
  ⚙ 设置 → 数据备份 → 复制诊断信息 to gather version info).
- **Features** — open an issue first and describe the problem you want solved
  (see "Before you start" below).
- **Pull requests** — bugfixes and small polish can go straight to a PR;
  anything larger should be discussed in an issue first.
- **Translations** — explicitly welcome. The UI is currently Chinese-only;
  if you want to add a language, open an issue so we can agree on the approach
  before you do the translation work.
- **Docs** — clarifications and fixes to docs are always appreciated.

## Before you start

- Search [existing issues](https://github.com/Stars76/sisyphus-focus/issues)
  (open and closed) before filing a new one.
- For anything bigger than a bugfix or small polish, **open an issue first**.
  The maintainer prefers discussing the design before code is written. This is
  not bureaucracy: the app has hard correctness invariants — the timer state
  machine must never let a round complete twice, and all data flows through a
  single writer. A design that looks reasonable can easily break one of these.

## Development setup

```bash
git clone https://github.com/Stars76/sisyphus-focus.git
cd sisyphus-focus
npm install        # Electron runtime is fetched from a pinned mirror; see .npmrc
npm start          # launch the app from source
```

If you are not in China, the repo `.npmrc` points npm at the npmmirror mirror; use
the official registry instead with
`npm ci --registry=https://registry.npmjs.org` (that is what CI does). The lockfile
itself always references `registry.npmjs.org`, so no relock is needed.

The gates:

```bash
npm run verify                       # the gate: everything below in one command
node tools/check-syntax.js           # static syntax checks
node tools/check-links.js            # markdown link + anchor checks
node tools/selftest.js               # logic self-test
node tests/run-all.js                # full regression suite
npm run smoke                        # real Electron smoke test (see below)
```

Notes:

- `npm run verify` is the gate every PR must pass. Run it before you push.
- `npm run smoke` launches a real Electron instance and therefore needs a
  desktop session (Windows and macOS both work; not usable in a headless
  container).
- While iterating: `Ctrl+R` (`⌘R` on macOS) reloads the renderer, but
  main-process changes (`main.js`, `src/main/*`) need a full restart of
  `npm start`.

## Architecture pointers

| Path | Role |
| --- | --- |
| `main.js` | Process assembly: window, tray, module wiring. |
| `src/main/store.js` | The single data writer: atomic write + daily rolling backups. |
| `src/main/timer.js` | The only timer state machine (authoritative timer state lives here). |
| `src/main/schema.js`, `src/main/migrations.js` | Data validation and version migration. |
| `src/main/ipc.js` | All IPC handlers, each with argument validation. |
| `src/todo/*`, `src/timer/*` | Renderer views for 今日事 and 专注钟. |
| `tests/` | Regression suites, run by `tests/run-all.js`. |

## Hard rules for changes

These are the invariants the app's correctness rests on. Breaking any of them
will get a PR rejected, however well-tested it otherwise is.

- **Never add a second writer for the data file.** All reads and writes of
  `sisy-store.json` go through `src/main/store.js`. The renderer never touches
  the file directly.
- **Never add an unvalidated IPC channel.** Every handler in `src/main/ipc.js`
  validates its arguments (key patterns, enums, ranges, size caps). A new
  channel needs the same treatment.
- **Never let a timer round complete twice.** Add a regression test for
  anything touching the timer, data migration, or IPC validation — these are
 the areas where silent breakage costs users their data or their focus streaks.
- **Keep the renderer dependency-free.** No runtime dependencies, no CDN
  fetches, no bundler. ES5-style JS on purpose.
- **No network calls, no telemetry.** Zero network requests is a stated
  selling point of the app. A PR that adds either will be rejected.

## Testing expectations

Extend the suite that matches your change:

| Change | Extend |
| --- | --- |
| Timer behaviour, state transitions | `tests/timer-correctness.test.js` |
| IPC validation, new channels | `tests/ipc-validation.test.js` |
| Store, backups, atomicity | `tests/data-reliability.test.js` |
| Migrations, date-key normalisation, rework scenarios | `tests/rework-scenarios.test.js` |
| Build, packaging, version metadata | `tests/version-sync.test.js`, `tests/packaging-parity.test.js` |
| End-to-end behaviour on Windows / macOS | `tools/smoke-test.js` (manual, needs a desktop) |
| Platform-specific wiring (menus, tray icon) | `tests/macos-support.test.js` |

If your change touches user-visible behaviour but no test changes, explain why
in the PR.

## Commit and PR conventions

- Conventional commits: `feat(scope): ...`, `fix(scope): ...`,
  `docs(scope): ...`, `test(scope): ...`, `build(scope): ...`.
- One logical change per PR. If a PR needs a paragraph to explain why its
  files belong together, split it.
- Fill in the PR template and link the issue it resolves (`Closes #123`).
- Include what you manually verified — "ran `npm run verify`, clicked through
  the timer, data survived a restart" beats any amount of prose.
- **Test counts in docs are never hand-guessed.** Whatever numbers you cite
  (checks passed, files scanned), copy them from the actual run output of the
  command, not from memory or older docs.

## Code style

**There is deliberately no ESLint / Prettier setup.** The project has zero runtime
dependencies and only three devDependencies, and the maintainer prefers not to add
tooling that churns `package-lock.json` for a codebase this small. The static gate
is `node tools/check-syntax.js` (`npm run check`): it parses every JS/CJS file, every
inline `<script>` in the three HTML pages, verifies that referenced files exist,
that the load order is right, and that every element id referenced from a page script
**or from a `tools/` script** actually exists in the markup. Run it before pushing —
`npm run verify` already does.

Style rules it cannot check, so follow them by hand:

- If you do add a formatter locally, do not commit a config for it in an unrelated PR.
- 2-space indent, single quotes; semicolons in main-process code.
- Renderer files use ES5 `var` and IIFEs **on purpose** — do not modernize
  them (`let`/`const`, arrow functions, modules) in unrelated PRs.
- One module per file. Renderer modules are IIFEs attaching to the shared
  `window.DSH` namespace (`NS.io = ...`). Main-process modules are CommonJS
  with a `createXxx(deps)` factory taking injected deps (store/log/date) so
  they stay testable.

## Language policy

- Code comments and UI strings are **Chinese**; identifiers are English.
- Community files (this one, `SECURITY.md`, `CODE_OF_CONDUCT.md`) and the
  English `README` are **English**.
- A PR that only touches wording is fine.

## Getting help

- Open an issue: https://github.com/Stars76/sisyphus-focus/issues
- There is no private support channel; issues are the venue.
