# Module source observations — private candidate

BL-07 bounded public-document retrieval and independent source observations are qualified against the selected ESP32-S3-EYE v2.2 manufacturer sources. The owner has authorized DigiKey read-only lookup; distributor API retrieval, live quotes, electrical/physical readiness and asset reuse remain unqualified, and BL-07-A4 awaits host-local credential setup plus one successful read-only retrieval.

## Host configuration and user action

`BENCHLINE_MODULE_SOURCES` accepts an absolute host JSON configuration path. Missing, unreadable or invalid configuration disables retrieval. It is separate from project manifests and portable module/BOM exports. No source registration is configured by default.

Configuration uses `schemaVersion: 1` and a `sources` array, with at most twenty entries. Each entry contains exactly `url`, `manufacturer`, `model`, `hardwareRevision` and `kind` (`manufacturer` or `distributor`). The exact identity and complete URL must match a source already in the package. This is a trusted host selection; importing a package cannot enable its URLs. URLs require HTTPS on its standard port, without credentials, query parameters or fragments. Credential-bearing/API-query sources are unsupported in this public-document adapter. The separate [DigiKey adapter](DIGIKEY_SOURCING.md) now provides offline-qualified service-specific handling; its live qualification still needs dedicated access.

The controlling window explicitly selects **Check source** under the package's source references. The request carries the current project hash, package revision/hash, source ID and a fresh request ID. Stale inputs and observer requests are refused. Controller admission is checked again before reading and before persisting. Pending reads settle within the existing controller-release/shutdown drain. Successful and unavailable receipts persist; repeating a completed request ID returns its receipt without fetching again. Retargeting that ID fails.

## Retrieval and review boundary

The adapter resolves IPv4, rejects private/special-use addresses and pins the checked address to the HTTPS request while retaining hostname certificate validation. It makes one GET, with no redirects, cookies, authorization, client certificate, proxy configuration or automatic retry. IPv6-only sources are unsupported. The whole observation has a fifteen-second deadline, a four MiB response limit and a sixteen KiB header limit. Compressed responses and unsupported media types are refused. These conservative network restrictions still require live qualification against the chosen sources.

Plain text, HTML and JSON are recorded as a content hash, byte count, retrieval date and at most 4,000 characters of untrusted excerpt. React displays the excerpt as literal text; it is not interpreted as HTML, Markdown instructions or code. PDFs receive a hash and metadata without extraction or a retained file. No remote assets are installed and no downloaded content is executed. A response error exposes a bounded reason rather than transport details.

Receipts remain separate from package facts and their immutable review snapshots. A changed or unavailable latest source adds a design-readiness blocker. A matching content hash is not engineering verification. A new vendor revision needs a separately reviewed package proposal; neither retrieval nor an excerpt changes approved values, licenses, quotes or revision identity. Full source content is not retained by this public-document adapter, so reviewing the referenced document remains necessary. Distributor offers and credential handling use the separate DigiKey boundary described above.

## Evidence and implementation references

The [BL-07 evidence record](evidence/BL-07.md) distinguishes offline transport/store tests, actual production unavailable-source UI behavior and outstanding live qualification. Exact source hashes are recorded in `.runtime/bl07-sources-current.json`; prior receipts are retained.

Transport choices were checked against Node's [HTTPS documentation](https://nodejs.org/api/https.html) and [DNS documentation](https://nodejs.org/api/dns.html). The conservative address exclusions were checked against the [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry). These are implementation references, not proof that any vendor endpoint works.

## Selected-board qualification and source conflicts

ESP32-S3-EYE v2.2 manufacturer retrieval is now qualified in the production UI; see the current [BL-07 evidence](evidence/BL-07.md). This does not qualify distributor API access or electrical/physical readiness. Optional source `revisionStatus` records consistent, unreviewed or conflicting document identity. Explicit conflicts and unreviewed revisions block design and confirmation of dependent facts even when a fresh hash matches. The field has no default, so prior immutable hashes remain unchanged. Imported corrections still require a separate package proposal.

Module/BOM JSON file import is bounded to 512 KiB. Module-library request bodies allow one MiB including their envelope; other request limits are unchanged. The real 261,187-byte selected-board package was exported and re-imported through the UI, with an oversized rejection and source-conflict refusal checked.
