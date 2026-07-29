# YouTube Publisher 0.1

## Scope

Kr8 Studio can send the latest valid Reel export directly to YouTube without copying or transcoding it:

```text
latest valid exports/reels video
  -> ffprobe validation
  -> YouTube desktop OAuth
  -> resumable Data API v3 upload
  -> optional thumbnail
  -> processing status polling
  -> Open on YouTube
```

YouTube determines whether a video is classified as a Short. Kr8 does not expose a separate Short option.

The Publish UI shows a non-blocking warning when the selected source is 9:16 and longer than three minutes. The upload remains available, but Kr8 explains that YouTube will handle the file as a regular video rather than place it in the Shorts feed. Exactly three minutes does not trigger the warning.

Official references:

- [OAuth 2.0 for installed applications](https://developers.google.com/identity/protocols/oauth2/native-app)
- [YouTube resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- [Videos insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Videos resource and processing details](https://developers.google.com/youtube/v3/docs/videos)
- [Custom thumbnails](https://developers.google.com/youtube/v3/docs/thumbnails/set)

## Configuration

Backend-only variables in `.env.local`:

```dotenv
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
```

Kr8 checks only that both values exist and are non-empty. Values are never returned to the frontend, written to a `.kr8` project, copied to documentation, or included in normal logs.

The OAuth client must be a Google desktop application. When the Google Auth Platform project is in Testing, the Google account that owns the target channel must be listed under `Audience -> Test users`. Otherwise Google stops the flow with `403 access_denied` before the local callback is reached. The consent-screen application name comes from the Google Cloud project, not from Kr8.

Minimum scopes required by the implemented workflow:

```text
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube.readonly
https://www.googleapis.com/auth/youtube.force-ssl
```

`youtube.upload` authorizes the transfer. `youtube.readonly` is required for `channels.list` and reliable post-upload status/privacy reads. `youtube.force-ssl` is required by `videos.update`; Kr8 uses it only to confirm the selected altered/synthetic-content disclosure on the video it has just uploaded. Kr8 does not delete videos or modify unrelated existing videos.

The callback server binds to `127.0.0.1`, uses an OS-selected ephemeral port and the exact `/youtube/callback/` path, verifies a random OAuth `state`, and uses PKCE S256. It closes after success, denial, cancellation, or timeout.

## Credentials

YouTube credentials are stored separately from TikTok:

- Windows: `%APPDATA%\Kr8 Studio\publish\youtube-token.json`
- Linux/macOS: `$XDG_CONFIG_HOME/Kr8 Studio/publish/youtube-token.json` or `~/.config/Kr8 Studio/publish/youtube-token.json`

The store contains access token, refresh token, expiry, granted scopes, and cached channel display data. Access tokens refresh automatically before expiry. Disconnect attempts revocation and removes only the YouTube token file. TikTok credentials remain untouched.

## Metadata

The YouTube form provides:

- required title, maximum 100 characters;
- description, maximum 5000 characters;
- comma-separated tags;
- requested privacy: `private`, `unlisted`, or `public`;
- category, default Music (`10`);
- made-for-kids declaration, default no;
- AI-generated or meaningfully altered realistic content disclosure, default yes for Kr8's AI-oriented workflow;
- optional JPG or PNG thumbnail, maximum 2 MB.

The provider selector uses an explicitly dark native select and option palette, with a bounded popup width. This keeps TikTok and YouTube readable under the Windows/Chrome native dropdown rendering instead of inheriting light text over a light popup.

The upload request sends `snippet` and `status` metadata, including `status.containsSyntheticMedia`. After media transfer, Kr8 confirms the disclosure with a narrowly scoped `videos.update` while preserving the video's existing writable status values. The UI never assumes that requested privacy or disclosure was accepted: privacy comes from `videos.list`, while disclosure comes from the successful `videos.update` response and may be refreshed by `videos.list` when Google includes that optional field. Uploads made by some unverified API projects can be forced to Private.

## Resumable Transfer

Kr8 initializes `uploadType=resumable` and sends the local file in 8 MiB chunks. Chunk sizes are multiples of 256 KiB. Every request contains exact content length and byte range headers.

Network errors and HTTP 408, 429, 500, 502, 503, or 504 are retried with bounded exponential backoff. Before retransmission, Kr8 queries the session with `Content-Range: bytes */TOTAL` and resumes from the byte acknowledged in the server `Range` response. Permanent 4xx responses are not retried. Cancel aborts the active request and never deletes or edits the source Reel.

Progress reports acknowledged bytes, percentage, transfer rate, ETA, retry count, and the processing phase. After transfer, Kr8 polls the video resource until processing succeeds, fails, or reaches the bounded wait timeout.

## Architecture

```text
src/publish/
  providerContract.js
  publishService.js
  credentialStore.js
  oauthCallback.js
  providers/
    tiktok/
    youtube/
      metadata.js
      resumableUpload.js
      youtubeClient.js
      youtubeProvider.js
```

`PublishService` selects a registered provider by name. Token storage, connection jobs, upload jobs, cancellation and error redaction use common boundaries. API calls and provider metadata stay inside the provider directory.

## OAuth From The Windows Service

Kr8 may run as a Windows startup task under `SYSTEM`, which has no interactive desktop and therefore cannot open Chrome in the signed-in user's session. The OAuth providers publish their HTTPS authorization URL into the short-lived connection job. The Publish UI opens a blank authorization tab directly from the user's `Connect` click, navigates it as soon as the backend callback listener is ready, and exposes an `Open authorization page` fallback when the browser blocks popups. Client secrets, authorization codes and tokens are never returned by the endpoint.

The desktop OAuth redirect still uses an ephemeral `127.0.0.1` callback. Connect or reconnect YouTube from `http://127.0.0.1:5174/publish/index.html` on the Windows workstation. Once the refresh token is stored, publishing and status checks can be controlled from the mobile interface. Starting the first OAuth login in a phone browser would redirect to the phone's own loopback address rather than the workstation.

## Verification

Automated tests use fake credentials, temporary token stores, temporary media, local callback servers and mocked API responses. They cover configuration, OAuth, PKCE, refresh, channel normalization, metadata, privacy, thumbnail transfer, resumable recovery, retry policy, cancellation, secret isolation and all existing TikTok tests.

Real test checklist:

1. Add the channel owner as a Google OAuth test user when the project is in Testing.
2. Open `http://127.0.0.1:5174/publish/index.html` and select YouTube.
3. Connect Google and confirm the channel shown by Kr8.
4. Select `Private`, provide a title and upload the short valid Reel.
5. Confirm effective privacy is reported as Private and open the returned YouTube link.
6. Verify codec, duration and metadata in YouTube Studio.
7. Compare source file hash and size before and after upload.
8. Check server logs for absence of client secrets, access tokens and refresh tokens.

Real integration diagnostics on 2026-07-20 confirmed four configuration boundaries: the account must be an approved OAuth test user; the client ID and secret must come from the same Desktop credential JSON; `youtube.upload` alone cannot read channel or processing state; and it cannot call `videos.update` to confirm the altered/synthetic-content disclosure. The provider therefore requests the three capability-specific scopes documented above. Failed authorization attempts created no upload and persisted no usable token.

The altered/synthetic-content increment was verified against a processed Private test upload. YouTube accepted `status.containsSyntheticMedia: true` in the authenticated `videos.update` response while preserving Private privacy, standard YouTube licensing, embedding, public statistics visibility and the made-for-kids declaration. A subsequent `videos.list` response omitted the optional disclosure field; Kr8 therefore retains the explicit boolean returned by the successful update and only replaces it when a later API response contains another explicit boolean. The full automated suite passed `170/170`, including all TikTok regression tests. No credential or token was written to a project, log or Reel file.

The Windows service OAuth fix was verified on July 24, 2026 with Kr8 running as the `SYSTEM` startup task. The live endpoint returned an HTTPS Google authorization URL, the loopback callback accepted a controlled denial, the connection job completed without exposing a secret, and the Publish UI showed its fallback link only while the callback was active. The focused Publisher/OAuth suite passed `27/27`. The repository-wide suite passed `220/221`; its one unrelated failure is the official-site title assertion while that public title is being revised for Google application-name verification.
