@echo off
echo Generating PolyTAS extension icons...
powershell -ExecutionPolicy Bypass -File "%~dp0generate_icons.ps1"
echo.
pause
