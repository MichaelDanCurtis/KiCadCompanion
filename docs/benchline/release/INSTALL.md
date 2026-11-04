# Benchline private preview installation

This guide is a procedure for an owner-approved private macOS preview. It is
not an installation receipt and does not authorize provider sign-in, customer
workspace access, hardware actions, publication, or external upload.

## Before starting

- Use a fresh, disposable macOS user or an empty owner-controlled directory.
- Confirm Node.js 22 or newer. FreeCAD 1.1.3 is the owner-confirmed supported pilot version. Blender 5.2.1 LTS is installed for optional asset preparation; no Blender asset pipeline is required by the current package. KiCad 10 is required only for electronics review;
  the native shell additionally needs the Swift/Xcode command-line tools.
- Keep the provider disconnected until the exact account, model and data-use
  decisions are recorded. Do not copy credentials or remembered permissions.
- Use a synthetic sample project. Do not point the first run at a customer
  board, private history, or an inherited state directory.
- The native wrapper uses bundle-relative launcher metadata; host-specific Node,
  KiCad, FreeCAD and Konnect paths are resolved locally at runtime and are not
  supplied by the archive.

## Procedure

1. Extract the archive into the disposable directory and record its SHA-256.
2. Run `npm ci --ignore-scripts --no-audit --no-fund` only after reviewing the
   included `npm-shrinkwrap.json` and dependency notices supplied with the
   candidate.
3. Run `npm run build` and retain the output with the candidate revision.
4. Start the neutral preview with `npm run launch -- --server-only`; verify the
   returned `/api/state` identifies the expected checkout and empty workspace.
5. Open the local URL, create a synthetic product project, and exercise the
   approved software journey. Record tool discovery and all observed errors.
6. Stop only the matching preview process, then verify the disposable project
   files remain intact. No customer files may be removed by cleanup.

The procedure is complete only when the observations are recorded in the
candidate manifest and the owner has reviewed the privacy, license and support
claims. A successful build alone is not an installation result.
