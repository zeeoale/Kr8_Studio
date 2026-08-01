# Kr8 Server Mode 0.1

Kr8 Server Mode is a private self-hosted mode for a personal VPS. It is not a public multi-user platform.

The current recommended deployment is:

- Kr8 Studio Node server behind Nginx/Caddy or a private VPN.
- Chromium headless for `Headless MP4`.
- FFmpeg for MP4 encoding.
- TKMusic installed on the same VPS when using `TKMusic ID` import.
- One headless export at a time.

## VPS Profile

For an IONOS VPS with 4 vCPU, 4 GB RAM, and 120 GB SSD:

- the editor UI should be fine;
- 1080p exports are supported, but full-song renders may be slower than realtime;
- `libx264` is the expected encoder unless the VPS exposes an NVIDIA GPU;
- keep `KR8_HEADLESS_EXPORT_CONCURRENCY=1`;
- add swap to reduce crash risk during long renders.

## Environment

Copy `.env.server.example` to `.env.server` and edit values:

```bash
cp .env.server.example .env.server
```

Important variables:

```bash
KR8_SERVER_MODE=1
KR8_HOST=127.0.0.1
KR8_PORT=5174
KR8_TRUSTED_ORIGINS=https://kr8.example.com
KR8_AUTH_USER=kr8
KR8_AUTH_PASSWORD=change-me
KR8_PROJECTS_ROOT=/srv/kr8/projects
KR8_DEFAULT_PROJECT=/srv/kr8/projects/blank.kr8/project.json
KR8_TKMUSIC_LIBRARY_ROOT=/srv/tkmusic/data/library/suno
KR8_FFMPEG_PATH=/usr/bin/ffmpeg
KR8_BROWSER_PATH=/usr/bin/chromium
KR8_INTERNAL_ORIGIN=http://127.0.0.1:5174
KR8_CHROME_NO_SANDBOX=0
KR8_HEADLESS_EXPORT_CONCURRENCY=1
KR8_MAX_UPLOAD_MB=512
```

Use a real password and keep `.env.server` out of git.

`KR8_INTERNAL_ORIGIN` is the URL used by Chromium headless during server-side exports. On a VPS behind Nginx, keep it pointed at the local Kr8 listener so the worker does not depend on the public domain or proxy auth path.

`KR8_CHROME_NO_SANDBOX=1` is available for restricted containers only. Leave it disabled for a normal VPS whenever Chromium can start without it.

Headless exports are rendered with an export clock instead of the interactive audio player. The audio element is kept paused in the worker, so Linux audio/autoplay behavior cannot stall frame generation.

Create the first blank project in the persistent projects root:

```bash
mkdir -p /srv/kr8/projects/blank.kr8
cp examples/blank.kr8/project.json /srv/kr8/projects/blank.kr8/project.json
```

## TKMusic Requirement

Kr8 core is provider-agnostic, but the current workflow still relies on TKMusic as the first source provider. For `TKMusic ID` import on a VPS:

1. Install or clone TKMusic on the VPS.
2. Sync or generate its local library on the VPS.
3. Set `KR8_TKMUSIC_LIBRARY_ROOT` to the TKMusic Suno library folder.

Example:

```bash
KR8_TKMUSIC_LIBRARY_ROOT=/srv/tkmusic/data/library/suno
```

Kr8 does not modify the TKMusic library during import. It creates `.kr8` projects under `KR8_PROJECTS_ROOT`.

## Start

```bash
npm run server
```

The server command is:

```bash
node --dns-result-order=ipv4first src/editor/server.js --server --env .env.server
```

For a public VPS IP, keep Kr8 bound to `127.0.0.1` and expose it through a protected reverse proxy or VPN.

`--server` still defaults to `127.0.0.1`; it never implies external binding. For private-network deployment, bind only to the required interface and enforce exact `KR8_TRUSTED_ORIGINS`, authentication, and restrictive firewall rules. Do not expose the development server directly to the public internet.

## Health

The lightweight health endpoint is:

```text
GET /api/health
```

`GET /api/server/health` remains as a compatibility alias for the earlier server-mode plan. Health responses are not protected by Basic Auth, contain no paths or secrets, and use `Cache-Control: no-store`.

## Nginx Sketch

```nginx
server {
  listen 443 ssl;
  server_name kr8.example.com;

  client_max_body_size 512m;

  location / {
    proxy_pass http://127.0.0.1:5174;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Kr8 also has built-in Basic Auth when `KR8_AUTH_USER` and `KR8_AUTH_PASSWORD` are set. A VPN or reverse proxy auth is still preferred for personal VPS use.

## Export Queue

Server Mode limits headless exports with:

```bash
KR8_HEADLESS_EXPORT_CONCURRENCY=1
```

If another export is running, the API returns `409`. This is intentional for small VPS machines.

## Current Limitations

- Not designed for public multi-user access.
- No account system.
- No export retention cleanup yet.
- No systemd unit is generated yet.
- No automated TKMusic installation.
- No GPU/NVENC setup for cloud servers.

## Suggested Next Server Step

Kr8 Server Mode 0.2 should add:

- `systemd` unit example;
- export cleanup/retention;
- visible server status panel;
- optional project browser rooted at `KR8_PROJECTS_ROOT`.
