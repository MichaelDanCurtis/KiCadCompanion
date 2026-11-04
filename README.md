# Benchline

**BL-04 verified within its bounded local scope:** the product agent has an explicitly opted-in, pinned local dispatcher and revision-bound action gate. Native model assignment is registered only for a separately qualified disposable scope; generic native writes are not enabled. [Registered live binding and coordinated shutdown verification passed](docs/benchline/evidence/BL-04.md#2026-09-09--registered-live-binding-and-coordinated-shutdown-review). The legacy companion agent and AI studio launcher remain disabled; the main preview is now product-neutral without enabling the qualified runtime. See [local runtime configuration](docs/benchline/LOCAL_RUNTIME.md) and [current boundary](docs/benchline/ACTION_BOUNDARY.md). BL-05/06/07 are now eligible, not complete; no public-release or universal security claim is made.

## Benchline product roadmap

**Benchline** is an independent AI workspace for building connected products, starting with the KiCad companion. The approved local cutover now opens a product-neutral preview; customer projects remain separate from the product source. See the [separation handoff](docs/benchline/SEPARATION_HANDOFF.md). Start with the [roadmap](docs/benchline/ROADMAP.md), [goal execution guide](docs/benchline/GOALS.md), and [BL-01 evidence](docs/benchline/evidence/BL-01.md). These milestones have evidence-based acceptance criteria; documentation does not activate an agent goal or authorize publication.

A product-first workspace that starts with “What are we building?”, saves a brief, proposes a build sequence, and opens a project command center. The existing KiCad experience remains a specialist Electronics workspace with live context, visible actions and approvals, engineering visuals, and board renders.

The [product intake preview](docs/benchline/PRODUCT_INTAKE.md) uses local rules, not AI research. Plan approval does not run tools. **Product → Project model** now creates portable product manifests, explicitly snapshots saved briefs, registers native-file references, and tracks cross-discipline change impact. See the [model and recovery guide](docs/benchline/PROJECT_MODEL.md). Real cross-discipline execution remains to be implemented.

**Local review draft. Not published, not an official KiCad or Konnect product, and not a production release.** Licensing and ownership decisions are pending. This repository is private/unlicensed pending review; dependency licenses still apply. Start with [the upstream proposal](docs/UPSTREAM_PROPOSAL.md) and [release checklist](docs/RELEASE_REVIEW.md).

## What it does

- Guides product intake across electronics, firmware, enclosure and application needs; retains open decisions, saved drafts, brief/plan revision history and plan-only approval.
- Shows live footprint positions, pad nets, straight tracks, selection and freshness through KiCad IPC. Click a part to select it in the editor.
- Provides an opt-in product-scoped Codex App Server client with streamed messages, interruption and action approvals. Allow once, Decline and exact project/document/action-scoped Always allow remain visible and revocable.
- Uses Konnect MCP for design actions. A separate observer client handles checks; no Konnect source or binary is bundled here.
- Displays real A2UI 0.9 charts, tables and connection graphs through a bounded React component catalog.
- Renders saved boards with KiCad's ray tracer, including perspective/top/bottom views and KiCad/white/black/green/red finishes. Image-only presets do not alter fabrication settings.
- Retains the prototype AI studio presentation workflow, currently unavailable because its legacy launcher remains disabled. Its illustrative outputs and provenance are separate from engineering evidence; it is not a free or unlimited image API.
- Keeps local history and reports missing or hidden component models instead of inventing them.

## Quick start (macOS preview)

Requires Node 22+, KiCad 10, Konnect, `uv` (or equivalent Python environment tooling), and a compatible signed-in Codex runtime for agent features. Swift/Xcode command line tools are needed only for the native wrapper. Use your existing installations; this package does not install them globally.

```sh
npm ci
uv venv .runtime/venv
uv pip install --python .runtime/venv/bin/python kicad-python==0.8.0
npm run build
export BENCHLINE_WORKSPACE=''
export COMPANION_WORKSPACE=''
export BENCHLINE_AUTOCONNECT=0
npm run build:native
npm run launch
```

`npm run launch` starts product-neutral on port 4318, removes inherited `BENCHLINE_*` and `COMPANION_*` settings, and disables automatic connections. It does not import customer history, permissions, or provider opt-ins. To intentionally use configured settings, run `BENCHLINE_WORKSPACE='/path/to/your/pcb-project' BENCHLINE_AUTOCONNECT=0 npm run launch:project`. The lower-level `dev`, `start`, native-build and plugin-install commands still consume explicit environment settings; they are not the neutral launcher.

Without an explicitly configured workspace, the legacy board view discovers no boards. After configuring a workspace, choose a board in the UI; discovery does not silently select the first one. A previously selected board may resume from that project's own Benchline state. Select a narrow project folder, not your home directory. The new product agent instead uses an isolated empty working directory and host-resolved product/document scope; it requires the separate [runtime opt-in](docs/benchline/LOCAL_RUNTIME.md).

The browser UI defaults to `http://127.0.0.1:4318`. The launcher verifies the product, checkout, project, and state directory before reusing a service. For a deliberately configured launch, choose another `BENCHLINE_PORT` with `launch:project` if occupied. Closing the native window leaves its server running; identify the listener before stopping a server.

Open the matching board in KiCad and enable its API. Board identity and observation freshness are checked before selection. Restart the backend after changing configuration. `npm run install-plugin` optionally installs a **separate Benchline preview** action and refuses to overwrite an existing install. Native builds and plugin installation capture selected non-secret configuration and the exact checkout/Node paths. Configure the environment before building/installing; shell exports are not automatically inherited by an already-open GUI app. A moved checkout needs a rebuilt native wrapper. Existing companion bundles/plugins are left alone.

## Configuration

Environment variables are read directly; `.env` files are **not** loaded automatically. [`.env.example`](.env.example) documents the settings. Common options:

| Variable | Purpose |
| --- | --- |
| `BENCHLINE_WORKSPACE` | Explicit narrow project directory for board discovery and isolated project state |
| `BENCHLINE_BOARDS_DIR` | Board subtree relative to the workspace, default `.`; symlink escapes rejected |
| `BENCHLINE_PORT` | Loopback port, default 4318 |
| `BENCHLINE_STATE_DIR` | State base, default `.runtime/benchline`; isolated `projects/<workspace-hash>` subdirectories |
| `BENCHLINE_AUTOCONNECT=0` | Disable automatic KiCad/agent connections for offline review |
| `BENCHLINE_PROVIDER_RUNTIME`, `BENCHLINE_PROVIDER_MODEL` | Paired opt-in for the pinned local product dispatcher and one explicit model |
| `BENCHLINE_NATIVE_MODEL_REGISTRATION` | Host-owned qualification JSON for the narrowly scoped native model adapter; absent/invalid binding is unsupported |
| `CODEX_BIN`, `KONNECT_BIN` | Explicit executable paths; configured model is preserved |
| `COMPANION_PYTHON` | Python with official `kipy` IPC bindings |
| `KICAD_APP`, `KICAD_CLI`, `KICAD_PCB_EDITOR` | Override the standard macOS KiCad installation |
| `KICAD_PYTHON` | KiCad Python interpreter with legacy `pcbnew`, for read-only model coverage |
| `KICAD_SUPPORT_DIR`, `KICAD_3DMODEL_DIR` | KiCad support/model paths |
| `KICAD_CONFIG_HOME` | KiCad configuration base; `10.0` is appended |
| `COMPANION_KICAD_CONFIG_DIR` | Explicit versioned KiCad preference directory |
| `KICAD_API_SOCKET`, `KICAD_API_TOKEN` | Inherited IPC endpoint/authentication settings |

macOS locations are fallback discovery candidates, not required personal paths. Windows/Linux defaults exist where straightforward, but those platforms have **not** been validated. Native packaging and the current model-coverage implementation remain macOS/KiCad-10 oriented.

Legacy `COMPANION_WORKSPACE`, `COMPANION_BOARDS_DIR`, `COMPANION_PORT`, and `COMPANION_AUTOCONNECT` remain fallback inputs; Benchline-prefixed settings take precedence. `COMPANION_RUNTIME_DIR` is deliberately ignored: no old histories or permissions are imported. The observer environment remains at `.runtime/venv` by default; `BENCHLINE_PYTHON` overrides it, with `COMPANION_PYTHON` as a fallback. Migration is configuration-only and dry-run by default; see [migration instructions](docs/benchline/MIGRATION.md).

## Safety and limits

The live board drawing is a simplified overview, not KiCad's exact viewport. Filled zones, full footprint artwork, arcs, and arbitrary selections are not fully reproduced. DRC and renders use saved files, excluding unsaved edits. A render is rejected if the board hash changes while it is produced. Available model files are not proof of dimensional correctness.

AI studio images can change geometry and labels. They are presentation artifacts, never fabrication evidence. Model assignment is a separate, reviewable design operation. The legacy read-only model auditor must be replaced for a KiCad-forward release; it never saves the PCB.

The opted-in product Discuss mode uses execution-layer mutation refusal, a pinned central-dispatch allowlist and a mediated tool gateway, not prompt-only permissions. Its native actions pass through the revision/approval gate; model text cannot grant consent. This is not a universal OS sandbox or permission to edit customer boards. The legacy prompt-only launcher remains disabled. Stopping a turn does not undo completed actions, and unknown results require review rather than retry. Only Codex is implemented as an agent provider today; release/security review remains separate.

The server listens on loopback, checks Host/Origin, and protects internal MCP callbacks with a per-process token. This is not a defense against other processes running under your account. Board context, prompts and reference images can be sent to the configured AI service. Logs, conversation IDs, remembered approvals, board paths and images live under `.runtime` and must never be published. Google Fonts is currently an optional external cosmetic dependency; system fonts are the fallback.

## Verification

```sh
npm test
npm run build
npm run review:check
npm run licenses:check
npm run build:native # macOS only
```

The offline startup test uses a temporary state directory and an ephemeral loopback port. It does not contact KiCad or Codex. Live tests are opt-in and require `COMPANION_URL` explicitly: `node tests/live-smoke.mjs` changes selection and adds a visual; `node tests/render-live-smoke.mjs` creates local images. Do not point them at someone else's active session.

The [license inventory](docs/benchline/licenses/README.md) is version- and platform-specific. Its normal check verifies the reviewed local package/notice snapshot; `npm run licenses:release-check` deliberately fails until owner/legal/packaging gates are resolved. No product license or external terms were accepted by the audit.

[Verification evidence](docs/VERIFICATION.md) distinguishes fresh extraction checks from earlier live-prototype checks. No public CI run, installer certification, hardware validation or upstream acceptance is implied.

## Architecture and upstream direction

React/A2UI UI → local Node server → Codex App Server and Konnect MCP. A read-only KiCad IPC observer supplies live context; the KiCad CLI supplies saved-file checks/renders. The optional Swift/WebKit shell hosts the same UI. No new dependency is required in Konnect's core to run the UI separately.

We propose keeping the companion independently packaged initially, with narrowly scoped Konnect improvements discussed separately. See [UPSTREAM_PROPOSAL.md](docs/UPSTREAM_PROPOSAL.md). No issue, pull request, repository remote or license agreement has been submitted by preparing this draft.
