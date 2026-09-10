# 故障诊断手册

## 先取这三样

1. **日志**：`%APPDATA%\Sisyphus\logs\sisy.log`（设置 → 数据备份 → 打开日志；超 1MB 自动滚动为 `.1`）。
   行格式 `[时间] LEVEL 文本`；换行被压平、单行 600 字符截断。
2. **诊断快照**：DevTools（Ctrl+Shift+I）执行 `await window.dshApp.info()` →
   含 `storeFile / backupDir / logFile / storeKeys / recovery / migrations / timer` 快照。
3. **数据现场**：`%APPDATA%\Sisyphus\` 目录本身（含 `.corrupt-` / `.tmp` 文件与 `backups/`）。

## 关键日志线索 → 含义

| 日志片段 | 含义 | 处置 |
|---|---|---|
| `存储文件损坏，已另存为 …corrupt-…，尝试恢复` | 主文件不是合法 JSON | 看随后一行：`已从 .tmp 恢复` / `已从备份恢复` 说明自动处理成功 |
| `没有可用备份，按空数据启动` | 损坏且无备份 | 手工从 `.corrupt-` 文件里恢复：复制出来改名为 sisy-store.json，若其中 data 可读 |
| `导入校验失败（未做任何改动）` | 导入被 schema 拒绝 | 错误串里带具体键与原因，数据未动，无需处理 |
| `导入后验证失败，已从备份回滚` | 磁盘写入异常（坏盘/杀软拦截） | 已回滚到导入前；检查磁盘与杀软白名单 |
| `写入存储失败` | 落盘失败（去抖窗口内可能丢最新一次改动） | 确认磁盘空间 / 目录权限；UI 会弹「数据保存失败」 |
| `检测到系统时间跳变 …ms` | 手动改表或时区变化 | 计时用单调时钟校正过，无需处理 |
| `恢复运行中的计时：剩余 Ns` | 启动时从持久状态恢复计时 | 正常 |
| `拒绝非法状态转换 pause @ idle` | 非法计时命令（如空闲时按暂停） | 状态机按设计拒绝 |
| `IPC 拒绝: …` | 渲染层传来非法参数（键名/路径/时长等） | 若来自正常使用，属于 bug，带日志行提 issue |
| `系统唤醒，重算计时` / `系统休眠，暂停心跳` | 电源事件处理 | 正常；唤醒后剩余按单调+墙上双通道校正 |

## 常见问题

**任务列表空了？**
`backups/` 里找时间最近的 `sisy-store-*.json`（每日启动备份 / pre-import / pre-clear），
复制为 `sisy-store.json`（先备份现有文件），重启应用。

**导入失败怎么办？**
错误提示已指明是哪个键缺了什么字段。备份文件本身没有被改动；若导入中途失败，
store 层已自动回滚（返回结果里的 `backup` 路径即导入前状态）。

**怀疑统计数据不对？**
1) `await window.dshTimer.history()` 看逐轮记录（done/abandoned/recovered 三种 result）；
2) 对照 `dshApp.info().timer.stats`；
3) 跨天时统计归完成那一刻所在日期（见 `docs/data.md` 的统计口径）。

**日志里会不会有我的任务内容？**
不会。日志只写键名与数量；`app:info` 只列 `storeKeys`。渲染层日志模块也只记录
类别/键/错误消息（见 `src/shared/log.js` 与 `docs/data.md` 隐私边界）。

## 验收/回归命令速查

```powershell
node tools/check-syntax.js        # 静态检查（语法/引用/元素 id）
node tools/check-links.js         # 文档内部链接与锚点
node tools/selftest.js            # 逻辑自检 119 项
node tests/run-all.js             # 回归套件（8 套 / 387 项断言）
npm run smoke                     # 双窗口同步冒烟（需真实桌面会话，结果见 tools/smoke-result.json）
powershell -File build\win-build.ps1   # 全量：测试+打包+产物一致性校验
```
