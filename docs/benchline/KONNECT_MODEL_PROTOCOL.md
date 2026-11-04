# Private Konnect model protocol — 2026-09-06

BL-04 partial A3/A5 work. **Not production-qualified or enabled in Benchline.**
Latest startup, discovery and live preservation receipts: [native live checks](NATIVE_MODEL_LIVE.md).
This extends the [private native prototype](NATIVE_REVISION_GUARD.md), not the installed
Konnect or KiCad. No customer designs or preview processes changed. The previous goal turn
was progress: native dispatch/transport fixes and regression evidence changed the next action.

## Source and controls

Private Konnect checkout: `.runtime/konnect-revision-source`, v0.11.0 commit
`a22ad2153dcf45dbcf1cc63b5b0f1e40c93d7956`. Nine tracked files modified, two new Rust modules.
AGPL-3.0-only notices remain applicable; no relicensing, CLA, publication or distribution
approval is implied. The experimental KiCad protobuf is imported from its separate private
GPL source tree at build time, not silently copied into permissively licensed Benchline code.
Its source hash remains `53daf695f09be00b8327097ea44399dc34e339609ce1ed129a3a946eb8d273f0`.
The existing Cargo.lock is unchanged. Rust/Cargo 1.96.0 follows Konnect's pinned toolchain.

The `experimental-model-update` Cargo feature is absent from ordinary builds. Feature builds
expose a separate `experimental_models` toolset with four tools; each call also requires
`KONNECT_ENABLE_EXPERIMENTAL_MODEL_UPDATE=1`. This is a developer opt-in, not user approval.

- `experimental_get_model_context`: read-only discovery with an absolute board path;
  two native document reads pin and recheck the instance. Does not grant approval or
  verify a mutation revision.
- `experimental_preview_placed_models`: explicit native instance, absolute board path and
  complete model lists by placed-footprint UUID. Returns a native preview token, revision,
  before lists and expiry; explicitly does not grant approval.
- `experimental_apply_placed_models`: exact operation plus preview token. No automatic new
  preview, footprint refresh, saved-file editing or other fallback.
- `experimental_inspect_model_result`: reads the latest in-memory receipt in the pinned
  instance. Unknown/rejected outcomes are MCP errors, not successful application. Even an
  applied receipt has `state_verified: false` and `retry_authorized: false`.

Typed inputs reject unknown fields, absent transforms/visibility, invalid UUIDs, excessive
batch/model counts, nonfinite values, invalid opacity and nonpositive scale. Rotation is in
degrees, offset in millimeters and scale is dimensionless. Empty model lists deliberately
represent removal of all placed model references, still subject to native preview/approval.

The private client requires an explicit local IPC address and native instance token. It
resolves the requested existing board against exactly one absolute open-document identity
using a pinned-instance read. Relative/ambiguous/missing identity is rejected. The native
apply still owns authoritative freshness and document checks; a filesystem match is not a
live-revision guarantee. Client identity is process-bound correlation, not authentication.

NNG's ordinary cooked requester can automatically resend on disconnect even with a long
resend timer. The new client uses raw Req0 with one request per fresh socket, a four-byte
request ID and response correlation. It sends once, validates envelope status/instance/body
type and result token, and never converts a lost or malformed reply to success. Its send
timeout is five seconds, receive timeout 30 seconds, request limit one MiB and receive limit
two MiB. The protocol behavior was checked against the fetched nng/nng-sys primary source
and request-protocol manual, then exercised with real private Unix sockets.

## Verification receipts

Build commands run from the private Konnect source. Set `KONNECT_EXPERIMENTAL_KICAD_PROTO_ROOT`
to the absolute `api/proto` directory of the private KiCad source, and set `PROTOC` /
`PROTOC_INCLUDE` to the installed Protobuf 34.1 compiler/include paths. Rust generation does
not link the native C++ ASan runtime. This Rust build is debug, **not sanitizer-instrumented**.

```sh
cargo fetch --locked
cargo test --locked -p konnect-ipc -p konnect-core \
  --features konnect-core/experimental-model-update -j 6
cargo build --locked -p konnect --bin konnect \
  --features experimental-model-update -j 6
```

Fetch/build/test logs are ignored `.runtime/konnect-native-*.log` files. Final regression
`konnect-native-regression-final.log` exited 0:

| Suite | Passed | Explicitly ignored | Qualification |
| --- | ---: | ---: | --- |
| Core unit | 855 | 1 | Includes three new model/schema/outcome cases; ignored SVG case needs real kicad-cli |
| Core conformance | 4 reported | 0 | **All four returned early; corpus absent. No coverage credit.** |
| Core integration | 12 | 0 | Local temporary fixture/editor tests, not a live native window |
| IPC unit | 53 | 0 | Includes six new model client cases |
| IPC transforms | 4 | 0 | Local regression |
| IPC live-test executable | 1 | 3 | Only offline fixture check ran; all three GUI mutation tests ignored |
| IPC mock-server | 29 | 1 | Timeout-duration case ignored; no live KiCad claim |
| Doc tests | 0 | 1 | Existing ignored core doctest |

