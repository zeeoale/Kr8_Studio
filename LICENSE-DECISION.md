# License Decision

## Approved Model

Kr8 Studio uses a dual-license model.

Public source-code license:

```text
GNU Affero General Public License v3.0 or later
SPDX-License-Identifier: AGPL-3.0-or-later
```

The official, unmodified AGPL-3.0 text is in `LICENSE`.

The copyright holder reserves the right to offer separate commercial licenses
for proprietary use, closed-source integration, white-label distribution,
hosted services, enterprise deployment, and other uses that do not want to
comply with AGPL obligations.

The AGPL permits commercial use. The separate commercial option does not reduce
the rights available to users who comply with the AGPL.

## Scope

- Source code is AGPL-3.0-or-later unless a file states otherwise.
- Commercial rights require a separate written agreement.
- Brand names, logos, character identity, promotional artwork, screenshots, and
  demo media are not automatically licensed by the source-code license.
- Third-party dependencies retain their upstream licenses.
- User-imported and generated media retain their own terms.

See:

- `COMMERCIAL-LICENSE.md`
- `TRADEMARKS.md`
- `ASSET-LICENSE.md`
- `NOTICE`

## Contributor Constraint

Dual licensing requires sufficient permission from every relevant copyright
holder. No binding CLA has been approved. The project should not accept
substantial external contributions until the decision documented in
`CONTRIBUTOR-LICENSE-AGREEMENT-DECISION.md` is resolved.

## Dependency Compatibility

Current runtime dependencies are `mp4box` under BSD-3-Clause and `undici` under
MIT. Both are generally compatible with distribution of Kr8 Studio under the
AGPL when their notices and license terms are respected.

FFmpeg is an external executable whose license depends on the build selected by
the user. No FFmpeg binary is distributed in this repository.

