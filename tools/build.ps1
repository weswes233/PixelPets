param([ValidateSet('Web','Windows','All')][string]$Target = 'All')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$gamePath = Join-Path $projectRoot 'game'
$godotCommand = Get-Command Godot_v4.5.2-stable_win64_console.exe -ErrorAction SilentlyContinue
if (-not $godotCommand) { $godotCommand = Get-Command godot -ErrorAction SilentlyContinue }
if (-not $godotCommand) { throw 'Godot 4.5.2 is required. Set it on PATH before building.' }
$runtimePath = Join-Path $projectRoot 'runtime'
$legacyTemplates = Join-Path (Split-Path -Parent $projectRoot) 'Oddsprout\runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
foreach ($template in @('web_nothreads_release.zip','web_nothreads_debug.zip','windows_release_x86_64.exe')) {
    $destination = Join-Path $runtimePath $template
    if (-not (Test-Path -LiteralPath $destination)) {
        $source = Join-Path $legacyTemplates $template
        if (-not (Test-Path -LiteralPath $source)) { throw "Missing Godot 4.5.2 export template: $template" }
        Copy-Item -LiteralPath $source -Destination $destination
    }
    if ((Get-Item -LiteralPath $destination).Length -lt 1000000) { throw "Invalid template: $template" }
}
$presets = @'
[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
include_filter="*.json,*.txt"
exclude_filter="tests/*"
export_path="../dist/web/index.html"
[preset.0.options]
custom_template/debug="../runtime/web_nothreads_debug.zip"
custom_template/release="../runtime/web_nothreads_release.zip"
variant/extensions_support=false
variant/thread_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=false
html/canvas_resize_policy=2
html/focus_canvas_on_start=true
html/experimental_virtual_keyboard=false
progressive_web_app/enabled=false

[preset.1]
name="Windows Desktop"
platform="Windows Desktop"
runnable=true
export_filter="all_resources"
include_filter="*.json,*.txt"
exclude_filter="tests/*"
export_path="../dist/windows/PixelPets.exe"
[preset.1.options]
custom_template/debug=""
custom_template/release="../runtime/windows_release_x86_64.exe"
binary_format/embed_pck=true
texture_format/s3tc_bptc=true
codesign/enable=false
application/modify_resources=false
'@
Set-Content -LiteralPath (Join-Path $gamePath 'export_presets.cfg') -Value $presets -Encoding utf8
& $godotCommand.Source --headless --path $gamePath --editor --import
if ($LASTEXITCODE -ne 0) { throw 'Godot import failed.' }
if ($Target -in @('All','Web')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'dist\web') | Out-Null
    & $godotCommand.Source --headless --path $gamePath --export-release Web (Join-Path $projectRoot 'dist\web\index.html')
    if ($LASTEXITCODE -ne 0) { throw 'Godot Web export failed.' }
    & node (Join-Path $PSScriptRoot 'build-web.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Wallet bundle failed.' }
}
if ($Target -in @('All','Windows')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'dist\windows') | Out-Null
    & $godotCommand.Source --headless --path $gamePath --export-release 'Windows Desktop' (Join-Path $projectRoot 'dist\windows\PixelPets.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Godot Windows export failed.' }
}
Write-Host 'PixelPets build completed. Run tools/start.ps1 for the local services.'
