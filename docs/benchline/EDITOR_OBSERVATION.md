# Selected-file opening and native observation

Benchline can request opening a registered, saved PCB artifact in the configured macOS PCB Editor. The controlling window supplies the selected artifact ID and current manifest, local epoch and saved-file hash. The server resolves the project-relative file, rejects missing/stale/unsupported files and arbitrary path arguments, rechecks controller admission before launching, and deduplicates request IDs. It reports **opening requested**, not a verified live connection. Opening never saves, edits a design, starts a provider, or grants action permission. Other platforms/disciplines remain explicitly unsupported by this opening adapter.

`BENCHLINE_EDITOR_OBSERVATION` optionally points to a private host configuration for the qualified disposable native build. It is not project/export data. Version 1 pins the exact board, local IPC address, native instance, Konnect binary, Konnect configuration and native runtime hashes. Current qualification is restricted to the `benchline-native-live` disposable fixture family. Missing configuration, old diagnostics without a boolean dirty flag, changed host pins, different document/instance, busy/disconnected native state and shutdown all return unavailable; no default editor or file fallback is adopted.

The observer discovers the experimental toolset and permits only open-document inspection, native context and read-only diagnostic capture. It returns a revision, the editor's own unsaved flag and an observation timestamp to the project store. It does not publish native serialized content or tool authority. The UI ages observations into stale after ten seconds; manual selection, shared review and the composer display the same document context. Each engineering action still obtains its own fresh revision and scoped approval through BL-04.

## Private native change and provenance

The extra flag is read from `PCB_EDIT_FRAME::IsContentModified()` on the native main thread in the existing diagnostic handler. It is attached after computing the conditional model revision. Konnect removes it from the diagnostic revision inputs and exposes it as top-level `dirty`; an older host yields unknown. No mutation, save, history or revision-guard behavior was changed.

Incremental source patches are retained as [KiCad observation patch](patches/editor-observation-kicad.patch) and [Konnect observation patch](patches/editor-observation-konnect.patch). They apply to the prior private candidate, not a stock upstream tree. Existing KiCad GPL and Konnect AGPL obligations remain applicable; these patches do not elect a new license or authorize distribution. The private source/archive and all release gates remain required by BL-02/BL-14.

| Source | Baseline SHA-256 | Observation candidate SHA-256 |
| --- | --- | --- |
| KiCad `pcbnew/api/api_handler_pcb.cpp` | `fbd1763f72f0dd0923740db7f4df089a9351841df0229fa580f7c3cbf57d3678` | `43fef70600c6624653fc553b1a720122e42c40957f0d1ee5832efab973a90444` |
| Konnect `crates/konnect-core/src/tools/experimental_models.rs` | `4f7b505b05a049c65e76bead0401b4f6905000bf21c69be9fef5d963e5e95ada` | `269f21efc3ce6df3cc3837f003d0f09507c0d6b77ccd0e8edab3855e928e07b9` |

The original binaries and source files remain in ignored `.runtime/bl05-native-baseline/`. Previous model-registration files retain their original pins and cannot silently authorize the rebuilt binaries. Only the separate read-only observation configuration was used for the BL-05 browser journey. See [BL-05 evidence](evidence/BL-05.md) for actual native and browser receipts and remaining acceptance scope.
