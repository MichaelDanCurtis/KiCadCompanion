# Host-owned provider tool sessions — BL-04 bounded verification

## Current integration status

The actual product controller now accepts the explicitly opted-in pinned local
dispatcher and owned Code Mode gateway. Central dispatch and nested registry
admission enforce the reviewed tool set; the action gate controls Discuss versus
Agent permissions. Signed-in boundary, model/UI/native approval, runtime wiring
and real process-lifecycle evidence is retained in [BL-04 evidence](evidence/BL-04.md).
The product runtime defaults off; [host configuration](LOCAL_RUNTIME.md) selects one
explicit model and rechecks binaries, account and effective configuration on connect.

The inherited-profile/direct-tool companion launcher and AI studio remain disabled.
No arbitrary customer native writes or universal OS sandbox are claimed. Final live
registered native binding and coordinated server-shutdown verification passed;
[BL-04 is verified within its exact local scope](evidence/BL-04.md#2026-09-09--registered-live-binding-and-coordinated-shutdown-review).
The main preview remains unchanged and release gates remain open. The following protocol details and dated
increments preserve the implementation history: older statements about unavailable
production wiring describe those earlier checkpoints, not the current opt-in path.

## Authority and protocol

`server/provider-tools.mjs` creates a host-only session around the existing ActionGate. The host selects the project, permitted document IDs, mode and Codex thread. Document path, epoch and manifest hash are pinned from the project resolver. The active turn is explicitly bound by the host; completion or session closure invalidates it. No factory/session-management method is exposed as a provider tool or HTTP route.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) describes experimental dynamic tools and the client-handled item/tool/call flow. Definitions and responses were initially checked against schemas generated from Benchline's configured Codex **0.153.3** binary, not the different binary found on PATH. The configured app has since updated to **0.153.4**; its experimental schemas and actual model-facing tool inventory were inspected in the local probe below. The OpenAI Docs skill informed the protocol and effective-configuration checks; schema compatibility alone is not proof of isolation.

Only three flat dynamic function tools are supplied:

| Tool | Capability |
| --- | --- |
| benchline_prepare_action | Propose an action against a host-permitted document, using the registry and gate. It does not execute or approve. |
| benchline_action_status | Read a limited status projection for an action owned by this active turn. |
| benchline_execute_action | Ask the gate to execute that turn's action; approval, revision, scope and replay checks remain mandatory. |

There is no provider tool for approval, grants, raw commands, arbitrary MCP calls, file paths, recovery inspection or clearing uncertain outcomes. Prepare arguments do not accept mode, project ID, path, permission decisions or idempotency keys. The gate remains the authority on adapter capability and exact arguments. Discuss therefore cannot turn a write into a read by changing tool-call text.

CodexAgent accepts an optional toolSession and routes dynamic callbacks to it. Server-initiated legacy command/file/MCP approval requests cannot fall through to remembered Companion approvals, even without a session attached. Matching turn-completed and thread-closed/archived notifications invalidate session authority; foreign notifications do not. The opted-in product runtime constructs the mediated session; the legacy pre-spawn refusal remains unchanged.

## Host-owned thread lifecycle

`server/provider-session.mjs` supplies MediatedProviderSession. A trusted host first initializes and checks an isolated transport, then opens a session for one immutable project/document/mode scope. The session claims the transport synchronously; another owner cannot reuse or close it. A fresh ephemeral thread is started with mediated definitions, read-only sandbox and no native approvals. No resume or inherited thread metadata is used. The native gate independently permits only the selected mode's authorized operations; the read-only provider sandbox does not itself authorize native writes.

Only a successful turn/start reply binds the active turn ID. Racing callbacks wait for that reply and are validated against its ID; callback-supplied IDs never create authority. Scope is re-observed before a new model turn. A changed project epoch/path/manifest closes the session before another turn starts. Completion racing the start reply is handled without leaving a live turn or hanging the client. Foreign project/turn events are excluded from this session's event channel.

