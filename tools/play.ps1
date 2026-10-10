<#
.SYNOPSIS
Build the Web game and start the local API and website. Keep this PowerShell window open until it finishes.
#>
param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $nodeVersion = (& node --version | Out-String).Trim()
    if ($nodeVersion -notmatch '^v24\.') { throw "Node.js 24.x is required; found $nodeVersion." }
    if (-not $SkipInstall) {
        & npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & (Join-Path $PSScriptRoot 'build.ps1') -Target Web
    & (Join-Path $PSScriptRoot 'stop.ps1')
    & (Join-Path $PSScriptRoot 'start.ps1') -OpenBrowser
} finally { Pop-Location }