Thus Cargo reported 958 passed / six ignored; four reported passes were no-op corpus skips.
`konnect-native-corpus-observation.log` reran those four with `--nocapture` and confirmed the
skip messages. No test was removed or weakened. No ignored live mutation test was activated.

New IPC tests exercise preview envelopes, seven malformed/mismatched reply variants,
unknown receipt preservation/token mismatch, no resend after peer disconnect/restart,
explicit local/instance/document requirements, and one exact absolute document match versus
relative/ambiguous/absent matches. These are protocol fixtures, not the actual PCB Editor.

Real stdio MCP verification uses `.runtime/konnect-model-mcp-test/check.mjs` with the SDK,
private explicit configuration and a checked-absent socket; it never targets installed KiCad.
The first run failed because the harness expected a disabled-handler error for malformed
arguments, but the existing router correctly rejected the schema first. The corrected harness
tests malformed input rejection separately from valid disabled calls; it retains both checks.
Initial failure: `konnect-native-mcp-check.log`, exit 1. Final:
`konnect-native-mcp-check-qualified.log`, exit 0, both runtime opt-in states passed catalog,
schema/refusal checks, plus an unavailable-connection check while enabled.

An ordinary `--no-default-features` binary also built, exit 0, without the experimental proto
environment. Its SHA-256 was `f549a2d13e15d4f7a21b0ca1f641c493ed695517168e7aabc3da26c83e0464e5`.
`konnect-native-default-mcp-check.log` proves the toolset absent in real MCP discovery with
runtime opt-in both 0 and 1. The feature binary was then rebuilt for subsequent private tests;
final `target/debug/konnect` SHA-256:
`1af4768889f56657a3c2bad3fa3c1fa927d348d7ad29147692ce16c06a36b064`.
`konnect-native-mcp-build-qualified.log` records its successful build.

## Source SHA-256 receipts

Paths are relative to private Konnect source:

| File | SHA-256 |
| --- | --- |
| crates/konnect-core/Cargo.toml | 1ea2b93a316ab4f99fc9c73405ce3b7f89dd23e606fc028e9c21256188e30758 |
| crates/konnect-core/src/router/registry.rs | 6dd751399c29b86b21174cf8191da6e3aed2e754a3c47aab25500634d25ef0cf |
| crates/konnect-core/src/tools/mod.rs | 36aabe0dcc573f8c6d9afe75b1e43aef2bc3e07565f0657ce608e17e25343950 |
| crates/konnect-core/src/tools/experimental_models.rs | eb2683ac907b7643c727ad1f884367bda5d6f2e1d34db30eb7bd731868a87220 |
| crates/konnect-ipc/Cargo.toml | 7e662787a99e74567fa7dd9666f97210eb50fcb7103eedc3fa9553d1a160f94c |
| crates/konnect-ipc/build.rs | 7f7eb31da9ee3f9e2e4b263097ca5b89314e3dcdbaa007df7503eab103bcf3a9 |
| crates/konnect-ipc/src/client.rs | fa42dd6449d76069520c60592f2d08a127ee7b07a7ab6f3d3e2aca04cbbea072 |
| crates/konnect-ipc/src/gen.rs | c1590bd0aeeb841883d33aea3fe513ef8920269d46c1eb480f296453caf9992a |
| crates/konnect-ipc/src/lib.rs | c05cc9bce966505bdf92c783b73884b7f1a8c62571af6a1a60e1411d041b8932 |
| crates/konnect-ipc/src/experimental_models.rs | 1fd3cbefdde220d04390b4ba5ecfabddf431e7ce3b214ed63825984b64c58b17 |
| crates/konnect/Cargo.toml | fd206a0fbbb5e18115b85394ea51b8e2b5e9c7e9aeddae31c92643875e5abdd7 |

## Remaining work

No full BL-04 acceptance checkbox is complete. This increment implements private MCP support
and qualifies transport/schema behavior, not end-to-end native mutation or agent permissions.
Next: launch the private PCB Editor with separate configuration/socket directories, discover
current MCP schemas, create/use only a disposable board through Konnect, and test preview,
stale rejection, approved apply, preservation, undo/reopen and post-write recovery against the
actual native window. Complete snapshot coverage and authenticated provider isolation remain
open. Preview restart/user-managed production sign-in still needs its separate approval.
Production mutation capabilities stay disabled; BL-05–BL-14 remain ineligible.

