# TikTok Sandbox Publisher 0.1

## Scope

Kr8 Studio supports one publishing destination in this increment:

```text
Reel Mode
  -> latest valid exports/reels video
  -> Publish window
  -> TikTok Login Kit for Desktop
  -> Content Posting API FILE_UPLOAD
  -> TikTok inbox draft
  -> final editing and publishing in the TikTok mobile app
```

This is not Direct Post. Kr8 requests only `user.info.basic` and `video.upload`. It does not request `video.publish` and does not expose privacy, Duet, Stitch, or comment settings.

Official references:

- [Login Kit for Desktop](https://developers.tiktok.com/doc/login-kit-desktop?enter_method=left_navigation)
- [User access token management](https://developers.tiktok.com/doc/oauth-user-access-token-management?enter_method=left_navigation)
- [Get User Info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info/)
- [Upload a video as draft](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video?enter_method=left_navigation)
- [Media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)

## Configuration

Copy no values into source control. Fill only the ignored `.env.local` file:

```dotenv
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_ENV=sandbox
```

The safe template is `.env.example`. The backend loads `.env.local`; the Publish frontend receives only `configured`, environment, required scopes, connection state, display name, avatar URL, and media metadata.

Register this desktop redirect URI in the TikTok Sandbox app:

```text
http://127.0.0.1:*/tiktok/callback/
```

The callback server binds only to `127.0.0.1`, asks the OS for a free ephemeral port, accepts only `/tiktok/callback/`, verifies a cryptographically random `state`, and closes after success, denial, mismatch, cancellation, or timeout. The current TikTok desktop flow also requires PKCE; Kr8 sends an `S256` challenge and the verifier only during the backend token exchange.

The Kr8 launch scripts prefer IPv4 for outbound API calls because some dual-stack networks let Node's IPv6 connection attempt time out. The `--dns-result-order=ipv4first` flag applies only to the Kr8 Node process and does not modify Windows or global Node configuration.

## Token Storage

The codebase had no OS credential-store abstraction and Kr8 has no native dependencies. Version 0.1 therefore uses an isolated local JSON token store:

- Windows: `%APPDATA%\Kr8 Studio\publish\tiktok-token.json`
- Linux/macOS fallback: `$XDG_CONFIG_HOME/Kr8 Studio/publish/tiktok-token.json` or `~/.config/Kr8 Studio/publish/tiktok-token.json`

The containing directory is created with mode `0700` and the file with mode `0600` where the OS honors POSIX modes. Windows does not provide equivalent ACL enforcement through `chmod`; the file remains inside the current user's application-data directory, but it is plaintext at rest. A future OS keychain adapter can replace `LocalCredentialStore` without changing the provider or UI.

Tokens are never stored in `project.json`, `reel-mode.json`, browser storage, logs, or frontend responses. Disconnect attempts the official revoke endpoint and clears the local store even if remote revoke fails. Access tokens refresh automatically before expiry, including refresh-token rotation.

TikTok desktop authorization uses its documented PKCE variant: the verifier is 43-128 unreserved characters and the SHA-256 challenge is encoded as 64 lowercase hexadecimal characters. This differs from the standard Base64URL challenge used by YouTube, so each provider owns its PKCE encoding.

The shared Publisher HTTP transport uses IPv4 with a 30-second connection timeout. This accommodates Windows DNS lookups that can exceed Undici's 10-second default for `open.tiktokapis.com` without weakening OAuth validation or changing request timeouts after the connection is established.

When Kr8 runs as the Windows `SYSTEM` startup task, the backend cannot open a visible browser window. The provider therefore returns its HTTPS authorization URL through the temporary connection job and the Publish UI opens the TikTok authorization page from the user's original `Connect` gesture. A manual authorization link remains visible if popups are blocked. Secrets and tokens stay server-side.

TikTok's current desktop callback uses the workstation loopback interface. Connect or reconnect from `http://127.0.0.1:5174/publish/index.html` on Windows; the stored credentials can then be used by the remote/mobile controls.

## Media Selection And Validation

Publish does not accept a path supplied by the browser. The backend selects the newest valid `kr8-reel-render-metadata` document under the current project's `exports/reels/` directory and verifies that its video still exists inside that directory.

Before every upload, `ffprobe` confirms:

- readable MP4, MOV, or WebM file;
- a video track using H.264, H.265/HEVC, VP8, or VP9;
- both dimensions between 360 and 4096 pixels;
- frame rate between 23 and 60 fps;
- duration above zero and at most 10 minutes;
- file size at most 4 GB.

Kr8 never re-encodes an incompatible Reel during publication. The user receives a validation error and the local file remains unchanged.

## Upload Engine

The provider initializes `FILE_UPLOAD` with TikTok's inbox draft endpoint. It preserves the complete returned `upload_url`, including query parameters.

The default chunk target is 16 MiB, clamped to TikTok's 5-64 MiB range. Files smaller than the target are sent whole. For larger files, the remainder is merged into the final chunk according to TikTok's transfer rules. Each PUT uses exact `Content-Length` and `Content-Range` headers.

Network errors and HTTP 5xx responses retry the current chunk with bounded exponential backoff. Permanent 4xx responses do not retry blindly; HTTP 403 is reported as an expired upload URL and requires a new complete attempt. Progress includes confirmed bytes, average throughput, ETA, and retry count. Cancel aborts only the active upload request and never removes the Reel.

TikTok's inbox init endpoint does not accept a final caption. Kr8 therefore treats the field as a caption handoff: `Copy Caption` copies it explicitly, and clicking `Upload Draft` attempts the same clipboard copy while still in the user's click gesture. The upload request sends only supported draft fields. After delivery, the UI reminds the user to paste the caption in TikTok's mobile editor. Final caption editing still happens in the mobile app.

After TikTok approves the application and the `video.publish` scope, the planned next provider increment is an explicit mode selector: `Upload as Draft` keeps the current inbox flow, while `Direct Post` uses the separate publish endpoint and sends the caption plus TikTok-required creator, privacy, interaction and AI-content fields. The two modes must remain visibly distinct and must never silently substitute one endpoint for the other.

## Module Boundaries

```text
src/publish/
  config.js                 backend-only TikTok configuration
  credentialStore.js        token and non-sensitive settings stores
  security.js               state, PKCE, constant-time compare, redaction
  oauthCallback.js          temporary localhost callback server
  openBrowser.js            shell-free default browser launcher
  media.js                  latest Reel resolution and ffprobe validation
  chunks.js                 chunk plan, retry, progress, cancellation
  providerContract.js       common provider method contract
  publishService.js         provider-neutral orchestration
  providers/tiktok/
    tiktokClient.js         official OAuth/API HTTP calls
    tiktokProvider.js       connection, refresh, revoke, draft jobs

src/editor/public/publish/
  index.html
  publish.css
  publish.js
```

The provider contract separates connection state, connect/disconnect, media validation, upload, cancellation, and progress. TikTok remains isolated from the separately registered YouTube and Instagram providers.

## Sandbox Test

Automated tests use local callback servers, temporary files, in-memory stores, and mocked TikTok responses. They never contact TikTok or upload media.

For the real Sandbox test:

1. Fill `.env.local` locally without sharing its values.
2. Restart only the Kr8 Studio server.
3. Open a project with a short compatible Reel already exported.
4. Open Reel Mode and click `Publish`.
5. Click `Connect TikTok` and authorize the Sandbox account in the default browser.
6. Confirm the account display name/avatar appears after the callback.
7. Enter the caption handoff text, use `Copy Caption`, read the draft warning, and check the confirmation box.
8. Click `Upload Draft` and wait for `Uploaded`.
9. Open TikTok on the phone and use the inbox notification to continue editing and publish.
10. Confirm the local MP4 still exists and inspect logs for accidental secrets before recording the review video.

### Verified Sandbox run - 2026-07-20

- Login Kit Desktop completed through the ephemeral `127.0.0.1` callback with state and PKCE verification.
- Connected Sandbox account: `TKMusic`; granted scopes: `user.info.basic`, `video.upload`.
- Source: `far-away-tk-edit-kr8_reel_2.mp4`, H.264/AAC, 1920x1080, 30 fps, 3 seconds, 2,748,074 bytes.
- The real `FILE_UPLOAD` draft completed with status `uploaded`, zero retries, and a TikTok `publish_id` response.
- A follow-up call to `/v2/post/publish/status/fetch/` returned `SEND_TO_USER_INBOX`, `error.code=ok`, and no failure reason. Kr8 now polls this endpoint and only reports success after TikTok confirms inbox delivery.
- The source MP4 size and modification timestamp remained unchanged.
- Actual client secret, access token, and refresh token values were not found in project data, Reel metadata, backend logs, or the public context API.
- The first token exchange exposed a Node 26 dual-stack timeout: `curl -4` reached TikTok while Node `fetch` timed out. Kr8 launch scripts now use the process-local `--dns-result-order=ipv4first` flag; no system or global Node configuration was changed.
- The TikTok mobile notification arrived after a delay; the user opened the draft and completed the mobile publishing flow. The `Far Away (TK Edit)` Reel then appeared on the `TKMusic` profile, verifying the complete `Kr8 -> Sandbox API -> mobile inbox -> profile` chain. `SEND_TO_USER_INBOX` can precede visible mobile delivery, so the UI reports TikTok's API state without promising immediate notification timing.

## App Review Recording

Record one continuous flow:

1. Show Kr8 Studio with the intended project open.
2. Open Reel Mode.
3. Show the already exported Reel.
4. Click `Publish`.
5. Show fixed provider `TikTok` and `Upload as Draft`.
6. Show the automatically selected filename, duration, size, resolution, codec, and valid status.
7. Click `Connect TikTok`.
8. Show the genuine TikTok Login Kit authorization page.
9. Authorize and return to Kr8 automatically through the localhost callback.
10. Show the connected account display name and avatar.
11. Enter the caption handoff text and show `Copy Caption`.
12. Show the mandatory draft warning.
13. Check the explicit confirmation.
14. Click `Upload Draft`.
15. Show byte progress, speed, ETA, and any retry count.
16. Show the exact success message: `Draft uploaded successfully. Open TikTok on your phone and tap the inbox notification to continue editing and publish.`
17. Show the real TikTok mobile inbox notification and continue to the draft editing screen.

Do not describe the draft as already published and do not show secret configuration files or token storage during the recording.
