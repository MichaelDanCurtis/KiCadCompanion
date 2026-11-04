# Product-first intake slice

User-directed scope amendment · 2026-09-05

Benchline owns the product-development journey. Its opening question is **What are we building?** Specialist tools are workspaces beneath the product brief and plan, not the starting point.

This local vertical slice follows the standalone foundation. It introduces limited portions of BL-03, BL-05 and the planning side of BL-06; it does not complete those contracts, bypass their execution prerequisites, or activate another persistent Goal. The commercial license decision remains pending. No dependencies were added.

## Implemented journey

1. Describe the product, its intended users, and the relevant disciplines.
2. Answer conditional questions about power, connections, physical fit, environment, cost and constraints. Blank optional fields and simple markers such as TBD or unknown become open decisions. This is not semantic validation of filled answers.
3. Review a deterministic proposed sequence with dependencies, intended outputs and human review checkpoints.
4. Save the exact brief and plan revision, then approve the sequence only.
5. Enter the product command center: next step, unresolved decisions, proposed work and specialist-tool entry points.

The product page is the default landing. The Electronics tab retains the original board workbench. Switching tabs keeps both views mounted to preserve unsaved inputs. The guide pane has an adjustable width, and the layout stacks on narrow screens.

## Persistence and approval contract

- Product briefs live in `product-briefs.json` inside the selected runtime's isolated state directory. This is not a portable multi-artifact project manifest.
- Draft saves and plan approval await atomic replacement of the state file. A failed write does not replace committed in-memory state. Corrupt state fails startup rather than being silently reset.
- Mutations are serialized within one server process and require the expected revision. Stale updates receive HTTP 409, leaving inputs in the browser. Multi-process writers are not supported.
- Each brief revision retains a plan snapshot. Changed requirements preserve the previous brief and plan, invalidate approval, and require a new review. No downstream CAD or code files are regenerated.
- There are at most 100 briefs per runtime and 100 historical revisions per brief. Export, archive, branching, recovery UI and general migrations are deferred.
- Approval is explicitly `plan-only`. These routes have no tool-dispatch path, do not connect an agent, and do not grant remembered permissions. Open decisions may remain after sequence approval.
- Drafts are saved using Save draft or Save & continue. Unsaved edits have a browser leave warning, not automatic persistence. Cross-window edits are conflict-checked on save; there is no live cross-window synchronization yet.

## Honest capability labels

The guide and planner use local rules. They do not perform AI research, validate feasibility, choose components or generate adaptive conversational follow-ups. All tasks remain not started; progress is not fabricated.

The existing electronics workspace is available independently. A newly saved product brief is **not automatically linked to the currently open board**. FreeCAD, firmware and application execution adapters are planned, not wired into this flow. Existing board-agent permissions remain separate and retain the limitations documented in the README.

## Next implementation boundary

BL-03 now supplies a separate [versioned product model](PROJECT_MODEL.md), explicit saved-brief snapshots and native-file references with dependency impact. The original brief remains authoritative for its own plan; snapshot creation does not silently link the currently open board. Next implement revision-bound action authorization before connecting the plan to real execution. Durable task attempts, evidence, cancellation and restart reconciliation belong to BL-06. Adaptive AI questioning belongs above the same persistent brief model; it must not replace that model with conversation-only state.

See [intake verification evidence](evidence/PRODUCT-INTAKE.md) and [BL-03 evidence](evidence/BL-03.md). Each milestone has a separate acceptance record.