Post-increment checks: all eleven source hash receipts matched current files; private
Konnect tracked whitespace and new-file whitespace checks had no diagnostics. Benchline
`review:check -- --worktree` passed 142 files, its whitespace check passed and status.json
parsed. All build/test handles are terminal. Benchline application tests were not rerun for
this private-fork/documentation increment; the previous 168-pass run remains historical.

## Isolated native launch attempt — 2026-09-06

Created `/private/tmp/benchline-native-live.5Aj7Ez` with separate `config/10.0`, `socket`
and `fixtures` directories. Only a new application-settings JSON was supplied manually;
no serialized CAD was hand-edited. The private MCP process was discovered with
`list_toolboxes` and `get_active_toolsets`, then loaded the PCB, verification and experimental
toolsets. Its current schemas were inspected before calling `create_project` with the exact
fixture directory and name `BenchlineNativeTest`. MCP reported creation of the blank board,
project and schematic. This is fixture setup, not a completed PCB design or DRC result.

Before/after failed editor launches, these fixture hashes remained equal:

- `fixtures/BenchlineNativeTest.kicad_pcb`:
  `167f02625b7d14dc4a65c39dce1461ffc7e285680b0d27530f6edc20db1f39df`
- `fixtures/BenchlineNativeTest.kicad_pro`:
  `ac868276ee404471829ba76b6f2f7faab5f9956e966e58d829070b2808dcb663`

The private native process was launched with that board and explicit isolated
`KICAD_CONFIG_HOME`, `KICAD_RUN_FROM_BUILD_DIR=1`,
`KICAD_ENABLE_EXPERIMENTAL_REVISION_API=1`,
`KICAD_EXPERIMENTAL_API_SOCKET_DIR`, and ASan halt/abort options. No installed tool or normal
IPC socket was selected. CUA could not inspect the window: **the Mac was locked and automatic
unlock failed**. The owner was asked to unlock manually. No alternate UI-access method was
used to bypass this boundary.

Read-only process/socket diagnostics found a real startup failure, not a ready editor:
`sample` showed `wxEntryCleanup -> wxLogGui::Flush -> wxMessageDialog::ShowModal`. The socket
directory was empty and Konnect `check_kicad_ui` returned `ipc_responsive:false`,
`timed_out:false` (its process-detected result alone cannot identify the private editor).
Native stderr was empty. Process-scoped system logs contain platform/XPC errors but do not
establish the application's actual error-dialog text or startup root cause.

A separate, concrete build-path defect was found: `common/kiway.cpp` used `kicad.app` while
CMake's `OSX_BUNDLE_MAIN` and the actual case-sensitive build directory use `KiCad.app`.
The private source now matches that casing. Its SHA-256 is
`0d84cb1f29f96e97b75478dc8e926a3b329c5ca7b4425efe56058a5c54d7e874`.
The fork now has 29 modified tracked files and ten new files. This fixes a demonstrated
path mismatch, **not the observed startup failure**: a second launch after rebuilding still
waits in the cleanup/error-dialog stack, with no IPC socket.

`build-native-bundle-case.log` exited 0 for `qa_api qa_pcbnew qa_kinng`. Final reruns with
the previously documented isolated QA environment and unchanged suite selections:

- `test-native-api-bundle-case.log`: 41 cases / 2,096 assertions passed, exit 0.
- `test-native-pcb-bundle-case.log`: 32 cases / 186 assertions passed, 694 others filtered,
  exit 0.
- `test-native-transport-bundle-case.log`: seven cases / 24 assertions passed, exit 0.

The five executable/kiface hashes from the previous native qualification remain unchanged;
the modified shared library is
`kicad/KiCad.app/Contents/Frameworks/libkicommon.10.0.0.dylib`, SHA-256
`1b7536c667ef0a52530c8617908cfe2f01042a32212fa5046d95abf3f937a88f`.
These regressions do not verify successful GUI startup.

Lifecycle receipt: first failed private process PID 39826 was explicitly terminated with
SIGTERM after sampling; its handle returned exit 143. Rebuilt private process PID 45275
(exec session 52947) remains live in the error dialog for inspection after unlock. The
installed KiCad process PID 76065 was not stopped. The persistent private MCP harness
(session 32991) closed, exit 0; all build/QA/sample/log-query handles are terminal. Recheck
the surviving process identity before any future action; do not launch another copy merely
because this one has not finished. Scripts/configuration are in
`.runtime/konnect-model-mcp-test/live-client.mjs` and `live-config.toml`; native logs,
stack samples and process-scoped system log are under the isolated temporary root.

Next native step needs the Mac unlocked so the actual error dialog can be inspected.
No model preview/apply, board-outline change, populated-model rendering or GUI undo/reopen
was attempted. This turn made progress through MCP fixture creation, a source fix and new
verification evidence; it is not a third repeated impasse and the overarching goal stays
active. Production capabilities and all full BL-04 acceptance results are unchanged.
