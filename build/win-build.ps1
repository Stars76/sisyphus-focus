# Sisyphus - Windows build script. ASCII-only source on purpose:
# Windows PowerShell 5.1 decodes no-BOM files as ANSI, so keep this file ASCII.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build\win-build.ps1
#     -SkipTests            skip test gates (debug only)
#     -Targets "portable"   choose targets (default: "portable nsis")
#
# Notes:
#   * electron-builder may hit EPERM / extraction issues under non-ASCII
#     project paths; this script mirrors sources to an ASCII temp dir first.
#   * winCodeSign contains macOS dylib symlinks; extracting them on Windows
#     without Developer Mode fails (7za exit 2). That only affects rcedit
#     exe icon/version metadata embedding, so we fall back to
#     --config.win.signAndEditExecutable=false and still produce runnable
#     artifacts. Real signing/icons belong on CI or a permitted host.
#   * Code signing is opt-in: export CSC_LINK + CSC_KEY_PASSWORD before running
#     (or use Azure Trusted Signing via build\sign-azure.json) and the artifacts
#     come out signed; without them the build stays unsigned and says so.
#     build\check-signature.ps1 re-reports the status of each artifact afterwards.

param(
    [switch]$SkipTests,
    [string]$Targets = 'portable nsis',
    [string]$ElectronDist = ''
)

$ErrorActionPreference = 'Stop'

function Test-AsciiPath($p) { return $p -match '^[\x00-\x7F]+$' }

$repo = Split-Path -Parent $PSScriptRoot
Write-Host "== Sisyphus Windows build =="
Write-Host "repo: $repo"

Push-Location $repo
try {
    if (-not $SkipTests) {
        Write-Host "-- gate: node tools/check-syntax.js"
        node tools/check-syntax.js;  if ($LASTEXITCODE) { throw "check-syntax failed" }
        Write-Host "-- gate: node tools/check-links.js"
        node tools/check-links.js;   if ($LASTEXITCODE) { throw "check-links failed" }
        Write-Host "-- gate: node tools/selftest.js"
        node tools/selftest.js;      if ($LASTEXITCODE) { throw "selftest failed" }
        Write-Host "-- gate: node tests/run-all.js"
        node tests/run-all.js;       if ($LASTEXITCODE) { throw "regression tests failed" }
    }

    if (-not (Test-Path (Join-Path $repo 'node_modules/electron-builder'))) {
        Write-Host "-- installing build deps (registry from .npmrc mirror)"
        $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
        npm install --no-audit --no-fund
        if ($LASTEXITCODE) { throw "npm install failed" }
    }

    # Mirror to an ASCII build dir when the repo path is non-ASCII
    $buildDir = $repo
    if (-not (Test-AsciiPath $repo)) {
        $buildDir = Join-Path $env:TEMP ('sisyphus-build-' + [guid]::NewGuid().ToString('N'))
        Write-Host "-- non-ASCII repo path; mirroring sources to $buildDir"
        New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
        $exclude = @('.git', '.tmp', 'electron', 'backups', 'release', 'node_modules')
        Get-ChildItem $repo -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
            Copy-Item $_.FullName -Destination $buildDir -Recurse -Force
        }
        if (Test-Path (Join-Path $repo 'node_modules')) {
            cmd /c "mklink /J `"$buildDir\node_modules`" `"$($repo.TrimEnd('\'))\node_modules`"" | Out-Null
        }
    }

    $runtimeArgs = @()
    if ($ElectronDist) { $runtimeArgs = @("--config.electronDist=$((Resolve-Path -LiteralPath $ElectronDist).Path)") }
    $fallback = @()
    if ($env:SISYPHUS_SKIP_RCEDIT -eq '1') { $fallback = @('--config.win.signAndEditExecutable=false') }

    Push-Location $buildDir
    # Native stderr under $ErrorActionPreference='Stop' becomes a terminating
    # error in PowerShell; electron-builder/npm chatter on stderr must not do that.
    $ErrorActionPreference = 'Continue'
    try {
        foreach ($t in ($Targets -split '\s+' | Where-Object { $_ })) {
            Write-Host "-- electron-builder --win $t"
            $out = & npx --no-install electron-builder --win $t @runtimeArgs @fallback 2>&1
            $out | ForEach-Object { "$_" } | Write-Host
            $code = $LASTEXITCODE
            if ($code -ne 0 -and ($out -join "`n") -match 'winCodeSign|symbolic link|Cannot create symlink' -and $fallback.Count -eq 0) {
                Write-Host "  winCodeSign symlink issue (no Developer Mode); retrying with signAndEditExecutable=false"
                & npx --no-install electron-builder --win $t @runtimeArgs '--config.win.signAndEditExecutable=false'
                $code = $LASTEXITCODE
            }
            if ($code -ne 0) { throw "electron-builder ($t) failed, exit=$code" }
        }
        $releaseSrc = Join-Path $buildDir 'release'
    } finally { Pop-Location }

    $releaseDst = Join-Path $repo 'release'
    if ($releaseSrc -ne $releaseDst) {
        if (-not (Test-Path $releaseDst)) { New-Item -ItemType Directory -Force -Path $releaseDst | Out-Null }
        Copy-Item (Join-Path $releaseSrc '*.exe') $releaseDst -Force
        if (Test-Path (Join-Path $releaseSrc '*.yml')) { Copy-Item (Join-Path $releaseSrc '*.yml') $releaseDst -Force }
    }
    # 把“本次构建”的 app.asar 落盘到 release/current-build，供 check-asar-runtime.js
    # 核对打包内容与当前源码一致（抓「新文件没被打进包 / 构建产物过期」这类问题）
    $curr = Join-Path $releaseDst 'current-build'
    New-Item -ItemType Directory -Force -Path $curr | Out-Null
    Copy-Item (Join-Path $releaseSrc 'win-unpacked\resources\app.asar') (Join-Path $curr 'app.asar') -Force
    if (Test-Path (Join-Path $releaseSrc 'builder-debug.yml')) { Copy-Item (Join-Path $releaseSrc 'builder-debug.yml') $curr -Force }
    if (Test-Path (Join-Path $releaseSrc 'builder-effective-config.yaml')) { Copy-Item (Join-Path $releaseSrc 'builder-effective-config.yaml') $curr -Force }
    node tools/check-asar-runtime.js (Join-Path $curr 'app.asar')
    if ($LASTEXITCODE) { throw "Packaged runtime differs from source" }
    Write-Host "-- artifacts"
    $exes = Get-ChildItem $releaseDst -Filter *.exe
    if (-not $exes) { throw "no artifacts in release\" }
    $signing = if ($env:CSC_LINK) { 'enabled (CSC_LINK present)' } else { 'disabled (no CSC_LINK; artifacts will be unsigned)' }
    Write-Host "   code signing: $signing"
    foreach ($e in $exes) {
        $h = (Get-FileHash -Algorithm SHA256 $e.FullName).Hash
        $sig = Get-AuthenticodeSignature -LiteralPath $e.FullName
        $sigText = if ($sig.Status -eq 'Valid') { 'signed: ' + $sig.SignerCertificate.Subject } else { 'signature: ' + $sig.Status }
        Write-Host ("  {0}  {1:N1} MB  sha256:{2}" -f $e.Name, ($e.Length / 1MB), $h)
        Write-Host ("    {0}" -f $sigText)
        if ($env:CSC_LINK -and $sig.Status -ne 'Valid') { throw "CSC_LINK was set but $($e.Name) is not validly signed ($($sig.Status))" }
    }
    Write-Host "BUILD OK"
} finally { Pop-Location }
