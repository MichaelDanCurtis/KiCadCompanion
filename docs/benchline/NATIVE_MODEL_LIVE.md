# Private native model conformance — 2026-09-06

Partial BL-04-A3/A5 evidence, not completion of BL-04 or a production capability.
This resumes the same BL-01–BL-14 goal after the locked-Mac gate was cleared.

## Startup corrections and qualification

All build commands run in `.runtime/kicad-revision-build`. Source remains the private
GPL KiCad 10.0.0 fork pinned in [the native record](NATIVE_REVISION_GUARD.md).

1. The preserved failed editor exposed `Failed to import encodings module`; dismissing
   its dialog ended process 45275 with exit 255. CMake's relative Python site-package path
   was used to derive an incorrect Python home in build-directory mode. The matching
   framework interpreter imports `encodings` successfully with isolated mode enabled.
   Configure with the existing override:
   `cmake -S ../kicad-revision-source -B . -DPYTHON_SITE_PACKAGE_PATH=/Library/Frameworks/Python.framework/Versions/3.14/lib/python3.14/site-packages`.
   Exit 0; receipt `configure-python-runtime-path.log`.
2. `cmake --build . --target qa_api qa_pcbnew qa_kinng --parallel 6` exited 0;
   `build-python-runtime-path.log`. Fresh ASan suites exited 0: API **41 cases / 2096
   assertions**, selected PCB **32 / 186** (694 other cases filtered), NNG **7 / 24**.
   Logs `test-native-{api,pcb,transport}-python-path.log`. Same isolation variables,
   selection and 45-second bound as the preceding native qualification record.
3. A real launch created the private socket but crashed during cleanup (exit 134).
   LLDB identified the preceding IO error: missing `_eeschema.kiface`, not the old Python
   failure. `cmake --build . --target eeschema --parallel 6` exited 0;
   `build-native-eeschema.log`. LLDB receipts in the private fixture directory are
   `native-exception-debug.log`, `native-init-debug.log`, and `native-io-debug.log`.
   The final debugger expression to convert the already-visible IO message failed;
   that run exited 1, not a passing test. The debugger's structured variable output
   independently contains the exact missing-module message.
4. Native and installed editors shared `org.kicad.pcbnew`, making CUA observations
   ambiguous. The ignored generated test bundle now uses
   `local.benchline.native-test.pcbnew`, display name `Benchline Native Test PCB Editor`,
   and no document-handler ownership. A distinct 1.3-MB sibling bundle
   `pcbnew/BenchlineNativeTest.app` avoids the old path's cached identity. This is private
   test packaging, not a product/distribution change; reconfiguration may overwrite the
   original generated plist. Installed bundles were not edited.
5. With the distinct identity, CUA exposed missing `resources/images.tar.gz`.
   `cmake --build . --target bitmap_archive_build --parallel 6` exited 0;
   `build-native-images.log`. Restarted the private process. A stale disposable-board
   lock was overridden only after checking prior test processes had terminated and
   no process held the board file open. CUA then showed the actual test board, and
   real MCP discovery bound its exact open document. No GUI CAD edit was performed.

Native binary SHA-256 receipts after the Python-path rebuild:

| Artifact | SHA-256 |
| --- | --- |
| `qa_api` | `0f5aab8dfc5bbd0d69c7974cfde5575a1724c7f5a8536f5b2892919dad2f3f09` |
| `qa_pcbnew` | `bb8393a1f757124914629d6ffdd81b8425708769c52693e35946ca9455f79e67` |
| `qa_kinng` | `ebfbd22a72890fbca2ad2c5672477090994c49fce84602e30bee84fb61b1f069` |
| `pcbnew` | `5ff701803151c409e069c280a7c8e8d137430bd1b4f6637e7800dbcd505f33ee` |
| `_pcbnew.kiface` | `6fc4271700e1da9b5de1ec525241817023ddc0a736bbb6b01977b5da012268b9` |
| `libkicommon.10.0.0.dylib` | `ced49e4712aff8fb9f2a9ddafba4b04a73a3cd98fffbe33336cdd310579274f8` |
| `_eeschema.kiface` | `6a26275c82626471f8b64830fe866898bed52285de5f90f30011c192de00d95b` |
| `images.tar.gz` | `6bddfdd30f6bffeb52d410d954ae8f922e5a4dfa70a88e3d6790c2662697010d` |

These are current-host receipts, not macOS 14 compatibility. Existing deployment-target
warnings remain. ASan was not disabled; its stack-switch warning also remains visible.

## Read-only instance discovery

The private Konnect feature now has four tools. New `experimental_get_model_context`
requires an absolute existing board path and the configured explicit local IPC address.
It performs only GetOpenDocuments: first to learn the bounded instance token, then again
with that instance pinned to require exactly one matching open document. It returns
`source: ipc`, `approval_granted: false`, and `revision_verified: false`. Discovery is
not authentication, freshness approval, or permission to mutate. No unpinned client is
returned, no general unpinned command is exposed, and mutation methods keep strict
instance checking. Production tool exposure remains unchanged.

Seven focused IPC cases and three core cases passed, including eight discovery variants:
success, absent/empty/oversized token, wrong type, failed status, replaced instance between
reads, and absent document. Every discovery request is asserted to be read-only and the
second request must use the learned token. Full core/IPC Cargo regression exited 0:
**959 reported passes / six ignored**. Four corpus tests still return early without demos
and receive no coverage credit; this exclusion remains from the earlier record. Real
stdio MCP discovery/schema/runtime-off refusal tests passed with the four-tool registry.

