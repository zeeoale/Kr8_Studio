# Security Policy

## Supported Versions

Security fixes currently target the latest source version on the default branch. No stable release line exists yet.

## Reporting

Do not disclose credentials, private media, access tokens, project files, or exploitable details in a public issue. Use a private GitHub security advisory after the repository is published. Until then, contact the maintainer through a private channel already known to project collaborators.

Include a minimal reproduction, affected version, operating system, and sanitized logs. Never attach protected music or a populated `.env`.

## Security Notes

- Treat imported media as untrusted and keep FFmpeg/FFprobe updated.
- Bind the editor to loopback by default.
- Server mode requires authentication and network access controls.
- Keep publisher credential stores and `.env.local` outside version control.
- Project and upload paths must remain within configured roots; report any path traversal.
- Optional Ollama and ComfyUI endpoints should stay on trusted networks.
- The Instagram bridge must be behind HTTPS, accept only MP4, and use a strong bearer token.
