# Benchline roadmap

Plan version: 1.0 · 2026-09-05 · Implementation active under the owner's [roadmap-wide execution amendment](ROADMAP_EXECUTION.md). The amendment supersedes only the default milestone activation/stopping rules in this document and the goal contracts.

Implementation update: BL-01 foundation, [BL-02 inventory](licenses/README.md), and [BL-03 project model](PROJECT_MODEL.md) are verified in the status ledger; inventory completion is not legal clearance. The user-directed [product-first intake amendment](PRODUCT_INTAKE.md) makes the brief and build plan the default entry point. Product manifests and change impact have their own evidence; durable workflow records and input verification are qualified under BL-06. [BL-04 is verified within its bounded local scope](evidence/BL-04.md#2026-09-09--registered-live-binding-and-coordinated-shutdown-review): the pinned dispatcher/gateway is wired into an opt-in product runtime, native model assignment has narrowly scoped host registration, and final live binding/shutdown checks passed alongside retained signed-in and reversible model/UI/native evidence. The legacy agent and generic native refresh stay disabled; the main preview is unchanged. [BL-05 is verified](evidence/BL-05.md): adaptable layouts, browser/native review ownership, selected native editor context, retained visuals/approval behavior and final 200% zoom screenshots satisfy its bounded workspace contract. [BL-06 is verified](evidence/BL-06.md) with transactional SQLite recovery and registered-input verification. [BL-07 read-only sourcing is owner-authorized](evidence/BL-07.md) with offline package/BOM review and bounded source observations that preserve confirmed facts; Espressif ESP32-S3-EYE v2.2 is selected and manufacturer source retrieval passes; the documentary source/unknown audit and conflict protections pass, while the DigiKey adapter and offline production UI now pass; the production app is approved, and the validated host-local credential file plus one successful exact-match redacted live API retrieval now qualify BL-07-A4. The separate API terms/data-retention review remains open for broader release or redistribution decisions. [BL-08 is verified within its documented disposable/native scope](evidence/BL-08.md): connected authoring, saved reopen, model-only preservation/Undo and the explicit fixture matrix pass; customer-board use, missing meshes and ESP32 carrier readiness remain outside that scope. BL-09 is audited as awaiting-owner because the firmware behavior and electrical pin contract are unresolved; compatible ESP-IDF releases are supported, while the concrete per-build toolchain manifest remains open; its fail-closed contract validator and synthetic rejection tests are recorded as partial A2 evidence; BL-10 is audited as awaiting-owner because the approved assembly envelope is absent; FreeCAD 1.1.3 is now installed and its native qualification is partial; BL-11 is audited as awaiting-owner because no application brief or shared device protocol exists. BL-12 is awaiting-owner for a frozen cross-discipline scenario, BL-13 awaits an owner-approved unit and physical protocol, and BL-14 awaits the completed software/physical inputs for a fresh private-package install and rollback; its fail-closed candidate validator, CLI check, pending record, explicit package allowlist and Verification readiness panel are now in place; a disposable extracted package install/runtime rehearsal passed while native portability and acceptance inputs remain open. Under the [2026-09-11 sequencing amendment](ROADMAP_EXECUTION.md#narrow-sourcing-deferral--2026-09-11), these are explicit gates rather than inferred requirements. Unknown electrical limits and assembly dimensions still block dependent pilot design. The consolidated [owner input packet](OWNER_INPUTS.md) lists the exact remaining decisions and observations without supplying values.

## Product outcome

Benchline is an independent, local-first product-development workspace connecting electronics, firmware, mechanical CAD, sourcing, and application development. It starts by asking what the user wants to build, develops a reviewed brief and plan, and coordinates the product lifecycle. The initial companion interface becomes a specialist workbench beneath that product-level workflow: manual information and selection on the left, a wide agent pane on the right, and native editors available for deeper work.

A representative journey: select an approved ESP32 module, inspect its source-backed pinout and dimensions, create a small carrier circuit, build firmware, generate an editable FreeCAD enclosure, and exercise an application against a device simulator. A connector change should identify the affected enclosure opening, firmware contract, BOM, and tests before proposing coordinated work. This pilot proves the reusable framework; it does not limit the product to ESP32 or one customer.

The first product customer remains a separate workspace. Its private boards and commercial plans are not application source or public demo data. Local installation locations and migration notes belong in ignored local context, not the portable roadmap.

## Planning baseline and reuse

The standalone checkout already exists under the KiCadCompanion folder name. At planning time HEAD was 606ee2d, the working tree was clean before these planning artifacts, and the existing verification report recorded 24 tests. The following table describes that historical starting point, not today's unresolved work. Current implementation/verification belongs in the status ledger and per-goal evidence.

| Existing surface | Reuse | Missing layer |
| --- | --- | --- |
| server/config.mjs, scripts/launch.mjs | Explicit workspace/tool paths; instanceRoot/workspace checks | Benchline identity and operational migration |
| src/main.jsx and src/style.css | Workbench, component inspector, conversation, activity and approvals | Product navigation, resizing, detachment and general artifact context |
| server/codex.mjs CodexAgent | Correlated RPC, streamed events, provider initialization | Versioned provider contract and enforced tool exposure |
| server/konnect.mjs Konnect.call()/unpack() | Serialized tool calls, discovery and error propagation | Uniform capability/action contract |
| server/approvals.mjs ApprovalStore | Exact action scopes, remembered permission persistence and revocation | Execution-layer read-only and revision-bound authorization |
| server/index.mjs context()/refresh()/select() | Live identity/freshness and selection | Multi-artifact project context |
| server/renders.mjs RenderStore/fingerprint() | Artifact provenance and source-change checks | General evidence records across disciplines |
| shared/visuals.mjs, src/visuals.jsx | Bounded A2UI charts/tables/graphs | Project-plan and cross-discipline diagnostics |

The legacy session persistence retains board, conversation ID, messages and surfaces; it is not a durable workflow journal. BL-04 has since added a verified action journal, scoped approval/recovery handling and an enforced opt-in product tool boundary, including registered binding and coordinated shutdown evidence. Legacy prompt-only dispatch stays disabled. Durable multi-step workflow execution still belongs to BL-06; BL-04 verification does not complete that successor or broaden native qualification.

## Settled architecture choices

1. **Independent product and workspaces.** Keep Benchline source, user-specific state, customer design projects, and public fixtures separate. Complete migration before retiring a prototype installation; no wholesale runtime/approval copy.
2. **Native source authority.** KiCad owns electrical files; FreeCAD owns editable mechanical documents; firmware/app repositories own code. A versioned manifest links stable IDs, project-relative paths, requirements, revisions, and dependencies. Do not introduce a competing all-purpose CAD format.
3. **Durable local state.** Use a local SQLite workflow store with explicit migrations, transactional attempt/evidence records, and recovery. Portable project metadata remains a versioned manifest. Audit the binding and distribution footprint before choosing it.
4. **Observed state and change proposals.** Maintain live document identity/revision/dirty state separately from saved hashes. Manual edits invalidate stale proposals. The orchestrator records dependency impacts; it does not silently cascade writes.
5. **Controlled execution.** Every action carries capability, exact target/arguments, input revision, approval, attempt ID, and verification. Allow once, Decline, and explicit scoped Always allow remain available; recurring grants avoid repeated prompts for matching actions without bypassing fresh checks, and users can inspect/revoke them. Serialize native-document writes. Unknown outcome requires reconciliation, not blind replay.
6. **Agent/provider separation.** Codex is the first agent provider. Project state and evidence must outlive a conversation and remain usable without an agent. Account access, provider terms, external transfers and usage limits remain explicit.
7. **FreeCAD first.** Generate native named features/sketches and preserve editability. CadQuery is optional future work for a demonstrated code-driven generation need, not a mandatory duplicate mechanical authority.
8. **Permissive-first dependencies.** Prefer MIT/BSD/ISC/Apache, individually review copyleft and asset rights, retain notices and provenance. Keep current product license undecided; upstream contribution and distribution choices need owner review.
9. **MacOS preview first, portable boundaries.** Validate the initial native environment honestly. Windows/Linux support comes with tests and packaging work, not merely from cross-platform libraries.
10. **Evidence-based readiness.** Keep generated, software-verified, and physically tested labels distinct. No regulatory/electrical certification claims.

The source architecture should grow incrementally. Proposed new modules include shared/project.mjs for manifest schemas, server/projects.mjs for project identity/revision queries, server/actions.mjs for authorization and dispatch, server/adapters/ for specialist contracts, and server/workflows.mjs for execution and recovery. Split the large server/index.mjs and src/main.jsx only as these responsibilities are introduced; do not start with an unrelated framework rewrite.

## Milestones and dependency order

| Phase | Goals | Exit gate |
| --- | --- | --- |
| Foundation | BL-01 standalone; BL-02 provenance | Independent preview and explicit commercial/dependency inventory |
| Core project and controls | BL-03 project model; BL-04 enforced actions | Stable artifact identities and negative-tested execution boundaries |
| Workbench and program manager | BL-05 adaptable UI; BL-06 durable workflows | Visible plan/selection plus restart-safe execution and evidence |
| Specialist workflows | BL-07 module/BOM; BL-08 electronics; BL-09 firmware; BL-10 FreeCAD; BL-11 app | Each discipline has an honest capability contract and verified reference journey |
| Cross-tool proof | BL-12 integration | Actual native-tool/software workflow, coherent revisions and fault recovery |
| Physical proof | BL-13 hardware | Owner-observed prototype fit and behavior pass the approved protocol |
| Private release candidate | BL-14 packaging | Install/rollback/license/privacy review packet; no automatic publication |

The exact DAG is in status.json. BL-03 can follow BL-01 independently of the licensing report, but BL-04 waits for BL-02 and BL-03. BL-05 and BL-06 can progress independently once their prerequisites are verified. BL-07 then unlocks specialist work; BL-10 requires real electronics geometry and BL-11 requires the firmware contract. Independent development is possible, but one active goal per task is the default and native writes must never overlap.

These are outcome-based stages, not calendar commitments. Review actual effort after BL-01 through BL-04. Do not bundle all fourteen contracts into one indefinite goal.

## First goal

Start with BL-01. It finishes the independent application foundation and proves launch/workspace isolation. Reuse the extracted source rather than recreate it. Leave existing runtime work undisturbed, make migration inspectable, and require a separate explicit decision for operational cutover.

The copyable prompt and all five acceptance criteria are in goals/BL-01.md. GOALS.md contains the shared execution contract and the complete goal catalog. No goal is active merely because the documents exist.

## First pilot scope

Recommended planning default: one small, low-voltage ESP32-based accessory using a documented module, simple carrier, screw-fastened enclosure, and local configuration/status frontend. The exact module revision and requirements are an owner decision before BL-07. Do not presume an existing HDMI design is electrically validated or that HDMI HEC is a GPIO feature.

The pilot should demonstrate the product architecture, not become a reason to broaden every adapter. Firmware flashing, assembly, print submission, purchasing and physical tests are separately approved actions. Simulator behavior cannot satisfy BL-13.

## Acceptance and evidence discipline

Every goal has five stable acceptance IDs, dependencies, scope, reuse points, deliverables, verification procedure, blockers, non-goals and a complete activation prompt. The canonical per-goal contracts are docs/benchline/goals/*.md. status.json indexes them; evidence records are created only when work begins.

A goal is verified only when current evidence satisfies every criterion. File creation, successful syntax checks, or a persuasive agent summary are insufficient where live native behavior is required. Record failures, omitted checks, tool versions, source/model revisions, and observations. A fresh source change invalidates relevant evidence even if a previous run passed.

For physical testing, record the operator, unit, instrument or log source, expected tolerances and measured values. Waiting for a person is not a reason to manufacture a result or keep retrying the same tool.

## Risks and explicit deferrals

- **Konnect model updates:** the prior library-refresh failure requires a model-only preservation test, not bypassing the refusal. Upstream source inspection and current capability discovery precede extension design.
- **Source/terms drift:** pin relevant versions and recheck upstream contribution/license terms before modifying or redistributing their code. Upstream acceptance is never a goal completion condition controlled by the agent.
- **Unsaved state:** file-based checks do not cover unsaved edits. The product must show which revision was checked.
- **Generated CAD:** semantic validity and collision checks still do not prove real-world fit or manufacturability; do not hide missing models or unknown tolerances.
- **Downloaded data:** untrusted examples and documents may contain inaccurate facts, executable content, or incompatible rights. Review and sandbox them.
- **Cross-window concurrency:** detached UI must share state without creating a second uncontrolled writer.
- **Permission migration:** old approvals are not reusable grants for a new product/project without explicit scope review.
- **Commercial release:** own-product licensing, repository owner/visibility, trademark/domain availability, provider distribution terms, signing and privacy review remain owner decisions.

Deferred beyond the initial roadmap: a universal autorouter, RF/high-speed/mains validation, certification, broad module scraping, cloud multi-tenant orchestration, full Figma replacement, arbitrary CAD backends, production OTA/provisioning, a plugin marketplace, and automatic manufacturing purchases. Those require new goal contracts.

## Roadmap validation and review

Before handoff, validate all fourteen goal files, seventy criterion IDs, prerequisites/DAG, status entries, evidence template, and activation prompts. Validate/render the local visual plan and inspect its static workspace concept. This validates the planning artifact, not the proposed implementation.

The visual review in plans/benchline-roadmap/ contains a static current-shell reference and proposed workbench concept plus goal dependencies and a single decision form. It is a review surface, not a working Benchline UI. Goal files remain the execution authority; keep overview changes consistent with them.

Implementation begins only when the owner activates a specific goal. Changing a finish line requires an explicit versioned scope amendment, not a quiet edit after a test fails.
