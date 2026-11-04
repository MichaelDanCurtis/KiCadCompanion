# Native revision guard — implementation requirements, not a capability

Status: native board/settings revision-input capture compiled; fourteen focused native
tests passed under AddressSanitizer. Not installed or enabled in production. BL-04-A3 remains incomplete.
This document does not replace its acceptance
criteria or the required real concurrent-edit and preservation tests.

## Source baseline

Isolated checkout (initially sparse, now expanded): ignored `.runtime/kicad-revision-source`, KiCad tag 10.0.0,
commit `0feeca2a807f428ad2b3fa7c1e39625cb769f02c`. Cloned from the public
[KiCad source mirror](https://github.com/KiCad/kicad-source-mirror/tree/0feeca2a807f428ad2b3fa7c1e39625cb769f02c).
The initial clone did not modify any existing application, editor, customer project or
global development package. Owner-approved development package installation is recorded
below. The checkout now contains fourteen modified and two new source/build files. Original LICENSE/README and per-file notices remain
intact; this source is not imported into Benchline's permissive dependency catalog or
relicensed. Distribution and product license decisions remain outstanding.

The [existing gap](ACTION_BOUNDARY.md#unfinished-conformance) is across native calls:
Konnect compares a snapshot, then sends BeginCommit/UpdateItems/EndCommit. A host lock,
another preflight, or an undo group cannot guarantee no intervening editor modification.

## Required behavior

1. Use an explicitly discoverable **new conditional operation**. Do not add an optional
   protobuf precondition to the old write command and assume older servers enforce it:
   an unsupported server must reject the operation, not silently perform an unguarded write.
2. Bind the reviewed state to the exact native instance and document lifetime, not just
   a path or saved hash. Reopening the same file, undo/redo and unsaved manual edits must
   be included in conformance tests. Revision identity cannot silently survive replacement.
3. Capture a read-only native snapshot covering the actual plan dependencies, including
   footprint fields/children, nets/routing, document settings and unknown preservation
   domains. Canonicalization, bounds and completeness need explicit tests. External library
   inputs must also remain the exact reviewed bytes; a native document revision alone
   cannot attest a separately changed library.
4. Validate the whole batch and its expected state inside one native editor dispatch,
   before any mutation. Apply and publish the commit in that same guarded operation.
   Refuse overlapping pending commits; do not leave a second cross-call commit window.
   Audit event-loop reentrancy and all error paths rather than assuming one callback is atomic.
5. Preserve unknown fields and native object relationships. Full footprint replacement
   must not erase properties the wire representation cannot express. Refuse unsupported
   preservation domains explicitly until a tested native implementation handles them.
6. Return conflict with zero applied changes when the precondition fails. Distinguish
   verified application, verified no-op, rejected conflict, partial failure and unknown
   outcome. Lost replies must use inspection/reconciliation, never unconditional replay.
7. Register production support only after actual compiled native and Konnect integration
   tests. An echoed capability flag, protocol compilation or fixture test is insufficient.

## Approaches not yet qualified

- `BOARD::GetTimeStamp()` is an integer cache-invalidation counter. The inspected
  `board.cpp:262` and `board_commit.cpp:677` show increments, but coverage of every
  relevant change, rollover and document lifetime is not proven. Do not adopt it alone.
- `PCB_IO_KICAD_SEXPR::FormatBoardToFormatter()` at
  `pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp:329` avoids file I/O but calls
  EmbedFonts/ClearEmbeddedFonts on the board. Do not invoke it on the live document
  as a supposedly read-only fingerprint. BOARD's copy constructor is deleted; a shallow
  copy is not an established escape from those side effects.
- `API_HANDLER_PCB::handleCreateUpdateItemsInternal()` applies individual changes as
  it iterates and may defer publication to EndCommit. A conditional wrapper needs full
  batch validation and commit/error-path analysis, not merely an initial hash comparison.
- `KICAD_API_SERVER::handleApiEvent()` dispatches queued wx events. No full audit of
  nested event processing or competing native writers has been completed.

## Next implementation and verification

Establish a non-mutating, complete native snapshot representation and a conditional
single-dispatch update with preservation-aware prevalidation. Keep the patch in the
isolated KiCad source under its existing license. Extend Konnect to negotiate that exact
operation without a legacy-write fallback. Then exercise a disposable board with an
edit inserted after host preflight but before native dispatch, overlapping commits,
reopening, batch failure, lost response, undo/redo and unknown footprint fields.

Build environment observation, 2026-09-06: CMake, clang++, protoc and the macOS SDK
are available. wx-config and Ninja are not on PATH; wxWidgets, Boost and OpenCASCADE
are absent at their standard Homebrew opt paths. This is not an exhaustive machine
dependency scan or a failed full CMake configuration. The API QA target links pcbnew,
GUI and geometry libraries, so protoc alone cannot qualify the implementation. Resolve
a reproducible isolated build environment before claiming C++ or live-native validation.

## First native patch and build qualification — 2026-09-06T07:30Z

Changed only these files in the ignored KiCad checkout, retaining their original licenses:

- `pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.h`
- `pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp`
- `qa/tests/pcbnew/pcb_io/kicad_sexpr/test_kicad_sexpr.cpp`

`FormatBoardWithoutFontPreparation()` uses the existing formatter but omits the
font insertion/removal preparation. The original save entry point still prepares fonts.
This is deliberately not called a complete document snapshot: project settings,
editor lifetime and transient data are still absent, and wider serialization side effects
remain to be tested. No IPC operation or Benchline capability calls the new method yet.

Also replaced the formatter's temporary owning collection of borrowed embedded-file
pointers with a scoped non-owning collection. Its destructor relinquishes those pointers
even when output throws; the source board/footprint retains ownership. This addresses a
source-observed exception path, not a demonstrated failure in the installed application.
The plugin clears its formatter/board references when serialization throws.

Two native Boost regression cases were added, **not run**:
`BoardFormattingWithoutFontPreparation` checks retained fonts, unchanged timestamp,
repeatable bytes, skipped preparation and unchanged normal-save font behavior.
`BoardFormattingFailurePreservesBorrowedEmbeddedFiles` injects a formatter exception
at embedded-file output, checks ownership/content and reuses the formatter afterward.
ASan/native execution is still required; compiling unrelated JS tests cannot validate them.

CMake configure was actually attempted with AppleClang 21.0.0, CMake 4.3.0 and a local
install prefix under `.runtime/kicad-revision-install`; no install target was run.
It exited **1** at `CMakeLists.txt:815`: missing GLM_INCLUDE_DIR/GLM_VERSION, required
GLM >= 0.9.8. Compiler probes succeeded; source compilation never began. The retained
build directory is `.runtime/kicad-revision-build`, with CMake cache/configure logs.
The sparse source checkout must also be expanded before a full build.

Inspected the official [macOS build guide](https://dev-docs.kicad.org/en/build/macos/index.html)
and cloned the builder into ignored `.runtime/kicad-mac-builder`, commit
`227de1489ae646b2723723bad99f27c10c07c322`. Its reviewed bootstrap installs packages in
shared Homebrew; it was NOT run. Its dependency-only target builds KiCad's custom
wxWidgets, not a stock brew wxWidgets. Pin dependency revisions before executing it.
Upstream describes a multi-hour build using approximately 30 GB; local free space was
1.6 TiB. No Rosetta/license acceptance, package upgrade, ad-hoc app installation,
signing-identity access, editor launch, publication or customer action occurred.

Read-only Homebrew inventory of the bootstrap list reported installed cairo, cmake,
gettext, harfbuzz, libtool, openssl@3, protobuf and zstd. Missing from that list:
glew, bison, opencascade, glm, boost, doxygen, wget, libgit2, autoconf, automake,
unixodbc, ninja, nng, libomp, sentry-cli and jpeg. This is the upstream bootstrap list,
not proof that optional packaging tools such as sentry-cli are needed for our QA target.
Minimize the approved development installation; do not blindly run the bootstrap or
upgrade already-installed packages. Approval for changing shared Homebrew is pending.

Patch SHA-256 receipts:

| File | SHA-256 |
| --- | --- |
| pcb_io_kicad_sexpr.cpp | b4b5e4a0794d1e158e293d457d4fbce553a12385993547e300470129dc0a0801 |
| pcb_io_kicad_sexpr.h | 1ceadc9e6d8da11e345aeef6933288b8c3352f3b7d6b80829db5a554226b1e3a |
| test_kicad_sexpr.cpp | bd5fed8b87f1acdc2f4aa5481f2266f175532fad0d5ee3f707e4de19204e72a2 |

Next: obtain the scoped developer-dependency approval, configure the pinned native
build and run these tests (including exception ownership under ASan), then complete
snapshot coverage and the single-dispatch conditional operation. Do not declare
atomicRevisionCheck=true or enable production mutation based on this partial patch.

## Approved dependency build — 2026-09-06

Owner approved the required Homebrew development dependencies and private patched
wxWidgets build. This supersedes the earlier pending-install approval, not the separate
preview restart/sign-in requirement. Installed KiCad and customer CAD files are excluded.

Executed `brew install glm boost opencascade libgit2 glew bison autoconf automake ninja
nng libomp unixodbc swig` with `HOMEBREW_NO_AUTO_UPDATE=1`,
`HOMEBREW_NO_INSTALL_CLEANUP=1`, and `HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1`.
Exit 0. Verified direct versions: glm 1.0.3, boost 1.92.0, opencascade 7.9.3,
libgit2 1.9.7, glew 2.3.1, bison 3.8.2, autoconf 2.73, automake 1.18.1_1,
ninja 1.13.2, nng 1.12.4, libomp 23.1.0, unixodbc 2.3.14, swig 4.5.0.
Dependency installs include hwloc 2.14.0, tbb 2023.1.0, tcl-tk@8 8.6.18,
and libssh2 1.11.1_4. CA certificates updated to 2026-08-13 and llhttp to 9.4.3;
their previous kegs remain. Unlike the dry-run forecast, installed OpenSSL 3.6.3,
libtool 2.5.4 and pcre2 10.47_1 remained unchanged. No user shell profiles changed.
Homebrew warns that this macOS 27 prerelease host is unsupported; installation success
is not build or runtime qualification. Optional release/signing tools were not installed.

Expanded the pinned KiCad source checkout; its three-file patch was preserved and
`git diff --check` passed. Cloned these upstream dependencies into ignored `.runtime`
source directories and made space-free local source copies in the private staging root
`/private/tmp/benchline-native-build.O5xK7W`:

- wxWidgets `kicad/macos-wx-3.2`, commit
  `f9c61658f6831b9fd5e0427531ab4e735bf9a24b`, with pinned recursive submodules.
- ngspice `ngspice-45.2`, commit
  `724dc77b9153dc75eaec474b1f7a44f1fcf5f362`.

Original licenses are retained; these development builds do not clear distribution gates.
The private root contains `wx-src`, `wx-build`, `wx-install`, `ngspice-src`,
`ngspice-build`, and `ngspice-install`. It must be retained for build resumption; it is
temporary storage, not a distributable or durable product installation.

Both configure commands exited 0. wxWidgets uses the reviewed macOS builder options,
Apple clang, deployment target 14.0, Cocoa/Unicode/monolithic/debug with optimization,
built-in image/XML/regex dependencies, OpenGL and no mediactrl/liblzma. ngspice uses
`--with-ngshared --enable-xspice --enable-cider --disable-debug --disable-openmp`,
clang and task-local `/opt/homebrew/opt/bison/bin` PATH. Its reviewed `autogen.sh`
first refused the parent directory without changes, then succeeded from its source root.
Builds started with four jobs each; install targets are restricted to the private prefixes.
Configure/build/install logs are retained under each build directory. No native KiCad
test result is claimed by these dependency configuration results.

Dependency build results: wxWidgets build/install exited 0; private `wx-config
--version-full` reports 3.2.8.0. ngspice initially failed at bundled cppduals' forbidden
`std::is_compound<duals::dual<T>>` specialization under AppleClang 21/libc++.
Removed that redundant specialization only in the private `ngspice-src` copy: a class
already satisfies the standard trait. The canonical ignored upstream clone is unchanged.
`benchline-dual-trait-check.cpp` passes `clang++ -std=c++14 -fsyntax-only` with static
assertions for ordinary, const and nested dual types. No warning suppression was added.
Incremental ngspice build (`build-compat.log`) and private install then exited 0;
`file ngspice-install/lib/libngspice.dylib` reports Mach-O arm64. This is dependency
build evidence, not circuit-simulation conformance or distribution qualification.

Native KiCad configure restarted in `.runtime/kicad-revision-build` with private
wx/ngspice prefixes, Homebrew/OpenCASCADE search roots, wxPython/i18n/SPICE QA off,
Debug, `KICAD_SANITIZE_ADDRESS=ON`, deployment target 14.0, and
`KICAD_APPLE_MAKE_RELOCATEABLE_BUNDLE=OFF`. Python `/usr/local/bin/python3` was
verified to run arm64 (3.14 framework); no extra Python installation was performed.
Log: `.runtime/kicad-revision-build/configure-approved.log`. Native app installation
is not requested; its configured prefix remains isolated under `.runtime`.

Native configure ultimately exited 0 (`configure-framework-path.log`). Intermediate
failures were macOS discovery issues, resolved with documented cache options rather
than application-source changes: `NGSPICE_LIB_NAME=ngspice` (upstream finder defaults
to a Linux `.so.0` name), `OCC_INCLUDE_DIR=/opt/homebrew/opt/opencascade/include/opencascade`,
`OCC_LIBRARY_DIR=/opt/homebrew/opt/opencascade/lib`, and explicit Python 3.14 framework
library/include/root paths. Added missing development helper pkgconf 3.0.6 through
Homebrew under the same no-cleanup/no-unrelated-upgrade settings, exit 0.
The native `qa_pcbnew` target is now compiling with six jobs and AddressSanitizer;
log `.runtime/kicad-revision-build/build-qa-asan.log`. Configuration is not test passage.

First native compile exited 2 because API CMake used `add_definitions(-include path)`
with an unquoted source path containing spaces. Corrected isolated `api/CMakeLists.txt`
to target-scoped `target_compile_options(kiapi PRIVATE -include "path")`; its SHA-256
is `11682dfc76cc1b750017a8180804cae9ec9565ad2875c4c3fbb27d0ce8da3458`.
The three prior patch hashes remain unchanged, and native `git diff --check` passed.
Reconfigure exited 0 and generated flags now preserve the single quoted header argument.
Resumed build log: `.runtime/kicad-revision-build/build-qa-asan-pathfix.log`.

That build reached 26% before an independent shader custom-command quoting error
failed with a literal escaped space in the input filename. Fixed only the isolated
`common/gal/CMakeLists.txt`: quote each complete `-Dname=value` argument and add
`VERBATIM`. Reconfigure exited 0; all twelve shader conversions then succeeded and
compilation continued (`build-qa-asan-shaderfix.log`). Five native source/build files
are now changed. No warning suppression, source-fixture change, or acceptance waiver.

Linker warnings disclose that Homebrew libraries (including Abseil and nng) require
macOS 26 despite the configured 14.0 target. This is a current-host development build,
not evidence of macOS 14 compatibility; release targeting requires a separately
qualified dependency set. The warnings do not justify claiming backward compatibility.

The shader-fixed build reached 93%, then failed compiling the generated Python binding:
SWIG 4.5 no longer supplies Python 2 compatibility aliases used by KiCad's interface
files. Updated isolated `common/swig/math.i` and `common/swig/wx.i` to use
`PyLong_FromLong` and `PyBytes_Check` directly. These are the exact Python 3 expansions
in [SWIG 4.4.1's header](https://github.com/swig/swig/blob/v4.4.1/Lib/python/pyhead.swg),
not changed conversion semantics. Seven native files now differ from the pinned tag.
The first incremental attempt reused the stale generated wrapper and failed identically;
preserved it as `pcbnew_wrap.pre-swigfix.cxx` and triggered normal regeneration by
renaming the generated output (no manual generated-code edit). Current log:
`.runtime/kicad-revision-build/build-qa-asan-swigregen.log`.

## Native build and focused regression result — 2026-09-06

`cmake --build . --target qa_pcbnew --parallel 6` completed **exit 0**, 100%, in
`.runtime/kicad-revision-build` (`build-qa-asan-swigregen.log`). The executable is Mach-O
arm64 and links `libclang_rt.asan_osx_dynamic.dylib`. No native app install target ran.
Executable SHA-256: `86ff0779852fe93955426aeb356a166ee5ab9c5bdfdcedb248ebfbe0ccc80cd0`.

Ran with `KICAD_RUN_FROM_BUILD_DIR=1`, `KICAD_CONFIG_HOME_IS_QA=1`,
`KICAD_CONFIG_HOME=/private/tmp/benchline-native-qa-config.GvGUyX`, and
`ASAN_OPTIONS=halt_on_error=1:abort_on_error=1`. User KiCad configuration is not used.

- `qa/tests/pcbnew/qa_pcbnew --run_test=KiCadSexprIO/BoardFormatting*`
  with Boost detailed reporting: **exit 0, 2 cases / 13 assertions passed**.
  Log `test-formatting-asan.log`; 701 unrelated cases were filtered out.
- `qa/tests/pcbnew/qa_pcbnew --run_test=KiCadSexprIO --log_level=message
  --report_level=detailed --color_output=no`: **exit 0, 5 cases / 29 assertions passed**.
  Log `test-sexpr-suite-asan.log`. Temporary native round-trip output was scoped with
  `TMPDIR=/private/tmp/benchline-native-build.O5xK7W/qa-temp`.
  All five cases in this suite ran; 698 other PCB cases were filtered out, not qualified.

No AddressSanitizer error was reported by either run. Tests exercise real compiled KiCad
objects and serialization, including the injected exception path; they are not live-editor
concurrency, whole-document revision coverage, Python-binding runtime conformance or
full native application qualification. `atomicRevisionCheck` remains unavailable.

Additional native source receipts (the original three hashes above remain unchanged):

| File | SHA-256 |
| --- | --- |
| api/CMakeLists.txt | 11682dfc76cc1b750017a8180804cae9ec9565ad2875c4c3fbb27d0ce8da3458 |
| common/gal/CMakeLists.txt | 6c93518bc3e60069db7c2c2a9c7c904087e0e0d59e15a57c09cb1c85084a8ae3 |
| common/swig/math.i | 75302e83ad58aa92a94cc269591adf1c0fd3f650dd708537bfb7c3448f04f3c6 |
| common/swig/wx.i | e6e0f3f1dcf4ee5aec60637950a29dca581e3387f3d237a807d9e6a2230f3fc7 |

Private ngspice cppduals header hash:
`51e3dfc045f83b648a37f910c27f8e75e549f18f3ce5f32ab2a4a0783e7ae567`.
Native and Benchline whitespace checks passed; Benchline `review:check -- --worktree`
passed for 141 files. The package/build/test processes have exited; no unattended build
or installation is left running. Existing previews were not restarted.

Next native step: finish snapshot coverage and the single-dispatch conditional operation,
then run real stale/concurrent/preservation/unknown-outcome conformance on a disposable
native document. This successful build clears the development prerequisite, not BL-04.

## Current settings and combined revision inputs — 2026-09-06

Previous goal turn classified as **progress**, not a wait or repeated blocker: dependency
installation, native build and five serializer tests completed. This continuation verified
the host Goal is active again; the ledger's earlier blocked note was superseded.

Added `JSON_SETTINGS::CaptureParameterState()`: registered parameters serialize to a
temporary settings object, leaving the live backing JSON and modified flag untouched.
Its inspection envelope keeps stored/current state and nested children separate, retaining
unknown keys without masking deleted map entries behind stale backing values. It never
calls the live object's Load/Store/SaveToFile methods. Wrong nested ownership, cycles and
nesting depth of 32 or greater throw instead of returning an incomplete capture.

`PARAM_LAMBDA::Store()` suppresses errors in the pinned source. Added a separate strict
`StoreForCapture()` entry point for capture; the lambda implementation propagates getter
errors. Existing best-effort persistence behavior is preserved. Custom parameter serializers
that suppress errors must override the strict entry point; arbitrary new getters are not
automatically certified side-effect-free by this API.

Auditing real design-settings getters found `drc_exclusions` used map indexing to retrieve
comments, inserting missing entries while reading. Replaced that lookup with `find()` and
an empty-string fallback. A native regression proves repeated capture does not insert the
missing comment or change backing settings, and does observe unsaved rule changes.

Added `pcbnew/api/board_revision.{h,cpp}`, linked into `pcbnew_kiface_objects`:
`CaptureBoardRevisionInputs(BOARD&)` combines existing board-format content without font
preparation, the board ID/path/timestamp, current design settings, and attached native
project/local settings. It refuses worker-thread access, propagates errors, checks for a
timestamp change across capture, and caps the board-format stream at 64 MiB. That is a
board-stream limit, not a tested bound on all JSON memory. It is **not an IPC command**,
not a completed revision token, and is not exposed to a production writer.

Actual native tests demonstrate:

- A rules-only edit changes combined inputs while board text and timestamp stay identical.
- A placed footprint model change changes board content; capture preserves the model.
- An unsaved project-variable edit changes project inputs without updating backing JSON
  or the board text. This uses KiCad's native in-memory dummy project, not a customer file.
- Repeated capture is equal in the exercised states; ordinary/nested getter failures reject
  capture without persisting partial JSON. Invalid ownership, cycles and depth are rejected.
- A worker-thread call is rejected; a following main-thread capture succeeds.

Verification history, preserved rather than relabeled:

1. Initial settings build exit 0; first combined test run exit 201 with three test-setup
   conversion errors. Explicit base-JSON casts corrected those copies; no assertions were
   removed. Rerun: 11 cases / 65 assertions passed, exit 0.
2. Initial collector build exit 2 for a wrong forward-header name; corrected to the repository's
   `nlohmann/json_fwd.hpp`. Rebuild and expanded tests: 13 cases / 79 assertions passed.
3. Final build `build-revision-thread-check.log` exit 0. Final run
   `test-revision-thread-check-asan.log`: **14 cases / 81 assertions passed, exit 0**.
   Both complete selected suites ran: BoardDesignSettings (9) and KiCadSexprIO (5).
   **697 of 711 PCB cases were filtered out**, not verified. No ASan error reported.

Final test command from `.runtime/kicad-revision-build`:

```sh
env TMPDIR=/private/tmp/benchline-native-build.O5xK7W/qa-temp \
  KICAD_CONFIG_HOME=/private/tmp/benchline-native-qa-config.GvGUyX \
  KICAD_CONFIG_HOME_IS_QA=1 KICAD_RUN_FROM_BUILD_DIR=1 \
  ASAN_OPTIONS=halt_on_error=1:abort_on_error=1 \
  ./qa/tests/pcbnew/qa_pcbnew --run_test=BoardDesignSettings,KiCadSexprIO \
  --log_level=message --report_level=detailed --color_output=no
```

Executable SHA-256: `8344ad23b6ff3db6a0deba8094584a6035b63895d200a4258e8caffbd4fafd2d`.
Source receipts for this increment (previous seven files unchanged):

| File | SHA-256 |
| --- | --- |
| common/settings/json_settings.cpp | 46f29984e949952891617903f3dd7301da4a8b06352bb9e9f80886e997089032 |
| include/settings/json_settings.h | 5d30e2d487c175d8b845b5f09b1c2a3ec6420d40acce48f827397c600941cbf5 |
| include/settings/nested_settings.h | 943c3bff8442cf66cc0697d6f72f32a995f503b24506070d3ac7e0f7e2e2034f |
| include/settings/parameters.h | 9ad20c6300a5cddcfec7d4c34d2cfc4d84aaa9b5437d1726d7b8d5872313da03 |
| pcbnew/board_design_settings.cpp | 3bed9e3d6a1faec21729ff58cbcece68a3fd9cd79470cf0e9d2041f0e2e2f3b4 |
| pcbnew/api/board_revision.cpp | 312647811c926fd9f143160d4eee253e91de324a2b8a21ee50ded675bbbe06e1 |
| pcbnew/api/board_revision.h | 91fa0d66eb02e2a4b0040cfc25d3f410d776f586f922a54a17b94cebcf23bf91 |
| pcbnew/CMakeLists.txt | eb01a08b511e3a7e7d87006b6e2611cb3ee95cae5f50fa820fd1a9626c539f9d |
| qa/tests/pcbnew/test_board_design_settings.cpp | 22d90ff8aac194249932d3fac4e5793de20689c245df023d508f48e5eb6d934d |

Next: bind capture to native document/editor lifetime and edit epochs; finish coverage and
error bounds; implement the new whole-batch conditional operation and its native/Konnect
conformance. In particular, BOARD_COMMIT::Push invokes selected-item listeners and can
schedule zone/teardrop work: audit those effects and reentrancy before claiming an atomic,
preservation-safe operation. A timestamp comparison alone is explicitly insufficient.
All full BL-04 criteria remain incomplete. Production mutations stay disabled. No installed
application/customer file was changed, and all build/test handles are terminal.

## Experimental native model operation — 2026-09-06

The private KiCad fork now builds a **default-off experimental protocol and in-place
model-list operation**, not just capture helpers. This remains partial BL-04-A3/A5
engineering evidence, not qualification of any full criterion or production capability.
Source remains GPL-covered private fork work at the pinned revision above. Nothing was
installed, published, launched into a customer project, or connected to production agents.

Implemented:

- `BOARD_REVISION_CLOCK` is owned by PCB_EDIT_FRAME. SetBoard resets document lifetime;
  OnModify advances an overflow-checked edit epoch (including the native undo/redo call
  sites, inspected in source). Tests exercise the clock; actual GUI undo/reopen is pending.
- Revision inputs are hashed through bounded, typed CBOR and SHA-256. Non-finite numbers,
  unsupported JSON values, excessive nesting and oversized encodings fail. Exact native
  model doubles supplement the board formatter, which rounds opacity to four decimals.
  A 0.75001 -> 0.75002 edit now invalidates a preview despite identical formatted text.
- New protobuf command types `kiapi.board.experimental.PreviewFootprintModels`,
  `ApplyFootprintModels` and `InspectFootprintModelsResult` have no legacy-write fallback.
  Registration requires the exact private-process environment opt-in
  `KICAD_ENABLE_EXPERIMENTAL_REVISION_API=1`; the ordinary default is unhandled/unsupported.
  The prototype has its own vectors: dimensionless scale, degrees rotation, millimeters
  offset. It does not reuse the misleading `*_nm` component names in the legacy model wire type.
- One current preview and one outcome receipt per handler bound memory growth. The preview
  contains the previous model lists and a native revision; its token is client-correlated,
  exact-argument-bound, expires after 120 seconds and is consumed before staging or writing.
  A new preview invalidates the previous token. Client names are NOT authentication or consent.
- The entire request is validated before writes: 1-128 unique existing unlocked footprints,
  at most 32 models each, a 1 MiB request limit, valid UTF-8 filenames, explicit finite
  transforms and valid opacity. Unknown protobuf fields are rejected recursively.
- All undo images are staged before a final revision/expiry comparison. The complete batch
  then swaps pre-resolved native model vectors without allocation or event dispatch in the
  write loop; the vector swap's noexcept guarantee is checked at compile time. No footprint
  deserialization/replacement, child recreation or file save is involved.
- `BOARD_COMMIT::PushFootprintModelChanges` sends native change notification and, with a
  frame, registers undo and updates dirty/3D state. It avoids ordinary commit connectivity,
  group-entry, teardrop, auto-fill and synchronous selection-tool work. PCB frame API-busy
  checks reject re-entry during this operation; this is not proof that every common API
  handler is covered (see limitations below).
- A pre-write failure is rejected. A failure after model swaps is unknown, not success or
  automatic rollback/retry. A consumed token cannot execute again. The latest receipt can
  be inspected; missing/evicted/restarted receipts are unknown and require native-state inspection.

Verification history (all failed logs retained in the private build directory):

1. `build-experimental-model-update.log`: exit 2. The initial noexcept check also evaluated
   a non-noexcept accessor. The write loop was changed to pre-resolved vector pointers and
   the assertion now checks the actual swap type.
2. `build-experimental-model-update-2.log`: exit 2. Test setters exposed the legacy vector
   `*_nm` naming mismatch. The experimental protocol now uses its own explicit model vectors.
3. `build-experimental-model-update-3.log`: exit 2. Boost could not print a wide-character
   literal in an assertion; changed that assertion to a boolean equality, retaining the check.
4. `build-experimental-model-update-4.log`: exit 0. Initial selected suites passed
   **31 cases / 182 assertions**, exit 0, in `test-experimental-model-update-asan.log`.
5. Added exact model-double capture and the sub-format-precision regression. The precision
   build and test passed **32 cases / 186 assertions**. Added an IPC-build conditional around
   the handler-registration test (IPC-off builds themselves were not qualified).
6. Final `build-experimental-model-update-final.log`: exit 0. Final
   `test-experimental-model-update-final-asan.log`: **32 cases / 186 assertions passed,
   exit 0, no AddressSanitizer error**. Full selected suites: BoardDesignSettings 9/52,
   BoardCommit 3/6, FootprintModelUpdate 15/99, KiCadSexprIO 5/29 (cases/assertions).
   **694 of 726 PCB cases were filtered out**, not verified.
7. `cmake --build . --target pcbnew --parallel 6`, recorded in
   `build-experimental-pcbnew-app.log`: exit 0. The private PCB Editor and kiface build;
   they were not launched or installed. Existing current-host dependency/deployment-target
   warnings still apply. This is not a portable/release package.

Final QA command, from `.runtime/kicad-revision-build`:

```sh
env TMPDIR=/private/tmp/benchline-native-build.O5xK7W/qa-temp \
  KICAD_CONFIG_HOME=/private/tmp/benchline-native-qa-config.GvGUyX \
  KICAD_CONFIG_HOME_IS_QA=1 KICAD_RUN_FROM_BUILD_DIR=1 \
  ASAN_OPTIONS=halt_on_error=1:abort_on_error=1 \
  ./qa/tests/pcbnew/qa_pcbnew \
  --run_test=FootprintModelUpdate,BoardDesignSettings,KiCadSexprIO,BoardCommit \
  --log_level=message --report_level=detailed --color_output=no
```

Native tests cover complete-batch visibility to a listener; unchanged footprint/pad/group/
selection identity; preservation of a custom field and embedded-data ownership; native
serialized non-model content after model restoration; transform units; no-op; token replay,
client mismatch, changed arguments, expiry and new/failed-preview invalidation; late locked
targets; live-rule/edit-clock/lifetime changes; final-guard failure after staging; failure on
the second undo image; an exception in a real board listener after both model lists change;
unknown outcome inspection; malformed/unknown fields; hashing bounds; and worker-thread
rejection. The embedded content is a synthetic ownership sentinel, not a qualified STEP model.
The registration test uses the real handler with a malformed protobuf before frame access;
it does NOT prove a live GUI/NNG request.

Binary SHA-256 receipts (paths relative to the private build):

- `qa/tests/pcbnew/qa_pcbnew`: `b47d9ebe117cf992ac3c8ac6bdfbca235a6b8f0deb66e9d19a75cc87a208b69a`
- `pcbnew/pcbnew.app/Contents/MacOS/pcbnew`: `9d385bc0e6086d10758c5fa57fd5fcc795bc03703c1142f1d057b8bc419de4e2`
- `kicad/KiCad.app/Contents/PlugIns/_pcbnew.kiface`: `9e5a2c572552941d1ec282eab2178700883dcb1bc9c183941b3cfc296b5b2ca9`

Source receipts for this increment (relative to the private source; earlier unchanged files
retain the receipts above). The fork now has 21 modified tracked files and six new files.

| File | SHA-256 |
| --- | --- |
| api/CMakeLists.txt | 025d0704db47e013bd4f4fb9c56b5dcbc0e724cdddaacda976987e4a1cb25009 |
| api/proto/board/experimental_model_update.proto | 53daf695f09be00b8327097ea44399dc34e339609ce1ed129a3a946eb8d273f0 |
| pcbnew/CMakeLists.txt | 8a299b0c32b1c8cfdcff6b1f08e567876b8971e3f6c169f15815c176aaa0f4ee |
| pcbnew/api/board_revision.cpp | 1260555a65ddc1e33bc134eb14d65ead5845f91ba48276bbf4ec9774ffc08da7 |
| pcbnew/api/board_revision.h | afdefa5d52b76294e646f8b5a8984747133811c0de3eb022b9849769fffe0596 |
| pcbnew/api/footprint_model_update.cpp | 98eacc9edf5ccc7263578cb39c73e1825279e682215597321ccc9f772c5699b6 |
| pcbnew/api/footprint_model_update.h | 7d62185c6eecaca28e5a2609121db5023c64eecea693ff1422328ceab0dd560c |
| pcbnew/api/api_handler_pcb.cpp | 270c52dd1129a498de430e96bb3760807d17e1f5e521e0405b84c4ab27e588a4 |
| pcbnew/api/api_handler_pcb.h | 603136e297c6abf99ce20093121e54503820dad48e4978a6dad1101377b7d208 |
| pcbnew/board_commit.cpp | b1ded182d125f7100b996531e65a4bb256818326a2426ad6560ffa7de86e528b |
| pcbnew/board_commit.h | 49113bb44d3a007693d326074c71f339905042572c4a371c5dce023214171b65 |
| pcbnew/pcb_edit_frame.cpp | 25d271b726a715cdab9cb0d0fd91a2b18cc2a101c2638be307ab159695771e55 |
| pcbnew/pcb_edit_frame.h | f7120db4baeeab8c88e802cc5bbab42869338031a3a7c3aec8bcc1f13eceb0e1 |
| qa/tests/pcbnew/CMakeLists.txt | 9b3e034b504328ccc5051016a0dd756769cd3c78fd82499b1e304f0dcc07d901 |
| qa/tests/pcbnew/test_footprint_model_update.cpp | 97d810cf2e439db6c94b70af728fe824c40d2be5ba1fff1aa4549caaea60f9a3 |

Remaining qualifications and next action:

- Recheck the source hashes after further native edits. Compile-time/unit success does not
  prove live frame lifetime, undo/redo, rendering, reload, transport loss, or Konnect behavior.
- Capture coverage of other rounded native values, transient state, serializer side effects
  and external inputs remains incomplete. Encoding/formatter bounds do not bound the entire
  intermediate JSON allocation. No complete-snapshot claim is made.
- Common project handlers such as SetTextVariables do not consult the PCB frame's busy
  method. The NNG listener currently processes one receive/reply at a time, but that source
  observation is not reentrancy/transport conformance. The malformed-envelope path in
  api_server.cpp also replies without immediately returning; qualify/fix dispatch before
  treating native transport as trustworthy for this protocol. No transport change was made here.
- Build an isolated native-window/IPC test path and extend a private Konnect adapter for
  these exact experimental commands, preserving its license and never falling back to legacy
  footprint replacement. Use MCP for disposable CAD changes. The installed Konnect remains
  unchanged and its discovered catalog does not expose these new prototype commands.
- Test real undo/reopen, current-document binding, pending commits, stale/concurrent edits,
  post-write loss/recovery and selected/embedded-field preservation through that live path.
- Production Discuss/Agent and native mutation capabilities remain disabled. Authenticated
  provider testing still needs the separately pending preview-restart approval and user-managed
  sign-in. No full BL-04 checkbox is complete; BL-05 through BL-14 remain ineligible.

### Native dispatch and transport qualification — 2026-09-06

This follow-up retains the same private KiCad revision, default-off experiment and
production capability gates. It does not change installed applications or customer CAD.

`DispatchApiRequest` now returns immediately on malformed envelopes, rejects missing/invalid
message types and wrong instance tokens, and supplies one server-owned response token.
Unhandled commands cannot accidentally become success. Exceptions yield an unknown outcome,
not a claim of rollback. A regression constructs a valid request prefix followed by an
invalid protobuf byte: partial parsing must never reach a native handler.

The NNG listener now wakes on shutdown while awaiting a response, frees allocated receive
buffers, synchronizes callback installation, reports successful binding rather than merely
a joinable thread, and correlates replies with request IDs. Empty replies are supported;
duplicate or stale replies cannot answer a later request. Native wx events own their request
bytes and carry a listener generation. Stop joins the worker, discards queued payloads and
removes the handler from the wx application's pending list; restart generates a new instance
token. An opt-in, existing absolute private socket directory supports isolated testing
without touching the normal installed KiCad socket. Invalid explicit configuration fails
without falling back to the default directory.

Initial results and failures are retained, not replaced by later reruns:

- `build-native-dispatch.log`: exit 0. `test-native-dispatch-only-asan.log`: seven dispatch
  cases / 23 assertions passed; other API cases filtered.
- `test-native-transport-asan.log`: seven NNG cases / 24 assertions passed, including real
  private Unix sockets, late replies, callback failure and shutdown/restart. No CAD/frame.
- `test-native-event-queue-diagnostic.log`: one real native event-queue case / 12 assertions
  passed for malformed then valid requests. This is not a PCB frame integration test.
- `test-native-event-queue-asan.log` and `test-native-event-restart-diagnostic.log`: exit 142
  at the explicit 45-second alarm. The restart case hung because clearing wx payloads alone
  left the handler registered in the pending list. The subsequent fix mirrors wx destruction
  by removing the pending handler before deleting events; verification is still pending.
- `test-native-dispatch-asan.log`: full API run exited 1 with AddressSanitizer container
  overflow during protobuf PadStack decoding. The initial native build mixed sanitized
  callers with unsanitized Homebrew Protobuf. No API test was removed or sanitizer disabled.

Private dependency rebuild (no system package replacement):

- Protobuf v34.1, commit `4b0c3aacf0657fbf38253b38918d3358dd4319ec`, in
  `.runtime/protobuf-native-source`; BSD notices retained.
- Abseil 20260107.1, commit `255c84dadd029fd8ad25c5efb5933e47beaa00c7`, in
  `.runtime/abseil-native-source`; Apache-2.0 notices retained.
- Build/install root `/private/tmp/benchline-protobuf-asan.LDcfKa`, with separate `build`,
  `install`, `absl-build` and `absl-install` directories. Debug, C++17, arm64, deployment
  target 26.0, shared libraries, compile/link `-fsanitize=address`; dependency unit suites
  disabled for this build and therefore not claimed tested. KiCad remains ASan-enabled.
- Initial Protobuf build with libupb disabled failed to link libprotoc; enabling
  `protobuf_BUILD_LIBUPB=ON` built successfully. Sanitized Protobuf with unsanitized Abseil
  then aborted in `raw_hash_set.h` during protoc startup. Abseil's headers explicitly alter
  generation storage under sanitizers; both dependencies were rebuilt consistently.
- Private Abseil build/install and Protobuf rebuild/install exited 0. Installed protoc
  initially failed macOS dylib lookup; `CMAKE_INSTALL_RPATH_USE_LINK_PATH=ON` and reinstall
  added the private Abseil library path. `install/bin/protoc --version` then returned
  `libprotoc 34.1`, exit 0, with sanitizer checks enabled.
- Dependency logs remain under that private root (`build-private-absl.log`,
  `absl-build.log`, `install-private-rpath.log` and corresponding configure/install logs).
  KiCad is reconfigured to private Protobuf, utf8_range and Abseil CMake packages.
  `build-private-protobuf-absl.log` is the current native rebuild; results are pending.

The dependency/layout diagnosis remains an inference until the full API regression rerun
passes. Current-host build success is not macOS 14 compatibility or a release package.
The private Konnect v0.11.0 source was fetched at
`a22ad2153dcf45dbcf1cc63b5b0f1e40c93d7956` into `.runtime/konnect-revision-source`;
its AGPL/commercial terms remain applicable. No new Konnect command has been implemented,
built, installed or submitted yet. Live PCB-frame/MCP, undo/reopen, full snapshot coverage
and authenticated provider isolation remain required. All BL-04 checkboxes stay incomplete.

Dispatch/transport source SHA-256 receipts (private KiCad source):

| File | SHA-256 |
| --- | --- |
| common/CMakeLists.txt | 835fb4837024956ee1db007a023459c18039f2dd8fa94111654a82056aab8ecb |
| common/api/api_dispatch.cpp | 961aff04ccc1e9d10a679bfb4e98f9a29fd7b8dbc2d69605e06378f600d92d2c |
| common/api/api_server.cpp | a1433d09184bc04d4b7bd34cb638f212163eee77976314ab56d11168e7dd4421 |
| include/api/api_dispatch.h | 36cf675f16a0038299ca393d44a79cdef8a655ddc971299396ad6cef2202154d |
| include/api/api_server.h | 1c2d24e428dddc7ef11ea46bec1b7d0ceb1d55fa375599a3a8811335f1c07dc8 |
| libs/kinng/include/kinng.h | 347b2360dc9b70995f11a0190b82f7953f91647a46951a04b789be47f84203cb |
| libs/kinng/src/kinng.cpp | ab6c8cc1b8d043e236fcd58cad163af20df6582ccecada5645098dd85d087d44 |
| qa/tests/api/CMakeLists.txt | e22fefedbcf1d7ae8905d78e2f4ec38c19579b8b4fdf41cf32e445cd5b63e49e |
| qa/tests/api/test_api_dispatch.cpp | c33b1c3f6977d266aa6a50a01d1b2b67deffaac21b0bf5ae8287694288775d3c |
| qa/tests/api/test_api_server.cpp | 9958dcfba28926f8c7f6c2f7292c81bbab72fdfe2b5be15c877cf1919bb803ae |
| qa/tests/libs/kinng/test_kinng.cpp | a2310b76d7b2d6ed12c6df0f4f0bb5ba996591920537b9cd5bc9444cf73c27e5 |

Consistent-dependency rerun: `qa_api` rebuilt successfully. The complete API suite then
passed **41/41 cases, 2,096/2,096 assertions**, exit 0, with no filtering and ASan enabled.
`test-native-api-private-deps-asan.log` records all results. This includes 29 enum cases,
the two existing protobuf cases, seven dispatch cases and all three real native event-queue
cases (36 assertions). The restart case passed 20 assertions; the earlier timeout is resolved
at the source receipt above. The earlier decoder failure did not recur with the consistent
dependency build. No sanitizer suppression, test deletion or assertion disabling was used.
`otool -l qa/tests/api/qa_api` confirms private wx, Protobuf and Abseil runtime search paths.

Command from the private KiCad build directory:

```sh
env TMPDIR=/private/tmp/benchline-native-build.O5xK7W/qa-temp \
  KICAD_CONFIG_HOME=/private/tmp/benchline-native-qa-config.GvGUyX \
  KICAD_CONFIG_HOME_IS_QA=1 KICAD_RUN_FROM_BUILD_DIR=1 \
  ASAN_OPTIONS=halt_on_error=1:abort_on_error=1 \
  /usr/bin/perl -e 'alarm 45; exec @ARGV' ./qa/tests/api/qa_api \
  --log_level=error --report_level=detailed --color_output=no
```

Benchline `npm test` also reran: **168 passed**, no failures/skips, exit 0;
`.runtime/bl04-benchline-regression-native-transport.log`. This is regression evidence,
not production/native CAD conformance. The remaining native targets are still rebuilding.

Final increment verification: `build-private-protobuf-absl.log` completed with exit 0 for
`qa_api`, `qa_pcbnew` and `qa_kinng` (including the private PCB Editor/kiface dependencies).
The selected PCB rerun passed **32 cases / 186 assertions**, with 694 other PCB cases
filtered, exit 0 (`test-native-pcb-private-deps-asan.log`). It used the same selected suites
and isolated QA environment documented above, with log level `error`. The full transport
rerun passed **seven cases / 24 assertions**, exit 0
(`test-native-transport-private-deps-asan.log`), using the API command's environment,
45-second alarm and report options with `./qa/tests/libs/kinng/qa_kinng` as executable.
All build/test handles are terminal. No sanitizer failures occurred in these final runs.

Final binary SHA-256 receipts (private build-relative paths):

| Binary | SHA-256 |
| --- | --- |
| qa/tests/api/qa_api | 93fa9665af4c39c49f53829213ca973a4b1c46ba64b834279aa3f161dc628467 |
| qa/tests/pcbnew/qa_pcbnew | 4ade2beee895318c20e861262ecf29f336febce3aeace7ab374d1a4df0631a36 |
| qa/tests/libs/kinng/qa_kinng | ebfbd22a72890fbca2ad2c5672477090994c49fce84602e30bee84fb61b1f069 |
| pcbnew/pcbnew.app/Contents/MacOS/pcbnew | fddb1e301e36e75fd6da54b4aa3b00bf7112f465794b6c6733b8f967c62595a1 |
| kicad/KiCad.app/Contents/PlugIns/_pcbnew.kiface | 018e0b880ed4e760cf598ea11f5f9a626a21e4c659a70e4cc6357c2bbdf35383 |

The private fork has 28 modified tracked files and ten new files. Tracked whitespace
checks passed; all new files had no no-index whitespace diagnostics (exit 1 indicates new
content). Benchline review scan passed 141 files and status.json parsed. These tests qualify
the dispatch/transport increment, not all BL-04. Next: private Konnect command support and
live isolated native-window tests through MCP. Installed tools, customer documents, existing
preview processes and production capability settings remain unchanged.

Follow-up: [private Konnect protocol support](KONNECT_MODEL_PROTOCOL.md) now implements and
tests the experimental MCP/client path. This supersedes the earlier "extension not
implemented" status, not the pending live native-window qualification or production gates.

## 2026-09-11 private dependency qualification refresh

The BL-08 saved-board API comparison reproduced the earlier Protobuf ASan
container-overflow with CMake configured to use Homebrew dependencies. The old private
prefix retained libraries but lacked its installed headers/package metadata.
The [BL-08 evidence](evidence/BL-08.md) and
`.runtime/bl08-saved-snapshot-evidence/receipt.json` supersede the dependency and
binary pins above for this new build; older live results keep their original scope.

The private CMake option `BENCHLINE_ASAN_DEPENDENCY_ROOT` now fails configuration
if its headers/packages disappear, package origins conflict, ASan is disabled or
legacy discovery is selected. It also pins private header precedence, protoc and
macOS API/PCB-library runtime search paths. For a new recovered prefix, configure
that root together with `Protobuf_DIR=<root>/install/lib/cmake/protobuf`,
`utf8_range_DIR=<root>/install/lib/cmake/utf8_range` and
`absl_DIR=<root>/absl-install/lib/cmake/absl`; do not clear the guard to permit
system fallback. Exact commands and the current root are in `dependency-recovery.json`
and the configure receipts. This opt-in setup is a private qualification build,
not a distributable dependency layout or application installation.

Final qualification: both saved-board native projections pass, 69 selected PCB
cases pass, all 41 API cases and seven NNG cases pass, and both Python board-reader
reports match earlier reports without source-file changes. Runtime loader traces
confirm private Protobuf/Abseil; no ASan suppression was used. The receipt includes
86 source snapshots, ten native artifact hashes and 96 dependency-library hashes.
The Mac remains locked; live editor checks and broader milestone acceptance remain open.
