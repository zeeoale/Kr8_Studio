# Focused security audit - 2026-08

## Confirmed Vulnerabilities

1. `GET /api/project?path=` accepted arbitrary absolute filesystem paths when no projects root was configured. It was replaced with a read-only GET plus `POST /api/project/open` using a root-relative identifier.
2. Project asset resolution accepted traversal and absolute paths from project JSON. Asset access now uses canonical project-root validation.
3. The editor had no Host or Origin validation in the localhost profile, leaving DNS-rebinding and browser-CSRF exposure. Exact local/trusted Host and Origin checks plus Fetch Metadata validation were added.
4. Several export/Reel metadata paths used lexical prefix checks and did not account for symlink/junction escapes. They now share canonical root enforcement.
5. Server mode implicitly changed the fallback bind to `0.0.0.0`. All modes now default to `127.0.0.1`; external binding must be explicit.

## Private-Script False Positives

The public `npm start` flow did not install or run a SYSTEM service. The existing SYSTEM Scheduled Task and hardcoded external bind belonged to a private unattended deployment helper. They were not evidence that the public default ran as SYSTEM, but their defaults were unsafe if a public user invoked the helper without understanding its context.

## Context-Dependent Risks

- External binding remains supported for trusted VPN/reverse-proxy installations and requires explicit host/origin/firewall configuration.
- SYSTEM deployment remains supported only as an acknowledged advanced option with protected code and separated data.
- Media parsing and headless rendering depend on the security of current FFmpeg and Chromium builds.
- A same-user local process remains inside the default desktop trust boundary.

## Authentication Decision

No localhost API token was added. Loopback binding, strict Host/Origin validation, Fetch Metadata checks, and non-GET mutation routes provide the intended browser boundary without creating a browser-readable token lifecycle. External deployments must add authentication and network isolation.

## Remaining Limitations

- Kr8 remains a personal single-user application, not a multi-tenant service.
- Canonical path checks cannot eliminate all filesystem time-of-check/time-of-use races against an already privileged local attacker.
- The advanced SYSTEM flow should be manually validated on a clean Windows machine before release packaging.

## Validation

- `npm test`: 312 tests passed, 0 failed.
- `npm run lint`: passed, including syntax checks for the new security modules.
- `npm run build`: passed.
- `npm run audit:public`: passed with no known credentials, private paths, or unexpected large files.
- All public Windows deployment scripts passed PowerShell parser validation.
- Exploit tests cover traversal (plain, mixed separator, encoded and double encoded), absolute/UNC paths, symlink or junction escape, malicious Host/Origin, cross-site browser writes, and external-bind opt-in.