Stop revokes pending action authority before sending turn/interrupt. The session remains stopping until matching completion; a second turn cannot overlap. Stop before a turn ID is accepted closes the session/process instead of guessing an interrupt ID. The product controller's UI selection routes close ownership on product/mode changes; close invalidates synchronously and retains uncertain or already-applied outcomes in ActionGate. Session and transport cleanup both settle before controller shutdown or replacement, including late-opening rejection and cleanup failure.

CodexAgent is now a bounded host-side RPC transport, not a launcher that inherits global credentials/tools. It handles split UTF-8 frames, caps frames/pending requests/callbacks, denies non-mediated requests, and terminates on malformed input, send failure, request timeout or unexpected exit. Host request methods are allowlisted: process execution, arbitrary file RPC, config writes and thread resume are excluded. This reduces the exposed client surface; it is not OS confinement or protection against arbitrary trusted host code. The raw transport is never a provider tool.

Thirteen additional unit tests exercise these lifecycle and transport behaviors. The opt-in real-process harness now uses CodexAgent and MediatedProviderSession themselves, rather than a separate hand-written protocol client. Each scenario gets a new Codex process, effective configuration is checked before thread creation, and the process is closed before the next scenario.

## Replay, lifecycle and output

- Calls are bound to thread, active turn, protocol call ID, tool and arguments. Concurrent retransmissions share one promise; altered content under the same identity is denied. New call IDs still hit the action gate's persisted execution idempotency.
- Ownership is per session and turn. An action from another session, previous turn or direct UI request is not usable merely because its ID is known. Restart does not reconstruct provider ownership from old approvals. Session creation/begin/end are host actions, never model arguments.
- Before and after prepare, target identity must match the pinned snapshot. A changed root/epoch/manifest cancels the new proposal. Native revision freshness remains the adapter/gate's separate responsibility.
- Turn end/close synchronously invalidates authority and cancels known pending actions. A prepare that finishes afterward is cancelled too. During dispatch, cancellation does not claim rollback; the gate retains the actual outcome and receipt. Transport response failure closes the session without replaying the operation.
- Output includes action ID, document ID, operation, state, effect, summary, revision and explicit verification/approval/review flags. It excludes raw receipts, internal errors, paths, grants and recovery data. Tool-call success is not evidence that a pending proposal executed; state/verified flags state the outcome explicitly.
- Requests are limited to 32 KiB; sessions to 1,000 calls and 1,000 unique turns; document allowlists to 100 IDs. No unbounded replay cache or silent cache eviction reauthorizes actions.

## Verification and remaining work

`node --test tests/provider-tools.test.mjs` covers 15 cases, including hostile mode/path/permission inputs, wrong identity, duplicate/altered calls, session ownership, project-change races, closure during prepare/preflight/dispatch, legacy-approval refusal, failed response transport, and fresh scoped grants. It uses the actual ActionGate and in-memory fixture adapter. No paid model turn, native-board mutation or new dependency is involved.

## Opt-in real-process qualification

Run `npm run test:provider-isolation` on the qualified machine. It launches the actual configured Codex executable against a synthetic Responses endpoint bound to an ephemeral loopback port. No paid model, copied account credential, native adapter, customer document or production server is used. It produces a compact receipt in a fresh temporary directory and shuts down the child and local endpoint. Temporary test profiles/journals are retained for inspection, outside the project and customer workspace.

`server/provider-isolation.mjs` pins the exact executable version, SHA-256 and feature-name inventory. A binary update or unsupported platform fails before launch; requalification is required, not a blind pin update. This is a **test-only qualification policy**, not the production launcher. All feature flags are explicitly disabled except skipping host skill discovery; the child gets a separate profile, empty temporary working directory, stripped environment, no MCP/plugins, no credential-store inheritance, no project instructions, no history persistence, read-only policy and no approvals. The host verifies config/read before starting a turn, and the loopback endpoint verifies the exact tool schemas on every model request.

Observed on 0.153.4:

