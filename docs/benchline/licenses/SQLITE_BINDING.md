# SQLite workflow binding inventory

Reviewed 2026-09-10 for BL-06 local implementation; no licensing election or distribution clearance.

The workflow store uses `node:sqlite` from the existing external Node runtime. Observed Node 22.23.0 reports SQLite 3.51.3. No npm binding, extra service, or native addon was added. The engine minimum is now 22.13 because this built-in API no longer requires an experimental flag at that version. It remains experimental in the observed runtime. The exact runtime must be qualified again for packaging; this does not claim all supported Node releases have been tested.

Primary sources inspected:

- [Node 22.23.0 SQLite API source](https://github.com/nodejs/node/blob/v22.23.0/doc/api/sqlite.md): introduction, flag history and DatabaseSync API.
- [Node 22.23.0 license](https://github.com/nodejs/node/blob/v22.23.0/LICENSE): MIT core declaration and the runtime's additional component notices.
- [SQLite header in that Node tag](https://github.com/nodejs/node/blob/v22.23.0/deps/sqlite/sqlite3.h): upstream copyright disclaimer and version declaration.
- [SQLite copyright declaration](https://sqlite.org/copyright.html): deliverable code/documentation public-domain dedication; upstream distinguishes some build tooling.

The metadata review changed only the root Node engine in package.json and package-lock.json. The dependency closure and versions are unchanged. The lockfile hash was explicitly reviewed and updated in policy.json for that change; regeneration is not approval. Private receipts in `.runtime/bl06-runtime-review.json` record both lock hashes and the unchanged dependency closure hash. Downloaded primary source copies are `.runtime/bl06-node-sqlite-api.md`, `.runtime/bl06-node-license.txt`, and `.runtime/bl06-sqlite3.h`.

Existing G-NATIVE remains open for exact packaged Node builds, all embedded libraries, target binaries and notices. The binding inventory does not resolve the other eleven release gates. No runtime or SQLite source is bundled by this change.
