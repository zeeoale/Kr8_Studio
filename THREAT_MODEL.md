# Kr8 Studio Threat Model

## Scope

This model covers the public Kr8 Studio Node server, browser editor, local projects, export pipeline, Publisher credential store, and optional advanced Windows deployment. Third-party services, TKMusic, ComfyUI, Ollama, social platforms, and the Instagram media bridge retain their own security boundaries.

## Default Trust Model

The default user is the logged-in desktop user. Kr8 listens on `127.0.0.1`, reads projects only from an approved root, and serves one local browser session. Other processes running as the same operating-system user are trusted at the OS boundary; Kr8 is not a sandbox against malware already executing as that user.

## Assets to Protect

- local audio, covers, lyrics, video, and exports;
- Publisher OAuth tokens and provider credentials;
- project integrity and preset libraries;
- local filesystem paths outside approved Kr8 roots;
- execution of FFmpeg, FFprobe, Chromium, and platform folder-open commands.

## Considered Attackers

- a malicious website opened in the user's browser;
- a crafted `.kr8` project or imported media filename;
- a remote network client when Kr8 is explicitly bound externally;
- a low-privilege local user on a machine running the advanced SYSTEM task;
- malformed metadata in render history or Reel files.

## Primary Controls

- loopback-only default binding with no server-mode exception;
- exact Host and Origin checks plus Fetch Metadata rejection for cross-site requests;
- no permissive CORS and no cookie-based application session;
- GET routes remain read-only;
- canonical root enforcement using resolved paths and real existing ancestors;
- rejection of absolute, drive, UNC, mixed-separator traversal, encoded traversal, and double-encoded traversal where relative identifiers are required;
- server-managed project roots and relative project IDs;
- allowlisted child-process commands with argument arrays rather than shell interpolation;
- advanced SYSTEM deployment requires protected code and separated mutable data.

## CSRF and Local API Authentication Decision

The public localhost application does not add a local bearer token. A browser-readable bootstrap token would share the same origin boundary already enforced by Host and Origin checks, while adding storage and disclosure risks. Same-origin browser writes include an allowed Origin. Browser writes with Fetch Metadata but no Origin, cross-site requests, null/untrusted origins, and malformed Host values are rejected. Direct non-browser clients without Origin remain supported because they are not a browser-CSRF vector.

When Kr8 is exposed through a trusted VPN or reverse proxy, configure exact `KR8_TRUSTED_ORIGINS` and authentication. This remains a personal single-user service, not a public multi-tenant application.

## Context-Specific Risks

- Basic Auth over plain HTTP exposes credentials; use TLS or a trusted encrypted VPN.
- A SYSTEM task has broad OS access. Use it only when pre-login operation is required and keep code non-writable by normal users.
- FFmpeg, Chromium, font parsers, and media codecs process untrusted input and may contain upstream vulnerabilities.
- A process running under the same desktop account can directly read that user's projects and credential store.
- Symlink/junction checks reduce root escape but cannot prevent every race if a privileged local actor changes filesystem links concurrently.

## Out of Scope

- defending a compromised administrator/SYSTEM account;
- multi-user authorization and tenant isolation;
- public internet hosting without a hardened reverse proxy;
- vulnerabilities inside external provider APIs or optional AI services.
