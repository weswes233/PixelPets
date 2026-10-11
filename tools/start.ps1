param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $projectRoot 'runtime\node\node.exe'
$nodeExecutable = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$nodeVersion = (& $nodeExecutable --version | Out-String).Trim()
if ($nodeVersion -notmatch '^v24\.') { throw 'PixelPets requires Node.js 24. Use the portable release or install Node.js 24.' }
foreach ($asset in @('index.html', 'index.wasm', 'index.pck')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot ('dist\web\' + $asset)))) { throw 'The game export is missing. Use the complete portable release, or build the game first.' }
}
$runtimePath = Join-Path $projectRoot 'runtime'
$apiPort = if ($env:API_PORT) { [int]$env:API_PORT } else { 9782 }
$webPort = if ($env:WEB_PORT) { [int]$env:WEB_PORT } else { 9783 }
if ($apiPort -lt 1024 -or $apiPort -gt 65535 -or $webPort -lt 1024 -or $webPort -gt 65535 -or $apiPort -eq $webPort) { throw 'Choose two different ports between 1024 and 65535.' }
$env:PORT = [string]$apiPort
$env:API_PORT = [string]$apiPort
$env:WEB_PORT = [string]$webPort
$playUrl = 'http://127.0.0.1:' + $webPort + '/'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
$processes = @()
foreach ($service in @(
    @{Name='api'; Port=$apiPort; Script='server\src\index.ts'},
    @{Name='web'; Port=$webPort; Script='tools\serve.ts'}
)) {
    $listener = Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
        if (-not $running.CommandLine -or -not $running.CommandLine.Contains($projectRoot)) { throw "Port $($service.Port) is already used by another application." }
        $processes += @{Name=$service.Name; Pid=$running.ProcessId}
        continue
    }
    $scriptPath = Join-Path $projectRoot $service.Script
    $compiledPath = [IO.Path]::ChangeExtension($scriptPath, '.mjs')
    if (Test-Path -LiteralPath $compiledPath) { $scriptPath = $compiledPath }
    $process = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $scriptPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath ($service.Name + '.out.log')) -RedirectStandardError (Join-Path $runtimePath ($service.Name + '.err.log'))
    $processes += @{Name=$service.Name; Pid=$process.Id}
}
$processes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'processes.json') -Encoding utf8
$ready = $false
for ($attempt=0; $attempt -lt 60; $attempt++) {
    try {
        # Local services must bypass a system/browser proxy, including on Windows PowerShell 5.
        $healthRequest = [Net.HttpWebRequest]::Create($playUrl + 'api/v1/health')
        $healthRequest.Proxy = $null
        $healthRequest.Timeout = 2000
        $healthResponse = $healthRequest.GetResponse()
        try {
            $healthReader = [IO.StreamReader]::new($healthResponse.GetResponseStream())
            try { $health = $healthReader.ReadToEnd() | ConvertFrom-Json } finally { $healthReader.Dispose() }
        } finally { $healthResponse.Dispose() }
        if ($health.ok -and $health.data.service -eq 'pixel-pets') { $ready=$true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'Local services did not become healthy. Inspect runtime/api.err.log and runtime/web.err.log.' }
Write-Host ('PixelPets is ready: ' + $playUrl)
if ($OpenBrowser) { Start-Process $playUrl }
