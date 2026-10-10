param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = (& $nodeExecutable --version | Out-String).Trim()
if ($nodeVersion -notmatch '^v24\.') { throw "Node.js 24.x is required; found $nodeVersion." }
foreach ($asset in @('index.html', 'index.js', 'index.wasm', 'index.pck', 'bridge.js', 'wallet.css')) {
    $file = Join-Path $projectRoot ("dist\web\" + $asset)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -eq 0) {
        throw "Game export is incomplete: missing $asset. Run tools/build.ps1 -Target Web before starting."
    }
}
$runtimePath = Join-Path $projectRoot 'runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
$processes = @()
foreach ($service in @(
    @{Name='api'; Port=9782; Script='server\src\index.ts'},
    @{Name='web'; Port=9783; Script='tools\serve.ts'}
)) {
    $listener = Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
        if (-not $running.CommandLine.Contains($projectRoot)) { throw "Port $($service.Port) is already used by another application." }
        $processes += @{Name=$service.Name; Pid=$running.ProcessId}
        continue
    }
    $scriptPath = Join-Path $projectRoot $service.Script
    $process = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $scriptPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath ($service.Name + '.out.log')) -RedirectStandardError (Join-Path $runtimePath ($service.Name + '.err.log'))
    $processes += @{Name=$service.Name; Pid=$process.Id}
}
$processes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'processes.json') -Encoding utf8
$ready = $false
for ($attempt=0; $attempt -lt 30; $attempt++) {
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:9783/api/v1/health' -TimeoutSec 2; if ($health.ok -and $health.data.service -eq 'pixel-pets') { $ready=$true; break } } catch {}
    Start-Sleep -Milliseconds 250
}
if (-not $ready) { throw 'Local services did not become healthy. Inspect runtime/api.err.log and runtime/web.err.log.' }
$page = Invoke-WebRequest -Uri 'http://127.0.0.1:9783/' -UseBasicParsing -TimeoutSec 5
if ($page.StatusCode -ne 200 -or -not $page.Content.Contains('/bridge.js')) { throw 'The game page is not ready. Inspect runtime/web.err.log and rebuild the Web export.' }
Write-Host 'PixelPets is ready: http://127.0.0.1:9783/'
if ($OpenBrowser) { Start-Process 'http://127.0.0.1:9783/' }