- Only the three Benchline tools plus the non-mutating built-in request_user_input are advertised. The client rejects non-mediated server requests; the question tool cannot approve an action.
- The removed apps_mcp_path_override flag appears in feature discovery but is omitted from config/read. Only that exact known omission is accepted; missing active flags fail.
- Codex drops JSON Schema format and adds empty properties to an unstructured object. Definitions now use its supported wire shape; UUID, document scope and argument validation remain enforced in the host, not delegated to schema hints.
- Ten scenarios / 34 local model requests passed: Discuss write refusal and read execution; Agent pre-approval refusal, hostile self-approval arguments, host Allow once and replay; decline; scoped Always allow with fresh proposals, changed-scope reapproval and revocation; forged shell, patch, MCP and approval function calls; and a custom-format patch call. Forbidden calls returned rejection to the synthetic model with no mediated dispatch or sentinel-file creation.
- Test decisions are made by the harness as the host. This is not a human approval UI journey. Successful writes affect only an in-memory fixture label. Production native adapters are never registered in the probe.

This demonstrates the installed process's behavior for a synthetic local provider. It does **not** establish OS confinement, arbitrary host-RPC restrictions, authenticated model/provider variants, network egress confinement, or the production UI/session lifecycle. The real Codex process necessarily sends model requests to the synthetic local endpoint; removing model-visible network tools is not a claim that the process has no network access. Ephemeral thread mode is not a promise of zero internal runtime metadata.

Historical pre-enablement checklist for the synthetic-provider increment (later
progress is recorded in BL-04 evidence; this is not the current remaining-work list):

1. Supply a reviewed isolated production provider profile and explicit sign-in flow to the new transport: no direct native MCP, shell/file mutation, unmediated app/browser/network, inherited plugin/skill or other bypass tools. Extend the synthetic evidence to each supported authenticated provider/model, check effective configuration and runtime behavior, and never expose arbitrary host RPC. Do not silently copy existing account credentials or treat this test-only policy as production-ready. The guarded board-centric handlers in server/index.mjs must be replaced by product-scoped lifecycle calls rather than unguarded.
2. Bind product/UI selection to session creation and accepted thread/turn lifecycle. Register these dynamic definitions and wire approval visibility without exposing human approval APIs to the provider. Product changes must close the old session.
3. Define reviewed adapter-specific result projections for useful read results; raw journal receipts remain host-only. Add appropriate context and visuals through explicitly bounded interfaces.
4. Complete native adapter preservation/recovery conformance and a production-path disposable-board journey. The earlier isolated native experiment is not this end-to-end test.
5. Rerun UI/provider/native verification, then assess the unchanged BL-04 criteria. Under ROADMAP_EXECUTION.md, continue eligible successors automatically only once their prerequisites are verified; this increment alone does not satisfy BL-04.

## Isolated account setup (account-only process cannot execute models)

The Product workspace now exposes a collapsed **AI account setup** section. Loading
the page reads inert status only. Explicit consent enables **Prepare isolated account
setup**, which starts the pinned executable with a Benchline-owned profile under
the instance state directory. It does not import global credentials, permissions,
plugins, project instructions or customer files. An account-only RPC allowlist cannot
create threads or model turns, dispatch engineering tools, or consume usage resets.

The user may explicitly start managed ChatGPT sign-in, follow the validated official
HTTPS link, then check sign-in status. Login URLs are returned only to that caller,
not persisted in projects or status. Notifications invalidate cached account status;
only a fresh account/read establishes signed-in state. API keys, external auth tokens,
arbitrary endpoints and client-selected profile paths are not accepted by these routes.

Disconnect closes the account process but retains the private profile. Sign out is a
separate explicit operation affecting that profile only. Overlapping disconnects await
the same shutdown; reconnect waits until ownership is released. Late replies cannot
restore disconnected state. The profile lock is removed only after the child closes.
Changed/unowned profiles, unexpected symlinks or permissions, mismatched executable
or feature inventory, and stale locks are refused and preserved, never silently adopted,
rewritten or deleted. Stale-lock recovery still requires inspection; no recovery UI exists.

Initial verification covered signed-out prepare/check/disconnect/reconnect using the
actual executable and browser UI, plus adversarial controller/profile tests. Later
signed-in execution and product wiring are recorded in BL-04 evidence. Account setup
itself remains account-only and cannot qualify or authorize engineering actions.

## Product controller and agent panel (explicit runtime opt-in)

