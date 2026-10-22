@echo off
setlocal
chcp 65001 >nul
title CyrusAsha_UniversalRTL-1.0.0 - Control Panel
pushd "%~dp0.."
if errorlevel 1 goto :bad_dir

echo.
echo  ==========================================
echo    CyrusAsha_UniversalRTL-1.0.0 - Control Panel
echo  ==========================================
echo.

if not exist "%~dp0..\src\gui\server.js" goto :bad_layout

where node >nul 2>nul
if errorlevel 1 goto :no_node

echo  Starting... your browser opens automatically.
echo  Press Ctrl+C to stop the server.
echo.
node "%~dp0..\src\gui\server.js" --open %*
set "EXITCODE=%ERRORLEVEL%"
echo.
echo  Server stopped (exit code %EXITCODE%).
popd
pause
exit /b %EXITCODE%

:no_node
echo  Node.js was not found on this computer.
echo.
echo  Option 1 (easiest, no Node.js needed):
echo      use the portable build and run Start.bat:
echo      release\windows\CyrusAsha_UniversalRTL-*-win-x64.zip
echo.
echo  Option 2: install Node.js LTS from
echo      https://nodejs.org/en/download
echo  then run this file again.
echo.
popd
pause
exit /b 1

:bad_layout
echo  This launcher must stay inside the project folder.
echo  Expected file not found:
echo      %~dp0..\src\gui\server.js
echo.
popd
pause
exit /b 1

:bad_dir
echo  Could not open the project folder: %~dp0..
echo.
pause
exit /b 1
