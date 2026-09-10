# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 2.x     | Yes (current line) |
| 1.x     | No — EOL. Its data-key prefix was renamed with no migration path. |

## Reporting a vulnerability

- **Preferred:** use GitHub's private "Report a vulnerability" flow (the
  *Security* tab → *Report a vulnerability* on this repo) so the conversation
  stays private and structured.
- **Fallback:** e-mail **entropicechoc@gmail.com**.

Please include:

- the app version (the app's ⚙ 设置 → 数据备份 shows it),
- your Windows build (e.g. `winver` output),
- steps to reproduce, and
- the impact you see.

**Do not attach your `sisy-store.json`** — it contains your tasks. If the
reproduction needs a sample data file, say so and one will be provided.

Please do **not** open a public issue for an exploitable bug.

## What counts as a security issue here

In rough order of relevance for this app:

1. Escape from the renderer into the main process (full Node access).
2. An IPC channel accepting unvalidated input (argument injection, oversized
   payloads, forged keys).
3. Path traversal through `data:reveal`, export, or import — reading or
   writing files outside the app data directory.
4. Tampering with the authoritative timer state from the renderer (e.g.
   forcing a round to complete twice).
5. Writing outside `%APPDATA%\Sisyphus`.
6. A packaged build that differs from source.

## Security design notes

These choices are deliberate; please read before reporting them.

- **`contextIsolation: true`, `nodeIntegration: false`.** The renderer has no
  direct Node access.
- **`sandbox: false` and `nodeIntegrationInSubFrames: true` are both
  deliberately enabled.** The 今日事 view runs inside an iframe that must
  receive the same preload bridge (`window.dshWindow`, `dshStore`, `dshTimer`,
  `dshData`, `dshLog`, `dshApp`, exposed via `contextBridge`). Without
  `nodeIntegrationInSubFrames` the iframe silently falls back to localStorage
  and data splits between two writers — the single-writer model exists
  precisely to prevent that.
- **Content-Security-Policy** meta tags are present in `index.html` and the
  two page HTML files.
- **Every IPC entry point validates its arguments:** storage keys are checked
  against the whitelisted `sisy-*` pattern, timer commands against a whitelist
  of known commands, plus duration/phase/preference/enum checks and size caps.
- **`data:reveal` only accepts** paths inside the app data directory or files
  the user just exported through a file dialog.
- **Logs are hardened:** lines are truncated and flattened so they cannot
  forge multi-line entries, and task text is never written to logs.
- **Single-writer data model:** all writes to `sisy-store.json` flow through
  one store module in the main process (`src/main/store.js`), with atomic
  writes and daily rolling backups.
- **No remote content is loaded**, `shell.openExternal` is never called on
  untrusted input, and the default application menu is disabled.
- **No telemetry and no network requests at all.** The app makes zero network
  requests by design; there is no auto-update channel.

## Out of scope

- Issues that require an attacker who already has local code execution or
  write access to the user's `%APPDATA%`. At that point the attacker owns the
  user's session and the app adds nothing.
- SmartScreen warnings on unsigned artifacts — a known limitation documented
  in `docs/release.md`, not a vulnerability. Missing code signing is tracked
  as a release task (the pipeline is wired up and activates once a certificate
  is configured as the `CSC_LINK` / `CSC_KEY_PASSWORD` CI secrets).

## Disclosure timeline

- Reports are acknowledged within about **7 days**.
- Fixes are best-effort; timing depends on severity and complexity.
- Reporters are credited in the release notes unless they prefer otherwise.
