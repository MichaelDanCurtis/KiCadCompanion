# BL-02 dependency and commercial-boundary inventory

Audited 2026-09-05. **Inventory complete for this declared scope; not legal clearance or permission to distribute.** Benchline remains private and UNLICENSED. No contribution agreement, service contract or project license was accepted.

## Result and recommended starting boundary

Keep Benchline's orchestration, project model and interface independent. Initially connect to user-installed specialist tools through explicit adapters. Do not bundle or copy their implementation merely to simplify packaging. This minimizes the distribution surface, but does not replace review of linking, combined-work, asset and service terms. Forks retain upstream obligations; accepting a PR is a separate owner decision.

The product can continue local implementation without selecting its eventual commercial license. Before external distribution or a hosted offering, resolve the applicable gates in [catalog.json](catalog.json). Review should be performed by the owner with qualified legal advice for the actual delivery model.

## Reconciled inputs

2026-09-09 runtime-candidate update: the already inventoried `@grpc/grpc-js`
1.14.4 and `@grpc/proto-loader` 0.8.1 now belong to runtime dependencies. This
reclassifies 33 existing lock entries from build-only to the conservative
runtime closure; no package version, source, integrity or closure entry changed.
The current inventory contains 291 entries and 140 retained notice texts. The
reviewed lock digest is
`e134403e33145556bc77fb5bb292733397ff984333c0af13578b6990112a56b2`.
The matching unmodified Apache-2.0 protocol, LICENSE and NOTICE are retained in
`server/vendor/code-mode-protocol/`, with provenance there and a catalog entry.
Historical fixture copies remain for evidence compatibility. This local runtime
promotion makes no license election, closes no release gate and does not by
itself enable the provider or authorize distribution. The table below records
the original BL-02 audit, not these later inventory counts.

| Surface | Observed scope | Evidence |
| --- | --- | --- |
| npm dependency graph | 258 exact lock entries: 195 conservatively shipped runtime entries, 63 build-only entries | [npm-sbom.json](npm-sbom.json) contains version, source tarball, integrity, declared license, dependency ranges, mode, platform and classification |
| Installed npm notices | 208 installed packages; 210 notice-file references deduplicated to 124 complete texts | [npm-notices.json](npm-notices.json), SHA-256 keyed and traced to exact installed paths |
| Other-platform build packages | 50 optional entries not installed on this host | Explicit unresolved platform classification, gate G-TARGET |
| Local native build packages | esbuild/darwin-arm64 0.25.12 and rollup/darwin-arm64 4.63.1 have no own notice file | Exact-version findings in policy.json; parent notices collected, native contents still unresolved |
| Observer Python | Python 3.12.11; 12 observed distribution versions and their supplied notices | [python-sbom.json](python-sbom.json); no imports of KiCad or third-party packages were executed by the collector |
| External software | KiCad CLI 10.0.6, Konnect 0.11.0, configured Codex CLI 0.153.3, Node 22.23.0, KiCad Python 3.9.13, uv 0.9.26, Swift 6.3.3, macOS 27.0 | Version observations and unresolved binary provenance in [catalog.json](catalog.json) |
| Proposed integrations | FreeCAD, optional/deferred CadQuery, firmware SDK | Explicit UNSELECTED versions; tagged FreeCAD 1.0.2 and ESP-IDF v5.5.1 are license reference examples, not selected supported versions |
| Assets and services | Fonts, icons, library collections, vendor documents/models/examples, generated images and cloud account terms | Separate asset and integration records, not hidden inside an application-code license |

The npm SBOM is a documented Benchline JSON inventory, not a claim of CycloneDX/SPDX conformance. It includes every lock entry, including nested duplicates. Runtime scope is deliberately conservative: it is not a tree-shaking attribution analysis. The observed installation matches all installed lock versions. No dependency versions were changed by this audit.

The current native build compiles the shell and writes local launcher configuration; it does not copy KiCad, Konnect, Node, Python or FreeCAD into the bundle. The frontend build does compile npm code into JavaScript. Installed node_modules and generated dist are not source-export inputs. Final binary distributions and hosted resources must be reconciled again before release; this source inventory is not a release-package certificate.

## Findings that matter

### Konnect: distinguish the delivery models

