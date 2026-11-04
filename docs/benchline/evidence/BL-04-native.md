# BL-04 disposable native experiment

**2026-09-06 audit amendment:** the observations below remain historical evidence of
change/restore and an edit completed before preflight. They are NOT atomic concurrency
conformance. Source review found the expected revision is compared in Konnect before
the subsequent KiCad UpdateItems request, which lacks that precondition. See
[the source analysis](../ACTION_BOUNDARY.md#unfinished-conformance). The ignored
gated-refresh.mjs helper now declares atomicRevisionCheck=false and is refused by
ActionGate before mutation. It was not rerun after retirement. No CAD files were
changed by the audit. Native mutation enablement requires a native-boundary fix and
new evidence; neither old successful receipts nor one undo group meets that gate.

Observed 2026-09-06T03:10Z (2026-09-05 local). User explicitly approved creation/opening of the separate disposable project and reversible test. This is limited conformance evidence, not milestone completion or general native-write enablement.

## Isolation and method

Fixture retained under `.runtime/bl04-native-Gtltml/`: project `benchline-native-test`, one `TP1` footprint, a 30 × 20 mm outline, and project-local `BenchlineTest.pretty`. These are synthetic test artifacts, not a product circuit. All native creation, graphics edits, placements, refreshes and saves used discovered Konnect MCP tools. The Konnect/PCB/library skills required exact-document checks, library search before creation, dry-run review and post-write observations; no raw KiCad file edits were used.

The customer PCB editor remained open. Initial `open_project(path=fixture)` on the default socket reported requested_open=false and listed only the customer board. No mutation was sent through that connection. The separately opened fixture editor exposed `/tmp/kicad/api-20801.sock`. A test-only `konnect-test.toml` and MCP `--config` connection selected that socket; open_project then confirmed exactly the fixture. The global fixed ipc_address took precedence over the attempted environment-only override and was left unchanged. Future production connections need explicit editor binding, not assumptions about the foreground window or environment.

The local `call.mjs` helper discovers tools and invokes MCP; `gated-refresh.mjs` imports the actual ActionGate but registers only an isolated test adapter. It is not imported by the production server or run by npm test. It requires the exact reviewed native revision, exact test path/socket/reference, expected library geometry and graphics-only plan. It checks the document again on every observation and dispatch, supplies expected_plan_revision to native apply, then reads component/pad/graphic observations and a fresh dry run independently of the apply response.

The test uses fixed synthetic project/document identities rather than the production ProjectStore or HTTP routes. Its once decisions exercise the user's explicit test authorization in a script; they are not a browser click-through, model-supplied permission or enabled provider test. Test-only adapter support is not production conformance.

## Observed sequence

1. Created the blank project with create_project, launched its manager and opened its PCB editor. Added outline and synthetic library/footprint using MCP. Registered only a project-local library.
2. Initial dry run found attributes/metadata changes from placement; reviewed revision `2b3ddda4c36a70185ff2947e6dcb43526e4312deaf951f766a9a1dd80742f1e2` applied once to normalize the fixture. Saved the baseline.
3. Changed the library F.Fab polygon's right edge from 1 to 1.5 mm. Dry run returned ready, graphics-only revision `2ac2c123accddb01b9f954cf4382e3e73c8a7a8de15fbe3b36047e383e5ea7a6`.
4. Simulated an intervening manual edit through a separate MCP move: TP1 from (110,110) to (111,110). Apply with the old revision returned conflict / stale_plan_revision, **0 applied**. Live F.Fab observation still had right edge 1 mm. This proves an intervening live-edit check, not a simultaneous human-edit race test.
5. Reviewed the new dry run. ActionGate prepared, accepted once, dispatched, independently verified and persisted the successful update. Repeating execute returned the record without a second native dispatch.
6. Restored the library F.Fab polygon to its original points. Reviewed a new dry run and ran a separate once action through ActionGate. Live geometry returned to the original points; no-op dry run followed. Again, replay did not dispatch and no recurring grant existed.
7. Restored TP1 position to (110,110) through MCP and saved. Final component observation confirms position, rotation 0, front side and original value. DRC on the saved fixture: 0 errors, 2 warnings (silk_overlap and silk_over_copper from the generated reference field). No attempt was made to present the fixture as manufacturable.

| Gated native action | Reviewed revision | Action ID | Result |
| --- | --- | --- | --- |
| Set F.Fab right edge to 1.5 mm | c664155fb0666d5eedcfccd8aa47eec8123a7e27af25d44ac5fadec103b55e9e | 2463c5c7-e074-4dd1-9008-aa8d771261ee | verified; applied 1; subsequent dry run noop |
| Restore F.Fab right edge to 1 mm | 290b26b1a9105e91248dbbddaea726cbe2c492bb38154e1f66cefe939d3eeed0 | ad23200c-49c8-49d9-9e5c-ff86841b4ca9 | verified; applied 1; subsequent dry run noop |

Both action receipts retain before/after component and pad observations, live graphics and follow-up plan in `.runtime/bl04-native-Gtltml/native-actions.json`. The component's reference/value/library/side/rotation/position and its single unconnected pad's number/layers/position/net matched before and after each refresh. Verification did not independently inspect every KiCad field or full board object identity. Native receipt preservation flags are recorded claims, not substitutes for those missing checks.

Retained evidence SHA-256: native-actions.json `596230a11d1a587ce8a6f45de56145559da78b03284016a3daafd4ce850fb813`; gated-refresh.mjs `792d604c637b7ee7c421de41da261afd19251056bbecd5bb9cbf87ae7623cd38`; final-drc.json `26115dbb0db52263265b0e89e9e3b40030237b4ff78079c5f38fe823a90113b3`. The disposable editor was left open with its saved, non-asterisk title for inspection. No test artifacts were deleted.

The restore is a compensating update, **not native Undo** or byte-for-byte restoration; refreshed graphic UUIDs change. Konnect reports a single undo commit, but this test did not invoke Undo. No available discovered MCP undo operation was used, and the skill's MCP-only write boundary was preserved.

Customer saved-board SHA-256 before and after: `83ca5dea34f3f1af7110e12e09500e51c759d325ac97578d951f19736c72c47e`. No customer write/save/selection command was sent. The default socket still listed that customer document after testing. A saved hash is not an exhaustive observation of unsaved live state.

## Remaining verification

- Production project resolution, explicit socket/document binding, approval UI and constrained provider mediation together.
- Connected-pad nets, instance UUIDs/overrides/fields/models, multi-component preservation and unrelated board geometry.
- Simultaneous human edits, native disconnect or process loss during dispatch, cancellation, and reviewed resolution of unknown outcomes.
- Native Undo/recovery inspection where supported, with no blind retry or hidden reset of the uncertain-action block.

All 83 software tests passed again. Production native refresh remains unsupported, and Agent/Discuss/AI studio remain paused. This experiment removes the lack of disposable-test evidence; it does not remove the remaining BL-04 requirements.