Commands use the same pinned Rust toolchain and explicit proto/build environment as
[the protocol record](KONNECT_MODEL_PROTOCOL.md). New receipts under
`.runtime/konnect-model-mcp-test/`: `discovery-tests.log`, `discovery-regression.log`,
`discovery-build.log`, `discovery-mcp-check.log`. All those handles exited 0.
The ordinary feature-off build evidence is historical pending a fresh recheck.

| Private Konnect artifact | SHA-256 |
| --- | --- |
| feature binary | `5b86ec3440890d02f75b798e7c6cf0ce01ed57decff4f16c759c57c710198d19` |
| IPC experimental module | `3e2b0bd8151664fdfd9590a4b6d1713f97ba331d23740e3679fa3fa105e23ba0` |
| core experimental module | `60e79d557f4eb606698a2843bccf4ab510c55db2d22ed6a943bb3e6ddbaa1b94` |

## Actual disposable board journey

Fixture root: `/private/tmp/benchline-native-live.5Aj7Ez`; project `BenchlineNativeTest`.
Explicit private config/socket variables and ASan options remain as in the prior launch
record. The persistent MCP client is `.runtime/konnect-model-mcp-test/live-client.mjs`;
tool availability and schemas were freshly queried before actions. All CAD writes below
were actual Konnect MCP calls to this fixture, never shell/text edits or GUI CAD edits.

- Created a 40 × 30 mm outline at (100,80), then placed two installed
  `Resistor_SMD:R_0603_1608Metric` footprints. R1: (110,90), 15°; R2: (125,100), 90°,
  both F.Cu. Queried placements and saved through MCP. The extents tool reported `empty`
  before save and `source: file` with correct bounds after save; it does **not** receive
  live unsaved-outline coverage credit. Native 3D view later showed the rectangular board.
- Existing component tools omit footprint UUIDs, so these two UUIDs were inspected
  read-only in the native-saved fixture as a last resort, then resolved again by native
  preview. R1 `7808ced2-f83d-42f1-a71d-4d94bfd2a1f7`; R2
  `3a196209-d06b-4cbd-94d7-117549a1ab80`. This is a remaining MCP usability gap.
- Native instance `6b631a19-dec5-48f0-ae33-49afce001ec0` returned empty model lists and
  revision `f594aae830400b7ff3de908abb5b4c6ebd5dc3dd1bf9ddc3445a4fc030e3f933`.
  Preview ticket `3e23e065-5336-4ca9-b23c-ec41b0f81a65` applied both installed
  `R_0603_1608Metric.step` files in one model-list operation: scale 1, zero rotation/offset,
  visible, opacity 1. Result `MU_APPLIED`; no automatic file save or success verification
  was implied by that receipt. Subsequent native preview read back both full model lists.
- A newly previewed identical batch returned `MU_NO_CHANGE`. After explicit MCP save,
  an independent read-only S-expression comparison preserved **all non-model serialized
  board content** for this pair, including UUIDs, fields, geometry and placements.
  Script/receipt: `verify-preservation.mjs`, `live-preservation.json` in the MCP test folder.
  This is not general snapshot coverage or proof of transient/unsaved state preservation.
- Baseline saved SHA-256:
  `7a3936934b184c84386a2f96f8c985ce2f80e15a801ca084cefa94bdff821176`.
  Populated saved SHA-256:
  `b695cb0860d408af4d9f8e3d16b413cff6fb53f17805937dbe9854e5c7c314c9`.
  Both non-model structural hashes:
  `c48cd72bceb6db65f78f9655f3a2a0f080fe2732dfa6cee63cb8326251027293`.
- Previewed opacity 0.5 with ticket `2d06eeaa-f248-4b4b-b638-e8b2a1679033`; then added a
  sentinel text via a separate ordinary MCP edit. Apply returned `MU_REJECTED`,
  `Stale document revision`; fresh native readback retained opacity 1 on both models.
  The text UUID `c7f233c3-fa10-46ac-a3f9-8833a2c5b828` was resolved by dry-run and deleted
  through MCP with exact UUID/type/layer filters; follow-up dry-run found zero matches.
  This covers an intervening IPC edit, **not yet a human manual edit**.
- Wrong native instance and wrong existing document (the disposable schematic path)
  failed before model preview dispatch. Ticket `d547f05c-31e2-476a-857e-4f2932d07095`
  was consumed by a fresh no-change operation; an intentional single replay test returned
  `MU_UNKNOWN` / MCP error, not success. Receipt inspection recovered original
  `MU_NO_CHANGE`; no further replay was attempted.
- A fresh model-only preview/apply restored both empty lists. Readback confirmed empty;
  explicit save returned to the **exact baseline byte hash** above. Clean GUI quit
  of process 36921 exited 0 and removed its socket. Disconnected preview failed
  `Native connection unavailable; no request sent` with no file fallback.
- Reopening produced instance `5d223f5c-ba3f-4adc-bee4-822aa0ef7bac`; the old identity was
  refused. A fresh preview observed the reopened empty lists. Ticket
  `35b509ec-1885-457a-b71d-edf93cb27418` applied both models again as an **unsaved** batch.
  The later crash below invalidates that in-memory state; it was not saved or retried.

## Rendering failure and current limitation

