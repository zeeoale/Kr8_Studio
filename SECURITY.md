# Security Policy

## Supported Versions

Security fixes target the latest source version on the default branch. No stable release line exists yet.

## Reporting a Vulnerability

Use a private GitHub security advisory for the repository. Until advisories are available, contact the maintainer through a private channel already known to project collaborators. Do not put credentials, private media, tokens, project files, or working exploit details in a public issue.

Include the affected commit/version, operating system, deployment mode, a minimal sanitized reproduction, and logs with paths and secrets removed.

## Public Security Boundary

- `npm start`, `npm run dev`, and `npm run server` default to `127.0.0.1`.
- `--server` does not imply `0.0.0.0`.
- The HTTP server validates Host, Origin, and Fetch Metadata. It emits no permissive CORS headers.
- Browser state changes use non-GET methods. Cross-site browser requests are rejected.
- Project selection is rooted at `KR8_PROJECTS_ROOT` and uses a relative project identifier.
- Project assets, Reel inputs, render metadata, and exports are checked against canonical roots, including symlink/junction resolution.
- Publisher tokens and `.env.local` stay outside project files and version control.

Kr8 does not use a local API token in the localhost-only build. A token delivered to the same browser would not improve the intended boundary enough to justify secret lifecycle and bootstrap complexity. Loopback binding plus Host/Origin/Fetch Metadata validation addresses local DNS-rebinding and browser-CSRF threats. Non-browser tools may omit Origin; they still need direct access to the listening socket and must pass Host validation.

## External Binding

External binding is an advanced, explicit configuration. Set `KR8_HOST` and exact comma-separated `KR8_TRUSTED_ORIGINS`, then use a trusted VPN or authenticated reverse proxy and restrictive firewall rules. Built-in Basic Auth is available but is not a substitute for TLS or network isolation. Never expose Kr8 directly to the public internet.

## Windows SYSTEM Deployment

The public setup does not install a service. The advanced scheduled-task installer under `deploy/windows/` requires explicit acknowledgement and refuses SYSTEM execution from a checkout outside `Program Files`. Executable code is read-only for the installing user; projects, logs, PID state, credentials, and optional environment configuration live under ACL-restricted `ProgramData` directories. Prefer a dedicated least-privileged service account when unattended pre-login execution is not required.

## Operational Notes

- Treat imported media and project JSON as untrusted.
- Keep Node.js, Chromium, FFmpeg, and FFprobe current.
- Keep Ollama and ComfyUI on trusted local interfaces.
- The Instagram bridge must be HTTPS-only, MP4-only, bearer-token protected, and separately hardened.
- Review [THREAT_MODEL.md](THREAT_MODEL.md) and [docs/windows-service.md](docs/windows-service.md) before network or service deployment.
