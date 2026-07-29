# Instagram Publisher 0.1

Kr8 Studio publishes the latest valid Reel export to a preconfigured Instagram Professional account. Instagram is a third isolated publish provider; it does not modify the TikTok or YouTube implementations and it never writes provider data into `project.json`.

## Flow

```text
latest valid Kr8 Reel MP4
  -> provider-specific ffprobe validation
  -> authenticated streaming upload to your private HTTPS media bridge
  -> opaque temporary HTTPS media URL
  -> Instagram media container
  -> processing poll
  -> media_publish
  -> final media id and permalink
  -> bridge cleanup
  -> local size and SHA-256 verification
```

The bridge is a deployable component in `bridge/instagram-media-bridge/`. It is not assumed to run on the local Kr8 machine.

## Configuration

`Validate Instagram account` rereads the `INSTAGRAM_*` values from the configured env file. When the access token was replaced there, Kr8 discards an older cached Instagram session and validates the new token without requiring a full editor restart. If a locally refreshed long-lived token is still valid and the env token has not changed, the refreshed session remains preferred.

Normal editor startup resolves its credential file to the repository-root `.env.local`. An explicit `--env <path>` remains authoritative for Server Mode and alternate deployments; a missing CLI override no longer falls through to an unrelated `.env` in the working directory.

Kr8 reads these backend-only values from `.env.local`:

```text
INSTAGRAM_USER_ID
INSTAGRAM_ACCESS_TOKEN
INSTAGRAM_APP_ID
INSTAGRAM_APP_SECRET
INSTAGRAM_BRIDGE_TOKEN
INSTAGRAM_BRIDGE_URL=https://media-bridge.example.com
INSTAGRAM_GRAPH_VERSION=v23.0
```

The Graph version is configurable so a VPS or local installation can move versions deliberately. No value is sent to the frontend, project files, Reel metadata, logs, or test snapshots. `INSTAGRAM_BRIDGE_TOKEN` must equal the bridge VPS `BRIDGE_AUTH_TOKEN`.

Instagram does not use OAuth inside Kr8 in this phase. `Validate Instagram account` inspects the configured token and fetches the account id, username, display name, and profile image when available. Meta's Facebook Graph `IG User` node does not consistently expose `account_type`; successful access to the configured IG User is therefore reported as `Professional`, while provider/API permissions remain authoritative. `Clear local Instagram session state` removes only cached validation/profile data. It never changes `.env.local`.

The configured token uses the Instagram API with Facebook Login. Its required permissions are:

- `pages_show_list`
- `instagram_basic`
- `instagram_content_publish`
- `pages_read_engagement`

`business_management` may also be present but is not required by Kr8's publishing flow. Replacing `INSTAGRAM_ACCESS_TOKEN` in `.env.local` requires restarting only the Kr8 server process because environment values are loaded at process startup. No global Node.js process termination is needed.

`INSTAGRAM_BRIDGE_URL` accepts either a full HTTPS URL or a bare hostname such as `media-bridge.example.com`; Kr8 normalizes the latter to HTTPS. Non-loopback plain HTTP URLs, credentials embedded in URLs, query strings, and fragments are rejected before publishing.

Manual refresh stores a replacement long-lived token atomically in the separate local Instagram credential store. It does not rewrite `.env.local`. Automatic refresh is deliberately disabled during development.

## Reel Rules

- MP4 only in the Kr8/bridge pipeline
- H.264 or HEVC video
- AAC when audio exists
- 23-60 fps
- maximum 1 GB
- technical duration 3 seconds through 15 minutes
- caption up to 2200 characters
- optional Share to Feed
- explicit public-publish confirmation

Above 3 minutes 30 seconds Kr8 shows the editorial recommendation warning and requires `Publish anyway`. It does not trim or transcode the video.

## Story Rules

- MP4 only
- maximum 60 seconds, enforced as a hard block
- no caption is sent
- no trimming, segmentation, or transcoding
- the configured Professional account and Meta permissions remain authoritative
- explicit public-publish confirmation

## Bridge Security

The bridge accepts only authenticated raw `video/mp4` uploads with a valid `Content-Length`. It validates size, MIME, optional SHA-256, and the MP4 `ftyp` signature. Uploads are written privately and renamed atomically only after successful validation.

Public media paths contain a 256-bit random token and no original filename. They support GET, HEAD, and byte ranges for Meta fetch. There is no listing endpoint. Cleanup creates a short-lived tombstone so removed and expired URLs return HTTP 410. Failed and interrupted uploads are removed, and an expiry sweep handles abandoned media.

The supplied Nginx deployment disables access logging under `/m/` so opaque URL tokens are not recorded by the recommended proxy configuration. Port 8787 should remain bound to loopback; only Nginx exposes HTTPS.

Deployment details are in `bridge/instagram-media-bridge/README.md`.

## State And Cancellation

UI states are `Validating`, `Uploading to bridge`, `Waiting for Meta fetch`, `Processing`, `Publishing`, `Cleaning up`, `Published`, `Failed`, and `Cancelled`.

Cancellation is accepted through container processing. Immediately before `media_publish`, the job becomes irreversible and cancellation is rejected instead of pretending that a published post was undone. Cleanup is attempted after success, error, timeout, and cancellation.

Retries apply only to network errors, timeouts, HTTP 429, HTTP 5xx, and temporary processing. Authentication, permission, account type, media, and Story duration errors are permanent.

## Verification Status

Automated tests use fake credentials, mocked Meta responses, temporary credential stores, local bridge servers, and temporary files. They cover configuration, account and token validation, Reel/Story policy, metadata, container/poll/publish, permalink, refresh, cancellation, local-file integrity, bridge authentication, opaque URLs, Range/HEAD, expiry, cleanup, rate limiting, traversal defense, MP4-only validation, and interrupted uploads.

The remaining manual verification is an explicitly confirmed publish of a short Reel, followed later by a Story below 60 seconds. Check permalink, caption, Share to Feed, bridge cleanup, local hash, and secret-free logs after each publish.
