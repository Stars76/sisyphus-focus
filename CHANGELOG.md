# 更新日志

本项目版本号遵循语义化版本；`package.json` 的 `version` 必须与本文件最新条目一致
（由 `tests/version-sync.test.js` 校验）。

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
