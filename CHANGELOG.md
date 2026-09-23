# 更新日志

本项目版本号遵循语义化版本；`package.json` 的 `version` 必须与本文件最新**已发布**条目一致
（由 `tests/version-sync.test.js` 校验）。「未发布」节收录已合入但尚未定版的变更，
发布时把节名改为版本号标题并同步 bump `package.json`。

## 2.3.0（2026-09-22）

对应提交 `8604c6d`。月历与专注统计的界面重做（放缩居中、可滚动日程时间轴、图表与卡片层次），并补齐 ui-review 验收项。

### 界面
- **月历重做**：整块在窗口内水平 + 垂直居中（不再堆在顶部），日格高度随窗口放缩（`clamp(40px,8.2cqb,72px)`，五行/六行都填满可用高度），外观改为卡片（圆角 + 描边 + 阴影），今天 / 选中 / 有任务三种状态区分更清楚
- **每日时间轴改为可滚动的日程视图**：不再把 24 小时压进一屏，改成每小时等高（`--tl-hour: 56px`，共 1344px）在卡片内滚动，打开即落在第一个时段前一小时；刻度逐小时标注（每 6 小时加重）、轨道分小时/6 小时两级网格、左侧加竖分隔线、夜间（00–06 / 22–24）加极淡底色；今天额外画一条「现在」标线
- **补录表单与动作区**：原生 `time` 控件去掉默认外观（等宽数字 + 焦点环），表单与操作区各自成卡并加分隔线，主动作「+ 补录时段」改实心蓝 + 投影
- **「本周 / 本月」视图**：四张指标卡改为主卡（浅蓝渐变 + 蓝数字）+ 描边卡，柱状图改为渐变柱 + 网格线 + 空槽底轨的图表卡，标题右侧挂范围摘要（`2026-09-21 至 2026-09-22`）
- **小窗兜底**：统计面板自身不溢出视口，时间轴设最小高度，720×560 下补录与导出按钮仍可达
- ui-review 验收脚本新增 4 项（月历放缩居中、重叠块与 1 小时等高、时间轴滚动落点、标准窗口下统计页与每日视图无多余滚动条），并把「先换窗口尺寸再断言」改成轮询等待视口真正切换（34 → 39 项）

## 2.2.0（2026-09-22）

对应提交 `e34d742` 与 `7b88dd9`。新增每日时间轴、笔记模板导出（Obsidian / Notion 联动）与任务顺延，并修复任务绑定链路。

### 专注钟
- **多轮番茄计划**：设置面板改为「选择专注计划」，四套预设展开成段落队列后**自动推进**（专注 → 短休 → … → 专注 → 长休）——标准番茄（25 专注 ×4，轮间 5 短休，收尾 15 长休，共 8 段）、深专注（45 ×2 / 5 / 15，4 段）、短冲刺（15 ×4 / 3 / 10，8 段）、长跑（50 ×2 / 10 / 20，4 段）
- 单段专注保留：25/45 快捷预设 + 1–180 分钟自定义（移除 5/10/15 快捷按钮，短时长场景由计划预设覆盖）
- 计划内段落完成**不弹完成屏**：只发 `plan-advance` 事件与系统通知/toast 并自动进入下一段；整套计划跑完才回到完成屏
- 中途改时长 / 切阶段 / 换计划 / 重置 / 放弃都会终止当前计划，进行中的轮次先记一条 abandoned 历史，不再无痕丢轮
- 关窗期间到点走静默补记（不响铃、不通知），**补记不推进计划**，完成后计划终止
- 每段（含计划内休息段）完成各记一条历史；专注段照常累计今日轮数/分钟数

### 今日事
- **任务闹钟**：任务行可设 `HH:MM` 提醒（`task.alarm`），到点由主进程调度器 `src/main/alarm.js` 发系统通知（15 秒扫描一次，误差 ≤15 秒）；已完成的任务不提醒，同一任务同一时刻当天只响一次；只在应用运行期间生效（托盘常驻时关窗也响），睡眠/关机错过的时点不补
- **子步骤精简**：去掉分钟数倒计时按钮（数据里的 `minutes` 字段仍保留兼容），新增显式「修改」按钮；删除/修改按钮与主任务操作列同列对齐
- 状态汇总收敛为标题行右侧小胶囊（⏱ 专注分钟、步骤进度、闹钟时刻），不再占任务本体行
- 专注钟界面不再显示当前任务名（绑定关系保留：完成分钟照常记回任务、主窗任务保持高亮）
- 任务「开始专注」改为**先绑定任务并打开小窗、弹出计划选择器**，用户选完计划/时长点「开始」才开跑（`timer.startTask` 新增 `noStart` 选项，修复 preload/IPC 层参数透传）

