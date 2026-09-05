# KiCad Companion

A rich, separate window for collaborating with an AI agent while working in KiCad: live board context, visible actions and approvals, interactive engineering visuals, and actual / AI-assisted board renders.

**Local review draft. Not published, not an official KiCad or Konnect product, and not a production release.** Licensing and ownership decisions are pending. This repository is private/unlicensed pending review; dependency licenses still apply. Start with [the upstream proposal](docs/UPSTREAM_PROPOSAL.md) and [release checklist](docs/RELEASE_REVIEW.md).

## What it does

- Shows live footprint positions, pad nets, straight tracks, selection and freshness through KiCad IPC. Click a part to select it in the editor.
- Runs a Codex App Server client with streamed messages, tool activity, interruption and approval cards. Allow once, Decline and board-scoped Always allow remain visible and revocable.
- Uses Konnect MCP for design actions. A separate observer client handles checks; no Konnect source or binary is bundled here.
- Displays real A2UI 0.9 charts, tables and connection graphs through a bounded React component catalog.
- Renders saved boards with KiCad's ray tracer, including perspective/top/bottom views and KiCad/white/black/green/red finishes. Image-only presets do not alter fabrication settings.
- Optionally feeds an actual render to Codex's built-in image generator. The AI result is labeled illustrative, shown separately and saved with provenance. This uses the user's Codex account; it is not a free or unlimited image API.
- Keeps local history and reports missing or hidden component models instead of inventing them.

## Quick start (macOS preview)

Requires Node 22+, KiCad 10, Konnect, `uv` (or equivalent Python environment tooling), and a compatible signed-in Codex runtime for agent features. Swift/Xcode command line tools are needed only for the native wrapper. Use your existing installations; this package does not install them globally.

```sh
npm ci
uv venv .runtime/venv
uv pip install --python .runtime/venv/bin/python kicad-python==0.8.0
npm run build
npm run build:native
export COMPANION_WORKSPACE='/path/to/your/pcb-project'
npm run launch
```

Without a configured workspace, the app looks only in this repository's `projects/` directory, which is empty by default. It does not scan parent directories or start an agent without a board. The workspace is also the agent's working directory: select a narrow project folder, not your home directory.

The browser UI uses `http://127.0.0.1:4317`. The launcher refuses to reuse a service from another checkout or workspace. If a different companion already uses that port, set `COMPANION_PORT=4318` (or another free port). Closing the native window leaves its server running; identify the listener before stopping a server.

Open the matching board in KiCad and enable its API. Board identity and observation freshness are checked before selection. Restart the backend after changing configuration. `npm run install-plugin` optionally installs a **separate preview** action and refuses to overwrite an existing install. For the installed action, set configuration in its launch environment, or in a launcher wrapper; shell environment exports are not automatically inherited by an already-open KiCad app.

## Configuration

Environment variables are read directly; `.env` files are **not** loaded automatically. [`.env.example`](.env.example) documents the settings. Common options:

| Variable | Purpose |
| --- | --- |
| `COMPANION_WORKSPACE` | Narrow project directory, used for board discovery and agent cwd |
| `COMPANION_BOARDS_DIR` | Board subtree relative to the workspace, default `.` |
| `COMPANION_PORT` | Loopback port, default 4317 |
| `COMPANION_RUNTIME_DIR` | Local state directory, default `.runtime` |
| `COMPANION_AUTOCONNECT=0` | Disable automatic KiCad/agent connections for offline review |
| `CODEX_BIN`, `KONNECT_BIN` | Explicit executable paths; configured model is preserved |
| `COMPANION_PYTHON` | Python with official `kipy` IPC bindings |
| `KICAD_APP`, `KICAD_CLI`, `KICAD_PCB_EDITOR` | Override the standard macOS KiCad installation |
| `KICAD_PYTHON` | KiCad Python interpreter with legacy `pcbnew`, for read-only model coverage |
| `KICAD_SUPPORT_DIR`, `KICAD_3DMODEL_DIR` | KiCad support/model paths |
| `KICAD_CONFIG_HOME` | KiCad configuration base; `10.0` is appended |
| `COMPANION_KICAD_CONFIG_DIR` | Explicit versioned KiCad preference directory |
| `KICAD_API_SOCKET`, `KICAD_API_TOKEN` | Inherited IPC endpoint/authentication settings |

macOS locations are fallback discovery candidates, not required personal paths. Windows/Linux defaults exist where straightforward, but those platforms have **not** been validated. Native packaging and the current model-coverage implementation remain macOS/KiCad-10 oriented.

## Safety and limits

The live board drawing is a simplified overview, not KiCad's exact viewport. Filled zones, full footprint artwork, arcs, and arbitrary selections are not fully reproduced. DRC and renders use saved files, excluding unsaved edits. A render is rejected if the board hash changes while it is produced. Available model files are not proof of dimensional correctness.

AI studio images can change geometry and labels. They are presentation artifacts, never fabrication evidence. Model assignment is a separate, reviewable design operation. The legacy read-only model auditor must be replaced for a KiCad-forward release; it never saves the PCB.

Discuss-only mode is an agent instruction, **not an enforced read-only sandbox**. The instruction to use Konnect is likewise not a transport-level write gate. Stopping a turn does not undo completed actions. Always-allow scopes and app-server protocol handling require broader adversarial testing before public release. Only Codex is implemented as an agent provider today.

The server listens on loopback, checks Host/Origin, and protects internal MCP callbacks with a per-process token. This is not a defense against other processes running under your account. Board context, prompts and reference images can be sent to the configured AI service. Logs, conversation IDs, remembered approvals, board paths and images live under `.runtime` and must never be published. Google Fonts is currently an optional external cosmetic dependency; system fonts are the fallback.

## Verification

```sh
npm test
npm run build
npm run review:check
npm run build:native # macOS only
```

The offline startup test uses a temporary state directory and an ephemeral loopback port. It does not contact KiCad or Codex. Live tests are opt-in and require `COMPANION_URL` explicitly: `node tests/live-smoke.mjs` changes selection and adds a visual; `node tests/render-live-smoke.mjs` creates local images. Do not point them at someone else's active session.

[Verification evidence](docs/VERIFICATION.md) distinguishes fresh extraction checks from earlier live-prototype checks. No public CI run, installer certification, hardware validation or upstream acceptance is implied.

## Architecture and upstream direction

React/A2UI UI → local Node server → Codex App Server and Konnect MCP. A read-only KiCad IPC observer supplies live context; the KiCad CLI supplies saved-file checks/renders. The optional Swift/WebKit shell hosts the same UI. No new dependency is required in Konnect's core to run the UI separately.

We propose keeping the companion independently packaged initially, with narrowly scoped Konnect improvements discussed separately. See [UPSTREAM_PROPOSAL.md](docs/UPSTREAM_PROPOSAL.md). No issue, pull request, repository remote or license agreement has been submitted by preparing this draft.
