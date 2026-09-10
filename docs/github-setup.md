# 把仓库发布到 GitHub 的清单

这份文件是**一次性的发布操作手册**：把本机这个仓库推到 GitHub、把占位符换成真实地址、
把仓库设置调到能接收贡献的状态。做完之后基本不用再回来翻。

> 里面所有命令都在 Windows PowerShell 里执行，工作目录是仓库根目录。
> `$owner` 请替换成你的 GitHub 用户名。仓库 owner 已确定为 **`Stars76`**
> （即 `https://github.com/Stars76/sisyphus-focus`）。

## 1. 推送前必做

### 1.1 填掉 `OWNER` 占位符 —— ✅ 已完成（2026-09-10，8/8 处替换为 `Stars76`）

下面保留当时用的方法，将来改仓库名或换 owner 时可照做。仓库里原本有 **3 个文件共 8 处**
写着 `https://github.com/OWNER/sisyphus-focus`：

| 文件 | 位置 |
|------|------|
| `package.json` | `homepage` / `repository.url` / `bugs.url` |
| `CONTRIBUTING.md` | 「Before you start」的 issues 链接、`git clone` 示例、文末 help 链接 |
| `.github/ISSUE_TEMPLATE/config.yml` | Discussions 与 Security advisories 链接 |

一条命令替换（替换前先 `git status` 确认没有别的未提交改动）：

```powershell
$owner = 'Stars76'
Get-ChildItem package.json, CONTRIBUTING.md, .github/ISSUE_TEMPLATE/config.yml |
  ForEach-Object {
    (Get-Content $_ -Raw -Encoding utf8).Replace('github.com/OWNER/', "github.com/$owner/") |
      Set-Content $_ -NoNewline -Encoding utf8
  }
# 核对：应该没有任何输出
Select-String -Path package.json, CONTRIBUTING.md, .github/ISSUE_TEMPLATE/config.yml -Pattern 'OWNER'
```

