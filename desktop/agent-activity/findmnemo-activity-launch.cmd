@echo off
if "%~1"=="--deliver" goto deliver
start "" /b "%ComSpec%" /d /c call "%~f0" --deliver "%~1" "%~2"
exit /b 0

:deliver
start "" /b "%~dp0..\..\FindMnemo Companion.exe" --activity-hook --adapter "%~2" --safe-event-base64 "%~3"
exit /b 0
