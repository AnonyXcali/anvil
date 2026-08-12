# Validation Failure Policy

==== STATUS: evolving ====

This reference documents which failures currently stop Anvil workflows and the
implemented milestone-based repair behavior. It remains evolving, but the
classification below describes the current runtime rather than a proposal.

## Current behavior: strict safety with bounded repair

The edit workflow remains strict for contracts, safety, staging, remote
integrity, commit, and rollback. Selected verifier and CSS findings are
repairable when a persisted staging transaction exists; affected files stay
local while safe files may commit.

```text
search or planning contract failure
→ no usable edit plan

staging preparation failure
→ no remote commit

edit or verification failure
→ no upload for the affected workflow

project validation failure
→ no coordinated commit

remote hash or target-state conflict
→ no commit

upload failure
→ compensating rollback attempt
```

The application preserves the original failure when rollback or cleanup also
fails. Recovery artifacts may be retained for a later operator or worker
attempt.

## Current hard-stop gates

### Search, planning, and compression

These failures prevent a valid edit plan from reaching approval or execution:

- malformed search requests or search-tool failures;
- missing or invalid final plans;
- unsafe paths, missing dependencies, or circular dependencies;
- invalid operation contracts or line ranges;
- conflicting patch or complete-replacement instructions;
- empty edit plans or missing canonical structural metadata.

### Staging preparation

Preparation stops when it cannot safely create the local transaction:

- invalid project or staging paths;
- duplicate or inconsistent staged files;
- invalid create, edit, or delete state;
- staging file-count or byte-size limits;
- local workspace or file creation failure;
- existing-file download failure;
- missing content for a new file.

New files are written locally and do not use the existing-file download path.

### Apply and verification

The existing-file path remains strict for download, backup, range, patch,
replacement, local write, timeout, and required runtime-state failures.
Verifier/scorer findings and deterministic CSS findings become repairable when
they can be associated with a staged transaction. Affected files are not
uploaded.

### Project validation

The staged project-validation step remains strict for failures such as:

- duplicate or inconsistent manifest state;
- unapplied or unverified files;
- missing imports or route targets;
- other supported cross-file validation failures.

CSS syntax/SCSS-artifact and CSS/TSX selector findings are repairable when
they are associated with a staged transaction and are recorded in the bug
ledger.

### Commit and cleanup

Commit stops on invalid remote paths, changed original hashes, unexpected new
targets, remote directory failures, backup failures, upload failures, or
remote verification failures. A partial commit triggers compensating rollback.

Cleanup is currently part of the workflow lifecycle and cleanup failures may
still affect the final workflow result. This is a candidate for reclassification
as a warning when the edit and rollback integrity are already complete, except
where cleanup protects data or security guarantees.

## Existing best-effort behavior

The following failures are intentionally non-blocking or preserve the primary
result:

- progress publication through `context.writer`;
- diagnostic event publication;
- best-effort history writes;
- rollback failures replacing the original commit error;
- cleanup attempts that preserve the original operation failure.

These failures must remain observable through backend diagnostics without
changing the stable `workflow-resume` and `edit_status` contracts.

## Implemented milestone-based repair

The workflow records dependency-ordered milestones and splits safe commits
from repair-pending files:

```text
approved structural plan
→ stage one milestone
→ validate milestone
→ commit successful milestone
→ continue independent milestones
```

When a validation issue is repairable rather than unsafe:

```text
repairable validation failure
→ record sanitized unresolved bug in architecture/BUGS.md
→ preserve successful independent milestones
→ publish `completed_with_issues` and create one bounded repair approval
→ require HITL approval
→ repair and revalidate
→ remove the bug by stable ID
→ append the outcome to HISTORY.md
```

`BUGS.md` contains unresolved bugs only. `HISTORY.md` retains the audit trail,
including the stable bug ID, milestone, affected files, validation result,
originating run, and repair run.

## Failure classification

```text
hard blocker
→ stop the milestone and require intervention

repairable blocker
→ preserve safe completed milestones and start a bounded repair cycle

warning
→ record diagnostics/history and continue
```

The classification must be explicit and application-owned. Agents may propose
repairs but must not decide whether a safety or integrity failure is allowed to
pass.

## Failures that should remain strict

The following should remain hard gates unless a future architecture decision
explicitly changes the safety model:

- path traversal or sensitive-file violations;
- invalid operation or patch contracts;
- dependency cycles and unsafe structural plans;
- remote hash conflicts;
- unexpected remote targets for new files;
- uploading unverified or unchanged-local-state files;
- failures that could corrupt, overwrite, or misattribute project files;
- required imports, route targets, or build guarantees for a milestone being
  committed.

## Repairable failures

- CSS selector integration findings where the affected local files are safe to
  preserve and can be deterministically corrected;
- deterministic CSS syntax/SCSS-artifact findings;
- verifier/scorer findings limited to the staged transaction.

The repair run reads the bug/history context once, requires HITL approval,
reopens the preserved staging workspace, and resolves bugs by stable ID after
successful validation. Repair attempts are bounded by the transaction budget.

## Open decisions

- Which validators classify findings as hard blockers versus repairable bugs?
- Does one HITL approval cover a milestone, or only one repair attempt?
- What is the configured repair budget? The current architecture task proposes
  a default of 20 rounds.
- How are pre-existing bugs separated from bugs introduced by the current run?
- How are independent milestones selected when a newer bug is added?
- What cleanup failures can safely become warnings?
- How are staged manifests and remote backups retained across a paused repair?

Any implementation must update workflow state, rollback behavior, stream
diagnostics, tests, and the related architecture task together.
