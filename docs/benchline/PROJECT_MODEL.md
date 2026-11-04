# Versioned product projects (BL-03)

In **Product → Project model**, create an empty product without a board or agent, or explicitly snapshot a saved brief. Register requirements and native-file references; changing an upstream requirement or saved file identifies downstream work for review. This is metadata and observation, not tool execution.

## Storage and schema

The portable `benchline.project.json` is the authority for schema version 1, stable UUID project/node identities, manifest revision, optional source-brief ID/revision, requirements, artifacts and dependency edges. Requirements contain text, revision and its SHA-256 content hash. Artifacts contain a name, one of electrical/firmware/mechanical/application/evidence, a project-relative path and dependency IDs. `dependsOn` points to prerequisites; the combined graph must be acyclic. See `shared/project.mjs` for the strict schema.

Local observations are separate: the selected runtime stores `product-models/index.json` and `product-models/<project-id>.json`. These contain canonical root locators, a local authorization epoch, saved-file hashes/status, separate live observations, fingerprints, sticky changed IDs and a bounded revision journal. New portable project folders are created under `product-workspaces/<project-id>` in that runtime. Back up those folders as project data, not disposable cache. No native file is created merely by registering its path.

Saved observations say saved or missing and include hash, bytes and timestamp. Live observations independently say observed or unavailable, with editor revision, dirty flag and timestamp. The production adapter currently reports unavailable: a saved hash never claims to describe unsaved editor changes. An injected adapter seam accepts only correctly identified, path-matched signals younger than ten seconds; stale/foreign signals are rejected. This seam is fixture-tested, not a claim of live KiCad integration.

## Changes, impact and recovery

- Metadata saves require both expected manifest revision and exact on-disk hash. Mutations serialize within one server process; stale edits return 409. Multi-process writers and hostile same-user filesystem races are not supported.
- Requirements and file references are the only authored data. Observation reads bytes, not CAD semantics. A changed connector fixture propagates to enclosure, firmware mapping and acceptance evidence while unrelated files remain untouched.
- Changed and needs-review labels are conservative and sticky. No automatic acknowledgement, rebase, regeneration, native edits or evidence certification occurs in BL-03. Adding a new reference establishes its first observation; missing files remain clearly labeled. No-tracked-changes is not an engineering validation label.
- The manifest and local state each use atomic replacement, but are not a two-file transaction. If the manifest committed and observation persistence failed, the UI reports uncertainty and preserves inputs. Clear the form, refresh, and inspect the committed revision before retrying. Reopening reconciles the older local projection against the manifest. Corrupt state fails closed and is preserved; do not delete it as an automatic repair.
- Journal entries record manifest revision/hash, saved observations and available live state when meaningful tracked state changes. They are observations, not complete historical copies of native files. Backup/version control remains necessary. There is no graph-wide atomic snapshot across independently edited files.
- Current limits: 100 registered projects, 500 requirements and 500 artifacts per manifest, 1 MiB manifest, 64 MiB per observed artifact, 500 journal entries. Limit failures require review; no automatic pruning. Export/archive UI is deferred.

## Portability and migration

Only normalized relative paths are allowed. Absolute paths, traversal, hidden segments, encoded escapes, duplicate case-insensitive paths and symlink components are refused, including symlinks to files inside the project. Keep registered native files within the chosen product root; this UI does not move or copy them for you.

To relocate, move the whole product folder yourself, then choose **Open folder manifest** at its new location. The old root must no longer exist: two simultaneous copies with the same project ID are refused. Reopen preserves portable IDs and manifest bytes, rotates the local epoch, clears reserved grants and rechecks every locator and observation. Paths that became symlinks fail closed. No previously observed editor connection is carried over.

Version 1 is the first portable schema. Unsupported versions are rejected, not silently migrated. Existing intake records remain unchanged; **Create from saved brief** is an explicit one-time snapshot of its nonempty text fields with source ID/revision. Structured discipline choices and the plan remain in the source brief rather than becoming fabricated requirements. Later brief edits are not automatically synchronized. Real customer project migration/association remains an ownership decision, not a side effect of opening this page.

## Execution boundary

All project-model responses report execution disabled. BL-03 neither issues nor consumes execution grants; any reserved local grant data is cleared during observation. Existing electronics permissions are untouched and are not imported or associated with a product. The relocation test seeds a synthetic future grant to test invalidation; it does not establish a working authorization engine. BL-04 supplies enforced capabilities, permissions and dispatch; BL-06 supplies durable execution and recovery.
