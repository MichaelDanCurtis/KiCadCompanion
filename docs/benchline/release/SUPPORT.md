# Private preview support boundary

The intended first target is a local macOS preview on the tested host with
Node.js 22 or newer. KiCad 10, its separately installed Python/IPC tooling and
the optional Swift shell are versioned prerequisites when those disciplines are
used. Exact supported versions and provider assumptions remain owner review
items until a fresh candidate run records them.

The native wrapper's launcher metadata is bundle-relative and was verified in a
fresh extracted build without a source-checkout path. This does not make host
tools portable: Node, KiCad, FreeCAD, Konnect and their configuration still
must be installed and approved for the supported preview environment.

Windows and Linux are unsupported for this preview because they have not been
qualified. Firmware builds, the approved FreeCAD enclosure contract, device simulators, physical
hardware acceptance, provider sign-in and live DigiKey sourcing are separate gates.
FreeCAD 1.1.3 is owner-confirmed for the pilot host, and only its synthetic native mechanics path is qualified. Blender 5.2.1 LTS is installed for optional asset preparation; Blender-based asset reuse is not qualified.
