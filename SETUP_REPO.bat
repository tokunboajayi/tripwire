@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0setup_repo.ps1" %*
pause