Initial native 3D inspection showed the board/pads but no components: the private plugin
directory was empty. Built `s3d_plugin_oce s3d_plugin_idf s3d_plugin_vrml` with the same
ASan configuration, exit 0; `build-native-3d-plugins.log`. A new private launch (45950)
subsequently crashed with exit 134 in `__asan_register_globals`. Raw receipt:
`native-with-3d-plugins.log` in the fixture root. Rendered component visibility is **failed**,
not a passed integration inferred from successful assignments or compilation.

CUA's transparent launch behavior started another copy (47274, without the isolated
launch arguments) after the intended process had died. It showed the original Python
import failure. That unintended private process was identified by exact executable path
and terminated; do not count its dialog as a failure of the isolated Python configuration.
Do not claim its environment was isolated or reuse it. No CAD action was sent to it.
Future GUI inspection must revalidate process identity/readiness and avoid automatic
relaunch when the intended process has stopped. Installed binary paths were not modified.

After the crash the saved fixture still matches baseline `7a393693…821176`.
Feature-off build and real MCP exposure were rechecked: `discovery-default-build.log`
and `discovery-default-mcp.log` exited 0, with the experimental toolset absent under both
runtime flag values. The feature-enabled binary was restored (`discovery-feature-restore.log`,
exit 0). All private GUI and MCP processes from these checks have terminated.

Next: diagnose the ASan plugin-load failure; retain all failed logs and complete actual
manual/undo and broader native conformance before
production adapter qualification. Provider preview restart/sign-in approval remains
separately pending. A1–A5 remain unchecked; successor goals remain ineligible.

## CAD-free sanitizer loader diagnosis

`plugin-load-probe.cpp` in `.runtime/konnect-model-mcp-test` loads and unloads each supplied
shared library twice with `dlopen`/`dlclose`. No GUI, CAD or credentials are involved.
The three private KiCad plugins reproduce an ASan duplicate-global failure on the second
cycle (`plugin-load-probe.log`, exit 1 with nested sanitizer failure).

A minimal ASan-instrumented dylib containing only one integer and its accessor reproduces
the failure on its second load (`plugin-load-minimal.log`, exit 134). Separate builds using
`-fregister-global-dtors-with-atexit` and `-fno-sanitize-address-globals-dead-stripping`
also fail (respective `plugin-load-minimal-atexit.log` and `plugin-load-minimal-no-strip.log`,
exit 134). The minimal image contains an ASan module destructor and an undefined reference
to `__asan_unregister_image_globals`; that does not yet prove the destructor executes.

This isolates a host/toolchain sanitizer unload/reload problem independent of KiCad board
content; its exact loader/compiler/runtime cause is not yet established. No sanitizer or
ODR check was disabled and no speculative KiCad plugin-lifetime workaround was applied.

Further bounded probes retained their failures: targeting macOS 14 also exits 134;
attribute-destructor-only and C++-destructor-only variants print their respective teardown
messages but still fail on reload. A combined constructor/destructor variant passes twice
in separate runs with ASan enabled. That contrast is a diagnostic clue, **not a fix** or
proof that ASan unregistering works generally; code/layout changes need further isolation.
Receipts are `plugin-load-minimal-macos14.log`, `plugin-load-attribute.log`,
`plugin-load-cxx.log`, `plugin-load-destructors.log` and
`plugin-load-destructors-repeat.log` in the same test folder.

A bounded LLDB unregister breakpoint attempt timed out (exit 142) without reaching an
observable breakpoint or reporting a backtrace. Its surviving, exact diagnostic child PID
63358 was terminated; this attempt supplies no destructor-execution evidence.

