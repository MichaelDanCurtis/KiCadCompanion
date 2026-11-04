# Product-first intake verification

Date: 2026-09-05. Scope: local intake and plan review, not autonomous engineering execution.

## Automated checks

- `npm test`: 42 passing tests, including draft recovery, plan snapshots, stale-revision rejection, failed-write preservation, corrupt-state refusal, approval invalidation, workspace isolation, all 16 discipline combinations, and explicit undecided responses.
- The offline HTTP startup test creates, approves and revises a product without a PCB or installed agent runtime. It verifies plan-only scope, cross-origin rejection, stale HTTP 409, missing-record HTTP 404, and unchanged agent/board/messages/permissions state.
- `npm run build`: production bundle builds successfully.
- `npm run review:check -- --worktree`: scans the current tracked and unignored source for forbidden artifacts, personal paths and obvious credential patterns. This is not a complete security or license audit.

## Browser observations

Verified through a real browser against an isolated temporary workspace, separate from the user's design runtime:

- The first-run view asks “What are we building?” and offers the four work areas.
- Selecting electronics, firmware and enclosure surfaces power, connection and physical-fit questions.
- Save and continue records revisions. Plan-only approval opens the command center with seven proposed tasks, open decisions and no executed work.
- Reloading returns to the approved product and its saved plan.
- Editing and saving a requirement creates the next revision, retains history and displays the invalidated-approval warning.
- Product and Electronics tab switches preserve both a brief edit and an unsent board-chat draft. No chat was submitted.
- No browser-console errors were returned during the walkthrough.
- The opening screen was visually inspected at desktop width. Narrow-screen CSS is implemented; mobile-device testing is not claimed.

The local standalone preview was restarted only after verifying its identity and idle agent/request state. No sample products were added to the user's runtime. The original companion service and native windows were not reloaded or stopped. No CAD writes or live selection changes were performed for this slice.

## Not established by this evidence

AI research, conversational clarification, semantic requirements validation, real task dispatch, CAD artifact association, FreeCAD control, firmware/app integration, live task progress, multi-process persistence, licensing clearance and hardware validation remain future work. This evidence does not mark BL-03, BL-05 or BL-06 complete.