`build/sign-azure.json` 里的 `REPLACE_WITH_YOUR_VERIFIED_PUBLISHER_NAME` **不要动**：
那是给签名用的，等真的申请证书时再填（见 [docs/release.md](release.md#代码签名)）。

### 1.2 设置 git 身份

提交身份已经配好（不要用 `genz@local` 这种本地值提交）：

```powershell
git config user.name   # GenZ
git config user.email  # entropicechoc@gmail.com

# 没有 remote 时添加（仓库名与 package.json 的 name 一致）
git remote add origin "https://github.com/$owner/sisyphus-focus.git"
```

### 1.3 提交与自检

2.0.0 的内容与 OWNER 占位符替换都已经作为提交落在本机
（`a2a7cdf chore(release): 2.0.0 开源收口`、随后的文档/占位符提交），工作区是干净的。
发布前建议再跑一遍闸门，然后直接推送：

```powershell
npm run verify            # 提交前总闸门：静态检查 + 自检 119 项 + 回归 8 套
git status --short        # 应为空
git log --oneline -5      # 确认要推的内容
```

`.gitignore` 已经屏蔽了 `electron/`、`node_modules/`、`dist/`、`release/`、`backups/`、`.tmp/`、`tmp/`、
`*.log`、`tools/smoke-*`；如果 `git status` 里看到这几类文件，先补 `.gitignore` 再提交。

## 2. 在 GitHub 上创建仓库

1. 新建 **public** 仓库，名字 `sisyphus-focus`。
   **不要**勾选 README / .gitignore / LICENSE 初始化 —— 本地已经有这三个，勾了会冲突。
2. 推送：

   ```powershell
   git branch -M main        # 可选：把 master 改名成 main
   git push -u origin main
   ```

3. **仓库描述**（GitHub 右上 About → Description，直接粘贴）：

   ```text
   西西弗斯 · 专注工作台：本地优先的 Windows 桌面专注工具（今日事任务管理 + 字符海专注钟）。零网络请求、零遥测、零运行时依赖。
   ```

4. **Topics**（About → Topics，逐个添加）：

   ```text
   electron  productivity  pomodoro  focus-timer  todo-app  task-manager
   local-first  offline  privacy  no-telemetry  windows-desktop  vanilla-js
   ```

5. **勾选** About 里的 Releases（让下载入口显示在仓库首页）。

## 3. 仓库设置

| 设置 | 位置 | 建议值 |
|------|------|--------|
| Actions 权限 | Settings → Actions → General | Read and write（Release 工作流要建 Release） |
| 工作流默认权限 | Settings → Actions → General → Workflow permissions | Read repository contents；需要写时在 YAML 里显式声明（仓库里已用 `permissions: contents: write`） |
| Issues | Settings → General → Features | 开 |
| Discussions | 同上 | 可选。开了以后 `.github/ISSUE_TEMPLATE/config.yml` 里的 Discussions 链接才有内容 |
| Wiki / Projects | 同上 | 关（避免两套文档） |
| Dependabot alerts | Settings → Code security | 开（`dependabot.yml` 已经在仓库里，只会提 PR + 每月的 Actions 版本更新） |

### 3.1 分支保护（Settings → Rules → Rulesets，或 Branches → Branch protection）

对 `main` 建议：

- 勾 **Require a pull request before merging**（自己一个人开发时也可以先不勾，等有外部贡献者再开）
- 勾 **Require status checks to pass** → 选 **Windows Build / build**（就是 `.github/workflows/windows-build.yml` 那个 job）
- 勾 **Require branches to be up to date before merging**
- 不勾 force push 与分支删除

> 注意：`windows-build.yml` 只在 **PR 和手动触发**时跑（主分支 push 交给 `continuous-release.yml` 出滚动包），
> 所以分支保护里选它当必需检查不会拖慢主分支 push。

### 3.2 签名 secrets（可选，拿到证书后再配）

Settings → Secrets and variables → Actions → New repository secret：

| 名称 | 值 |
|------|----|
| `CSC_LINK` | 证书的 base64（或指向证书文件的 URL；Azure Trusted Signing 走另一条路，见 docs/release.md） |
| `CSC_KEY_PASSWORD` | 证书密码 |

配好之后，`release.yml` / `continuous-release.yml` 会自动签名，并且**签名失败会让流水线变红**
（没有配这两个 secret 时按未签名产物正常发布，不会因此失败）。

## 4. 发第一个版本

### 4.1 打 tag 触发 Release

```powershell
git tag -a v2.0.0 -m "2.0.0"
git push origin v2.0.0
```

- `.github/workflows/release.yml`（`on: push: tags: ['v*']`）会构建 portable + NSIS、
  跑门禁与打包一致性校验、附加 `SHA256SUMS.txt`，并创建 GitHub Release。
- 也可在 Actions 页面手动 `workflow_dispatch` 并填一个已存在的 tag。
- Release 说明由工作流用 `RELEASE_NOTES.md` + `generate_release_notes: true` 组合生成。

### 4.2 滚动包（可选保留）

`.github/workflows/continuous-release.yml` 会在每次 push 到主分支时更新 `continuous` tag 上的
滚动 Release（「最新代码的最新包」）。不想要这个行为就删掉这个工作流文件。

### 4.3 加 CI 徽章

仓库推上去、Actions 成功跑过一次之后，在 `README.md` 的 badge 区加一行（放在其他 badge 后面）：

```markdown
[![Windows Build](https://github.com/Stars76/sisyphus-focus/actions/workflows/windows-build.yml/badge.svg)](https://github.com/Stars76/sisyphus-focus/actions/workflows/windows-build.yml)
```

> 现在 README 里**故意没有**这个徽章：仓库还不存在时挂上去只会显示 broken。

## 5. 发布后自查

- [ ] `https://github.com/$owner/sisyphus-focus` → About 里有描述与 topics，Releases 显示下载入口
- [ ] Actions 里 `Windows Build`（PR 触发）与 `Continuous Release`（主分支触发）至少各成功一次
- [ ] 仓库 Insights → Community Standards 里 CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / issue 模板 / PR 模板**全部已识别**
- [ ] Release 附件里有 `Sisyphus-2.0.0-setup.exe`、`Sisyphus-2.0.0-portable.exe`、`SHA256SUMS.txt`
- [ ] 下载 portable 双击能跑，数据落在 `%APPDATA%\Sisyphus\sisy-store.json`
- [ ] `README.en.md` 与中文 README 互链能跳转；`docs/data.md#7-从-1x-手工迁移` 锚点不 404
- [ ] 占位符清零（应只剩本文件里作为示例/说明出现的 `OWNER`）：
      `Select-String -Path package.json,CONTRIBUTING.md,.github/ISSUE_TEMPLATE/config.yml -Pattern 'OWNER'`

## 6. 常见坑

| 现象 | 原因与处置 |
|------|-----------|
| `npm ci` 在 runner 上很慢或超时 | 仓库根 `.npmrc` 给本机配了国内镜像；CI 已经在 `npm ci` 上显式加了 `--registry=https://registry.npmjs.org`，别再删掉 |
| Release 工作流报权限不足 | Settings → Actions → Workflow permissions 需要允许写；YAML 里已有 `permissions: contents: write` |
| 构建报 winCodeSign 软链失败 | 本机（未开开发者模式）会出现，`build/win-build.ps1` 已自动降级；CI runner 上正常走完整路径 |
| 中文路径导致打包异常 | 本机构建时用 `build/win-build.ps1`，它会先把仓库镜像到 ASCII 临时目录再构建 |
| 首运行被 SmartScreen 拦 | 未签名产物的正常现象，README 已写明点「更多信息 → 仍要运行」；想彻底解决见 [docs/release.md](release.md#代码签名) |
