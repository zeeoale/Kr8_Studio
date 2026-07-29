# Contributor Permission Decision

## Why a Decision Is Required

Kr8 Studio uses an AGPL public license while reserving the possibility of
separate commercial licenses. The copyright holder can offer different terms
only for code it owns or for which it has sufficient contributor permission.

If third-party contributions are accepted only under the AGPL, copyright in
those contributions normally remains with their authors. The project could
continue distributing the combined work under the AGPL, but might not be able
to include those contributions in a separate commercial license.

## Current Policy

No binding Contributor License Agreement (CLA) is created by this document.
Until an explicit contributor-permission policy is approved, the project should
not solicit or merge substantial external code contributions that are expected
to participate in dual licensing.

Documentation corrections, issue reports, test cases, and very small fixes
should still be reviewed for provenance and licensing before merge.

## Options to Decide

1. **No CLA, AGPL-only contributions**
   - simplest contributor flow;
   - contributors retain copyright;
   - commercial licensing can exclude third-party contributions or become
     impractical for the combined work.

2. **Copyright assignment**
   - contributors assign copyright to the project owner;
   - gives the owner broad relicensing control;
   - requires careful legal drafting and can discourage contributors.

3. **Broad inbound license**
   - contributors retain copyright but grant the project owner permission to
     relicense and offer commercial terms;
   - must define scope, patent rights, warranties, and revocation clearly;
   - requires an explicitly approved CLA.

4. **Developer Certificate of Origin plus separate consent**
   - a DCO confirms provenance but does not itself grant relicensing rights;
   - a separate commercial relicensing permission would still be needed.

## Required Next Decision

Before enabling substantial outside contributions:

- identify the legal copyright holder and commercial licensing entity;
- choose one of the inbound contribution models;
- obtain legal review of the exact terms;
- decide how contributors accept the terms and how acceptance is recorded;
- update `CONTRIBUTING.md` and the pull request template.

Do not present a checkbox, bot, or pull request statement as a CLA until the
actual agreement has been explicitly approved.

