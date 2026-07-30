@echo off
REM Earthlink edge agent — Windows (CMD / Task Scheduler)
REM Edit the set lines below, or set them in the environment before running.
REM
REM   set EARTHLINK_HUB=http://10.11.12.62:8080
REM   set EARTHLINK_HOST_ID=desktop-win
REM   set EARTHLINK_AGENT_TOKEN=change-me
REM   agents\run-windows.cmd

cd /d "%~dp0\.."

if "%EARTHLINK_HUB%"=="" (
  echo Set EARTHLINK_HUB=http://HUB_IP:8080
  exit /b 1
)

if "%EARTHLINK_HOST_ID%"=="" set EARTHLINK_HOST_ID=%COMPUTERNAME%
if "%EARTHLINK_POLL_MS%"=="" set EARTHLINK_POLL_MS=2000

echo [run-windows] hub=%EARTHLINK_HUB% hostId=%EARTHLINK_HOST_ID%
node agents\earthlink-agent.mjs
