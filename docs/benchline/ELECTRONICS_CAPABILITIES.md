# Electronics compatibility — BL-08

Observed 2026-09-11 on the isolated reference fixture and owned copies of pinned saved fixtures. Tool names and successful
MCP responses alone are not capability qualification. Full private input hashes,
schemas and receipts are in `.runtime/bl08-reference-nPEIlQ/`.

| Surface | Current evidence | Limitation / next requirement |
| --- | --- | --- |
| Konnect catalogue | Installed 0.11.0: 217 tools; private 0.11.0 build: six additional experimental model tools and one explicit schematic field-position tool | Private binary is separately pinned; no default production exposure. |
| Schematic authoring | Actual MCP creation, three explicit references, seven connected pins, three nets; KiCad 10.0.6 netlist export and ERC: zero findings | Explicit revision-bound MCP positions now fix R1/R2 text overlap; only four property at nodes changed. Native KiCad 10.0.6 reopen now passes with a normal exit and unchanged schematic/board/project hashes; the older-format notice remains and no save was requested. |
| Symbol lookup | Exact pinned library listing and `get_symbol_info` find Device:R | Keyword search advertised by `search_symbols` does not search the description; `resistor` returned zero. Use explicit library identity and verify pins. |
| Annotation response | Real annotation returns plain text, handled with the existing `unpack` function | Initial fixture parser incorrectly assumed JSON; failed receipt retained. |
| PCB creation / observation | Exact isolated native instance; 40 by 30 mm outline, three placed footprints, three connected nets, six saved segments and one via through MCP, native save/reopen and diagnostic export | Connected routing is qualified on a disposable passive reference. The three library-footprint mismatch warnings remain retained for disposition; this is not a carrier or customer board. |
| Saved schematic synchronization | Current schema offers dry-run/revision guarded apply; a current private disposable bridge also previews, applies and inspects seven pad nets with symbol associations | The bridge preserved other captured inputs and native Undo restored the original model lists. A fresh disposable clone was saved and reopened with three nets and `dirty: false`; DRC findings and an intentionally unrouted state are retained. The follow-on Redo failed to restore expected pad nets. It remains approval-free, experimental and not ActionGate-integrated; no production saved synchronization is qualified. |
| Model assignment | Retained live front/back, transform and hidden-model evidence. Native Preview/Apply/Inspect on an owned populated-board copy assigns 80 unlocked footprints including four DNP; five locked parts, 366 connected pads, 738 tracks and 28 zones stay unchanged | Current rebuilt live MCP Preview/Apply/Inspect and independent comparison pass on the connected disposable reference for front/back non-default transforms, opacity and original model restoration through guarded native Undo. Populated fixtures cover hidden/missing models, four DNP parts, library-field rejection and failed-partial unknown outcomes. Missing meshes, customer-board use and ESP32 carrier readiness remain unqualified. |
| Native history / refusal | Retained live undo/save and stale/unsupported rejection. Populated owned-copy batch containing locked footprints rejects unchanged; injected native notification failure returns unknown and consumed-token replay changes nothing | Current rebuilt live editor now passes guarded Undo and unchanged-file shutdown; owned-copy failure does not establish the full live failure matrix or a fresh browser approval journey. |
| Model coverage / provenance | KiCad parser now records DNP, visibility, opacity, resolved files and SHA-256; production renders recheck model inputs after ray tracing. Actual private QA fixture identifies four omitted DNP parts and two partial model sets; production browser verifies these and legacy-format handling | Saved-file coverage evidence plus native DNP assignment/preservation on owned copies; full live DNP/failure/render matrix remains pending. Missing external files stay explicit. |
| DRC | Installed KiCad 10.0.6 reports zero errors, zero unconnected items and three library-mismatch warnings on the saved connected disposable reference; the same result survives native reopen | All three warnings retained. No rule is suppressed; the reference remains a qualification fixture, not a production carrier. |
| Actual populated render | Production RenderStore and saved-file model audit; inspected top and bottom images account for all three STEP models; board and model hashes unchanged | Real unconnected placement fixture, not a working carrier or physical fit proof. |
| Private editor lifecycle | Controlled reopen preserved saved bytes and three model lists; configured editor exited 0 and removed its socket | A UI observation launched an extra unconfigured editor and produced a Python error. Avoid querying a closed app in a way that launches it; use the owned process handle to verify exit. |

Private Konnect source baseline: `a22ad2153dcf45dbcf1cc63b5b0f1e40c93d7956`;
private KiCad source baseline: `0feeca2a807f428ad2b3fa7c1e39625cb769f02c`.
Both retain earlier local patches. Binary/runtime hashes, rather than these base
commits alone, identify this run. The installed CLI is 10.0.6; the native test fork
reports 10.0. Toolchain differences are explicit and tested only to the scope above.

Pinned assets: installed Device and Connector_Generic symbol files, the 0603
resistor and 1x03 2.54 mm vertical header footprints, and their STEP models.
These remain private runtime assets; the existing G-ASSETS inventory/release gate
is not cleared and no library collection or model is added to distributed source.


Populated native model-assignment qualification: see the 2026-09-11 entry in
[evidence/BL-08.md](evidence/BL-08.md) and the private
`.runtime/bl08-populated-model-assignment-evidence/receipt.json`. Both saved source
files retain exact hashes. Restoring models on a comparison copy isolates the
permitted changes; it is not a substitute for native editor undo or saved reopen.

Native model result verification now checks unrelated captured board inputs and
requested model lists after commit; three callback-mutation regressions pass.
See `.runtime/bl08-model-result-invariant-evidence/receipt.json` (106 selected
cases / 1,539 assertions). Unexpected changes remain unknown; this is not proof
of current live undo or rollback. Schematic reopen evidence is in
`.runtime/bl08-schematic-reopen-live/resolved-receipt.json`.

Current rebuilt live model/undo qualification: `.runtime/bl08-model-invariant-live/receipt.json`.
Both editor plugins and all 80 loaded private dependencies are verified; the older
mixed-library run is retained as unqualified. All saved source hashes remain exact.
