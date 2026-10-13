param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$runtimePath = Join-Path $projectRoot 'runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $name = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "Env:$name" -Value $value
  }
}

# Base Devnet config, then optional Helius override for CHAIN_RPC_URL only.
Import-DotEnv (Join-Path $runtimePath 'devnet-chain.env')
Import-DotEnv (Join-Path $runtimePath 'helius.local.env')

# Prefer a keyless public Devnet RPC that works from China networks.
# Official api.devnet.solana.com is often DNS-hijacked here; mango rpcpool works for curl/browser.
if (-not $env:CHAIN_PUBLIC_RPC_URL -or $env:CHAIN_PUBLIC_RPC_URL -match 'api\.devnet\.solana\.com') {
  $env:CHAIN_PUBLIC_RPC_URL = 'https://mango.devnet.rpcpool.com'
}
# Server RPC: keep Helius keyed URL if present; else same public RPC.
if (-not $env:CHAIN_RPC_URL -or $env:CHAIN_RPC_URL -match 'api\.devnet\.solana\.com') {
  if ($env:HELIUS_API_KEY) {
    $env:CHAIN_RPC_URL = "https://devnet.helius-rpc.com/?api-key=$($env:HELIUS_API_KEY)"
  } else {
    $env:CHAIN_RPC_URL = $env:CHAIN_PUBLIC_RPC_URL
  }
}
# Browser/CSP must be keyless. Official Solana RPC is DNS-hijacked on many CN networks;
# Helius without api-key returns 401. mango works for curl/browser (Node UA is blocked).
$env:CHAIN_PUBLIC_RPC_URL = 'https://mango.devnet.rpcpool.com'

$env:CHAIN_ENABLED = 'true'
$env:CHAIN_NETWORK = 'devnet'
$env:TRUSTED_PROXY_IPS = '127.0.0.1'
$env:SERVE_FORWARD_CLIENT_IP = '1'
$env:PORT = '9782'
$env:HOST = '127.0.0.1'
$env:WEB_PORT = '9783'
$env:API_PORT = '9782'
if (-not $env:TRAVEL_DURATION_MS) { $env:TRAVEL_DURATION_MS = '45000' }

# Rewrite Linux-style issuer path if present.
if ($env:CHAIN_ISSUER_KEYPAIR_PATH -and $env:CHAIN_ISSUER_KEYPAIR_PATH -notmatch '^[A-Za-z]:') {
  $env:CHAIN_ISSUER_KEYPAIR_PATH = (Join-Path $projectRoot 'runtime\devnet-keys\issuer.json')
}
if (-not $env:CHAIN_ISSUER_KEYPAIR_PATH) {
  $env:CHAIN_ISSUER_KEYPAIR_PATH = (Join-Path $projectRoot 'runtime\devnet-keys\issuer.json')
}

Write-Host "PixelPets Devnet start: rpc=$($env:CHAIN_RPC_URL -replace 'api-key=[^&]+','api-key=REDACTED') public=$($env:CHAIN_PUBLIC_RPC_URL)"

try { & (Join-Path $PSScriptRoot 'stop.ps1') } catch { Write-Host 'stop.ps1: no prior processes' }

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
for ($attempt=0; $attempt -lt 60; $attempt++) {
    try {
      $live = Invoke-RestMethod -Uri 'http://127.0.0.1:9783/api/v1/live' -TimeoutSec 2
      if ($live.ok -and $live.data.service -eq 'pixel-pets') { $ready=$true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'Local services did not become live. Inspect runtime/api.err.log and runtime/web.err.log.' }

Write-Host 'PixelPets travel Devnet is ready: http://127.0.0.1:9783/'
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:9783/api/v1/health' -TimeoutSec 90
  Write-Host ('health ok=' + $health.ok)
} catch { Write-Host ('health check soft-fail: ' + $_.Exception.Message) }
try {
  $cfg = Invoke-RestMethod -Uri 'http://127.0.0.1:9783/api/v1/chain/config' -TimeoutSec 90
  Write-Host ('chain enabled=' + $cfg.data.enabled + ' reason=' + $cfg.data.reason + ' rpc=' + $cfg.data.rpc_url)
} catch { Write-Host ('chain/config soft-fail: ' + $_.Exception.Message) }
if ($OpenBrowser) { Start-Process 'http://127.0.0.1:9783/' }
