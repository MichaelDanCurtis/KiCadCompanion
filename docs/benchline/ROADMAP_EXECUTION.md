# Roadmap execution amendment — 2026-09-05

Authorization: the owner activated one overarching Codex Goal to complete the existing BL-01 through BL-14 roadmap, with every milestone verified against its unchanged acceptance criteria. This amendment records that explicit user instruction; it does not create or control the host Goal.

## Superseded sequencing rules

For this authorized run only, the one-milestone-per-Goal activation rule, prohibition on automatic successor work, and stop-after-milestone handoffs in GOALS.md, ROADMAP.md and the individual contracts are superseded. Keep one host Goal and use status.json and per-milestone evidence to track progress. After verifying a milestone, continue eligible work without requesting another “proceed.” Do not create child host Goals.

Resume from current source and evidence, not from BL-01 by default. At activation, BL-01 through BL-03 were recorded verified and BL-04 remained in progress. Revalidate evidence affected by changed revisions; this authorization is not proof of milestone completion.

## Unchanged constraints and finish line

- All fourteen contracts, seventy acceptance criteria and prerequisite edges remain unchanged. No skipped live checks, lowered thresholds or substituted mock completion.
- Authorized scope is local implementation and bounded disposable fixtures in the independent Benchline checkout. Customer workspaces, native authority, revision checks, scoped approvals and existing user work remain protected.
- Customer-design mutation, credential copying, purchases, additional paid services, publication, deployment, licensing decisions, firmware flashing, printer submission and live power operations still require specific approval. No implicit subagent authorization is added.
- Record progress, failures, revisions, verification and next actions in the repository. If human input is needed, identify the minimum unlock and continue other authorized work whose prerequisites are satisfied. Stop affected operations rather than bypass safeguards; do not busy-loop when no useful authorized work remains.
- Host lifecycle rules and user pause/resume/budget controls still apply. This amendment neither overrides a system stopping rule nor marks the Goal achieved.
- Completion requires current evidence for every BL-01 through BL-14 criterion, including human-assisted physical acceptance and an actually tested private preview package. Public release remains outside scope. Blocked, deferred, simulated and untested requirements do not count as complete.

The roadmap ledger is separate from host Goal status. Historical evidence statements that no host Goal was active describe those earlier increments, not the current run.

## Parallel-agent authorization — 2026-09-09

The owner explicitly requested an agent swarm to speed up this roadmap. Bounded
parallel subtasks are now authorized within the existing Goal and safety scope.
The coordinating agent owns milestone acceptance and shared integration; each
worker receives non-overlapping file ownership and an explicit finish line.
Prerequisite gates remain in force. No two workers may mutate the same native
document, and this does not authorize extra paid services, customer mutations,
publication, hardware operations, or a change to acceptance criteria.

## Independent task continuation — 2026-09-10

The owner activated the same full BL-01–BL-14 objective in the independent
Benchline task after the read-only separation handoff. The former customer-workspace task
was handed off with its Goal paused. This task uses the expressly selected local
KiCadCompanion checkout and preserves its uncommitted implementation. One
roadmap-wide host Goal is active here; individual milestones remain in status.json.
The owner's instruction again explicitly authorizes automatic progression between
eligible milestones. All original criteria, native safeguards, customer separation,
licensing requirements and specific external/physical approval boundaries remain.

## Narrow sourcing deferral — 2026-09-11

The owner proposed skipping BL-07 while distributor access is pending. For this
continued run, defer only BL-07-A4's live DigiKey qualification and start independent
BL-08 capability, native preservation, and disposable reference-fixture work.
BL-07 remains incomplete; A1/A2/A3/A5 evidence and all engineering unknowns stay
in force. The DigiKey account is approved, but data-use clarification, separately
approved credential setup, and a successful live read remain outstanding.

This is an execution-order exception for work that does not consume live offers,
unverified electrical limits, or unknown assembly geometry. It does not remove
the BL-07 dependency from final acceptance, authorize an unqualified ESP32 carrier,
or waive any criterion. BL-08 can progress using bounded native fixtures; its
final reference journey and the full roadmap still require their original evidence.
Return to BL-07-A4 when the external and approval prerequisites are resolved.
No additional external messages, credentials, purchases, or license decisions are
authorized by this deferral.

## Owner-directed BL-07 deferral — 2026-09-11

The owner has now confirmed that BL-07 may be skipped in the current execution
order. The ledger therefore records BL-07 as `deferred`, while its original
contract and evidence remain unchanged and BL-07-A4 remains awaiting-human.
This does not promote any successor to verified and does not remove BL-07 from
the final roadmap acceptance set. Continue only bounded offline work whose
inputs are independently available (including the ESP-IDF observation and
mechanical qualification); preserve all downstream gates until their own
contracts are satisfied. Return to BL-07 when the provider clarification,
credential approval and live read are available.

## Completion audit handoff — 2026-09-11T20:04:00Z

A current machine-readable audit is retained at
`.runtime/roadmap-completion-audit.json`. It maps all 70 acceptance IDs to the
current evidence matrix, preserves BL-07 as deferred, and lists the smallest
owner unlock for each open downstream goal. The audit is valid as a roadmap
structure check, not a completion claim: BL-09 through BL-14 still require the
owner decisions and human observations recorded in `OWNER_INPUTS.md`.


## Read-only sourcing and tool-version decisions — 2026-09-12

The owner confirmed that DigiKey is approved for read-only lookup. BL-07 is no
longer execution-order deferred; its A4 criterion remains awaiting-user until
the approved host-local credential file is configured and one successful redacted
read is retained. No cart, order, upload or credential copying is authorized.

The owner also clarified that no single ESP-IDF release is a product requirement;
the application must support compatible releases. Reproducible pilot builds still
record the concrete compatible release/toolchain used for each build. FreeCAD
1.1.3 is confirmed as the supported pilot version. Blender 5.2.1 LTS is installed
for optional asset preparation, without changing the enclosure or asset-reuse
gates.


## DigiKey read-only qualification — 2026-09-15

The approved host-local DigiKey credential file is now configured with private
permissions, and one exact-match ProductInformation V4 read succeeded for the
ESP32-S3-EYE v2.2 registration. The redacted receipt is
`.runtime/bl07-digikey-live-read-2026-09-15.json`; no cart, order, upload or
substitute action occurred. BL-07-A4 is therefore verified in the status ledger.
The separate API terms/data-retention clarification remains an open release
decision; BL-09 through BL-14 retain their independent owner-input gates.
