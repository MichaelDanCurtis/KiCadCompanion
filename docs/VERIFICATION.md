# Review extraction verification

Local verification date: 2026-09-05. This distinguishes the extracted package from its earlier working prototype. No upstream CI, publication or hardware approval is claimed.

## Fresh checks on this standalone source

| Check | Result |
| --- | --- |
| Dependency install and lockfile consistency | Passed with Node 22; install scripts disabled during initial extraction |
| `npm test` | 19 passing tests, including four new configuration/offline-startup checks |
| `npm run build` | Production React/Vite bundle built |
| `npm run build:native` | macOS Swift/WebKit wrapper compiled and signed ad hoc |
| `npm run review:check` | Staged-file scan passed; runtime, images, private paths and obvious credential patterns excluded |
| Dependency audit during lockfile update | Zero reported vulnerabilities at that time; not a security certification |

The offline startup test uses temporary empty project/state directories, non-existent Codex/Konnect executables, and an ephemeral port. It verifies that a clean start imports no boards, conversations, approvals or render history, rejects chat without a board, and enforces Origin/internal-token/project checks.

Configuration tests check narrow default discovery, explicit workspace and executable overrides, versioned KiCad config paths, port validation, and rejection of a board directory outside the selected workspace. Existing tests cover approval scope/persistence, protocol error propagation, A2UI schema processing, colors/contours, render provenance, invalid input and source changes.

## Prior prototype evidence — not repeated against this extraction

The preceding local prototype was exercised with live KiCad IPC, shared selection, A2UI charts/graphs, saved-file DRC, five render finishes, three camera views and one actual-image-to-AI-studio round trip. Native image display was visually inspected. Rendering left the saved PCB hash unchanged. The board had no assigned component models and the UI explicitly reported that absence.

No private board, screenshot, generated image, conversation, permission file or account metadata from those checks is included here. Those results establish the prototype behavior, not cross-platform support or full end-to-end certification of this refactored copy.

## Not run / still pending

- Extracted-package live IPC, agent and image-generation round trip using an approved shareable PCB.
- Native plugin installation from this checkout (intentionally not installed over the working app).
- Windows/Linux runtime and native packaging tests; macOS notarization.
- Full model-coverage fixtures with real assigned/missing/hidden/DNP model references.
- Enforced read-only permissions, broader malicious-input tests and fresh-machine setup.
- Upstream Rust gates: no Konnect code PR exists in this review repository.

Re-run the listed commands after changes. Publication requires the independent owner/privacy/licensing review in [RELEASE_REVIEW.md](RELEASE_REVIEW.md).