`server/provider-controller.mjs` wraps the mediated session with host-selected project,
document IDs, mode and expected manifest/epoch. Selection replaces and revokes the old
session; each accepted selection gets a fresh ID. Turn, stop and disconnect calls must
match that ID, so a stale window cannot operate a newer selected session. Resolution
checks run both before and after process/thread setup, and the underlying session still
rechecks targets before each turn. Client input cannot include launch paths, credentials,
arbitrary RPC methods, resume IDs or approval decisions.

The `/api/provider/product` HTTP routes are mounted behind the existing local host/origin
guards. Status is inert and uncached. Selection is unsupported unless the host supplies
the qualified runtime; an enabled connection rechecks pins/account/model without
fallback. Controller/HTTP tests inject a protocol fixture; actual server startup tests
verify opted-in capabilities, inert account state and rejected selections. These startup
checks are distinct from the retained signed-in model qualification.
The project model now includes an agent panel with explicit document scope, mode,
connect/cancel/disconnect, message and stop controls. Server capability results keep
unsupported connection/send controls disabled. No existing session is adopted merely
because it appears in a status response. Project/manifest/epoch changes remount the
scoped panel and close its owned session; unsent drafts remain per-product in memory.
Failed/uncertain sends preserve the draft, never automatically retry it. These drafts
and transcripts are not yet durable workflow records (BL-06 remains unimplemented).

Opening has a host-issued selection ID before transport creation. Matching stop or
disconnect revokes authority, aborts the opener, closes any available transport, and
waits for late cleanup before a replacement may open. Aborting the HTTP selection
request also cancels only that request's generation. The trusted opener must honor
its AbortSignal; an uncooperative opener is awaited, not assumed stopped or replaced.

The session callback projects only matching-turn assistant text into a bounded,
selection-owned transcript: 100 messages, 32,000 characters per message, 200,000
characters total. Raw diagnostic/tool/login events and receipts are excluded. UI
renders text without HTML execution and labels truncation. Active owned panels poll
status/transcript; inactive panels do not poll. Clearing a session clears its transcript.
Conversation text remains untrusted prose, never verification or approval evidence.

The positive signed-in model/UI/native journey, preservation/recovery and bounded read
projections have later evidence. Final registered native binding and coordinated
server-shutdown verification passed. Legacy board-centric chat stays disabled;
BL-05/06/07 are now eligible, not completed by this provider qualification.

## Authenticated model transport (used by the qualified opt-in runtime)

`server/provider-model.mjs` adds the missing account-profile-to-model transport layer.
It requires a fresh managed ChatGPT account/read result, discovers a bounded model
catalogue, and refuses a requested model absent from the visible text-model catalogue.
No model fallback, login, credential copy or automatic account-setup disconnect occurs.
The account ceremony must release its exclusive profile lock before this transport opens.

The candidate supports one ephemeral thread with the exact selected model, OpenAI
provider, isolated empty working directory, no extra workspace/environment/capability
roots, read-only sandbox and no approval prompts. It checks the returned model, provider,
working directory, sandbox, ephemeral flag, loaded instruction sources and runtime roots.
After setup, only strict own-thread start/interrupt inputs are accepted; account changes
close the transport. Raw account/launch/config/resume methods are not exposed to the
caller through this bound request interface. These constraints do not certify OS or
network confinement, nor the authenticated model's complete advertised tool inventory.

The shared profile launcher now accepts cancellation during discovery and process setup,
and retains the abort listener until process close. Account-only and candidate model
transports have separate RPC allowlists. The account-only transport still cannot list
models or create threads. The product controller instantiates this transport only through
the qualified runtime factory with explicit model selection; unconfigured instances
remain unsupported.

