# ESP32-S3-EYE v2.2 pilot review

Selected by the owner on 2026-09-10: **Espressif ESP32-S3-EYE development board, v2.2**. This is the pilot target; no physical unit has been inspected. The earlier exact-product selection blocker is resolved.

The [current portable package proposal](esp32-s3-eye-v2.2.audit-02.proposed.json) imports into Benchline's Modules / BOM view. The [initial BOM](esp32-s3-eye-v2.2.bom.json) contains one ESP32-S3-EYE, with no invented quote or substitute. Its portable module reference remains unset until linked to a project's actual reviewed record. The isolated production qualification established that link and verified both exports.

## Reviewed sources and remaining engineering work

| Subject | Recorded result | Source |
| --- | --- | --- |
| Main-board revision | v2.2 selected; schematic title block agrees | [Main-board schematic](https://dl.espressif.com/dl/schematics/SCH_ESP32-S3-EYE-MB_20211201_V2.2.pdf), Rev 2.2, 2021-12-07 |
| Board outline | Main-board drawing labels 30.00 mm width and 60.00 mm length | [Front dimensions](https://dl.espressif.com/dl/schematics/DXF_ESP32-S3-EYE_MB_top_V2.2_20211207.pdf), page 1 |
| Assembly envelope | Unknown: LCD/camera, connector protrusions, stack height and tolerances are not qualified by the main-board outline | Package dimensions remain unknown and block enclosure work |
| Contacts and module pads | 176 entries cover main-board connectors, U5, battery/mounting/drawing-only pads and sub-board connectors/test points | Main-board sheets 2-4, sub-board sheet 2 and referenced drawings; unknown functions remain explicit |
| Complete pin inventory | Unknown: footprint-only pad functions, unidentified test locations and sub-board document identity are unresolved | The inventory-completeness field remains unknown and blocks dependent design |
| Electrical limits | Complete-board input range, each contact's absolute limits and current budget remain unknown | Nominal net labels do not establish maximum ratings |
| Sub-board revision | Conflict: linked filename says V1.1; both title blocks say Rev 1.0 | [Linked sub-board schematic](https://dl.espressif.com/dl/schematics/SCH_ESP32-S3-EYE_SUB_V1.1_20210913.pdf), title blocks visually inspected |
| Firmware | BSP 6.0.0 manifest pinned to commit b1bc71e7980663110055fbeba7eab59d5e689c2b; requires ESP-IDF >=5.4. Exact SDK/dependency lock and build remain pending | [Espressif guide](https://docs.espressif.com/projects/esp-board-manager/en/latest/references/boards/esp32_s3_eye.html), section 2.4 |
| Asset reuse | Permission unresolved; schematics are labeled Proprietary | References only in the portable package; original downloads stay in private runtime evidence |

The [Espressif guide](https://docs.espressif.com/projects/esp-board-manager/en/latest/references/boards/esp32_s3_eye.html), sections 3.1 and 4.1, documents occupied GPIOs and the added v2.2 LED resistor. Carrier design must account for existing onboard functions. Main-board and sub-board connector reference numbers differ; package contact names explicitly use the **MB** prefix.

## Retrieval and sourcing

Production UI evidence: `.runtime/bl07-eye-v22-browser-01/evidence.json`. Four explicit source checks retrieved the guide and three PDFs through the actual Benchline reader and matched the preparation hashes. The selected revision, package hash, review history and facts remained unchanged. All receipts survived reload. Chrome 152.0.7977.84 / Node 22.23.0; no application errors; isolated server exit 0. Selected-package, source-history and unavailable-distributor screenshots were visually inspected.

The [DigiKey listing](https://www.digikey.com/en/products/detail/espressif-systems/ESP32-S3-EYE/17887518) identifies MPN ESP32-S3-EYE, distributor SKU 1965-ESP32-S3-EYE-ND and Bulk packaging. A public web research snapshot is not an authenticated API quote or a guarantee of shipped hardware revision. Benchline's direct request returned an unavailable HTTP status, so the BOM contains no price or stock offer.

The next source-access decision is a dedicated read-only distributor connection. [DigiKey Product Information V4](https://developer.digikey.com/products) uses a registered application; [production setup](https://developer.digikey.com/resources) and [two-legged OAuth](https://developer.digikey.com/tutorials-and-resources/oauth-20-2-legged-flow) are documented by the provider. The intended bounded operation is product details for the selected SKU, US/USD quantity one, followed by exact MPN/packaging/quantity and observation-time review. Ordering, carts and paid quotes are outside this operation. Existing public-document retrieval does not support credentialed API calls. The separate [DigiKey adapter](../DIGIKEY_SOURCING.md) now passes offline qualification; dedicated access and successful live API retrieval remain necessary. No account registration, terms acceptance, credential lookup or credential copying has occurred.

[Mouser Search API](https://www.mouser.com/en/api-search/) is an alternative if the owner already has that access. Provider choice and available access were requested while completing this package review. Secrets belong in a dedicated host credential mechanism, never this document, project, chat, logs or exports.

## Verification scope

- Package schema validates; all unresolved fields remain explicit and design readiness is false.
- Production package/revision review, four real manufacturer reads, distributor failure handling, persistence and module/BOM round-trip passed.
- Current package/source regression: 12/12 tests pass; full regression 306/306 and production build pass. Source-conflict handling and the larger import allowance are qualified in audit browser run 02.
- BL-07-A1/A2/A3/A5 have current evidence, including the explicit blocking unknowns allowed by A2. A4's manufacturer portion passes, while live distributor integration remains unverified. No successor milestone is ready.

## Source audit 02 and enforced conflict handling

The original 20-contact proposal and browser evidence are retained. The new proposal enumerates 176 contacts/pads. It records the main-board back drawing and the sub-board 30 x 31.90 mm outline without interpreting them as a complete assembly envelope. Raw source receipts, exact hashes and the per-field audit are in `.runtime/bl07-eye-audit-01/sources.json` and `field-audit.json`. The BSP manifest and Apache-2.0 license are pinned source references, not an installed or tested dependency.

The sub-board schematic and dimension source carry structured `revisionStatus: conflicting`. Conflicting or explicitly unreviewed source revisions independently block design readiness and confirmation of affected facts. A matching retrieval does not clear the conflict. This metadata is optional without a default, preserving hashes of older packages. Resolving it requires a separate sourced proposal; no existing review is silently modified.

The larger proposal is 261,187 bytes. The UI now accepts files up to 512 KiB, with a one MiB request envelope only for module-library routes; other JSON routes keep their existing limit. `.runtime/bl07-eye-audit-browser-02/evidence.json` passes the actual export/re-import, oversized-file rejection, UI/direct-HTTP source-conflict refusal, immutable prior-record and source-hash checks. Eight manufacturer documents were retrieved and matched; DigiKey remained unavailable. The first browser attempt is retained: an asynchronous fixture predicate advanced before the re-import completed. The final fixture waits for the actual second/third package to appear. Both runs shut their isolated servers down successfully. Selected-package and negative source-conflict screenshots from the successful run were visually inspected.

Current validation: **306/306 regression tests**, build pass, license inventory pass (all twelve release gates still open), export review pass and clean whitespace check. A2 is satisfied as a source/unknown representation audit: it does not assert known electrical ratings or complete geometry. A3 is satisfied by the preserved conflict, unavailable/changed-source protections, inert-source fixtures and real UI/API refusal. A4 remains incomplete pending a service-specific distributor connection and successful live retrieval. No successor is ready.

## DigiKey implementation and offline qualification — 2026-09-10

The current increment passes 19 focused checks, 313/313 full regression tests, production build, export review and license inventory (all twelve release gates remain open). `.runtime/bl07-digikey-browser-01/evidence.json` verifies an actual missing-credential result and an explicitly injected offline sourcing observation in a disposable production UI, including server restart and separate proposal export/reimport. Both screenshots were visually inspected; both server runs exited 0 with no browser errors. This is not a live quote for the selected board. The real pilot BOM remains offer-free. BL-07-A4 awaits dedicated API access and one successful approved read-only retrieval; all successors retain their unmet prerequisites.
