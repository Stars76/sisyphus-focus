# 发布与打包（Windows x64）

## 依赖与版本

- `electron`（devDep，版本与 `build.electronVersion` 锁定一致，由 `tests/version-sync.test.js` 校验）
- `electron-builder`（devDep）——首次构建时自动下载 Electron 发行包与 NSIS 工具链，
  镜像已在 `.npmrc` 固定：`electron_mirror` / `electron_builder_binaries_mirror` = npmmirror
- `@electron/asar`（devDep）——`tests/packaging-parity.test.js` 与 `tools/check-asar-runtime.js` 用它读取打包内的文件清单
- 缓存位置：`%LOCALAPPDATA%\electron-builder\Cache`（与仓库路径无关）；CI 上这条路径走 `actions/cache`

> 本机 `node_modules/electron` 若只有壳（安装时跳过了二进制下载），可直接用仓库内解压版运行时：
> `.\electron\electron.exe tools\ui-review.cjs after`。

## 一键构建

```powershell
powershell -ExecutionPolicy Bypass -File build\win-build.ps1            # 校验+测试+portable+NSIS
powershell -ExecutionPolicy Bypass -File build\win-build.ps1 -Targets portable
```

脚本行为：

1. 依次跑 `tools/check-syntax.js`、`tools/check-links.js`、`tools/selftest.js`、`tests/run-all.js`（失败即停，不允许跳过口径）
2. 依赖缺失时 `npm install`（镜像源）
3. **当前目录路径含非 ASCII 时**（例如中文目录），自动镜像源码到
   `%LOCALAPPDATA%\Temp\sisyphus-build`（纯 ASCII）后用 junction 共享 `node_modules` 构建
   —— 这是本机中文路径触发过 npm EPERM 的防线；CI 的 workspace 天然是 ASCII
4. 产物回拷到仓库 `release/`，逐个打印大小、SHA-256 与 **Authenticode 签名状态**；
   检测到 `CSC_LINK` 但产物没签成功时**直接失败**，避免"以为签了其实没签"
5. **本次构建的可核验 asar 落盘到 `release/current-build/app.asar`**：即便镜像目录被清理，
   也能对本轮产物执行打包一致性校验：
   ```powershell
   node tools\check-asar-runtime.js   # 打包内全部运行文件（main/preload/index/src/**）与当前源码逐字节
   ```
   默认核验 `release/current-build/app.asar`；若缺则回退 `release/win-unpacked/resources/app.asar`（旧目标，不代表本轮代码）。

手动等价命令：`npm run dist`（portable）、`npm run dist:nsis`、`npm run dist:all`。

## 代码签名

**为什么要证书**：Windows 用 Authenticode 校验 exe 的签名，签名链必须能追溯到一个
**公开受信任的 CA 签发的代码签名证书**。自己生成的证书（自签名）浏览器/Windows 不认，
签名状态只会显示"未知"或需要用户手动信任根证书，等于没签。证书的私钥必须由发布者自己持有，
所以签名这件事无法由他人代劳 —— 仓库这边能做的是**把管线铺好**：证书一到位，构建即产出签名产物。

**四条硬约束（2023–2026 陆续生效，查证于 2026-09）**：

- CA/Browser Forum 自 **2023-06** 起要求代码签名私钥存放在硬件令牌或云 HSM 里 ——
  「导出一个 `.pfx` 直接塞进 CI secret」的做法对新证书基本走不通；
- CA/Browser Forum 自 **2026-03-01** 起把公开可信代码签名证书的最长有效期限制为 **458 天**
  （SSL.com 自 2026-02-27 起先行执行）；
- Sectigo 自 **2026-02-23** 起不再签发「一张多年证书签在同一台 FIPS 设备上」的形态，
  多年期变为「多张短证书 + 同一设备」；