### 数据与 IPC
- `sisy-focus-state-v2`：任务新增可选 `alarm`（`HH:MM`；非法值校验时丢弃并记入修复清单）
- `sisy-timer-state`：新增可选 `plan`（`{key,name,steps:[{phase,sec}],index}`，结构非法整体剥离）与 `awaitPlan`（等待选计划标记）
- 新增计时命令 `applyPlan`（预设键 `classic` / `deep` / `sprint` / `marathon`，IPC 层校验预设键白名单）

### 每日时间轴（任务时段记录）
- **每日时间轴**：专注统计新增「每日」视图——这一天哪些时间段做了哪些事，纵向时间轴按分钟定位，重叠时段并排分列（允许重叠）
- 时段从 `sisy-timer-history` 纯推导（零新增记录负担）：同任务相邻专注段（间隔 ≤15 分钟，含计划内休息）合并为一个连续时段，中断（abandoned）独立标注，未绑定任务的专注显示为「未定任务的专注」
- **时间轴可自定义**：每块可改起止时间、隐藏误记块，也可手动补录时段；修正存入覆盖层 `sisy-timeline-overrides`（派生数据与权威历史不动，重算后修正不丢）
- 时间轴上可一键导出笔记、单独复制某任务的记录

### 笔记模板导出（Obsidian / Notion 联动）
- **用户可编辑的 MD 模板** + 标准命名变量（snake_case）：单值 `{{date}}` `{{date_cn}}` `{{weekday}}` `{{focus_minutes}}` `{{focus_rounds}}` `{{tasks_done_count}}` `{{task_title}}` `{{task_minutes}}` `{{week_since}}` `{{peak_range}}` 等；循环块 `{{#timeline}}` / `{{#tasks_done}}`（含 `{{^list}}` 空态，块内 `{{start}}` `{{end}}` `{{title}}` `{{minutes}}`）；未知变量原样保留不吞
- 三份内置初始模板：**每日复盘 / 单任务记录 / 周报**；「⚙ 设置 → 笔记模板」可编辑、即时预览、恢复默认
- 导出动作：**复制到剪贴板**（粘贴进 Notion / Obsidian）与**存为 .md 文件**（可直接落 Obsidian vault）；仍为零网络本地生成
- 新存储键 `sisy-export-template`（每份 ≤32KB，损坏回落默认）；新增 IPC `data:render-note` / `data:copy-note` / `data:save-note`（.md 导出走对话框授权 + reveal 白名单）

### 任务顺延
- **未完成任务滚动顺延**：普通任务（非每日任务）没做完，跨天自动搬进今天的列表并标「顺延」徽标（tooltip 显示来源日），顺延任务置顶，直到完成或删除
- 每日任务豁免（每天自动重新实体化，顺延会重复）；任务的闹钟、子步骤随任务走，任务累计专注分钟跨日合并显示
- 任务新增 `rolledFrom` 来源日字段（schema 校验，非法丢弃可修复）

### 修复
- **专注钟状态徽章**（左下角）与主窗标题栏状态条改显**本轮设定时长**（定 45 分钟恒显 `45:00`）：原实现显示被向上取整的剩余时间（剩 23:33 显示 24:00、一分钟一跳）；剩余倒计时以中央大数字 / 托盘为准
- **任务绑定链路**：选计划（`applyPlan`）或选单段时长（`setDuration`）后任务绑定不再丢失（修复「绑定 → 弹选择器 → 选完绑定消失」）
- **「继续本轮专注」**：已绑定本轮的任务再点任务行专注按钮直接恢复计时，不再走计划选择器
- ui-review 验收脚本对齐任务发起专注的新流程与小窗不显示任务名的语义，并补绑定链路断言（31 → 34 项）
- 新增回归套件 `tests/timeline-notes.test.js`（时间轴合并/修正层/重叠分列、跨日分钟聚合、任务顺延、模板引擎、新键校验）；回归 8 套 387 项 → **9 套 436 项**
- 新增存储键 `sisy-timeline-overrides`（归 `tasks` 清空分区）、`sisy-export-template`（归 `prefs` 清空分区）

