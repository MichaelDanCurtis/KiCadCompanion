# Benchline owner input packet

This packet lists the smallest owner decisions and observations still needed to
advance the selected ESP32-S3-EYE v2.2 pilot. It is a request for explicit
inputs, not an authorization to flash, power, purchase, publish, or change
customer files. Leave a field blank when it is unknown; the corresponding
milestone must remain blocked.

## BL-07-A4 — live sourcing (read-only authorized)

- **Resolved:** DigiKey may be used for the proposed read-only lookup and for the
  specific retention/export behavior described in `DIGIKEY_SOURCING.md`.
- **Resolved:** The approved credentials are stored in the host-local private
  file and the exact ESP32-S3-EYE v2.2 read-only lookup succeeded. The redacted
  receipt is `.runtime/bl07-digikey-live-read-2026-09-15.json`; no cart, order,
  or customer BOM upload was performed.

The production application is approved and BL-07-A4 is qualified within the
documented read-only scope. The separate API terms/data-retention clarification
remains open for broader release or redistribution decisions.

## BL-09 — firmware contract

- **Resolved scope decision:** the application must support compatible ESP-IDF releases; no single release is a product requirement.
- For each reproducible pilot build, record the selected ESP-IDF/toolchain and dependency lock used for that build.
- Interfaces to use on this board (for example USB, camera, LCD, microphone,
  accelerometer, or another explicitly selected subset).
- Commands, responses, safe startup defaults, timeout/error semantics, and the
  version of the protocol.
- Reserved pins and a complete carrier pin inventory tied to reviewed sources.
- Input-voltage/current limits and any carrier power budget.
- Decision on the unresolved ESP32-S3-EYE sub-board filename/title revision
  conflict, or an approved source that resolves it.

No firmware build or device action is authorized by filling this packet alone;
the resulting contract still goes through the fail-closed validator.

## BL-10 — mechanical contract

- **Resolved:** FreeCAD 1.1.3 is the supported pilot version for the current host.
- Blender is installed for optional asset preparation; its use, versioned asset inputs and reuse rights remain separate owner decisions.
- Complete assembled envelope for the main board and sub board, in millimetres.
- Origin and orientation, mount-hole coordinates, connector openings, LCD and
  camera protrusions, antenna and thermal clearances, and cable/fastener access.
- Material, print orientation, wall thickness, and tolerance profile.
- Approved STEP/mesh/component sources and their reuse rights.

A 30 x 60 mm main-board outline alone is insufficient for this contract.

## BL-11 — application and protocol brief

- Whether the pilot needs a product application at all.
- The approved reference interaction and expected visible state changes.
- Transport, protocol version, command/response schema, rejected-command and
  disconnect behavior, and timeout budget.
- Simulator boundary and the firmware/client ownership of the shared schema.

If no application is needed, record that decision as a BL-12 scope amendment;
Benchline will not invent a dashboard from the board name.

## BL-12 — frozen integration scenario

After BL-09 through BL-11 are approved, provide:

- Baseline artifact revisions and hashes.
- The exact connector/module revision change.
- Numeric electrical and mechanical thresholds.
- Current firmware, FreeCAD, frontend/simulator, KiCad, and package artifact
  references.
- Restart checkpoint, manual-editor-change checkpoint, recovery procedure, and
  acceptance checks.
- Explicit statement that physical validation remains pending until BL-13.

## BL-13 — physical acceptance record

For one owner-controlled unit, provide the written protocol before any action:

- Board marking/serial or other exact unit identity.
- Explicit authorization for flashing and powering, including stop conditions.
- Supply type, voltage/current limits, and required instruments.
- Operator identity and timestamped logs/photos.
- Firmware/software revisions under test.
- Measured values with expected tolerances.
- Printed enclosure/assembly fit, connector access, and functional observations.
- Failures, redesign actions, and retest results.

Simulated or inferred values cannot fill these fields.

## BL-14 — owner review

The package rehearsal, privacy scan, install, uninstall, and rollback isolation
receipts already exist. Final candidate review still needs:

- Accepted BL-12 and BL-13 evidence revisions.
- Owner decisions for the twelve release gates and any license/privacy
  unknowns.
- Confirmation of supported macOS/Node/KiCad/FreeCAD/tool versions and the
  native portability decision.
- Review of the private candidate archive, hash manifest, SBOM/notices,
  installation guide, rollback guide, and support claims.

Publication remains blocked by design. The candidate validator must pass only
with these real inputs and current evidence.

## Current evidence links

- [BL-07 evidence](evidence/BL-07.md)
- [BL-09 evidence](evidence/BL-09.md)
- [BL-10 evidence](evidence/BL-10.md)
- [BL-11 evidence](evidence/BL-11.md)
- [BL-12 evidence](evidence/BL-12.md)
- [BL-13 evidence](evidence/BL-13.md)
- [BL-14 evidence](evidence/BL-14.md)
