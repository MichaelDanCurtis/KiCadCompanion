# BL-04 action boundary — verified bounded local scope

The action core, signed-in constrained dispatcher, scoped approvals and reversible model/UI/native journey have evidence. The actual product server wires an explicitly opted-in runtime and a narrowly qualified native model registration. **BL-04 is verified within that bounded local scope**: [registered live binding and coordinated shutdown review](evidence/BL-04.md#2026-09-09--registered-live-binding-and-coordinated-shutdown-review) passed, with 257/257 integrated tests. See [local configuration](LOCAL_RUNTIME.md); historical experiments below retain their original limitations. Generic customer writes, public release and universal security certification are not implied.

## Current capability boundary

The server registers the ordinary Konnect metadata adapter and the separate `native-models` adapter. Metadata reads use exact project/document lookup and saved-file fingerprinting; they do not claim a live revision or dirty state. The host can explicitly bind those reads to an editor using paired BENCHLINE_KONNECT_CONFIG and BENCHLINE_KICAD_IPC settings; binding rejects wrong identity/socket, disconnection and file fallback. Without the pair, metadata reads permit explicit source-labelled file fallback. The legacy observer is not redirected.

`native-models/set-placed-models` is unsupported unless a host-owned qualification passes exact disposable-board/UUID/model scope, binary/config/runtime/model pins, canonical model-root bounds and fresh IPC/native-instance checks. It retains atomic live revision tickets and the action gate; it cannot qualify customer boards, save, rebind automatically or authorize itself. Generic `refresh-footprints` remains unsupported: discovering a dry-run/revision argument is not atomicity or preservation evidence.

The product runtime defaults off. Explicit host opt-in enables only the pinned dispatcher/owned gateway after qualification; connection rechecks account, configuration and the exact model. The legacy companion Agent/Discuss and AI studio launcher stay disabled. Old threads or remembered board permissions cannot bypass the product gate. Manual native inspection, selection, rendering and saved-board checks remain separate user-initiated operations. No universal OS sandbox, customer-write permission or global Codex configuration change is implied.

The [provider-session callback layer](PROVIDER_MEDIATION.md) pins host-selected project/document/mode/thread/turn authority and exposes only prepare/status/execute through the gate. It is wired into the product controller. The separate pinned source-dispatch allowlist removes other direct tool routes, and the gateway validates the actual nested registry; callbacks alone would not provide this enforcement. Current test counts and exact executable evidence are recorded in BL-04 evidence.

Official [App Server documentation](https://learn.chatgpt.com/docs/app-server) describes thread/turn overrides and notes that steering does not accept permission overrides; shell-command/process APIs can run outside thread sandboxing. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents separate controls for shell, apps, MCP, plugins and network. These sources plus generated schemas from installed Codex 0.153.3 informed the guard. They do not establish an exhaustive tested allowlist for this integration.

## Contract and state machine

Only trusted host code may register a version-1 adapter with capabilities, validate, observe, preview, execute, verify, cancel and inspect methods. No arbitrary shell command, file patch, network URL or MCP tool-name proxy is exposed. Inputs name registered project/document UUIDs, adapter, operation, exact arguments, mode and idempotency key; paths are resolved by the product model, not accepted from the agent.

1. **Prepare:** validate schema, identity, capability and mode; resolve root/epoch/manifest; obtain a fresh matching observation and bounded preview.
2. **Decide:** write actions wait for Allow once / Decline / Always allow. Read actions become ready. Decisions are user HTTP actions, never agent text.
3. **Execute:** revalidate capability/version, scope, exact arguments, confirmation, document revision, project root/epoch/manifest and preview expiry. Persist executing before dispatch; check immediate revocation/cancellation again after persistence.
4. **Verify:** record receipt and separate verification. Unverified/partial/exceptional results are unknown, not successful. Replaying the same idempotency key returns its record without dispatching again.

Adapters that mutate must atomically compare the expected native revision at their mutation boundary. Host preflight alone cannot eliminate a race with manual editing. The fixture demonstrates compare-and-set; the qualified private model extension implements the native final-window guard. This does not confer support on other native mutation operations.

Always allow grants cover one exact project/document/path/epoch/adapter/action/argument set/capability version/confirmation. Later operations still need new previews. A changed argument, expanded confirmation, identity or capability does not reuse the grant. Manifest/root changes invalidate prepared actions; relocation changes the scope epoch. Old board permissions are neither copied nor consumed.

## Persistence and recovery

Actions/grants live in runtime actions.json, separate from the portable project manifest and legacy permissions. The strict versioned journal is atomically replaced with restrictive permissions. Corruption is preserved and rejected. A persistence failure poisons the gate until restart; it cannot dispatch the next action based on unsaved state.

Restart expires every unresolved preview/approval. An executing record becomes unknown. Unreconciled unknown actions block both new action keys and previously prepared work on that project/document. Inspection alone never clears the block. A real child-process SIGKILL fixture proves the after-apply/before-response case and recovery from its persisted effect.

Reviewed recovery is a separate acknowledgment of CURRENT inspected state, not a correction of the original outcome. Host-only recovery-review/reconcile routes require a bounded adapter inspection, an exact review ID/fingerprint, a 60-second expiry and an explicit note. The UI additionally requires an unchecked acknowledgment. Reconciliation independently reinspects identity, capability, arguments and current state; changes require a new review. Capability replacement or drift during an asynchronous inspection is rejected too. Pending recovery consent expires on restart.

Acceptance retains the original unknown state, receipt and verification, stores a separate reconciliation, revokes all grants on that project/document and expires its pending work. The old action can never replay; newly prepared writes need fresh approval. The provider has no recovery or approval tool. Registered recovery supports metadata reads and, only within an unchanged qualified binding, selected native model pre/postcondition inspection. Generic native-mutation recovery remains unsupported. Neither a metadata read nor an observed postcondition proves how the original unknown action ended.

Previews expire after 60 seconds and observations after 10 seconds. Journals are capped at 1,000 actions and 1,000 grants; there is no automatic deletion/archive. Writes are serialized within one server process; multiple writers and hostile same-user tampering are outside this preview contract. The gate fails safely on receipt/persistence uncertainty rather than claiming rollback.

Revocation immediately marks a grant unusable for not-yet-dispatched operations, then persists removal. Cancellation before dispatch stops future work. After dispatch it reports the limitation and waits for verification; it does not promise undo, terminate a native mutation mid-write, or retry. The adapter cancel contract currently reports unsupported for in-flight native calls.

## Visible controls and verification

Product → Project model → Action controls shows capability support, exact scope, input revision, approval buttons, execute, stop, evidence, recovery inspection and revocation. Buttons never conceal unsupported native writes. The manual preview requires a separate Execute click after approval; durable automatic orchestration belongs to BL-06.

Run npm test for gate/provider/API regressions. Run node tests/fixtures/actions-preview.mjs only for an isolated, temporary fixture UI on port 4332. Its label changes are in-memory simulations and never native writes; it is not imported by the production server. Browser verification covers Always allow, explicit execution, a verified fixture receipt and revocation.

## Completion boundary and successors

Final registered binding against the explicitly restored private editor and the
server-shutdown cleanup-rejection regressions passed. The original five criteria
are verified; BL-05/06/07 are eligible, not complete. No customer-board mutation,
new crash campaign or repeated paid/native action is implied. All twelve release
gates stay open; the main preview is unchanged and unconfigured runtimes remain off.

## Implemented surfaces and conformance history

### Read-result projection

The provider now receives a reviewed `board-metadata` result after a verified read,
not the raw native receipt. `shared/provider-results.mjs` bounds metadata strings,
counts and dimensions, requires explicit source/freshness limitations, and rejects
unknown output fields. `ActionGate.providerResult()` exposes only verified read
snapshots via an adapter-specific projector, with an 8 KiB cap. Unsupported,
malformed or unavailable data has an explicit status; it is not an empty board.
Raw file identity, recovery records, native extension fields and exception details
remain local. Deliberately selected design text (title/company/date/revision) is
untrusted content, not instructions; this is not a content-based secret scrubber.

Konnect read verification now requires an exact matching returned file identity,
valid metadata and an unchanged saved hash. It still cannot attest live revision
or dirty state. Paper metadata originates from the saved file even for IPC reads.
`npm run test:provider-native-read` is an opt-in, read-only probe of the retained
disposable fixture using its explicit socket config. It does not open an editor,
mutate a board, launch a model, or qualify authenticated production operation.
The real A4/IPC and A4/file-fallback paths are verified. Custom paper dimensions have
source-reviewed shape but not a real native custom-paper fixture observation.

`npm run test:provider-native-read -- --bound` exercises explicit binding through
the production adapter, gate and host-driven callbacks. `--file-fallback` instead
uses a private nonexistent socket, leaving native windows and existing config alone.
`npm run test:native-binding-http` exercises the normal server, ProductStore and
HTTP action routes against that same disposable board. It adds a Benchline manifest
only when absent; it refuses to overwrite an existing incompatible fixture manifest.
The HTTP probe also refuses a not-open document reference without creating a CAD file.
`--wrong-binding` and `--disconnected` test separate refusal paths. Every run uses
fresh server state and a temporary port and shuts down only its own server.

Konnect v0.11.0 source review confirmed that
[open_project](https://github.com/mixelpixx/Konnect/blob/v0.11.0/crates/konnect-core/src/tools/project.rs#L290)
queries IPC and document identity without opening or saving anything. Its
[board metadata reader](https://github.com/mixelpixx/Konnect/blob/v0.11.0/crates/konnect-core/src/tools/pcb_board.rs#L1159)
uses exact-document IPC lookup and reports file fallback separately. This is source
inspection, not proof of an atomic cross-call live revision or native write guard.

### Generic footprint refresh remains unsupported

Source audit of Konnect v0.11.0's
[footprint update handler](https://github.com/mixelpixx/Konnect/blob/v0.11.0/crates/konnect-core/src/tools/pcb_footprint_update.rs#L249)
shows plan comparison before a later commit/update call. Its
[IPC client](https://github.com/mixelpixx/Konnect/blob/v0.11.0/crates/konnect-ipc/src/client.rs#L824)
sends UpdateItems without the expected plan revision. KiCad 10.0.0's
[protocol](https://github.com/KiCad/kicad-source-mirror/blob/10.0.0/api/proto/common/commands/editor_commands.proto#L245)
and [handler](https://github.com/KiCad/kicad-source-mirror/blob/10.0.0/common/api/api_handler_editor.cpp#L246)
do not establish an atomic expected-revision check at that boundary. This is a
source-level unprotected-window finding, not a demonstrated simultaneous-edit race.
Undo batching does not prove compare-and-set. The historical disposable refresh
helper's atomicRevisionCheck declaration has been retired (false); the action gate
now refuses its mutations. Production refresh remains disabled. A native precondition
extension and its actual concurrency/preservation tests are required before enabling it;
moving another host-side check closer to dispatch is insufficient.

The model-only extension below follows a separate, tested conditional operation;
its qualification does not repair or enable generic footprint refresh. Later native
preservation, stale-guard, recovery and signed-in/UI results are retained in the
BL-04 evidence record. Final registered binding/shutdown verification now passes
within the model-only scope; the earlier broad conformance worklist is not an
additional milestone contract or permission to enable generic footprint refresh.

### Historical native model dispatch candidate increment (2026-09-09)

At this increment, `KonnectModelsAdapter` was **not registered in production** and
was disabled by default. Explicit test construction pinned the IPC endpoint and native
instance; every observation checks the exact open target and required capabilities.
Arguments contain only complete model lists for exact footprint UUIDs. No generic
tool proxy, raw file edits, save, rebinding, fallback or automatic undo is exposed.

The gate supports optional host-only `prepareDispatch` metadata (32 KiB maximum).
Read-only preparation issues a one-use native ticket and validates the original
live revision. The ticket, operation digest, before-model digest and native binding
are persisted with `executing` before apply. Native apply performs its own atomic
revision/arguments/expiry guard. Target/capability changes during preparation or
journal persistence prevent dispatch. Cancellation/revocation remain checked after
all asynchronous preparation. Old journals remain readable; older executables that
do not understand the new optional field must fail closed rather than drop it.

Verification independently reads selected native model lists. An applied response
alone is insufficient. Unknown-result recovery uses the persisted ticket plus a
fresh revision and selected-model snapshot; it can accept a reviewed current pre-
or postcondition, never certify the original unknown result or authorize replay.
Any reconciliation invalidates grants/previews through the existing gate.

The disposable native test applied models, deliberately discarded the received
host response, reloaded the journal, inspected/reconciled current state and issued
a separately approved restoration. Model lists returned to baseline and the saved
file was unchanged. This is not an actual process-kill/disconnect test, whole
unsaved-board serialization preservation, native UI acceptance or production
qualification. Native revision includes editor epoch: an ABA content restoration
must produce a new revision, not revive old approvals. See the retained first
assertion failure and corrected run in the BL-04 evidence record.

### Actual worker loss and project-bound native HTTP qualification (2026-09-09)

The later `native-model-crash-probe.mjs` killed its own worker with SIGKILL after
one real native apply returned but before ActionGate persisted its receipt. Its
private Konnect process had closed; a new PID connected to the same native editor.
The executing journal recovered as unknown, with no retry. Konnect reports a missing
client receipt as MCP `isError`, so `unpack` rejects it and the adapter records
`unavailable`; independent current-state observation, not that receipt, supported
review. The first incorrect test assertion and the separately resumed recovery
receipt are retained. Reconciliation left the original outcome unknown. A new
approved action restored the selected lists. This does not test a KiCad crash or
disconnect during native commit.

`native-model-project-probe.mjs` then exercised the real ProjectStore, target
resolver and HTTP action routes with the candidate adapter in a test-only server.
Discuss, wrong document, decline, missing approval, restart, changed manifest and
revoked recurring grant all dispatched zero native writes. Exact recurring scope
matched without prompting; changed arguments required approval. Explicit once
approval dispatched one verified change; duplicate execute did not replay. A fresh
connection and new approval restored the lists, with unchanged saved-board hash.
ProjectStore reopen preserved the resolved target. A disposable Benchline manifest
was added; no protected CAD file was edited by the test harness.

Production registration, browser-native approval, full unsaved-board preservation
and authoritative signed-in provider inventory remain unqualified. These tests use
scripted operator decisions and cannot substitute for those remaining checks.
