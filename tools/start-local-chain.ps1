param(
    [switch]$RunContractTests,
    [switch]$RunServiceTests,
    [switch]$StopAfterTests
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runtimePath = Join-Path $projectRoot 'runtime'
$validatorExe = Join-Path $runtimePath 'agave-2.3.13\solana-release\bin\solana-test-validator.exe'
$keygenExe = Join-Path $runtimePath 'agave-2.3.13\solana-release\bin\solana-keygen.exe'
$adminPath = Join-Path $runtimePath 'chain-fixtures\local-admin.keypair.json'
$programPath = Join-Path $projectRoot 'chain\target\deploy\pixel_pets.so'
$corePath = Join-Path $runtimePath 'chain-fixtures\mpl_core.so'
foreach ($requiredPath in @($validatorExe, $keygenExe, $adminPath, $programPath, $corePath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Required local fixture is missing: $requiredPath" }
}
if ($RunContractTests -and $RunServiceTests) { throw 'Choose either -RunContractTests or -RunServiceTests, each requires an isolated fresh chain.' }
if ($StopAfterTests -and -not ($RunContractTests -or $RunServiceTests)) { throw '-StopAfterTests requires a test run.' }
foreach ($localPort in @(8899,8900,9900)) {
    if (Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $localPort is already in use. Existing processes and ledgers were left unchanged."
    }
}
$adminAddress = (& $keygenExe pubkey $adminPath).Trim()
if ($LASTEXITCODE -ne 0 -or $adminAddress -notmatch '^[1-9A-HJ-NP-Za-km-z]{32,44}$') { throw 'Could not read the disposable local admin public address.' }
$programAddress = (Get-Content -LiteralPath (Join-Path $projectRoot 'chain\idl\pixel_pets.json') -Raw | ConvertFrom-Json).address
$runId = 'validator-local-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6)
$runPath = Join-Path $runtimePath $runId
New-Item -ItemType Directory -Path $runPath | Out-Null
$ledgerPath = Join-Path $runPath 'ledger'
$configPath = Join-Path $runPath 'cli-config.yml'
@("json_rpc_url: http://127.0.0.1:8899", "websocket_url: ws://127.0.0.1:8900", "keypair_path: '$($adminPath.Replace("'", "''"))'", 'commitment: confirmed') | Set-Content -LiteralPath $configPath -Encoding utf8
$argumentValues = @('--log', '--config', $configPath, '--ledger', $ledgerPath, '--bind-address', '127.0.0.1', '--rpc-port', '8899', '--mint', $adminAddress, '--upgradeable-program', $programAddress, $programPath, $adminAddress, '--bpf-program', 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d', $corePath)
if ($argumentValues | Where-Object { $_ -match '["\r\n]' }) { throw 'Unsupported quote or newline in a process argument.' }
$arguments = ($argumentValues | ForEach-Object { '"' + $_ + '"' }) -join ' '
$previousLogSetting = $env:RUST_LOG
$env:RUST_LOG = 'warn'
try {
    $validatorProcess = Start-Process -FilePath $validatorExe -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runPath 'stdout.log') -RedirectStandardError (Join-Path $runPath 'stderr.log')
} finally { $env:RUST_LOG = $previousLogSetting }
$run = [ordered]@{ pid=$validatorProcess.Id; executable=$validatorExe; ledger=$ledgerPath; runPath=$runPath; rpc='http://127.0.0.1:8899'; version='2.3.13'; snapshotLimitation='Official Windows build stops when its first rooted snapshot needs symlink privilege. No security settings are modified.' }
function Save-Run {
    $run | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runPath 'process.json') -Encoding utf8
    $run | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runtimePath 'local-chain-process.json') -Encoding utf8
}
Save-Run
try {
    $ready = $false
    for ($attempt=0; $attempt -lt 120; $attempt++) {
        $validatorProcess.Refresh()
        if ($validatorProcess.HasExited) { throw "Local validator exited; inspect $runPath\stderr.log" }
        try {
            $reply = Invoke-RestMethod -Uri $run.rpc -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' -TimeoutSec 1
            if ($reply.result) {
                $health = Invoke-RestMethod -Uri $run.rpc -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":2,"method":"getHealth"}' -TimeoutSec 1
                $slot = Invoke-RestMethod -Uri $run.rpc -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":3,"method":"getSlot","params":[{"commitment":"confirmed"}]}' -TimeoutSec 1
                # Upgradeable programs preloaded in genesis are not invocable in slot 0.
                if ($health.result -eq 'ok' -and $slot.result -ge 2) { $run.genesis=$reply.result; $run.readySlot=$slot.result; $ready=$true; break }
            }
        } catch {}
        Start-Sleep -Milliseconds 100
    }
    if (-not $ready) { throw "Local validator did not become ready; inspect $runPath\stderr.log" }
    $run.readyAt=[DateTime]::UtcNow.ToString('o'); Save-Run
    Write-Host "Local validator ready. Genesis: $($run.genesis)"
    Write-Warning 'This official Windows build has a short snapshot-limited lifetime. Use this helper for immediate tests, not a persistent development service.'
    if ($RunContractTests -or $RunServiceTests) {
        $testName = if ($RunContractTests) { 'local-validator-e2e' } else { 'service-e2e' }
        $evidencePath = Join-Path $projectRoot ('chain\evidence\' + $testName + '.json')
        if (Test-Path -LiteralPath $evidencePath) {
            Copy-Item -LiteralPath $evidencePath -Destination (Join-Path (Split-Path -Parent $evidencePath) ($runId + '-' + $testName + '-previous.json'))
        }
        $previousRpc=$env:PIXELPETS_TEST_RPC; $previousGenesis=$env:PIXELPETS_EXPECTED_GENESIS; $previousAdmin=$env:PIXELPETS_TEST_ADMIN
        try {
            $env:PIXELPETS_TEST_RPC=$run.rpc; $env:PIXELPETS_EXPECTED_GENESIS=$run.genesis; $env:PIXELPETS_TEST_ADMIN=$adminPath
            & (Get-Command node -ErrorAction Stop).Source (Join-Path $projectRoot ('chain\tests\' + $testName + '.mjs'))
            $run.testExitCode=$LASTEXITCODE; Save-Run
            if ($run.testExitCode -ne 0) { throw "$testName integration tests failed: exit $($run.testExitCode)." }
        } finally {
            $env:PIXELPETS_TEST_RPC=$previousRpc; $env:PIXELPETS_EXPECTED_GENESIS=$previousGenesis; $env:PIXELPETS_TEST_ADMIN=$previousAdmin
        }
    }
} finally {
    if ($StopAfterTests) {
        $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$($validatorProcess.Id)" -ErrorAction SilentlyContinue
        if ($candidate -and $candidate.ExecutablePath -eq $validatorExe -and $candidate.CommandLine.Contains($ledgerPath)) {
            Stop-Process -Id $validatorProcess.Id -ErrorAction Stop
            $run.stoppedAt=[DateTime]::UtcNow.ToString('o'); Save-Run
        }
    }
}
