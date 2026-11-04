# Publication review — owner decisions required

This is a local review repository. No remote, public repository, issue or PR is created by the preparation scripts. `private: true` and `UNLICENSED` are intentional staging settings, not a final license selection.

## Before any publication

- [ ] Resolve the named gates in `docs/benchline/licenses/catalog.json`, reconcile actual release artifacts and run `npm run licenses:release-check`; an inventory pass alone is not permission to publish.
- [ ] Choose repository owner, name and visibility; review the exact tracked tree and first commit.
- [ ] Choose a license after checking code provenance and dependency obligations. Do not assume communicating over MCP settles licensing questions.
- [ ] Explicitly review Konnect's contributor agreement before any code contribution; no agreement was accepted during this preparation.
- [ ] Recheck the upstream roadmap, open issues, contribution and governance rules.
- [ ] Approve the proposal text; decide whether to post an issue or discussion.
- [ ] Approve a non-private demo board and any screenshots/recording. No current board or generated image is included in this repository.
- [ ] Run the tracked-file privacy check, inspect dependency notices, and manually inspect the staged diff and archive. Automated scans are a supplement, not proof that no secret exists.
- [ ] Confirm package/native identifiers and naming. Preview identifiers are deliberately separate from the working local plugin.

## Engineering before calling this release-ready

- [ ] Replace legacy model inspection with a KiCad-forward interface; verify real assigned models, missing files, aliases and DNP behavior.
- [ ] Validate a supported Codex version range and failure/approval/disconnect/restart behavior.
- [ ] Implement an enforced read-only mode if advertising one; current Discuss-only is not one.
- [ ] Test install discovery, plugin launch environment and cleanup on fresh machines.
- [ ] Test Windows/Linux before claiming support; macOS signing is currently ad hoc only.
- [ ] Exercise the full extracted app with an approved public KiCad sample. Earlier prototype checks do not certify the refactored package.
- [ ] Decide whether to self-host fonts and tighten local service protections.

## Suggested initial demonstration (not recorded yet)

On an approved sample: launch beside KiCad, select a part in each view, request an A2UI connectivity graph, demonstrate Allow once/Decline/revoke, save and render the board, then optionally generate an illustrative studio image. Show the saved/live distinction, model-coverage warnings and source provenance. Hide personal paths, account details and all unrelated applications. Record 60–90 seconds only after approving the sample and cloud transfer.