## 2.1.0（2026-09-11）

macOS 适配。此前项目标注「仅 Windows」，理由是「自绘标题栏、托盘、电源事件全部按 Windows 调过，
没有真机验证就不发产物」；本次在 Apple Silicon 真机上完成适配与验证，把该理由消掉。

### macOS 运行时适配
- **应用菜单**：新增 `src/main/menu.js`。此前 `main.js` 无条件 `Menu.setApplicationMenu(null)`，
  在 macOS 上会移除承载系统快捷键的菜单栏，导致 `Cmd+Q` / `Cmd+C` / `Cmd+V` / `Cmd+X` / `Cmd+A` /
  `Cmd+W` / `Cmd+M` / `Cmd+H` 全部失效（应用甚至无法用键盘退出）。现在仅 Windows/Linux 移除菜单，
  macOS 装一份最小菜单（App / 编辑 / 视图 / 窗口，全部用 `role:` 交给系统本地化）。
  视图菜单顺带恢复了 `reload` / `toggleDevTools`——README 与 docs/diagnostics.md 里写的这两个
  调试快捷键在此之前本来就是死的。模板是纯数据，`tests/macos-support.test.js` 直接断言必需 role 齐全
- **窗口外观**：主窗在 macOS 上改用 `frame: true` + `titleBarStyle: 'hidden'` + `trafficLightPosition`，
  拿到系统原生红绿灯；自绘的窗口按钮仅在非 macOS 出现（`src/shell.css` 的 `body.platform-darwin`）。
  macOS 上不再接管标题栏双击——交给系统按「桌面与程序坞 → 双击标题栏」的偏好处理，避免与系统行为打架。
  `preload.js` 向渲染层暴露 `platform`，用于加平台 class
- **托盘**：macOS 菜单栏图标改用单色模板图（`assets/trayTemplate.png` + `@2x`，`setTemplateImage(true)`），
  随浅色/深色菜单栏自动反色；此前是把 1254×1254 的彩色应用图标缩到 16px 塞进菜单栏，深色模式下观感是错的，
  Retina 下也糊。图标由 `build/make-tray-icon.js` 零依赖生成（PNG 编码只用 Node 内置 zlib），资源可复现。
  另外：macOS 上一旦 `setContextMenu`，`click` / `right-click` 就都不再触发，「点托盘回主窗」会失效——
  现在 macOS 不设常驻菜单，改为左键回主窗、右键临时弹出；并用 `tray.setTitle()` 把剩余时间直接写在菜单栏上
