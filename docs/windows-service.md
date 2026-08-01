# Advanced Windows unattended deployment

## Not the Public Default

Kr8 Studio does not install a Windows service automatically. The normal public setup runs as the logged-in user and binds to `127.0.0.1`. The scripts in `deploy/windows/` exist only for a private installation that must operate before login.

Running Node and Chromium as `SYSTEM` increases impact if the application or a media parser is compromised. Prefer a dedicated least-privileged service account or normal user startup whenever pre-login access is unnecessary.

## Required Security Layout

The advanced installer refuses to create a SYSTEM task unless:

- `-AcknowledgeSystemServiceRisk` is supplied explicitly;
- the executable checkout is below `C:\Program Files`;
- executable files receive read/execute-only ACLs for the installing user;
- projects, Publisher data, logs, PID state, and configuration are placed below ACL-restricted `C:\ProgramData\Kr8 Studio`;
- external binding is separately enabled with `-AllowExternalBinding`.

Do not point SYSTEM at a checkout under a user profile, Downloads, Desktop, or another user-writable directory. Install dependencies and verify the build before locking the executable directory ACL.

## Safe Loopback Installation

From an elevated PowerShell, with the repository already installed under `C:\Program Files\Kr8 Studio\app`:

```powershell
cd 'C:\Program Files\Kr8 Studio\app'
.\deploy\windows\install-kr8-service.ps1 `
  -AcknowledgeSystemServiceRisk `
  -MigratePublisherCredentials `
  -StartAfterInstall
```

This remains bound to `127.0.0.1`. It is suitable for a same-machine reverse proxy or local automation.

## Private VPN Binding

For a VPN-only interface, first configure exact origins in the protected service environment file:

```text
KR8_TRUSTED_ORIGINS=https://kr8.private.example
KR8_AUTH_USER=kr8
KR8_AUTH_PASSWORD=a-long-unique-password
```

Then install with explicit network acknowledgement:

```powershell
.\deploy\windows\install-kr8-service.ps1 `
  -AcknowledgeSystemServiceRisk `
  -ListenHost '0.0.0.0' `
  -AllowExternalBinding `
  -EnvironmentFile 'C:\secure-staging\kr8-service.env' `
  -StartAfterInstall
```

Restrict TCP 5174 to the trusted VPN interface and authorized peers in Windows Firewall. Never port-forward it from the public internet. Binding to `0.0.0.0` is not access control.

## Data and Credentials

Defaults are:

```text
C:\ProgramData\Kr8 Studio\projects
C:\ProgramData\Kr8 Studio\publish
C:\ProgramData\Kr8 Studio\runtime
C:\ProgramData\Kr8 Studio\config\.env.local
```

The optional credential migration copies only known Publisher store files and never reads or prints their contents. `-EnvironmentFile` is also opt-in and copies the file into the protected configuration directory. OAuth reconnect still needs an interactive logged-in browser; a SYSTEM process cannot display one on the user's desktop.

## Operations

```powershell
.\deploy\windows\status-kr8-service.ps1
.\deploy\windows\restart-kr8-service.ps1
.\deploy\windows\stop-kr8-server.ps1
.\deploy\windows\uninstall-kr8-service.ps1
```

Stop and restart scripts act only on the recorded PID after verifying that it is the expected Kr8 Node command. They never terminate Node globally. Uninstall preserves service data unless an explicit removal switch is supplied.

## Manual Verification

1. Confirm `npm test`, `npm run lint`, and `npm run build` before installation.
2. Confirm the task account and executable ACLs with `Get-ScheduledTask` and `icacls`.
3. Confirm `127.0.0.1:5174` is the only listener for a loopback installation.
4. For VPN mode, test that non-VPN clients cannot connect and untrusted Host/Origin values receive 4xx responses.
5. Reboot without logging in and verify `/api/health` through the intended private path.
