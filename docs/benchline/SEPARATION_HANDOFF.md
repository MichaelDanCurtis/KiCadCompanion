# Benchline / customer-project separation handoff

## Ownership

Benchline is the reusable product and owns this checkout, roadmap, orchestration, adapters, approval boundaries, and UI. Each customer project owns its hardware, firmware, application architecture, and customer acceptance. Do not continue Benchline development in the retired customer-side companion directory. Keep customer examples explicitly selected and scoped; never adopt the previous task's working directory as a product default.

The source folder remains named `KiCadCompanion` because installed launchers and qualified runtime paths reference it. The saved Codex project is named **Benchline**. This separation does not require renaming or committing the heavily modified checkout.

## Approved operational cutover — 2026-09-10 UTC

- The old prototype service was checked idle and stopped. Old native/plugin launchers were parked recoverably, with history, permissions, renders and source retained. Its README records recovery locations and the deliberate rollback opt-in.
- Standalone native bundle and KiCad action were rebuilt/installed with no workspace selection and automatic connections disabled. Native build success is not a claim that its window was visually exercised. KiCad plugin rediscovery awaits the user's normal restart.
- `npm run launch` now clears inherited Benchline/Companion settings and starts the neutral product on port 4318. `npm run launch:project` retains explicit environment-based launches. Both use the existing exact server-identity checks; neither silently takes over a foreign/customer service.
- Live `/api/state` showed `projectSelected=false`, no board, disconnected agent, and empty messages, requests, permissions, renders and product list in the neutral namespace. Browser inspection showed the empty “What are we building?” wizard. No sign-in or model turn was started.
- Existing customer-bound Benchline state was retained separately, not reset or copied. Saved customer PCB/project and legacy session/permission hashes matched the pre-cutover baseline.

## Roadmap truth and next work

BL-01 through BL-04 are verified only against their bounded contracts and evidence. Subsequent roadmap work verified BL-06 durable plan execution. BL-05 adaptable workspace is verified after final 200% zoom capture and shared-style inspection. BL-07 offline module/BOM and source-observation work is implemented; exact module selection and real source qualification remain pending. These increments are separately evidenced, not completed by the original separation. The end-to-end PCB/firmware/enclosure product pipeline, release qualification, and physical acceptance remain unfinished. Read `status.json`, `GOALS.md`, and each chosen goal contract before implementation. Runtime qualification is opt-in and separate from the neutral preview.

Preserve all existing uncommitted work. A new task must use the current checkout only with the user's explicit local-checkout choice, or first prepare a reviewed transfer to a worktree. Do not assume a fresh default-branch worktree contains the implementation.

The prior task's roadmap Goal does not automatically migrate with the saved project. Do not start duplicate autonomous writers: stop/pause the prior Goal using the app's controls before starting the replacement Goal. First confirm the handoff read-only, then continue only under the new task's authorization. Customer modifications, publishing, purchases, credential migration and hardware actions remain separate authority boundaries.

## Verification commands

```sh
npm test
npm run build
npm run review:check
npm run licenses:check
npm run launch -- --server-only
```

Neutral-launch tests exercise inherited-setting removal and existing-server reuse/refusal. The legacy suite separately verifies fail-closed retirement and explicit rollback. These checks do not imply a public release or completed roadmap.

Cutover checks: 262/262 Benchline tests, 26/26 legacy tests, Vite build, and license inventory passed. The inventory retains 12 open release gates. `npm run launch -- --server-only` reused the verified neutral service successfully. No CAD writes or model execution were used for these checks.