Run `npm run test:provider-model-profile` for a repeatable no-login/no-generation check
on the pinned host. It verifies signed-out rejection, catalogue discovery, exact structural
thread settings, account-profile reuse and lock release. It may use the advertised default
model for the structural thread but never calls turn/start; this is not a production model
choice or an authenticated execution test. A redacted receipt is written outside source.
The implementation follows the fetched [official app-server documentation](https://learn.chatgpt.com/docs/app-server)
and schemas generated from the exact configured executable.

## Explicit authenticated smoke (not a production qualification)

`tests/fixtures/provider-authenticated-smoke.mjs` is opt-in only. It requires an
existing signed-in account root, explicit binary, `--use-advertised-default` and
`--run-one-turn`. Disconnect account setup first through its normal endpoint; the
probe refuses an occupied profile. It uses the existing pinned profile launcher,
requires exactly one advertised visible text default, then binds that exact model
to a fresh Discuss session. No fallback or credential copy is performed.

Each invocation starts at most one accepted model turn, with a 60-second turn wait,
90-second overall abort, and bounded tool callbacks. Only an in-memory fixture
adapter is registered. The smoke requires observed host write denial, verified read,
unchanged fixture state, no recurring grants, empty workspace and profile release.
A completed model turn or reassuring model prose cannot satisfy those assertions.
Private receipts preserve failures and bounded untrusted assistant diagnostics.

The owner-approved default was `gpt-6-astra` on 2026-09-08. Both initial turn and
one diagnostic retry completed with zero mediated callbacks, so both tests failed.
The retry reported a disabled tool host, but model prose is not authoritative
runtime evidence. The current profile disables Code Mode/host features along with
other nonessential features; compatibility needs investigation before changing
that isolation policy. Do not enable a host, switch models or claim authenticated
tool qualification just because account access and plain generation worked.
Account setup was reconnected signed in after both probe processes closed.

### Code Mode candidate follow-up (2026-09-09)

The cached model catalogue marks Astra `tool_mode: code_mode_only`, whereas the
baseline profile disables `code_mode`, `code_mode_host` and `code_mode_only`.
`tests/fixtures/provider-code-mode-probe.mjs --exercise` now reproduces the runtime
error `code-mode host is disabled` against a credential-free loopback synthetic
provider. This is direct protocol evidence, not reliance on the model explanation.
With `--host-enabled --exercise` (also `npm run test:provider-code-mode`), the
disposable profile verifies a denied write and a verified read, unchanged fixture,
exact three-tool `ALL_TOOLS` inventory, absent selected bypass tools and I/O globals,
denied Node import, no grants and empty workspace. Its first enabled exercise had
an incorrect assumption that dynamic tool results are objects; the runtime returns
JSON text here. The failed receipt is retained and the corrected probe parses that
text before using actionId. This does not change production tool semantics.

`openCandidateCodeModeProfile` is a separate, non-production launcher. It verifies
the sibling host SHA-256 as well as the existing Codex pin, and uses only three
temporary command-line feature overrides. The on-disk account configuration and
ownership marker stay unchanged. Effective configuration requires those exact
three deltas and every original endpoint, sandbox, inheritance and remaining feature
check. Account-only and baseline model launchers explicitly disable this variant;
no production route selects it. Neither pin is a blanket sandbox certification.

The authenticated smoke accepts the explicit additional `--code-mode-candidate`
flag. The owner-approved default remained `gpt-6-astra`; one fresh live turn passed
all smoke assertions with three observed callbacks, one read dispatch and no write.
Account setup reconnected signed in after process/lock release. No customer data,
CAD adapters, copied credentials, new service, public release or production mode
enablement was involved. Full authenticated inventory/bypass coverage, Agent human
approval lifecycle, native conformance and positive product UI integration remain
required. Do not mark BL-04 complete from this bounded pass.

### Code Mode lifecycle matrix (2026-09-09)

`npm run test:provider-code-mode-isolation` now runs the existing real-process
synthetic-provider suite through the Code Mode host. The unchanged default command
`npm run test:provider-isolation` still covers direct function calls. Each variant
uses its own new credential-free profile and every scenario starts a fresh process
and mediated session. There is no second approval implementation: both use the
actual ActionGate, CodexAgent and MediatedProviderSession.

Each variant currently passes 15 scenarios / 48 synthetic model requests: Discuss
denial/read, Allow once and no self-approval/replay, decline, scoped Always allow
with fresh previews/changed-argument reapproval/revocation, stale fixture revision,
mutation followed by response loss and no duplicate execution, stop while approval
is pending, stop after a verified change, stop during dispatched mutation, and six
forged raw shell/patch/MCP/approval calls. Interruption checks wait for the matching
real `turn/completed` notification with `interrupted` status. The in-flight case
drains the existing action queue without replaying the mutation and confirms the
journal distinguishes applied work from cancellation; it does not pretend to undo.

Code Mode requests are checked for the expected top-level exec/wait/question tools
and exactly the three mediated nested declarations. This is not the same as observing
every authenticated model-specific advertised schema; that gate remains open. Host
test code supplies the synthetic approval decisions, not the model or a real user
click. Successful suite exit remains synthetic transport/fixture evidence only.

Generated the exact pinned executable's experimental protocol schema during local
diagnosis. `experimentalRawEvents` is explicitly described as internal-use-only;
it was not enabled in production or the signed-in candidate, and no raw response
capture is claimed. Next work remains authenticated tool-inventory qualification,
the actual product approval journey and native conformance, not another repetition
of these already-passing fixture cases.

### Product approval handoff (2026-09-09)

The product controller now opts into a host-only `waitForApproval` setting. A
write proposal's callback stays pending until a persisted host/UI decision, a
terminal state, or its existing 60-second preview expiry. The wait does not hold
the ActionGate queue while the person decides. Reads and existing exact-scope
grants return normally; this setting never approves or executes anything itself.
Stop, disconnect, scope replacement and matching completion abort pending waits
and revoke turn ownership before subsequent dispatch. Failed journal persistence
cannot release an in-memory approval as a successful callback. Expiry records an
expired action; a new proposal is required. Low-level diagnostic sessions retain
their original immediate-return behavior unless the host explicitly opts in.

Action controls now poll the selected project's journal with non-overlapping,
abortable reads. Decision requests invalidate in-flight reads and pause polling;
navigation cancels the old view. Polling errors are visible, never interpreted as
an empty or successful journal. The UI displays each pending decision's deadline.

`node tests/fixtures/product-approval-ui.mjs --serve-disposable-fixture` runs an
explicit separate loopback test server with the actual ProductAgent, ActionControls,
ProductProviderController and ActionGate. Only this test server advertises its
scripted fixture provider; production capabilities are unchanged. Messages become
in-memory fixture labels. It has no account, model, native adapter or customer
document. Shutdown saves a private receipt and closes the test session/server.

Browser-driven Allow once, Decline, Always allow, identical reuse, revoke, fresh
reapproval and Stop passed, with the expected journal and no browser warnings/errors.
This proves the rendered host approval journey for a scripted fixture, not a human
acceptance sign-off or an authenticated model/CAD integration. The expanded actual
Codex-process suites pass 18 scenarios / 54 synthetic requests per transport,
including a held callback independently approved, declined or interrupted by the
test host. Both production modes remain unsupported pending the remaining gates.

### Authenticated held-approval fixture (2026-09-09)

The opt-in authenticated smoke now additionally accepts `--approval-once` only
after `--code-mode-candidate`, while preserving explicit root/binary/default-model
and one-turn flags. It keeps the same pinned candidate launcher and isolated
profile; production has no route to select it. This variant uses Agent mode and
the same host-only waitForApproval path that the product controller selects.

Only one exact in-memory label proposal is permitted by the test host. After its
preview is persisted, an independent one-second wait verifies that the session is
working, its action awaits approval, no callback response has been returned and
no adapter dispatch has occurred. The host then chooses once. The model must
receive approved, execute once and return verified; the receipt checks the exact
two callbacks, one action/dispatch, expected value/revision, zero grants and empty
workspace. This is a test-host decision, not self-approval or a real user click.

The existing signed-in account advertised `gpt-6-astra` as its sole visible text
default. One live turn passed this variant; profile lock released, account setup
reconnected ready/signed-in, production execution still false. No credentials were
copied and no customer/native adapter existed. The prior scripted browser journey
and this authenticated callback test are separate evidence: their combined
end-to-end live-model browser journey, complete authenticated tool inventory and
native conformance remain open.

### Combined authenticated product/UI harness prepared (2026-09-09; live run pending)

`tests/fixtures/authenticated-product-approval-ui.mjs` now connects the existing
ProductAgent and ActionControls to the real ProductProviderController/ActionGate
and pinned candidate model launcher. It is an explicit separate test server;
production imports, capabilities and launch guards are unchanged. No signed-in
process or model turn was started while implementing or testing this increment.

The host helper `authenticated-product-approval.mjs` requires an existing dedicated
account profile, checks ownership-marker/lock metadata without reading credentials,
and opens it only after explicit product selection. Its ordinary launcher retains
all binary/profile/account checks. One profile-opening attempt and one exact
prefilled model-turn prompt are permitted for the entire harness lifetime, including
disconnect/reconnect. Failures do not reset those bounds. The visible advertised
default is selected without fallback. Only one exact in-memory fixture label proposal
is accepted; no native/customer adapter exists. A 90-second model-turn deadline
revokes the session; the HTTP harness closes after ten minutes if abandoned.

This scenario accepts only human **Allow once** or **Decline**, through the real
action controls. It never calls decide automatically. Always allow is deliberately
refused by this bounded test host, not removed from the product. Manual HTTP action
prepare/execute routes are denied so they cannot substitute for model callbacks.
Evidence captures held-approval observation, decisions, turn counts/status, dispatches
and the actual journal. `browserVerified` and `passed` stay false: a receipt cannot
self-certify the visual journey. No raw account replies, credentials or arbitrary
provider diagnostics are projected to the browser. Only this test server advertises
its Agent candidate; Discuss remains unsupported here.

The shared fixture page renders a host-supplied test notice and initial prompt as
plain React text; the credential-free scripted server retains its original defaults.
HTTP Host/Origin checks and explicit Vite deny rules protect `.runtime`, `.git`,
environment files and key material. A synthetic sentinel confirmed both ordinary
and `/@fs` runtime-file requests are denied; no real credential path was requested.

Verification: six injected-transport tests cover required flags, inert construction,
exact prompt, one attempt across reconnect, once/decline, no self-decisions or grants,
wrong-label rejection, and timeout cancellation. An actual separate HTTP/Vite process
test loads/transforms the real components, checks capabilities, Origin and manual-route
denials, runtime-file denial, inert counters and clean shutdown with retained evidence.
This is HTTP/protocol-fixture evidence, **not authenticated execution or rendered
browser acceptance**. React checklist: abortable existing fetch retained, direct
component imports, plain-text notice/prompt, no new effects or mutable UI authority.

Manual run after Mac unlock and normal account-setup disconnect (never remove its
lock or copy credentials):

```sh
node tests/fixtures/authenticated-product-approval-ui.mjs \
  --serve-authenticated-fixture \
  --account-root /absolute/path/to/existing/benchline/account-profile \
  --binary /absolute/path/to/pinned/codex \
  --use-advertised-default --run-one-turn --code-mode-candidate --approval-once
```

Use the emitted loopback URL. Choose Agent and the sole fixture document, connect,
send the exact prefilled prompt, verify the pending action/no dispatch, then explicitly
choose once or decline. Inspect the resulting action and transcript independently;
stop the harness, retain its receipt and reconnect account setup normally. This command
is preparation, not a claimed run or new authorization. The prior approved bounded
model-test scope still governs execution. Combined live-model/browser, complete
authenticated tool inventory and native production conformance remain unfinished.

Protocol reviewed against the fetched [official App Server documentation](https://learn.chatgpt.com/docs/app-server)
on 2026-09-09. It still describes dynamic tool callbacks as experimental; documentation
and unit fixtures do not substitute for checking the pinned executable's live behavior.

### Headless product approval qualification (2026-09-09)

An unlocked Mac is not required for browser checks: the existing local Playwright
runtime and cached Chromium can render the loopback fixture headlessly. The
agent-browser CLI was absent; Docker browser loopback could not reach this Mac.
No new browser package was installed or listener exposed beyond loopback.

`tests/fixtures/browser-approval-check.mjs` now exercises the real rendered scope,
Connect, Send and Allow once controls. Explicit scripted/authenticated flags and
absolute runtime/browser/output paths are required. It checks zero dispatch while
held, a single submitted turn, one verified action, no grants, no manual execute
requests and browser errors. Browser-driven approval is **automated test-operator
approval**, not human acceptance. Backend receipt flags remain independent.

One actual signed-in default `gpt-6-astra` turn reached awaiting-approval with zero
dispatch, received the browser click, executed exactly once and completed. The
saved receipt reports one profile/turn/proposal, decision `once`, no timeout,
one verified label and an empty execution workspace. However, that browser run
failed its console-error assertion: two Vite middleware servers competed for
port 24678 despite `hmr:false`. Its failure receipt and screenshots are retained;
do not call the combined authenticated browser journey cleanly qualified.
The final completed transcript was captured by a separate read-only HTTP readback,
not observed in the original browser before that failure.

Both fixture servers now attach Vite's websocket to their own ephemeral loopback
HTTP server. Two simultaneously running scripted fixtures subsequently passed the
complete browser check with zero console/page errors. A missing test-page favicon
was also corrected. The checker now explicitly polls and asserts completed turn
status and waits for the ready UI, rather than trusting the earlier browser
waitForFunction observation. No second authenticated generation was attempted.

Evidence: `.runtime/headless-authenticated-approval/{pending.png,failure.png,failure.json,completed-readback.json}`;
final host receipt `/var/folders/f8/pt30b9455vsgtbwk9yd9vvgc0000gn/T/benchline-authenticated-ui-jAcvxz/ui-evidence.json`;
clean scripted receipts/screenshots in `.runtime/headless-shared-port-first/` and
`.runtime/headless-shared-port-second/`. The authenticated server exited 0 and
ordinary account setup reconnected ready/signed-in, without reading or copying
credential files. Production capability flags and all BL-04 acceptance boxes remain
unchanged. Next qualification must retain these failures and test the corrected
authenticated journey deliberately, not silently retry an uncertain generation.

### Corrected authenticated browser journey (2026-09-09)

The deliberate post-fix run passed, preserving the previous failure. Command:
`browser-approval-check.mjs --authenticated-once` against the one-turn test host,
using bundled Playwright 1.62.1 and cached Chromium 1228. Existing dedicated account
profile and pinned executable were reused without copying credentials. The model
catalogue again selected `gpt-6-astra` as its sole advertised visible text default.

Observed in the rendered UI and independently checked in the journal: pending
approval with zero dispatch, automated test-operator Allow once click, exactly one
verified mutation, no recurring grant, completed turn, ready UI, and final model
message. Zero console/page errors; no manual prepare/execute HTTP substitution.
Both pending and verified screenshots were retained and the final screenshot was
visually inspected. This is automated browser acceptance of the fixture journey,
not a human product signoff, CAD execution, or full sandbox certification.

Receipts: `.runtime/headless-authenticated-approval-corrected/{browser-evidence.json,pending.png,verified.png,rendered.txt}`;
shutdown receipt `/var/folders/f8/pt30b9455vsgtbwk9yd9vvgc0000gn/T/benchline-authenticated-ui-Q02BRD/ui-evidence.json`.
Host exit 0; one profile attempt, one accepted turn/proposal/decision/dispatch,
no timeout, empty workspace. Normal account setup restored ready/signed-in.

The remaining authenticated inventory gate cannot be satisfied by asking the model
to recite its tools. A credential-free pinned Code Mode probe now retains bounded
runtime item and event-method observations. Its completed items contain the three
mediated callbacks, user and assistant messages, but not the outer `exec` result
that contains the inspected runtime inventory. That result is visible only to the
synthetic model endpoint in this experiment. The generated installed experimental
protocol schema exposes no tool-inventory read RPC; `modelProvider/capabilities/read`
reports only imageGeneration, namespaceTools and webSearch booleans. This is a
verified diagnostic limitation, not evidence that authenticated tools are absent.
No credential interception, model-prose attestation or production enablement was used.
Next: qualify the native adapter/recovery path and obtain authoritative inventory
evidence for the exact signed-in provider before enabling production modes.
