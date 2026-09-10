# Sisyphus - Authenticode signature report for built artifacts.
#
# ASCII-only on purpose: Windows PowerShell 5.1 decodes no-BOM files as ANSI.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build\check-signature.ps1
#   powershell -ExecutionPolicy Bypass -File build\check-signature.ps1 -RequireSigned
#   powershell -ExecutionPolicy Bypass -File build\check-signature.ps1 -Path release\Sisyphus-2.0.0-setup.exe
#   npm run verify:signature
#
# Exit codes:
#   0  all artifacts are validly signed, or unsigned while -RequireSigned was NOT passed
#   1  an artifact has a broken/expired/untrusted signature, or -RequireSigned was passed and something is unsigned
#   2  no artifacts found to inspect
#
# Signing is opt-in: set CSC_LINK / CSC_KEY_PASSWORD (see docs/release.md) or use
# Azure Trusted Signing via build\sign-azure.json before building. Unsigned builds
# are expected today and are reported, not failed, unless -RequireSigned is used.

param(
    [string]$Path = '',
    [switch]$RequireSigned
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
if (-not $Path) { $Path = Join-Path $repo 'release' }

$files = @()
if (Test-Path -LiteralPath $Path -PathType Container) {
    $files = @(Get-ChildItem -LiteralPath $Path -Filter *.exe -File | Sort-Object Name)
} elseif (Test-Path -LiteralPath $Path -PathType Leaf) {
    $files = @(Get-Item -LiteralPath $Path)
}

if ($files.Count -eq 0) {
    Write-Host "no .exe found under $Path"
    if ($RequireSigned) { throw "no artifacts to verify" }
    exit 2
}

Write-Host "== Authenticode signature report =="
Write-Host "path: $Path"
Write-Host "requireSigned: $($RequireSigned.IsPresent)"
Write-Host ''

$failures = 0
$unsigned = 0
$signed = 0

foreach ($f in $files) {
    $sig = Get-AuthenticodeSignature -LiteralPath $f.FullName
    $status = [string]$sig.Status
    $sizeMb = [math]::Round($f.Length / 1MB, 1)
    $subject = ''
    $stamp = ''
    if ($sig.SignerCertificate) { $subject = $sig.SignerCertificate.Subject }
    if ($sig.TimeStamperCertificate) { $stamp = $sig.TimeStamperCertificate.Subject }

    if ($status -eq 'Valid') {
        $signed++
        Write-Host ("  [SIGNED]   {0}  {1} MB" -f $f.Name, $sizeMb)
        Write-Host ("             signer: {0}" -f $subject)
        if ($stamp) { Write-Host ("             timestamp: {0}" -f $stamp) }
    } elseif ($status -eq 'NotSigned') {
        $unsigned++
        Write-Host ("  [UNSIGNED] {0}  {1} MB" -f $f.Name, $sizeMb)
        if ($RequireSigned) { $failures++ }
    } else {
        $failures++
        Write-Host ("  [BROKEN]   {0}  {1} MB  status={2}" -f $f.Name, $sizeMb, $status)
        if ($sig.StatusMessage) { Write-Host ("             {0}" -f $sig.StatusMessage) }
    }
}

Write-Host ''
Write-Host ("signed={0}  unsigned={1}  broken={2}" -f $signed, $unsigned, $failures)

if ($unsigned -gt 0 -and $failures -eq 0) {
    Write-Host 'Unsigned artifacts are expected until a code signing certificate is configured.'
    Write-Host 'Windows SmartScreen will show "Unknown publisher" for them; verify integrity with SHA256SUMS.txt.'
    Write-Host 'To enable signing see docs/release.md (CSC_LINK / CSC_KEY_PASSWORD, or Azure Trusted Signing).'
}

if ($failures -gt 0) {
    if ($RequireSigned) {
        throw "$failures artifact(s) failed signature verification (or were unsigned while -RequireSigned was set)"
    }
    throw "$failures artifact(s) have a broken or untrusted signature"
}

exit 0
