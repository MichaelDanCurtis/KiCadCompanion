# Third-party and provenance review

This extraction contains companion application source, not a copy of Konnect's Rust source, executable, KiCad libraries or Codex binaries. It connects to separately installed products. This boundary is an architectural description, not a legal opinion on licensing.

Runtime/development dependencies and exact resolutions are in `package.json` and `package-lock.json`. Their notices and licenses must be reviewed and preserved when distributing dependencies. The UI uses React, React DOM, React Markdown, Lucide, A2UI, Express, Zod, the MCP SDK and Vite. The optional native shell uses system Cocoa/WebKit. The observer uses separately installed kicad-python; the read-only model auditor uses the KiCad-provided `pcbnew` bindings.

Reference material used while developing the integration includes the official KiCad CLI documentation and KiCad source describing renderer presets, plus official Codex App Server/image-generation documentation. An owner-reviewed source/dependency provenance audit remains a publication gate.

Konnect's contribution agreement and community/commercial licensing terms are documented upstream. No license to companion source, acceptance of that agreement, or permission to redistribute third-party products is granted by this local draft.
