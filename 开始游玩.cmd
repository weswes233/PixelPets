@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start.ps1" -OpenBrowser
if errorlevel 1 pause