The installed 0.11.0 line has an [AGPL license](https://github.com/mixelpixx/Konnect/blob/v0.11.0/LICENSE). Its [commercial document](https://github.com/mixelpixx/Konnect/blob/v0.11.0/COMMERCIAL.md) explicitly describes MCP clients as separate works and distinguishes internal use, redistribution and modified network services. That supports an external-MCP starting architecture, as an engineering recommendation—not a legal ruling.

The same tag's [README](https://github.com/mixelpixx/Konnect/blob/v0.11.0/README.md) has broader wording about business software built around Konnect. Preserve this discrepancy as G-KONNECT; confirm the intended distribution with the owner/counsel and, if necessary, the maintainer. A commercial license is an option, not an assumed purchase requirement for every external client.

The [contributor terms](https://github.com/mixelpixx/Konnect/blob/v0.11.0/CONTRIBUTING.md) grant the maintainer broad sublicensing rights when a contribution is submitted. A future PR therefore needs owner review of those terms. No PR, issue, email or agreement was submitted here.

### KiCad and FreeCAD: useful tools, separate obligations

KiCad describes most program source as GPL-3.0-or-later and notes other component licenses. Keep the application external initially; evaluate exact code modifications, redistribution and the legacy pcbnew-importing helper before shipping. The program license is not the library-asset license. [KiCad license policy](https://www.kicad.org/about/licenses/)

The reviewed FreeCAD tag carries the Library GPL v2 license text; a core source header explicitly permits version 2 or later. Do not flatten this to “MIT” or assume every component has identical terms. Select an exact build and review Qt, OpenCASCADE, Python and add-ons before embedding or bundling. Prefer an external native-document adapter first. [FreeCAD 1.0.2 license](https://github.com/FreeCAD/FreeCAD/blob/1.0.2/LICENSE), [version-specific core header](https://github.com/FreeCAD/FreeCAD/blob/1.0.2/src/App/Application.cpp)

### Package declarations are not the whole license inventory

The lockfile declarations are MIT (238 entries), ISC (10), Apache-2.0 (3), BSD-3-Clause (3), BSD-2-Clause (2), Python-2.0 (1) and MPL-2.0 OR Apache-2.0 (1). These are package declarations, not a count of all embedded legal texts.

- Lucide's actual notice retains Feather/MIT lineage as well as ISC terms.
- DOMPurify 3.4.14 supplies Apache and MPL alternatives. Both texts are retained; no distribution election is made by this report.
- argparse 2.0.1 carries historical Python license material. A mention of GPL compatibility is not itself a declaration that argparse is GPL-licensed.
- Vite's complete license includes embedded third-party sections and CC0 material beyond its top-level MIT declaration.
- pynng, cffi and rpds-py supply package notices, but these alone do not establish the complete licenses/versions of native libraries inside their wheels. G-PYTHON remains open.

These findings come from exact local package metadata and notice files, retained in the two notice inventories. Binary origin hashes, component-level provenance inside every wheel/tool and target-specific source offers are not established by this audit.

### Assets: rights follow each source

KiCad's library policy uses CC-BY-SA 4.0 with an exception for designs and generated files. It distinguishes that use from redistribution of library collections, where attribution and sharing obligations remain. Do not apply this exception to vendor models or another library provider. [KiCad library terms](https://www.kicad.org/libraries/license/)

DM Sans and Manrope have OFL license files in Google's font repository. The live CSS request is not version-pinned, so exact delivered font binaries remain unresolved. Keep remote-loading privacy and future self-hosting as explicit G-FONTS decisions. No font files were downloaded into Benchline. [DM Sans OFL](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt), [Manrope OFL](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt)

There are no approved vendor datasheets, footprints, STEP models or firmware samples in the release surface. Their records deliberately say NONE/UNRESOLVED. Customer assets and generated runtime images are excluded, not relabeled as publicly redistributable. Future imports need exact source, revision, hash, permitted use and retained notices.

ESP-IDF's reviewed example tag has an Apache-2.0 top-level license; subcomponents, examples, compiler and vendor binary terms must still be checked for the chosen target. No firmware SDK is selected or bundled here. [ESP-IDF v5.5.1 license](https://github.com/espressif/esp-idf/blob/v5.5.1/LICENSE)

### Provider access is separate from source licensing

The observed Codex CLI version has an [Apache-2.0 source license](https://github.com/openai/codex/blob/rust-v0.153.3/LICENSE). That does not grant cloud model access, settle the bundled executable's provenance, or permit account resale. Applicable service terms depend on the customer's account and offering; G-PROVIDER requires review of the actual agreement and data transfers. The fetched [OpenAI Services Agreement](https://openai.com/policies/services-agreement/) is a review reference, not a conclusion about this user's account. The generic terms URL returned regional terms, so applicability was not inferred.

All linked upstream sources in these finding sections were fetched on 2026-09-05. Tagged links identify the reviewed source version. Moving font policies and service pages must be rechecked before distribution. Upstream URLs elsewhere in the catalog may be origin pointers rather than fetched, complete binary-license evidence.

## Repeatable checks

```sh
npm run licenses:check
npm run licenses:inventory
node scripts/license-inventory.mjs --python-snapshot
npm run licenses:release-check
```

The first command checks the frozen lock digest, installed versions/licenses, inventory identity, notice text hashes, catalog fields and new assets/remote font URLs. It requires the reviewed npm install. It scans git-tracked/unignored files plus runtime source/public directories, including ignored assets that a frontend build could include. It does not scan the user's project or runtime model folders.

Inventory regeneration writes local generated reports only. It cannot update the reviewed lock digest or approve a new license. Review the changed lock, metadata and notices before deliberately updating policy. The optional Python snapshot reads the observer environment and never installs or imports its packages; it is informational, not a locked environment or automatic live drift gate.

The release command intentionally exits nonzero while any named release gate is open. This prevents an inventory pass from being presented as legal clearance. No external CI service was enabled; the check is available for local use or later CI wiring.

Tests inject unknown packages, unknown CAD/font/document assets, ignored public binaries, missing/tampered notices and installed-version/license drift. Source-code copying hidden in an ordinary code file, arbitrary dynamic downloads, binary internals, and package tarball authenticity are outside this checker; manual provenance/security review remains necessary. A target-platform change requires a fresh inventory review, not reuse of the macOS installed-package snapshot.
