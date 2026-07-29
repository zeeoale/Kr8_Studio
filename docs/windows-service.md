# Kr8 Windows unattended service

## Decision

Kr8 runs at Windows boot through a Scheduled Task named `Kr8 Studio`, under the built-in `SYSTEM` service account, whether or not a user has logged on. This provides the required unattended behavior without adding NSSM, WinSW or another native wrapper.

`node.exe` cannot be registered directly with the Service Control Manager because it does not implement the Windows service control protocol. The Task Scheduler configuration is therefore the smallest built-in and reversible service host for the existing Node process.

The task:

- triggers at Windows startup after a short delay;
- runs as `SYSTEM` with no interactive login;
- starts one Kr8 instance on `0.0.0.0:5174`;
- uses `examples/blank.kr8/project.json` by default;
- restarts the launcher after a process failure;
- ignores duplicate task starts;
- records the exact Node PID in `kr8-editor.pid`;
- writes stdout and stderr under `logs/`;
- uses absolute Node, FFmpeg and Chrome paths.

## Publisher credentials

The `SYSTEM` account has a different profile from the desktop user and cannot use `%APPDATA%\Kr8 Studio\publish`. Service mode instead uses:

```text
C:\ProgramData\Kr8 Studio\publish
```

The installer can copy the existing TikTok, YouTube and Instagram credential records plus non-sensitive Publisher settings into that directory. Source files remain intact. It never prints or parses token contents. Directory ACLs grant access only to `SYSTEM`, Administrators and the installing user.

OAuth token refresh and normal publishing work from the service. Interactive reconnect flows should be performed while the user is logged into Windows; a `SYSTEM` process cannot display a browser in the user's desktop session. Existing migrated refresh tokens avoid requiring a login at boot.

## Install

Open PowerShell as Administrator and run:

```powershell
cd C:\Path\To\Kr8_Studio_Public
Set-ExecutionPolicy -Scope Process Bypass
.\deploy\windows\install-kr8-service.ps1 `
  -MigratePublisherCredentials `
  -ReplaceRunningInstance `
  -StartAfterInstall
```

The process-scoped execution policy does not modify global PowerShell configuration. The installer detects the current absolute FFmpeg path; use `-FfmpegPath` only if detection fails.

## Status

```powershell
.\deploy\windows\status-kr8-service.ps1
```

Expected values are `Installed: True`, `TaskState: Running`, `ProcessMatchesKr8: True`, a listener PID, and `Health: ok`.

The same endpoint can then be checked over WireGuard:

```text
http://127.0.0.1:5174/api/health
```

## Controlled stop

```powershell
.\deploy\windows\stop-kr8-server.ps1
```

The script reads `kr8-editor.pid`, verifies that the PID is a Node process running `src/editor/server.js` on port 5174, and only then stops that PID. It never terminates Node globally.

To start it again:

```powershell
Start-ScheduledTask -TaskName 'Kr8 Studio'
```

For the normal controlled restart, use an elevated PowerShell:

```powershell
.\deploy\windows\restart-kr8-service.ps1
```

From a regular PowerShell window, the same restart can request elevation through UAC:

```powershell
Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "C:\Path\To\Kr8_Studio_Public\deploy\windows\restart-kr8-service.ps1"'
```

This validates and stops only the PID recorded for Kr8, then restarts the installed task. `logs\kr8-service-runtime.json` records only non-secret runtime paths and the service account for diagnostics.

## Verified installation

Local validation completed on 2026-07-22:

- task installed and running as `NT AUTHORITY\SYSTEM` with `ServiceAccount` logon;
- boot trigger and `ServiceMode` enabled;
- recorded PID matched the process listening on `0.0.0.0:5174`;
- `/api/health` returned `status: ok`;
- the default project was `examples/blank.kr8/project.json`;
- the shared Publisher store resolved to `C:\ProgramData\Kr8 Studio\publish`;
- TikTok, YouTube and Instagram connection summaries were available from service mode;
- all 213 automated tests passed;
- `npm run check` passed;
- every PowerShell deployment script parsed successfully.

No global Node process termination is used by install, stop, restart or uninstall. The remaining acceptance check is the no-login reboot described below.

## Uninstall

From an elevated PowerShell:

```powershell
.\deploy\windows\uninstall-kr8-service.ps1
```

Publisher credentials are preserved by default. Removing them requires the separate explicit `-RemovePublisherData` switch.

## Boot acceptance test

1. Verify the task and health locally.
2. Restart Windows without logging in.
3. Wait for WireGuard and the configured startup delay.
4. From an authorized private-network client, request the configured `/api/health` URL.
5. From the phone, confirm TK Workstation Remote turns Kr8 green and opens `/mobile`.
6. Confirm the current project is the blank project and the Publisher provider summary can be read.

The unattended requirement is complete only after this no-login reboot test.