- **跨 Space 置顶**：小窗此前只设了 `alwaysOnTop`，在 macOS 上切到别的桌面或别人的全屏应用就会被盖住。
  现在置顶时同步 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`。
  **注意必须带 `skipTransformProcessType: true`**：不传时 Electron 会把进程类型转成 Accessory，
  结果是 Chromium 认为该窗口不可见 → `document.hidden` 变 true → `src/timer/flow.js` 的 `start()`
  直接 return，字符海动画整个停掉（真机复现：冒烟测试的「字符海渲染循环在跑 / 渲染帧率接近 120」
  两项转红；`tools/ui-review.cjs` 的截图也看不到字符海）
- **生命周期**：`app.setAppUserModelId` 加 `win32` 判断（macOS 上是空操作）；
  macOS 上 `window-all-closed` 不再退出应用，交给已有的 `activate` 处理器（关窗后点 Dock 图标可唤回）

### macOS 打包
- `package.json` 新增 `mac` 构建配置：dmg + zip，arm64 与 x64 各一份，声明应用分类与产物名
  （带 `${version}` 与 `${arch}`），开启强化运行时并配 `build/entitlements.mac.plist`
- 新增 `build/mac-build.sh`（对照 `build/win-build.ps1`）：同样的四道测试闸 → 构建 →
  用现成的 `tools/check-asar-runtime.js` 核对 `Sisyphus.app/Contents/Resources/app.asar` 与源码一致 →
  输出产物大小与 SHA-256、`codesign` 状态。**没有证书时自动补 ad-hoc 签名**：
  Apple Silicon 上未签名的 `.app` 会被系统判定为损坏、双击打不开，本地构建必须做这一步
- 新增 npm 脚本 `dist:mac` / `dist:mac:dir`

### 测试
- 新增 `tests/macos-support.test.js`（30 项断言）：菜单模板必需 role 齐全、`main.js` 确实接上了菜单
  （模块写了却没接线是静默失效）、菜单栏模板图标存在且尺寸正确
- `tests/version-sync.test.js` 补 macOS 构建配置断言（12 → 20 项）
- `tests/rework-electron.integration.cjs` 里用 `powershell.exe` 清理临时目录的那段改为按平台选 shell，
  在 macOS 上原本必然失败
- 回归套件 8 套 387 项 → **9 套 425 项**

### 未做
- 不加 macOS CI job：macOS runner 计费是 Linux 的 10 倍，是否接入应由维护者决定，
  不在本 PR 里替项目增加持续成本。macOS 侧改为「本地构建脚本 + 真机验证记录」
- 不做公证（需要 Apple Developer 账号）；签名与公证路线见 [docs/release.md](docs/release.md#代码签名)

## 2.0.0（2026-09-10）

开源发布版本。**含破坏性变更**：技术命名统一为 `sisy-*`，并完成发布前的工程收口。

### 命名统一（破坏性）
- 存储键前缀 `adhd-*` → `sisy-*`；数据文件 `adhd-store.json` → `sisy-store.json`；备份 `sisy-store-*.json`（含 `-pre-import` / `-pre-clear`）
- 日志文件 → `%APPDATA%\Sisyphus\logs\sisy.log`；小窗位置 → `sisy-timer-win.json`
- 前端自定义元素 `kimi-icon` → `sisy-icon`（图标仍是本地手写的 16x16 线性图标）
- **不提供 1.x → 2.0 的自动迁移**：2.0 不再读取 1.x 的 `adhd-*` 数据与旧目录；需要保留 1.x 数据的用户请留在 1.3.0，或按 [docs/data.md](docs/data.md) 的手工步骤迁移（导出 JSON → 把键名里的 `adhd-` 全量替换为 `sisy-` → 导入）
- npm 包名与仓库名 → `sisyphus-focus`；`productName` 仍为 `Sisyphus`，安装名、快捷方式、应用名「西西弗斯」不变

### 开源收口
- 新增 `CONTRIBUTING.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md` / issue 与 PR 模板 / `.github/dependabot.yml`
- README 按实跑结果重写（版本号、下载文件名、测试数量、验证命令、数据与隐私口径），并新增英文版
  `README.en.md`（与中文版逐节对应，互链）；新增 [ROADMAP.md](ROADMAP.md)（做什么、明确不做什么）
  与 [docs/github-setup.md](docs/github-setup.md)（仓库描述 / topics / 分支保护 / 执行清单）
- [docs/data.md](docs/data.md) 新增第 7 节「从 1.x 手工迁移」：键名对照表 + 导出改前缀再导入的完整步骤
- `package.json` 补 `repository` / `homepage` / `bugs` / `author` 元数据；`@electron/asar` 由隐式传递依赖改为显式 devDependency
- CSP：`index.html` 与两个页面 HTML 增加 `Content-Security-Policy` meta（`default-src 'self'`、禁远程脚本）
- 安全与隐私口径写入 `SECURITY.md`（`sandbox:false` / `nodeIntegrationInSubFrames:true` 的成因、IPC 校验白名单、无网络请求与无遥测）
- 接入 Windows 代码签名管线：支持 `CSC_LINK` / `CSC_KEY_PASSWORD`（文件形态证书）与 `build/sign-azure.json`（Azure Artifact Signing）；新增 `build/check-signature.ps1` 核验产物签名状态。
  签名路线在图省事之后重新查证（2026-09）：Azure 对**个人仅限美国/加拿大**、组织限 12 个国家/地区（不含中国大陆），
  因此个人可行的两条是 [SSL.com IV](https://www.ssl.com/products/software-integrity/code-signing/iv/)（$129/年 + eSigner 云签名订阅）
  与 [Certum 开源代码签名证书](https://certum.store/open-source-code-signing-code.html)（专为开源项目，需物理加密卡），口径写进 [docs/release.md](docs/release.md#代码签名)。
  另查证到两条**免费**路径并写进文档：Microsoft Store（MSIX 提交由商店用微软证书重签，开发者账号已免注册费，
  是唯一「零成本 + 用户永远看不到警告」的路）与 [SignPath Foundation](https://signpath.org/)（有条件地免费为
  开源项目签名，但证书签发对象是它自己、且要求项目已有可验证声誉）
- CI：构建任务固定 `windows-2022`、启用 npm 缓存、显式走官方 npm 源、失败时上传冒烟与 UI 验收诊断产物
- 依赖源口径：`package-lock.json` 的 `resolved` 统一写成官方 `registry.npmjs.org`（npm ≥ 9 会按本机 `.npmrc`
  自动换到镜像），`.npmrc` 里说明如何切回官方源

### 测试
- 自检 `tools/selftest.js` 119 项；回归 `tests/run-all.js` 8 套（合计 387 项断言：
  可在本机直接跑的 7 套 381 项 + `packaging-parity.test.js` 6 项，后者需要已安装依赖的常驻环境）
- `tools/check-syntax.js` 扩到 5 步：把 `tools/*.js|*.cjs` 纳入语法检查，并交叉检查工具脚本引用的元素 id
  是否存在（含 `const ids=[...]` 形式的清单）；顺带修掉 `tools/smoke-test.js` 里引用已不存在
  `sisy-app`（实际 id 是 `todo-app`）的陈旧断言
- 新增 `tools/check-links.js`（`npm run check:links`）：静态校验文档里的相对路径与 `#锚点`，
  并接入 `npm run verify` 与一键构建门禁；顺带修掉 `docs/github-setup.md` 里两条指向 `docs/docs/release.md`
  的相对链接

## 1.3.0（2026-09-09）

品牌改名：**ADHD Studio → 西西弗斯**（技术标识用纯 ASCII 的 `Sisyphus` / `com.sisyphus.studio`）。

### 品牌与视觉
- 应用名改为「西西弗斯」：`productName`/`appId`/包名/产物名/托盘/通知/日志前缀全部更新，安装与开始菜单快捷方式为「西西弗斯」
- 新增 exe/安装包图标（推石上山的意象）；标题栏品牌字重排，「斯」用品牌蓝强调
- 数据目录由 `%APPDATA%\ADHD Studio` 迁到 `%APPDATA%\Sisyphus`：首次运行自动搬移旧数据（含备份/日志/小窗位置），新目录已有数据则不动

### 今日事
- 内容区改为单一背景并随窗口自适应缩放（去掉居中卡片与左右边框）
- 过去的日期也能编辑：可勾选完成、改标题、增删改小步骤与分钟数；「新增任务 / 拖拽排序 / 点开专注」仍限今天

### 构建 / 测试
- `version-sync.test.js` 的 appId 断言同步为 `com.sisyphus.studio`
- 清理 `release` 中旧的 ADHD 产物

## 1.2.0（2026-09-08）

工程可靠性版本：无 UI 视觉变更。

### 数据可靠性
- 新增 `src/main/schema.js`：全部已知存储键的结构校验（硬错误拒绝 / 软问题修复），导入摘要与分区清空映射
- 新增 `src/main/migrations.js`：版本化数据迁移链（裸表→envelope、扁平任务→按日分组、日期键零填充、统计/历史/偏好规范化），幂等且留迁移日志
- 导入流程改为：解析 → 校验 → 摘要 → 只备份一次 → 写入 → 磁盘验证 → 刷新；任一步失败自动回滚，不产生半成品备份
- 主文件损坏时自动尝试 `.tmp` 与最近备份恢复；损坏现场保留为 `.corrupt-<ts>` 文件；`app:info` 新增 `recovery` / `migrations` 诊断清单
- 清空数据支持分区（tasks / daily / stats / history / prefs / timerState / all），清空前自动 `pre-clear` 备份；空列表与未知分区被拒绝（详见 `docs/data.md`）

### 计时正确性
- 主进程计时状态机加入显式转换约束（idle / running / paused），非法命令被拒绝并记录 `lastRejection`
- 运行中 reset / setPhase / setDuration 不再无痕丢轮：自动补记一条 abandoned 历史
- 完成与放弃路径加重入保护：完成事件、统计累加、历史写入各只发生一次
- `setDuration` 非数字参数不再被钳制成 60s 的意外值（直接拒绝）
- **桌面验收修复**：`main.js broadcast()` 对子框架（今日事 iframe）显式 `sendToFrame` 路由，
  否则 iframe 收不到 `timer:state`/`timer:event` 广播，任务聚焦后的 `current-task` 高亮与历史/统计自动刷新失效
  （真实 Electron 集成新增对应断言，7/7）

### IPC 与本地安全
- 所有 IPC 入口做类型/白名单校验：键名、计时命令、时长、阶段、偏好、导入模式、通知长度、日志条目
- `data:reveal` 仅允许应用数据目录内路径；备份标签消毒（路径穿越失效）
- 日志单行 600 字符截断、换行压平、批量上限；错误信息不回显文件内容
- 保持 `contextIsolation: true`、`nodeIntegration: false`；未引入任何远程脚本 / 网络依赖

### 发布工程
- `electron-builder` 与 `electron` 声明为 devDependency，补齐 portable + NSIS 构建配置（x64）
- 新增 `build/win-build.ps1` 与 GitHub Actions（`.github/workflows/windows-build.yml`）：ASCII 路径下 校验 → 测试 → 冒烟 → 打包 → 产物哈希
- NSIS 卸载默认不删除用户数据（`deleteAppDataOnUninstall: false`），行为写入 `docs/release.md`

### 启动方式
- **移除 `.cmd` 启动脚本**（`启动西西弗斯.cmd` / `启动专注钟小窗.cmd`）：日常使用直接双击 exe
  （Release 的 `-setup.exe` 安装版或 `-portable.exe` 免安装版），不再需要命令行脚本
- 源码启动统一为 `npm start` / `npm run compact`（新增 `tools/launch.js`：优先用仓库内 Electron
  运行时，缺失时回退 `node_modules` 的 Electron，并给出明确提示）
- 新增 `.github/workflows/release.yml`：推送 `v*` tag 自动构建 portable + NSIS 并创建 GitHub Release
  （附 `SHA256SUMS.txt`）；补齐 `LICENSE`（MIT）

### 精简
- **移除 IPC「发送方页面白名单 + 窗口身份」信任校验**：本应用只加载本地文件、无远程内容、
  已关闭 `nodeIntegration`，攻击面极小；保留全部参数校验（键名 / 计时命令 / 时长 / 阶段 / 偏好 /
  导入模式 / 路径白名单）即可，同步删掉对应断言与诊断探针
- 删除过程台账与证据库（`PROGRESS.md`、`BLOCKED.md`、验收/返工文档、`docs/evidence/`）：
  审计产物而非产品内容；`tools/ui-review.cjs` 截图输出改到 `.tmp/`
- 移除 UI 文件 SHA-256 锁定清单与校验脚本（`docs/ui-lock.sha256`、`check-asar-hashes.js`）：
  git 本身就能反映改动，清单只增加维护负担；保留 `tools/check-asar-runtime.js` 抓「新文件没被打进包」
- **移除浏览器直开（serve.py）模式**：删掉 storage.js 的 localStorage 后端、timer/state.js 的本地
  状态机、todo/state.js 的重复数据迁移/修复（这些修复统一由主进程 schema.js + migrations.js 承担）、
  tests/browser-fallback.test.js 与 docs/browser-mode.md；数据/计时/任务只剩一条主进程权威路径。
  顺带删除失效的 `store:migrated` 迁移通知通道。

### 测试
- `tests/` 八套回归共 **384** 项断言（数据可靠性 / 计时正确性 / IPC 校验 / 版本一致性 /
  存储边界 / 返工场景 / 打包一致性 / 工作流）
- `npm run test:regression` / `npm run test:all` 一键执行

## 1.1.0

- 架构迁移：权威数据与计时状态机移入主进程（`src/main/*`），双窗口共享唯一计时状态
- 专注钟小窗、托盘常驻、原子写 + 滚动备份、导入导出、日志诊断
- 今日事：按日分组、每日任务模板、标题折叠；统计与历史落盘
