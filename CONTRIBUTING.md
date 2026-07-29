# Contributing

## Setup

```bash
npm install
npm run demo:prepare
npm run lint
npm test
npm run build
```

Use Node.js 26.4.0 or newer. Optional external services are not required for the test suite.

## Workflow

Create a focused branch, keep changes scoped, and follow existing module boundaries. Add tests proportional to the behavior changed. Pull requests should explain user impact, validation performed, and any project-schema compatibility considerations.

## Contributor Permission

Kr8 Studio is publicly licensed under AGPL-3.0-or-later and may also be offered
under separate commercial licenses. No binding Contributor License Agreement
has been approved.

Until the policy in
[`CONTRIBUTOR-LICENSE-AGREEMENT-DECISION.md`](CONTRIBUTOR-LICENSE-AGREEMENT-DECISION.md)
is resolved, maintainers should not merge substantial external code
contributions intended to participate in dual licensing. Opening an issue or
pull request does not create an assignment or broad relicensing grant.

## Code and Test Data

- Use JavaScript modules and the existing local helpers.
- Preserve unknown project fields and stable IDs.
- Use temporary directories and fake credentials in tests.
- Do not include protected music, personal projects, private covers, exports, tokens, cookies, OAuth downloads, AI models, or ComfyUI output.
- Keep demo assets small, original, and explicitly redistributable.

## Process Safety

Never use a global Node.js termination command. Tests and scripts must stop only the PID or child-process handle they started. Do not alter global Node, npm, Python, Rust, FFmpeg, browser, or operating-system configuration.

## Issues

Provide OS, GPU, Node version, Kr8 version, export mode, reproduction steps, and sanitized logs. A minimal synthetic `.kr8` project is preferred.
