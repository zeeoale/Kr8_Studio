# Kr8 Instagram Media Bridge

Optional private deployment component that exposes one temporary MP4 to Meta over HTTPS. It accepts only authenticated `video/mp4` uploads, uses opaque public URLs, supports byte ranges, and removes media after publishing or TTL expiry.

## Requirements

- Node.js 26.4.0 or newer
- A TLS-terminating reverse proxy
- A dedicated unprivileged account

Copy `.env.example` to `.env`, set a public HTTPS hostname and generate a long random `BRIDGE_AUTH_TOKEN`. Put the same token in Kr8 Studio as `INSTAGRAM_BRIDGE_TOKEN`. Never commit either populated environment file.

```bash
node --env-file=.env src/server.js
```

The service listens on `127.0.0.1:8787` by default. Keep that port private and expose only the HTTPS reverse proxy. Adapt `deploy/nginx.example.conf` to your hostname and certificate setup.

## API

- `GET /health`: public health check without sensitive data.
- `POST /v1/media`: authenticated raw MP4 upload with required `Content-Length`.
- `GET|HEAD /m/{opaque-token}`: temporary public media with byte-range support.
- `DELETE /v1/media/{id}`: authenticated cleanup.

The default limit is 1 GB and the default TTL is one hour. The service does not log credentials, original filenames, request bodies, or public media tokens. Restrict or redact reverse-proxy access logs for `/m/`.

## Service Managers

Use either the supplied systemd unit or PM2, never both for the same process. The deployment examples assume `/opt/kr8-instagram-media-bridge`; edit those paths if you choose another location.

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
```
