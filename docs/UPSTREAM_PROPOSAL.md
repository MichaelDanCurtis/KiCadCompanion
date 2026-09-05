# Draft issue: Optional rich companion UI for Konnect

**Status: local draft for owner review; not submitted.** Suggested destination: a design issue in [mixelpixx/Konnect](https://github.com/mixelpixx/Konnect/issues). No endorsement, ownership transfer or maintenance commitment is assumed.

## Problem

Using a separate AI client to operate KiCad can make it difficult to follow what the agent is doing and how its reasoning relates to the open board. Users need shared selection, explicit freshness, understandable approvals, visible activity, and room for diagrams and evidence alongside the editor.

## Working prototype

We have built a separate companion window with live PCB context, shared component selection, streamed Codex activity, per-board approvals, A2UI charts/tables/graphs, saved-board checks and local 3D renders. An optional studio mode uses the actual render as an image-generation reference and labels its output illustrative. It does not replace engineering checks.

The prototype has been exercised locally on macOS with KiCad 10 and Konnect. It is not a cross-platform release. Source cleanup is being prepared independently; private boards, conversations, credentials and generated assets are excluded. Public demo media will be prepared only from an approved sample.

## Proposed boundary

Keep the companion as a separately packaged client initially. Konnect continues to own its MCP tools and KiCad design operations. The UI, agent-provider adapter, local approvals and A2UI presentation remain outside the Rust core. Codex is the first implemented provider, not a proposed mandatory Konnect dependency. Other providers are future adapter work, not existing support.

Potential focused follow-ups, each subject to discovery of current upstream capabilities and design agreement:

1. A structured, read-only model-coverage API, reporting missing, hidden and unresolved model references. This would replace the prototype's legacy Python audit.
2. Saved-board render options for camera, image-only finish and quality, with source provenance and explicit failure/staleness reporting.
3. Shared-context/lifecycle contracts for board identity, selection, freshness and observable tool progress, avoiding duplicate clients where appropriate.

These are candidate scopes, not promised API names or claims that upstream lacks every capability. We would agree one reviewable change at a time, based on current main, with real KiCad fixtures and explicit compatibility tests.

## Limitations we will not hide

The current overview is simplified; it does not reproduce the exact KiCad viewport. Native packaging is macOS-only. Model coverage still relies on legacy `pcbnew` bindings. Discuss-only mode is prompt-level, not enforced isolation. Private source and image transfer to an AI service requires clear user consent. Public-release work includes dependency/provenance review, install discovery, provider isolation, approval-boundary tests and cross-platform validation.

## Questions for maintainers

- Is a separate optional companion client a useful direction for the ecosystem?
- Would you prefer independent ownership, an integration example, or eventual official packaging?
- Which of the backend candidate scopes belongs upstream, and which should remain client-side?
- Is there an existing effort we should coordinate with before preparing any code PR?

We are requesting design feedback, not a commitment to adopt or maintain the app.

## Review notes (remove before submitting)

Confirm title, ownership, demo board and public hosting choice first. Licensing is undecided: do not attach code or submit a PR until the owner has reviewed contribution terms. The [contribution guide](https://github.com/mixelpixx/Konnect/blob/main/CONTRIBUTING.md) requests design discussion before non-trivial code contributions and describes a relicensing grant. [Governance](https://github.com/mixelpixx/Konnect/blob/main/GOVERNANCE.md) assigns scope/licensing decisions to the project owner. Recheck both at submission time.