- **签名 ≠ 立刻没有警告**：全新证书是 **0 声誉**，SmartScreen 仍可能提示，直到积累起干净的下载记录
  （微软官方口径：可能要**几周**、**上百次**来自广泛用户的干净安装）。
  **EV 不再自动免警告** —— 微软已明确说「EV 证书不再绕过 SmartScreen」，只为躲警告而买 EV 不再划算；
  唯一「永不警告」的路径是 **Microsoft Store 分发**（商店用微软自己的证书重新签名）。
- **未签名最亏的地方是声誉按版本清零**：微软的原文是「未签名文件必须为**每一个新版本**从零重建声誉，
  声誉无法从前一版本继承，除非两者由**同一个发布者身份**签名」。也就是说，签了名之后，
  声誉会累积在**发布者身份**上，下个版本能继承；不签名的话每次发版都回到起点。
- **Windows 11 的 Smart App Control 会直接拦，且用户绕不过**：它先问云端有没有把握判断，
  没有把握时**只认有效签名**，未签名一律视为不可信并阻止运行；官方还写明「**目前没有办法**为单个应用放行」。

### 全部选项：先看这两条免费的

**不需要每个人都自掏腰包。** 微软自己的 [Code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) 页面把免费路径列得很清楚：

| 选项 | 价格 | 谁合适 | 用户还会看到警告吗 |
|---|---|---|---|
| **Microsoft Store（MSIX 提交）** | **免费**（开发者账号在新流程下也不收注册费） | 愿意把应用打成 MSIX 并过商店审核的项目 | **永远看不到** —— 商店用微软证书重新签名 |
| **SignPath Foundation** | **免费**（面向符合条件的开源项目） | 公开仓库 + OSI 许可 + 活跃维护的 OSS 项目 | 签名后按发布者累积声誉；**发布者显示为「SignPath Foundation」** |
| Azure Artifact Signing | 约 $9.99/月 | 有美/加（个人）或美/加/欧盟/英国（组织）实体 | 会：新文件先警告，声誉按发布者累积 |
| OV 证书（DigiCert / Sectigo 等） | 约 $150–300/年 | 有公司实体，或在大陆等受限地区的个人 | 同上（与 Azure 等效） |
| EV 证书 | $400+/年 | 需要企业采购背书（**不再为躲警告而买**） | 同上：微软已确认 EV 自 2024 年起不再自动免警告 |
| 自签名证书 | 免费 | 只用在本机开发 / 企业内网统一部署根证书 | 会：**和完全不签名一样**，公开分发不可用 |
| 不签名 | 免费 | —— | 会：强提示，企业策略可能直接禁止 |

> Store 有个坑：**只有 MSIX 提交**才由商店免费重签。如果你提交的是 Win32 的 **MSI/EXE 安装器**，
> 微软不重签，你仍然得自己签一份能追到受信任根 CA 的证书。

#### 路线 A：Microsoft Store（MSIX）—— 唯一「零成本 + 零警告」

1. 在 <https://storedeveloper.microsoft.com> 注册开发者账号：**个人与公司账号都不收注册费**；
   个人账号需要政府证件 + 自拍做身份验证，且必须用个人微软账号（MSA）；
2. 把应用打成 **MSIX** 包。**这是这条路真正的成本项**：本仓库现在的产物是 portable exe 与
   NSIS 安装器，还没有 MSIX 目标，需要额外的打包工作与适配；
3. 提交审核 → 通过后由微软重签 → 商店用户永远遇不到 SmartScreen 警告（UAC 仍可能出现）；
4. 代价是接受商店政策（例如更新机制要留在商店侧），并且用户是从商店而不是你的 Release 页安装。

#### 路线 B：SignPath Foundation（开源项目免费签名）

