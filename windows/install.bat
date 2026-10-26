@echo off
rem Instalador do Dashboard Executivo - clique duas vezes neste arquivo.
rem Ele so chama o PowerShell (install.ps1) nesta mesma pasta, com permissao liberada so para este script.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
