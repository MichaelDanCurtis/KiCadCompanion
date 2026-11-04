# Standalone preview and reversible migration

The current source folder may still be named KiCadCompanion; the product, native bundle, and new plugin identity are Benchline. Renaming the folder is not required. The migration planner itself never retires or modifies an installed prototype. The separately approved local cutover is recorded in [SEPARATION_HANDOFF.md](SEPARATION_HANDOFF.md).

## Configuration-only migration

Run from this standalone checkout:

```sh
npm run migration:plan -- --from-root '/path/to/prototype/app' --from-state '/path/to/prototype/state' --workspace '/path/to/customer/project'
```

This command only reports to stdout. It lists exact roots, launchers, proposed port/state, excluded state categories, and rollback steps. It does not read private state contents or design files. There is no `--apply` mode. Keep its machine-specific output out of source control.

Inspect the proposed environment, then launch a separate preview with an unused port. Prototype state remains in place: chats, permissions, renders, credentials, and Python environments are not copied. Create the standalone observer environment separately when needed.

```sh
export BENCHLINE_WORKSPACE='/path/to/customer/project'
export BENCHLINE_PORT=4318
export BENCHLINE_AUTOCONNECT=0
npm run build
npm run build:native
npm run launch:project
```

No board is automatically selected on first launch. Select the intended board explicitly. Automatic connection is disabled in this example; live verification needs its own approved procedure. Configuration is read from environment, not an automatically loaded `.env` file.

## Native and plugin identity

- The generated native bundle is `.runtime/Benchline.app`, identifier `local.benchline.preview`.
- Double-clicking a fresh bundle runs the captured checkout's launcher and checks instance ownership before loading its URL. `npm run launch` supplies its checked URL directly.
- The optional KiCad 10/macOS action installs in `local_benchline_preview`, distinct from the old companion action. Installation is not part of the default migration report and is not performed silently.
- Both capture selected configuration; no API tokens or entire environment dumps are embedded. A changed/moved checkout or configuration requires rebuilding the wrapper or deliberately replacing the separate preview plugin after inspection.

## Rollback and cutover gate

For another installation, cutover still requires explicit approval. This local installation completed its approved operational cutover on 2026-09-10 UTC: old launchers were parked, the prototype stopped, and Benchline started without a customer selection. A dry-run report does not prove either process is running: inspect listeners and `/api/state` before acting.

To roll back a separate preview: wait for its work to be idle, verify its `product`, `instanceRoot`, `workspace`, and `runtime`, then stop only that matching Benchline process. For the retired local prototype, also follow its README: parked launchers must be deliberately restored and its entry points require the process-scoped `COMPANION_ENABLE_RETIRED_PROTOTYPE=1` opt-in. No state copy-back is needed. Preserve both runtimes for inspection; do not recursively delete either project's runtime.

Do not retire the old app until the live read-only smoke passes and the user approves the exact cutover. This foundation does not provide durable crash recovery or concurrent multi-process writes to one project state directory; those are later goals. Use one backend per project state directory.
