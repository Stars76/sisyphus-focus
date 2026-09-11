# 数据文件、备份与恢复（2.0）

> 适用版本：西西弗斯 2.x（schema 2）。本文与 `tests/data-reliability.test.js`、
> `tests/ipc-validation.test.js` 的断言一一对应。
> 数据目录是 `%APPDATA%\Sisyphus`（Windows）或 `~/Library/Application Support/Sisyphus`（macOS），
> 由 Electron 按 productName 取目录名，代码里一律走 `app.getPath('userData')`。
> 2.0 起存储键前缀与文件名统一为 `sisy-*`；1.x 的 `adhd-*` 数据不自动迁移，
> 手工迁移步骤见本文 [第 7 节](#7-从-1x-手工迁移)，版本变更口径见 [CHANGELOG.md](../CHANGELOG.md) 的 2.0.0 条目。

## 1. 数据都在哪

| 路径（Windows / macOS） | 内容 |
|---|---|
| `sisy-store.json` | 唯一权威数据文件（外层 `{schema, updatedAt, data}`） |
| `sisy-store.json.tmp` | 原子写入的中转文件（成功后被 rename 消耗；崩溃时可能残留，可恢复） |
| `sisy-store.corrupt-<ts>.json` | 主文件损坏时保留的原始现场（永不自动删除） |
| `backups/sisy-store-YYYYMMDD.json` | 每日启动滚动备份（最多 10 份） |
| `backups/sisy-store-<stamp>-pre-import.json` | 每次导入前自动备份 |
| `backups/sisy-store-<stamp>-pre-clear.json` | 每次清空前自动备份 |
| `logs/sisy.log` | 诊断日志（超 1MB 滚动为 `.1`；不含任务正文） |
| `sisy-timer-win.json` | 专注钟小窗位置（非业务数据） |

存储键清单见 `src/main/schema.js` 的 `KEYS`；未知 `sisy-*` 键向前兼容、原样搬运。

## 2. 版本化迁移

`src/main/migrations.js` 声明迁移链（幂等，可重复执行）：

- 外层：裸键值表 / schema1 → `{schema:2, updatedAt, data}`
- M1 扁平任务 `{tasks}` → 按日期分组 `{viewDay, days}`
- M2 日期键零填充 `2026-9-8` → `2026-09-08`（含冲突日合并）
- M3 旧键 `sisy-focus-state` → `sisy-focus-state-v2`（1.x 遗留键，只为兼容历史导出）
- M4 统计规范化（day 补零、轮次/分钟非负整数）
- M5 历史上限裁剪（300 条）
- M6 偏好阶段时长钳制（60s–3h）

每次启动执行的迁移记录在 `app:info` 的 `migrations` 数组里（设置面板诊断可见）。

## 3. 导入流程（解析→校验→摘要→只备份一次→写入→验证→刷新）

1. 选择文件后**先解析并校验**（`schema.validateBundle`）：容器类型错误 / 必需字段缺失 / 非法键名 → 整体拒绝，**不产生备份、不写任何数据**。
2. 校验通过才做**唯一一次** pre-import 备份（旧版是 IPC 层 + store 层各备份一次，共两次；已修）。
3. 写入后**从磁盘重读比对**（verifyOnDisk）：任何不一致 → 用 pre-import 备份回滚，返回失败。
4. 成功后主进程重载计时状态并刷新所有窗口。
5. 叶子字段的小毛病（标题类型错、日期键不补零）在**校验时修复**并随结果返回 `repaired` 清单，导入日志记录「导入修复」。

损坏恢复键（`…__corrupt_…`）会随备份包一起搬运，且在「整体替换」时也保留。

## 4. 损坏恢复路径

- 主文件 JSON 损坏 → 另存 `*.corrupt-<ts>.json` 现场 → 依次尝试 `.tmp` → 最近可用备份自动恢复；都没有才按空数据启动（现场仍保留）。
- 主文件丢失但 `.tmp` 完好（崩溃在 rename 前）→ 从 `.tmp` 恢复。
- 单个已知键结构非法 → 该键另存为 `…__corrupt_<ts>` 并重置该键，其它键不受影响。
- 手动恢复：退出应用 → 把 `backups/` 里想要的文件复制为 `sisy-store.json` → 启动。或用设置里的「打开备份文件夹」。
- 程序化枚举：IPC `app:info` 的 `recovery` 字段（corrupt / temp / backups 三清单）。
- 卸载器默认**不会**删除以上任何文件（`deleteAppDataOnUninstall:false`，已在 electron-builder 模板 `uninstaller.nsh` 层核实：仅 `--delete-app-data` 显式参数或配置为 true 时才执行 `RMDir $APPDATA\...`），详见 `docs/release.md`。

## 5. 清空数据：分区与影响

底层已支持分区清空（`data:clear-all` 接受分区名数组或存储键数组）：

| 分区名 | 清掉的存储键 | 影响 | 不影响 |
|---|---|---|---|
| `tasks` | `sisy-focus-state-v2`、`sisy-focus-state` | 所有日期的今日事任务、小步骤、`dismissedDaily` | 每日模板、统计、历史、偏好 |
| `daily` | `sisy-daily-config` | 每日任务模板（已实体化的任务保留） | 各日任务列表 |
| `stats` | `sisy-timer-stats` | 今日轮数 / 分钟数（重新开始计数） | 历史记录、当前计时 |
| `history` | `sisy-timer-history` | 中断与完成明细 | 统计、当前计时 |
| `prefs` | `sisy-timer-prefs` | 时长 / 声音 / 通知 / 托盘等设置回默认 | 任务、统计 |
| `timerState` | `sisy-timer-state`、`sisy-timer-run` | 正在进行的本轮计时 | 统计、历史 |
| `all` | 以上全部 | 回到新装状态 | 备份与日志 |

- `keys = null` → 清空全部（现 UI 按钮的行为，保持未变）。
- 空数组被拒绝（防误触）；未知分区名报错且**不产生备份也不动数据**。
- 每次成功清空前自动做一份 `pre-clear` 备份，UI 提示里可直接打开。
- UI 目前只提供「清空全部」（本轮不做 UI 重构）；分区清空已可从测试 / IPC 调用：
  `window.dshData.clearAll(['stats'])`（DevTools）或 `store.clear(schema.resolveClearScopes(['stats']).keys)`。

## 6. 隐私边界

- 日志只记录键名、数量、日期与错误摘要，**不记录任务标题 / 正文**。
- `app:info` 只枚举 `storeKeys`（键名列表），不外传任何值。
- 单条日志 600 字符截断、换行压平；导入失败错误消息 500 字符截断。

## 7. 从 1.x 手工迁移

**2.0 不读 1.x 的数据**：既不读旧键名 `adhd-*`，也不读旧文件名 `adhd-store.json`
（1.3.0 之前还用过 `%APPDATA%\ADHD Studio` 目录，2.0 的 `migrateLegacyUserData` 已删除）。
要保留 1.x 数据只有两条路：留在 1.3.0，或按下面的步骤手工搬一次。

### 7.1 键名对照

迁移本质上只是**把键名前缀 `adhd-` 换成 `sisy-`**，其余内容不动：

| 1.x 键名 | 2.0 键名 | 内容 |
|---|---|---|
| `adhd-focus-state-v2` | `sisy-focus-state-v2` | 今日事任务（按日期分组） |
| `adhd-focus-state` | `sisy-focus-state` | 更早的扁平任务结构（2.0 仍能修复导入） |
| `adhd-daily-config` | `sisy-daily-config` | 每日任务模板 |
| `adhd-timer-state` | `sisy-timer-state` | 计时状态 |
| `adhd-timer-stats` | `sisy-timer-stats` | 今日统计 |
| `adhd-timer-run` | `sisy-timer-run` | 运行态镜像 |
| `adhd-timer-prefs` | `sisy-timer-prefs` | 偏好设置 |
| `adhd-timer-history` | `sisy-timer-history` | 完成/中断记录 |

### 7.2 步骤

1. **在 1.3.0 里导出**（这一步必须在旧版做，2.0 打不开旧文件）：
   今日事 → ⚙ 设置 → 数据备份 → **导出 JSON**；默认落到「文档」目录，
   文件名形如 `sisyphus-backup-<时间戳>.json`（旧版里前缀是当时的产品名）。
   顺手把 `%APPDATA%\Sisyphus\adhd-store.json`（或旧目录下的同名文件）复制一份留档。
2. **改键名前缀**（只替换带引号的 `"adhd-`，避免误伤任务正文里出现的「adhd」字样）：

   ```powershell
   (Get-Content .\sisyphus-backup-2026-09-09.json -Raw) -replace '"adhd-', '"sisy-' |
     Set-Content .\sisyphus-backup-2.0.json -Encoding utf8
   ```

3. **导入 2.0**：今日事 → ⚙ 设置 → 数据备份 → 从备份导入 → 选「合并」或「整体替换」。
   - 导入**先校验后写**：漏改的键名会报「非法键名」并**完全不写数据**（安全失败，可改完再导）。
   - 外层 `schema` 号是 1 也没关系：导入落盘前会再跑一遍数据级迁移（`migrations.migrateData`），
     空的/缺失的字段按 [第 2 节](#2-版本化迁移) 的规则补齐。
   - 扁平结构（`{tasks:[...]}`）会被归到**导入当天**的日期键下，并记一条「导入修复」。
4. **核对**：导入成功后主进程会重载计时状态并刷新窗口；统计面板与今日事列表应能直接看到旧数据，
   `app:info` 的 `migrations` 数组里能看到本次迁移记录。
5. **别指望自动回退**：导入前的数据会自动备份成 `backups/sisy-store-<stamp>-pre-import.json`，
   万一导入结果不对，把它复制成 `sisy-store.json` 即可回到导入前（见 [第 4 节](#4-损坏恢复路径)）。
