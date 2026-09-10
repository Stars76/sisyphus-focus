## What changed

<!-- A short summary of the change. One or two sentences. -->

## Why

<!-- The motivation: what problem does this solve? Link the issue with "Closes #NNN". -->

- Issue: N/A

## Type of change

- [ ] Bugfix
- [ ] Feature
- [ ] Refactor
- [ ] Docs
- [ ] Tests
- [ ] Build

## Gates run

Paste the ACTUAL output numbers from your run — do not estimate or copy them
from older PRs/docs.

- [ ] `node tools/check-syntax.js` — result:
- [ ] `node tools/selftest.js` — result:
- [ ] `node tests/run-all.js` — result (passed/total):
- [ ] `npm run smoke` — result (Windows desktop session required; write N/A if not run and why):

## UI changes

<!-- For UI changes only: before/after screenshots. Delete this section otherwise. -->

**Before:**

**After:**

## Checklist

- [ ] Added or updated a regression test for behaviour changes (timer, migrations, and IPC validation changes REQUIRE one)
- [ ] No new IPC channel without argument validation
- [ ] No new renderer dependency
- [ ] No network calls added
- [ ] Docs updated when user-visible behaviour or file formats changed
- [ ] Data-format changes have a migration, or an explicit breaking-change note in CHANGELOG