条件摘自其 [conditions 页面](https://signpath.org/terms.html)（2026-09 核对）：

- **项目层面**：无恶意代码、OSI 认可许可且无商业双许可、不含任何专有组件、活跃维护、
  **已经有可签名的发布产物**、功能在下载页/商店页有文档；
- **证书层面**：证书签发对象是 **SignPath Foundation**（用户看到的发布者是它，不是你），
  私钥存在它的 HSM 里，签名必须走它的流水线（能接 CI）。因此还有额外要求：
  构建可验证（二进制必须由你的仓库产出）、**每次发布需要人工审批**、
  团队成员全部启用 MFA、明确「作者 / 评审 / 审批」角色，并在项目主页按模板写一段
  「**Code signing policy**」（含指定的署名句与隐私政策链接）。
- **现实门槛**：它明确说**不给「没人知道的源码」签名**（执行程序需要一定的可验证声誉，
  库/组件不受此限）。本项目刚刚开源、还没有用户量，**现在申请大概率会被拒**；
  等有真实下载量与贡献者之后再申请更靠谱。

### 如果愿意花钱，再看这四条

| 服务 | 谁能申请 | 公开价（2026-09 查到的页面价） | 能在 CI 里签吗 |
|---|---|---|---|
| **Azure Artifact Signing**（原 Trusted Signing） | **个人开发者必须在美国或加拿大**；组织限美国/加拿大/欧盟/英国/澳/新西兰/日/韩/新/瑞士/挪威/以色列 —— **不含中国大陆** | Basic **$9.99/月**（5,000 次签名）、Premium $99.99/月；必须付费订阅（免费/试用/赞助订阅不支持），开户即按整月计费、不按天折算 | 能（SignTool + dlib / GitHub Action / Azure DevOps 任务） |
| **SSL.com IV Code Signing** | **个人即可，无需公司**；用政府签发证件做身份验证（标准 3–5 天） | 证书 **$129/年**（2 年 $116.10/年，5 年 $96.75/年）；密钥存储另算：eSigner 云签名订阅 Tier 1 **$20/月** 或 **$180/年**（含 240 次签名），或 YubiKey **+$379** | 能（eSigner 面向 CI 提供 CodeSignTool / GitHub Action） |
| **Certum Open Source Code Signing** | 开源项目维护者；证书主体是 `Open Source Developer <你的姓名>` | 必须买「证书 + cryptoCertum 3.7 卡 + 读卡器」套装，卡走快递；**页面上读不到价格**，以 Certum 报价与开源项目审核要求为准 | **不能直接用托管 runner**：签名要物理卡在读卡器上 → 只能本地签，或自建带读卡器的 runner |
| 传统 OV（Sectigo / DigiCert / GoGetSSL 等） | 需要公司实体与营业执照，个人一般申请不下来 | 约 $216/年起（转售价） | 一般要走 CA 自己的云签名服务 |

**结论（针对本项目）**：免费的两条里，Store 要额外的 MSIX 打包工作、SignPath 现在多半够不着门槛；Azure 对中国大陆的个人**不可用**（除非有美/加实体）；
真要签，**SSL.com IV 最省事**（个人能办、能进 CI），**Certum 的开源证书最贴题**
（专为开源项目、主体直接写「Open Source Developer」，但必须用物理卡）。
两家对「中国大陆申请人」的受理口径我无法替你确认 —— 下单前问一句对方支持/销售更稳。

### 路线 C：SSL.com IV + eSigner（个人开发者 + CI 的首选）

1. 买 IV 证书（1 年 $129）+ 选 **eSigner Cloud Signing** 订阅（Tier 1 $20/月或 $180/年）；
2. 提交政府证件完成身份验证（标准 3–5 天，加急 +$599）；
3. 签名改用 eSigner 的工具（CodeSignTool / eSigner CLI 或官方 GitHub Action），
   **不再走 signtool + `.pfx`**；
4. 接进本仓库：electron-builder 支持自定义签名钩子 —— 在 `package.json` 的 `build.win` 里加
   `"sign": "build/sign-esigner.cjs"`，脚本里调用 CodeSignTool 给传入的文件签名。
   **本仓库尚未内置这个脚本**（没有证书就无法验证它真的能跑），等证书到手再补，并可在 CI 里做一次验签。

> 注意：IV 证书**用不了 `CSC_LINK`** —— 私钥不在文件里，而在对方的云 HSM；同理 `win.signtoolOptions`
> 也不适用（那是给本地 signtool 签名用的）。

### 路线 D：Certum Open Source Code Signing（专为开源项目）

1. 在 Certum 下单套装（证书 + cryptoCertum 3.7 卡 + 读卡器，卡走快递），按
   [所需材料清单](https://support.certum.eu/en/code-signing-required-documents/) 提交开源项目证明
   （本项目 MIT 开源、有公开仓库，属于典型适用场景）；
2. 卡到货后用 proCertum CardManager 初始化，然后**单机签名**：

   ```powershell
   signtool sign /n "Open Source Developer <你的姓名>" /fd sha256 `
     /tr http://time.certum.pl /td sha256 release\Sisyphus-2.0.0-portable.exe
   ```

   （时间戳服务器以 CA 指引为准；本仓库 `build/win-build.ps1` 默认用 DigiCert 的 RFC3161
   时间戳，换成 Certum 的即可。）
3. 想在 CI 里签 → 需要**自建 runner**（插着卡和读卡器的那台机器），托管 runner 拿不到卡。

### 路线 E：Azure Artifact Signing（有境外实体时）

1. 需要一个**付费** Azure 订阅（免费/试用不行）与 Microsoft Entra 租户，注册
   `Microsoft.CodeSigning` 资源提供者；
2. 在支持的区域（East US / West Europe / Japan East / Korea Central 等 15 个）建
   **Artifact Signing Account**，再建 **Identity validation**（组织要营业执照等公开记录，
   个人则取 Azure 账单地址且**仅限美国/加拿大**）与 **Certificate Profile**；
3. 认证用服务主体（CI secrets）：`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`；
4. 把 `build/sign-azure.json` 里的占位字段填成实际值，然后：

```powershell
npx electron-builder --win portable nsis --config build/sign-azure.json
```

`build/sign-azure.json` 只声明签名相关字段，不碰 `package.json` 里的其它构建配置；
`win.signtoolOptions` 与 `win.azureSignOptions` 互斥，二选一即可。该服务不支持自定义 CN/O
（证书主体必须是验证过的法定名称），也不签发 EV 证书。

### 路线 F：暂不签名（本仓库当前状态）

代价是可承受的，但不是零：

- 用户首次运行会看到 SmartScreen「未知发布者」，点「更多信息 → 仍要运行」可以过 ——
  **企业策略可以把这一步直接禁掉**，那就完全跑不起来；
- 开了 **Smart App Control** 的 Windows 11 上会被**直接拦截且无法为单个应用放行**
  （该功能会在不少家用机器上自动开启）；
- 每一版都从零积累声誉，1.x 的下载量不会帮到 2.0；
- 完整性只能靠 Release 页面上的 `SHA256SUMS.txt` 自证（同一个页面被改就无法察觉）。

等有证书（或有了境外实体）再按上面任一条路线接上，仓库这边不用改结构。

### 附：`CSC_LINK` 机制（能拿到证书文件时）

electron-builder 原生支持两个环境变量，**不需要改配置**；当你的 CA 给了你一个可导入的证书文件
（自管的 `.p12`、或 CA 提供的可导入形态）时，这条路最短：

```powershell
$env:CSC_LINK = 'C:\path\to\cert.pfx'          # 或 base64 内容 / data: 前缀
$env:CSC_KEY_PASSWORD = '<密码>'
powershell -ExecutionPolicy Bypass -File build\win-build.ps1
```

CI 上把 base64 后的文件放进仓库 secret `CSC_LINK`、口令放进 `CSC_KEY_PASSWORD` 即可 ——
三个 workflow 已经把这些 secret 透传给构建步骤，也据此决定「签名校验是否当硬门槛」；
未配置时构建照旧产出未签名产物。

> 这也是为什么仓库里保留了 `win.signtoolOptions`（SHA-256 + DigiCert RFC3161 时间戳）：
> 一旦有文件形态的证书，签名、时间戳、验签三件事都不用改代码。

### 核验签名状态

```powershell
npm run verify:signature                                   # 只报告，不因未签名而失败
powershell -File build\check-signature.ps1 -RequireSigned  # 未签名即失败（CI 在证书已配置时用这个）
```

CI 里 release / continuous / PR 三条流水线都会打印签名状态；**配置了 `CSC_LINK` 时签名校验是硬门槛**，
没配置时只报告未签名。当前仓库**尚未配置证书**，因此公开产物是未签名的：

- 首次运行会出现 SmartScreen「未知发布者」提示（更多信息 → 仍要运行）；
- 完整性以 Release 附件里的 `SHA256SUMS.txt` 为准：
  ```powershell
  Get-FileHash -Algorithm SHA256 .\Sisyphus-<版本>-portable.exe
  ```
- 同上口径也写在 `SECURITY.md`：**未签名属于已知发布限制，不算安全漏洞**。

## CI

| 工作流 | 触发 | 做什么 |
|---|---|---|
| `.github/workflows/windows-build.yml` | PR、手动 | 门禁（`npm run verify`）→ Electron 冒烟（失败自动重试一次）→ 打包 → asar 逐字节对拍 → UI 全场景验收 → 签名状态 → 产物清单 → 上传产物；失败时额外上传冒烟与 UI 验收诊断包 |
| `.github/workflows/release.yml` | `v*` tag、手动 | 同上构建口径，产出并发布正式 Release（`RELEASE_NOTES.md` + 两个 exe + SHA256SUMS.txt） |
| `.github/workflows/continuous-release.yml` | push 到 main/master | 构建并覆盖滚动 Release（tag `continuous`）；纯文档改动（`**.md`、`docs/**`）自动跳过以省额度 |

- runner 固定 `windows-2022`（Electron 需要真实桌面会话；Linux runner 起不了带 GPU 的窗口）
- `actions/setup-node` 开 npm 缓存，另有一步单独缓存 Electron / electron-builder 的下载目录
- 脚本在 `CI=true` 时会为 Electron 追加 `--disable-gpu` 等开关，避免 runner 上没有显卡导致的帧率与截图抖动
- 若某条流水线在 GitHub 上首次运行报错，先看失败步骤上传的
  `sisyphus-smoke-diagnostics`（`tools/smoke-*.json/txt`）与 `sisyphus-ui-review-diagnostics`
  （`.tmp/ui-review-out/after/` 里的 `results.json` 与逐场景 PNG）

> GitHub 侧的一次性设置（仓库名、description、topics、分支保护、隐私披露）见 [github-setup.md](github-setup.md)。

## 产物形态与数据行为（升级/卸载口径）

| 场景 | 行为 |
|---|---|
| 全新安装（NSIS） | 用户级安装（`allowElevation:false`，装到 `%LOCALAPPDATA%\Programs`），桌面+开始菜单快捷方式；首次运行创建 `%APPDATA%\Sisyphus` |
| 覆盖安装 | 安装器不触碰 `%APPDATA%\Sisyphus`；启动后走 schema 迁移（`docs/data.md`） |
| 从 1.x 升级 | **不自动迁移**：2.0 的存储键前缀是 `sisy-*`，1.x 的 `adhd-*` 数据不再被读取。要保留 1.x 数据请继续用 1.3.0，或按 `docs/data.md` 的手工步骤迁移后再升级 |
| 卸载 | `deleteAppDataOnUninstall: false`：卸载**保留**用户数据、备份与日志（重装即恢复）。要彻底清除：卸载后手动删除 `%APPDATA%\Sisyphus` |
| Portable exe | 免安装，数据仍在 `%APPDATA%\Sisyphus`（userData 由 Electron 按 app name 决定，与 exe 位置无关，两个 portable 副本共享同一份数据） |

## 版本检查

`node tests/version-sync.test.js`：semver 合法、CHANGELOG 最新条目 == package.json version、
`build.electronVersion` == 安装的 electron、双 target 产物名含版本号。
