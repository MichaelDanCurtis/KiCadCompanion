# Local Codex execution-boundary candidate

`codex-execution-allowlist.patch` targets OpenAI Codex `rust-v0.153.4`, commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. It is a local, experimental derivative
of the Apache-2.0 source, not an accepted upstream feature or a production release.
Upstream [LICENSE](../../../tests/fixtures/code-mode-protocol/LICENSE) and
[NOTICE](../../../tests/fixtures/code-mode-protocol/NOTICE) are retained in this
checkout. No account-service or distribution rights are inferred from the source license.

Benchline modifications, 2026-09-09:

- Exact `features.tool_registry.execution_allowlist` namespace/name map.
- Omitted policy preserves upstream behavior; an empty map denies every tool.
- Prune registration before Code Mode definitions, after search registration,
  and after adding Code Mode control tools. Disable provider-hosted tools when
  a local execution restriction is selected.
- Check the same allowlist at the central dispatcher before hooks and handlers,
  for both direct calls and Code Mode callbacks.
- Configuration/schema, predicate, retained-handler and model-protocol tests.

This is an execution boundary, not an approval system or an app-server RPC
firewall. Benchline must still own configuration, restrict RPCs, pin the binaries
and host, bind each action to its product/document/revision, and verify outcomes.
The runtime is not activated by merely applying this patch. Qualification and
limitations are tracked in [BL-04 evidence](../evidence/BL-04.md).

The release tag's Cargo.lock uses `0.0.0` for 149 workspace crates, while its
Cargo.toml specifies `0.153.4`. The initial Cargo build mechanically normalized
those workspace versions without changing external dependency versions. That
normalization is not included in this focused patch. `just bazel-lock-update`
completed without a MODULE.bazel.lock change. Keep this distinction when
reproducing the build; do not attribute version normalization to new dependencies.

Build/test commands are evidence, not distribution instructions. No PR, release,
deployment, account migration or customer CAD operation is authorized by this file.

## Private native observation deltas

`editor-observation-kicad.patch` and `editor-observation-konnect.patch` add only the diagnostic unsaved-state observation described in [EDITOR_OBSERVATION.md](../EDITOR_OBSERVATION.md). They target the previous private candidate files, not stock upstream revisions. Their before/after source pins are retained with BL-05 evidence. The KiCad modified file declares GPL-3.0-or-later; the Konnect checkout declares AGPL-3.0-only. Upstream copyright/license material remains in those private source checkouts. Neither patch is relicensed, approved for external distribution, or a replacement for retaining/reviewing the full derivative source and notices. Catalog entries retain the existing open G-KICAD and G-KONNECT gates.