Reference checks: [Clang's destructor option documentation](https://clang.llvm.org/docs/ClangCommandLineReference.html#cmdoption-clang-fsanitize-address-destructor)
describes `none` and `global` (no alternative teardown mode to try without disabling the
destructor). [Apple's current dyld source](https://github.com/apple-oss-distributions/dyld/blob/main/dyld/DyldRuntimeState.cpp)
finalizes dead-image executable ranges through `__cxa_finalize_ranges`; this upstream
source is context, not verification that the host's runtime has identical implementation.

Fresh Benchline regression: `npm test`, exit 0, 168 passed / 0 failed / 0 skipped;
receipt `benchline-regression-live.log`. `npm run review:check -- --worktree`, exit 0,
143 files checked; manual review still required. These do not qualify native rendering,
provider isolation, or the remaining BL-04 acceptance criteria.

## Follow-up: registration failure reproduced across installed toolchains

This continuation made diagnostic progress: verbose ASan logs invalidate the apparent
reliability of the combined-destructor variant. With `report_globals=2:verbosity=2`, both
the minimal and combined variants exit 134. The logs show globals added on first load,
no `Removed Global` record on close, then the same global added at the same address on
reload before an ODR violation. User-defined destructor messages do appear in the combined
case; they do not prove ASan teardown. The previous two passing runs remain historical
observations, not a reliable workaround.

Bounded CAD-free probes (all runtime invocations retain `halt_on_error=1:abort_on_error=1`):

| Variant / receipt in the MCP test folder | Outcome |
| --- | --- |
| `plugin-load-minimal-verbose.log`, `plugin-load-destructors-verbose.log` | Both exit 134; no global-removal record |
| `plugin-load-minimal-no-chains.log` | Exit 134 with `-Wl,-no_fixup_chains` |
| `plugin-load-minimal-classic.log` | Exit 134; classic linker build warns that option is deprecated |
| `plugin-load-minimal-lower-dtor.log` | Exit 134 with `-mllvm -disable-atexit-based-global-dtor-lowering=false` |
| `plugin-load-minimal-O1.log`, `plugin-load-minimal-O2.log` | Both exit 134; optimization does not fix this probe |
| `plugin-load-minimal-clt-build.log` | Initial separate-toolchain build exits 1: missing `c++` library with implicit SDK |
| `plugin-load-minimal-clt-sdk-build.log`, `plugin-load-minimal-clt.log` | Explicit SDK build succeeds; matched compiler/runtime probe exits 134 |
| `plugin-load-minimal-ir.log` | Separate compilation of already-instrumented LLVM IR also exits 134; explicit SDK/minimum target required after an initial linker failure |

Installed compiler versions actually inspected: Xcode AppleClang 21.0.0
`clang-2100.1.1.101`; Command Line Tools AppleClang 21.0.0 `clang-2100.3.33.1`.
The CLT comparison compiles **both** the driver and library with that compiler and uses
the explicit existing Xcode MacOSX26.5 SDK. No shared compiler selection, SDK, installed
application or dependency was modified. The CLT output also retains `__mod_term_func`.

[LLVM's Mach-O destructor lowering change](https://github.com/llvm/llvm-project/commit/22570bac694396514fff18dec926558951643fa6)
explains why global destructors should be registered through `__cxa_atexit` instead of the
deprecated terminator section. The observed emitted section plus missing removal logs
are consistent with that boundary failing here, but **do not establish the exact Apple
compiler/runtime defect**. No debugger execution trace was obtained. Do not claim an
upstream fix exists or silently patch plugin lifetime to hide the failure.

Minimal source SHA-256: `3ab03453cf488962258af65454007fefa1596b22b49804b12fbb3fe1f7e5f8f4`;
driver source SHA-256: `1a8e3c06e7def25c4eaea6b10ab4218370bfa85abce51492b31ab5282e1ac092`.
All probe handles are terminal; no private native editor or MCP writer was launched in
this continuation. Native source/binaries remain unchanged by these experiments.

Next native decision must be evidence-backed: qualify corrected destructor registration
or another independently validated toolchain before retrying rendered native integration.
Do not reinstall shared tools, disable checks, or repeat uncertain CAD operations.
Production provider restart/sign-in authorization remains pending independently; the
automatic goal continuation is not that authorization. Full BL-04 criteria and all
roadmap dependencies remain unchanged.

## Explicit destructor registration diagnostic (2026-09-09)

The prior turn's product approval changes were progress; this continuation also
made new native diagnostic progress without launching KiCad or changing its build.
The ordinary flags already tried above were not blindly rerun. LLVM's
[LowerGlobalDtors implementation](https://llvm.org/doxygen/LowerGlobalDtors_8cpp_source.html)
and [Mach-O change](https://github.com/llvm/llvm-project/commit/22570bac694396514fff18dec926558951643fa6)
motivated an explicitly registered destructor probe, not a plugin-lifetime change.

Created a separate `plugin-load-explicit-cxa.ll` from the existing minimal
instrumented IR. The only semantic change replaces its global destructor entry
with a constructor calling `__cxa_atexit`, using the image's `__dso_handle` and a
wrapper that calls the **original** `asan.module_dtor`. That original function
still calls `__asan_unregister_image_globals` with the original registration flag.
Original instrumentation, redzones and global registration remain. The original
source/IR, all native KiCad source and binaries, installed apps and toolchains
remain unchanged. This is a manually transformed diagnostic, not a supported
compiler fix, release build option or qualified native application.

Compiled/linked the diagnostic with existing Xcode AppleClang, explicit MacOSX26.5
SDK, `-mmacosx-version-min=14.0`, `-dynamiclib -fsanitize=address`. Build exit 0;
warnings about target-triple override and redundant instrumentation were retained
in `plugin-load-explicit-cxa-build.log`. Runtime kept
`ASAN_OPTIONS=halt_on_error=1:abort_on_error=1:report_globals=2:verbosity=2` throughout.

Results in `.runtime/konnect-model-mcp-test`:

- Existing two-cycle driver: exit 0, two Added Global / Removed Global pairs for
  `benchline_probe_global`, then PASS (`plugin-load-explicit-cxa.log`). This is
  stronger evidence than the earlier user-destructor messages alone.
- New `plugin-cxa-validation.cpp` driver: verifies the value is 17, its address is
  unpoisoned and the adjacent redzone is poisoned on each of 20 reloads. Positive
  run exit 0, 20 checks and **20 Removed Global** records, no ODR/overflow failure
  (`plugin-cxa-validation-positive.log`).
- Same driver with `--negative`: after 19 complete reloads and the twentieth
  successful redzone check, deliberately reads the redzone. Exit 134 and
  `AddressSanitizer: global-buffer-overflow`, as required; 19 cleanup records before
  the intentional abort (`plugin-cxa-validation-negative.log`). This proves this
  tested memory error still trips, not blanket sanitizer correctness.
- One new unmodified-source comparison used ThinLTO plus the documented atexit
  flag, same SDK/minimum target and sanitizer. Build exit 0; runtime exit 134 on
  second load with ODR violation and no cleanup. Receipts:
  `plugin-load-minimal-thin-lto-build.log`, `plugin-load-minimal-thin-lto.log`.
  ThinLTO is not a fix and must not be enabled in the native project on this basis.

SHA-256 inputs/output:

- original IR: `b33a823808fd6398a4740daa554715f379dd977b22ef710d0b3ad6e634c6abd6`
- explicit-cxa IR: `c2dc075a0dc75f606f2a8dddd3ec1700b2fe065805d8109b1c8122ae74da6478`
- diagnostic dylib: `d58c53f11a1694b2714899379df50e8ca306348575369954b170117b03ec1ce4`
- validation driver source: `84d245bc16af7f5a0e3673196615b39bba54466a7ee93590f9fe8f0c482d0083`

Inference: the tested registration pathway is causally relevant to the missing
sanitizer cleanup. The exact Apple compiler/runtime defect is still not established.
No standalone `opt` or alternate LLVM compiler was present at the inspected
standard locations; no new toolchain was installed. Next: establish a maintainable
compiler/pass-level correction that preserves instrumentation and passes both
positive and negative controls before applying anything to private KiCad. Native
rendering, manual-edit/undo and broader conformance remain unqualified. All probe
handles are terminal; no CAD documents were opened or mutated.

Separate provider status is no longer the older pending restart/sign-in state:
the authenticated held-approval fixture passed this continuation and account setup
was reconnected ready/signed-in. Production model execution remains disabled.

## Pinned cleanup candidate and populated native viewer (2026-09-09)

A source-level compatibility candidate now runs in the **private Debug/ASan build**,
not the installed KiCad. `plugins/3d/apple_asan_image_cleanup.cpp` registers the
existing image-global cleanup routine with `__cxa_atexit` and the image handle.
The new CMake option `BENCHLINE_TEST_APPLE_ASAN_CLEANUP` defaults OFF, requires
arm64 AppleClang `21.0.0.21000101`, Debug and ASan, and links that object FIRST in
`kicad_3dsg`, `s3d_plugin_idf`, `s3d_plugin_vrml`, and `s3d_plugin_oce`. A separate
compile guard pins Apple build 21000101. This deliberately narrow private workaround
is not a general compiler fix. Normal unload and ASan checks remain enabled.

Important failed controls were retained in `.runtime/konnect-model-mcp-test`:

- Linking the cleanup object last prematurely removed protection before a C++
  destructor ran; the destructor-order assertion failed, exit 134
  (`plugin-cleanup-candidate-positive.log`). That order is rejected.
- First-object order passed 20 load/value/redzone/destructor checks and 20 global
  cleanup records (`plugin-cleanup-first-positive.log`, exit 0). Deliberately
  overflowing in the user destructor still produced `global-buffer-overflow`,
  exit 134, before any global cleanup (`plugin-cleanup-first-negative.log`).
- Rebuilding only the three plugins still failed on scenegraph dependency reload
  (`plugin-native-cleanup.log`). Adding the same guarded cleanup to `kicad_3dsg`
  yielded six real plugin load/close cycles, exit 0 and PASS
  (`plugin-native-cleanup-scenegraph.log`, line 105208).

Configuration/build receipts in `.runtime/kicad-revision-build`:
`configure-asan-cleanup-scenegraph.log` and `build-asan-cleanup-scenegraph.log`,
both exit 0. Existing deployment-target warnings remain; no macOS 14 compatibility
claim. Original four binaries retained at `.runtime/plugin-pre-cleanup.9KqPLB`.

Live isolated process 79038 used the existing disposable fixture/config/socket,
`KICAD_ENABLE_EXPERIMENTAL_REVISION_API=1`, and
`ASAN_OPTIONS=halt_on_error=1:abort_on_error=1`. Both the bare board and the board
populated with two resistor STEP models rendered visibly in the actual 3D Viewer.
No AI-generated image substitutes for that observation. Native log:
`/private/tmp/benchline-native-live.5Aj7Ez/native-asan-cleanup-candidate.log`.
The log contains an ASan `__asan_handle_no_return` warning and accelerator warnings,
but no reported ASan ERROR; ordinary UI quit returned process exit 0.

All model writes and saves used private Konnect MCP, native instance
`19563c14-a471-4ada-8a6b-6dd79b4d21a9`:

- Preview confirmed both empty lists; apply ticket
  `66817024-07a1-463d-b57a-8fca092e9847` returned MU_APPLIED. Readback confirmed
  both installed `R_0603_1608Metric.step` paths, identity transforms, opacity 1,
  visible true. MCP save succeeded and populated viewer was inspected.
- Fresh restore ticket `3ac90a64-856d-4363-864e-6468739b21c0` returned MU_APPLIED;
  subsequent preview confirmed both lists empty, then MCP save succeeded.
- **Exact saved-content preservation failed.** Before launch the board SHA-256
  was `7a3936934b184c84386a2f96f8c985ce2f80e15a801ca084cefa94bdff821176`;
  populated save `81ca9df85a3a608c0aede3f03e19e1a8eec51cf780b5b92c60e49e0100b3ec3f`;
  restored empty-list save `bc9e52977aab7efc3c72c0c9402e8e686f71950a4ce7050e0f0dc04b3ef68761`.
  KiCad's existing fixture `.history` git diff `c932594..2a776a2` isolates one
  non-model polygon x-coordinate change, `0.8` to `0.800001` mm. Model removals
  themselves changed only the 22 model lines (`6bbf12a..2a776a2`). Original fixture
  data remains in history; no manual file rewrite or silent tolerance exemption.
  Whether load/save rounding or the model operation causes this remains to test.

Source hashes: cleanup `9b53822383f21c4ac9794662172fb54960dbe1846d77d2935f04c9a85b7bc2da`;
CMake `3ae2e451ffcdf9a86b23c2d8bce1265dcb972c8ffb1a79f90195312aec6c72bc`.
Binary hashes: scenegraph `f821257cd69d72f4145e571d1341063ff72151184c078b65c4f82cef6e3a7f09`;
IDF `5429c7cc13feb781e65f53dd58fe81d5e966a2c9bb91470a03cb78ac613e903b`;
VRML `3296e2e0b82c5d373b9796b024c1b40fd0941864f8a8023d215e579d2de7d40d`;
OCE `87653bcf3efef9b95065e38ec025fb63a5a84feb2b0f2fb37e5b2c80b2f45711`.

The native viewer crash is mitigated for this pinned private configuration. Broader
rendering, preservation, manual-edit/undo, snapshot and production qualification
remain incomplete. BL-04 acceptance checkboxes and successor eligibility unchanged.

### CAD-file-free rounding and preservation controls

Extended the private `qa/tests/pcbnew/test_footprint_model_update.cpp` preservation
case with a 15-degree F.Fab polygon and exact integer vertex comparisons. The
native model operation preserves every tested vertex, child and non-model
serialized field. Added a separately named diagnostic using actual KiCad
`RotatePoint` twice on `(800000, 412500)` internal units, first +15 then -15
degrees: result `(800001, 412500)` with **no model service call or CAD file write**.
This reproduces the observed one-nanometer discrepancy in the parser/serializer's
integer transform pathway. It does not fix precision or qualify exact saved-file
preservation; the diagnostic intentionally expects the existing defect.

Commands: `cmake --build .runtime/kicad-revision-build --target qa_pcbnew -j 4`,
then `ASAN_OPTIONS=halt_on_error=1:abort_on_error=1 KICAD_RUN_FROM_BUILD_DIR=1
.runtime/kicad-revision-build/qa/tests/pcbnew/qa_pcbnew
--run_test=FootprintModelUpdate --report_level=detailed --log_level=test_suite`.
Both exit 0. Receipts `build-rotated-model-preservation.log` and
`test-rotated-model-preservation.log` in the private build. All 16 selected tests,
106 assertions passed; 711 unrelated tests were not selected. The two diagnostic
assertions prove reproduction, not resolution. Benchline `npm test` separately
passed 183/183 (`.runtime/native-cleanup-benchline-regression.log`); mechanical
review passed 150 files. No authenticated provider or browser approval test was
rerun in this native increment. Native/editor and MCP client exited cleanly.

Next native work: qualify preservation across actual native parse/serialize and
reopen, retain this discrepancy as a failure rather than increasing tolerances,
and exercise the still-missing manual-edit/undo/snapshot cases. The workaround
must remain pinned and opt-in until broader lifetime testing and source review.

## Native polygon preservation fix and live round trip (2026-09-09)

The prior turn was progress, not a blocked turn. A new in-memory test using the
real `PCB_IO_KICAD_SEXPR::Parse` and `Format` reproduced the exact polygon drift
without any model operation: `test-roundtrip-red.log`, exit 201, two coordinate
assertions failed. No CAD document was written by this test.

Implemented a private native source fix in `pcb_shape.h/.cpp` and the sexpr
parser/serializer. Parsing retains original local straight-polygon coordinates
along with their projected board-space points and parent identity/transform.
Formatting reuses those local coordinates only if **every** board-space point,
closure, parent identity, position, angle, layer and contour structure still
matches. Otherwise ordinary current-geometry formatting is used. The retained
data follows native copy and swap undo images; successful protobuf replacement
clears it. Arcs, holes and multiple contours are deliberately not handled by this
cache and retain the existing formatter. This fixes the observed polygon defect,
not all native geometry precision or arbitrary-document preservation.

The first 20-case run preserved polygon coordinates but found an unrelated whole-
footprint mismatch: when input omitted Reference/Value fields, KiCad generated
empty fields and then hid them on the next parse (`test-polygon-preservation.log`,
exit 201, 206/207 assertions passed). This normalization finding is retained and
not described as fixed. The final polygon fixture specifies actual Reference R1
and Value 10k fields, retaining full-output equality assertions across 20 cycles.

Final native QA: build `qa_pcbnew -j 4` exit 0; ASan-enabled
`--run_test=FootprintModelUpdate --report_level=detailed --log_level=error` exit 0,
**20 tests / 207 assertions passed**, 711 unrelated tests not selected. Controls
cover edited vertex output, moves, angle/layer/identity changes, clone, native
SwapItemData undo/redo image exchanges, CopyFrom and changed contour structure.
These image-level checks are not the native editor's full undo-stack journey.
Receipts under `.runtime/kicad-revision-build`:
`build-polygon-preservation-final.log`, `test-polygon-preservation-final.log`.

Live procedure used only the disposable fixture and Konnect MCP writes:

1. Pre-launch saved board SHA-256
   `bc9e52977aab7efc3c72c0c9402e8e686f71950a4ce7050e0f0dc04b3ef68761`.
   This is the prior turn's retained fixture, **not** a claim to have reversed
   that earlier one-nanometer change.
2. Process 7960, fresh instance `90c45206-540a-4932-b0ef-8c59ed3062df`.
   Preview observed empty lists. Apply ticket
   `8a54de43-2391-4164-a5ef-45a32f39b7a3` returned MU_APPLIED, readback confirmed
   both resistor models, and MCP save succeeded. Native 3D Viewer again visibly
   rendered both components without crashing.
3. Independent saved-structure comparison passed: populated board hash
   `81ca9df85a3a608c0aede3f03e19e1a8eec51cf780b5b92c60e49e0100b3ec3f`,
   unchanged non-model hash
   `bf8106918f3044fec94c8d935b040429479cfe456ddc96e89dfee476e4ee1583`.
   Receipt `.runtime/konnect-model-mcp-test/live-preservation.json`; prior receipt
   retained as `live-preservation-2026-09-06.json` before this run wrote its report.
4. Fresh restore ticket `67273960-335d-4d7b-85cf-f9fa3b32a326` returned MU_APPLIED;
   readback confirmed empty model lists; MCP save restored the **exact** pre-launch
   `bc9e...8761` hash. Native editor quit exit 0.
5. Reopened as process 9779, new instance
   `8f28bb76-e607-4ab3-a33a-f2ed0f132535`; preview again observed empty lists.
   MCP save without mutation retained the exact same hash. Native quit exit 0;
   the persistent MCP client and preservation checker also exited 0.

Both launches retained isolated config/socket and ASan halt/abort checks. Native
logs at `/private/tmp/benchline-native-live.5Aj7Ez/native-polygon-preservation.log`
and `native-polygon-reopen.log` retain the known `__asan_handle_no_return` warning
and Option accelerator warnings; no ASan ERROR was observed. Installed KiCad,
global libraries, customer designs, provider account and production mode unchanged.

Final SHA-256 source/build inputs:

- `pcb_shape.cpp`: `7979a7a46c089067404ae66be1596b2d182548c68b68bfcb54ef3bebbdedc047`
- `pcb_shape.h`: `66b1a0a9f96276ed6616a7214961d39545851cfaab61c40becc31f482714f52a`
- sexpr parser: `f4d447b4673ea93e71746f8e0e5e09eb4bdb60adaa047f9cfbf123ab3132e0a3`
- sexpr formatter: `67683befb7a46ce7dd3844e2cfd34aa663eb08505fb84e0085df4c8dd6756aac`
- model QA source: `01b98a4d61315da79e2f6ed818420fb899885945179b32b070dea7cbee492759`
- `_pcbnew.kiface`: `bfbf8e29022a416c15242e603d37e8061a49ce17f46c6d4b8db35f71861a6027`

BL-04 remains incomplete. Next: broader native manual-edit/undo/snapshot behavior
and provider-boundary qualification. Current Konnect discovery exposes PDF
`snapshot_project`, not a reversible native snapshot or undo tool; do not label
PDF export as recovery. No full editor undo or human manual-edit check was run.

## Guarded native history and mandatory-field identity repair — 2026-09-09

Added private `RunGuardedHistory` protobuf/native dispatch and Konnect MCP
`experimental_run_guarded_history`. It accepts only undo/redo, exact board and
native-instance identity, a fresh revision and canonical request UUID. Busy/pending
commit, empty history, invalid arguments, stale revision and consumed IDs reject
before dispatch. The bounded 1024-ID ledger fails closed when full and consumes
an ID before synchronous native dispatch. Dispatch receipt deliberately says
`state_verified: false` and `retry_authorized: false`; it is neither approval nor
proof of restoration. Both experimental feature/runtime opt-ins remain required.
Discovery now correctly reports five experimental tools. No production exposure.

First live run (instance `ccef645c-723f-489e-bb02-6d6f53a1d037`) proved actual
editor undo/redo changed both model lists as one history operation. Empty-stack,
stale-revision and consumed-ID history requests rejected. A preview created before
redo rejected afterwards with `MU_REJECTED: Stale document revision`. However,
the final native save changed eight mandatory field UUIDs, four per footprint:
starting SHA-256 `bc9e52977aab7efc3c72c0c9402e8e686f71950a4ce7050e0f0dc04b3ef68761`
became `a977a15b84215238b227f010d323ac29b49f98d324ba8f1088e1d14b97f480ac`.
The native history diff contains only those UUID changes; polygon coordinates
remained exact. This is retained as a failed preservation run, not overwritten.
Native history commits `5b251b9` and `0ac7f18` retain the before/after fixture.

Root cause: `FOOTPRINT` copy constructor lazily created mandatory fields, then
assigned their properties. `EDA_ITEM::operator=` intentionally does not copy UUID;
therefore every undo image acquired new mandatory field identities. The private
fix clones mandatory fields the same way as user fields, preserving identity and
parent remapping. `Duplicate()` still explicitly generates new child UUIDs; clone
and user duplication remain separate operations. No raw CAD-file edits performed.

New native `FootprintUndoImagePreservesFieldIdentities` checks mandatory/custom
field IDs and parents across clone, assignment and four native item-data swaps,
including model-list undo/redo. Before fix: exit 201, 20 failed assertions of 114.
After fix: full selected `FootprintModelUpdate` suite exit 0, **21 tests and 325
assertions passed**, 711 unrelated cases not selected. Adjacent existing
`Footprint,FootprintLoadSave` suites separately passed 2 cases/40 assertions.
All used ASan halt/abort checks; no suppression or tolerance relaxation.

Rebuilt live run on the same disposable fixture, instance
`47d7ddf0-2f84-4a01-9b5b-aa951df71ffb`:

| Step | Evidence |
| --- | --- |
| Initial readback | Both model lists empty; revision `dc11f4f9c4eea2171c299ca13be98ad9c1d851d4a4aa55de21650cd2a6497745` |
| Apply | Ticket `6625fd50-270b-4446-b593-f58a005a7b49`, MU_APPLIED; both resistor models read back; revision `42b8b00e24bd322f660dde11d0b40c0515436e5d1612ccac8476db895528791b` |
| Undo | Request `00000000-0000-4000-8000-000000000301`; both lists empty; revision `75b9c5f40aa1dd22eb99df1af45ed310cc809d33c6c6a0a53b8b554d46f9229d`; MCP save exactly equals run-start `a977...80ac` |
| Redo | Request `00000000-0000-4000-8000-000000000302`; both models restored; revision `aff1b577f90db378295a0e3a30509f5cc083aedf085207bea7164e9c0e3b6d4d` |
| Stale model preview | Ticket `c9d6c960-9cd7-4118-a24f-581201f81f89` created immediately before redo rejects as stale, with no intervening preview superseding it |
| Consumed history ID | Reusing confirmed-completed request 301 with the fresh redo revision rejects; independent readback remains populated at unchanged revision |
| Final undo/save | New request `00000000-0000-4000-8000-000000000303`; empty lists; revision `918acccfc26117c2788d4157e616e77a9764a5e6a0206fa894e7d0ed986298f6`; MCP save again exactly equals `a977...80ac` |

This qualifies restoration to the repaired run's starting file, not retroactive
restoration of UUIDs changed in the first failing run. Both native editor launches
and MCP clients exited 0. No ASan ERROR/SUMMARY observed in native history/identity
logs. Native UI interaction was limited to inspection and quit; actual CAD changes
and saves used Konnect MCP. Human-driven concurrent editing remains untested.

Build/test receipts under `.runtime/kicad-revision-build/`: `build-guarded-history.log`,
`build-guarded-history-optin.log`, `build-field-identity-red.log`,
`test-field-identity-red.log`, `build-field-identity-green.log`,
`test-field-identity-green.log`, `test-field-identity-adjacent.log`.
Konnect: `cargo test -p konnect-ipc -p konnect-core --features experimental-model-update
experimental_models` passed 4 core/8 IPC tests; feature binary build exited 0.
Receipts `.runtime/konnect-model-mcp-test/test-history-final-rust.log` and
`build-history-final-rust.log`. Proto root explicitly points to the private native
tree; source licenses unchanged. `npm test`: 183 passed, zero failed/skipped,
`.runtime/guarded-history-benchline-regression.log`.

Final SHA-256: footprint source `822da1bb0a46ed369807509d8f4fe482074dc7ae5a444c1c0d37cbafaa22b01f`;
proto `c29ab11524688bf5ab96a93b87c134ebbccae2875d4b565bf6b2381c7c73bf65`;
native handler `121214ec5e1b19e48ff74c1986f2bf4854acc433ef2243b3407aacca11f1997d`;
native test `3bc66481e1d0f4ad4f089550cdd63bb1f747d8be73b69286a1140892c37bdf5b`;
Konnect binary `b6c12455102fccbe1b9ab79c7cdcadd2000679b26973f0e074bdcb4cb138f4e8`.

Remaining: broader snapshot/recovery and manual-edit conformance, authenticated
provider/tool isolation and combined live-model/product-approval journey. Private
native history is not a production approval boundary. BL-04 stays incomplete;
all acceptance checkboxes unchanged, successors ineligible, production disabled.

### Intervening native board edit — 2026-09-09

Same rebuilt native binary, SHA-256
`b4c541f8863586ae8b6dcf38b16c0092cf1a9721c290ece36990426849ec16d5`,
new instance `666a2a17-af3d-45e4-ad0e-d3bb764dce9e`. Used ordinary Konnect
`add_board_text` over live IPC after experimental model preview and before apply;
this is a genuine intervening native write through a different command path,
not a human gesture or simultaneous event-loop race. No full-footprint wire
replacement was used, because its preservation limits remain unqualified.

First preview `313cdca6-472d-4b5a-977d-75382a37bf4f` rejected as stale after
adding `BL04 INTERVENING EDIT TEST` at (100,110) mm. Both model lists remained
empty. A dry-run graphics query filtered by alias `User.Comments` returned zero:
the builder accepts that alias but readback uses canonical `Cmts.User`. Do not
interpret that filtered zero as proof the note was absent. Guarded undo 401 and
MCP save restored starting SHA-256 `a977a15b84215238b227f010d323ac29b49f98d324ba8f1088e1d14b97f480ac`.
Alias readback inconsistency retained as a separate uncorrected finding.

Repeated with canonical `Cmts.User`, and an unfiltered read-only text query:

- Preview `cd64ddab-6c5b-486a-bb20-8e461004170b`, input revision
  `de35546563b24b18545d13816d0a276a98c1f678e6def773ee211b18faf5f11d`.
- Native note creation returned source IPC; independent dry-run query found one
  text, UUID `72f0e46c-695c-47b9-9833-2d92aeebf652`, canonical layer and exact position.
- Original model apply returned `MU_REJECTED: Stale document revision`; no intervening
  preview superseded its token. Readback both lists empty; revision
  `06ab1707cbb67c369ff0ec45288d36edc6ac44e624dfa8cff1b4ef737fa195af`.
- Guarded undo `00000000-0000-4000-8000-000000000402` returned revision
  `988dfe4b6e0052109a4a9aef4523ec98390313d6c5eed8679f03c1b4073ed2a6`.
  Unfiltered text readback then found zero. MCP save succeeded; independent SHA-256
  again exactly matched the run's starting file. No customer changes.

MCP client exited 0; no ASan ERROR/SUMMARY observed in `native-intervening-edit.log`.
At cleanup the Mac locked and automatic unlock failed; native editor remains open
on the saved, restored disposable fixture. Do not claim a clean exit for this third
launch. User must unlock before UI cleanup/verification; no repeated unlock attempts.
Worktree mechanical review passed 150 files. This increment does not qualify human
manual editing, all native snapshot domains, or provider isolation.
