# DigiKey sourcing — private candidate

The read-only adapter and offline browser workflow are implemented. **The owner has confirmed that DigiKey is approved for read-only lookup.** Live DigiKey API retrieval is not yet qualified; BL-07-A4 still requires local credential setup and one successful authorized retrieval. The selected pilot is Espressif Systems ESP32-S3-EYE v2.2; distributor stock does not establish the shipped hardware revision or electrical suitability.

## Account setup and data-use review — 2026-09-10

The owner supplied the signed-in developer portal and authorized setup. The initial personal-app form was sandbox-only. A **Benchline** organization was created and visibly reports Active. The owner completed production submission. The portal confirms **Benchline Product Research** was successfully created and is **Approved**; its detail page confirms **ProductInformation V4 Enabled**. The optional callback was left blank for two-legged OAuth. No credential values have been copied into project, host configuration or chat by the agent. Account/app creation is complete; live integration is not yet qualified.

Review of the linked [API User Agreement](https://developer.digikey.com/api-user-agreement) found a material unresolved restriction: section 5.1(e) prohibits using the API, its data or documentation to create or update one's own information database. Sections 3.2 and 4 also restrict data modification/disclosure and describe confidentiality obligations. These terms need clarification for the implemented saved observations and portable BOM offers before enabling the live integration. The offline tests establish behavior only; they do not establish permission for that behavior with actual DigiKey data. The owner cannot substitute internal approval for permission needed from DigiKey. App approval does not establish permission for the proposed retention/export behavior. No API execution or data-use clearance is claimed. The owner-approved [clarification message](DIGIKEY_PERMISSION_REQUEST.md) has now been sent to DigiKey; a response is pending.

## Access and configuration

The owner supplies a dedicated DigiKey Product Information V4 application and approves its use under the applicable account/API terms. No account creation, terms acceptance, credential discovery or credential copying is performed by this implementation. Secrets should not be pasted into chat, project files, environment example files or BOM exports.

`BENCHLINE_DIGIKEY` selects an absolute path to a nonsecret host JSON configuration. Missing or invalid configuration disables retrieval. The configuration is separate from portable project/module/BOM data. This is the exact pilot registration shape; the example paths are placeholders:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "credentialFile": "/private/host-secrets/benchline-digikey.json",
  "products": [{
    "manufacturer": "Espressif Systems",
    "mpn": "ESP32-S3-EYE",
    "hardwareRevision": "v2.2",
    "sku": "1965-ESP32-S3-EYE-ND",
    "packaging": "Bulk",
    "sourceUrl": "https://www.digikey.com/en/products/detail/espressif-systems/ESP32-S3-EYE/17887518"
  }]
}
```

The separate credential file contains exactly `clientId`, `clientSecret` and `accountId`, all strings. The current Product Information V4 documentation requires `X-DIGIKEY-Account-Id` for the two-legged flow. Use the account identifier assigned for the dedicated application's intended region/account; do not guess it. The file must be a private regular file owned by the running user, with no group/other permissions (for example mode 0600), at most 16 KiB, outside the source checkout, selected workspace, state/export root and current product project. Final-component symlinks are refused. Nothing reads this file at startup; loading is attempted only on the explicit sourcing action. This private preview is qualified on macOS; cross-platform credential-file permissions are not claimed.

The configuration permits at most twenty unambiguous exact part/revision/packaging registrations. Imported URLs, credentials, account identifiers, request headers and API endpoints cannot override the host registration. The BOM item must link a current local module record by ID, revision and hash. Unlinked, stale, unregistered and DNP items cannot be retrieved. Sourcing can inspect a part whose engineering facts remain unknown; the observation does not clear those design blockers.

## Review workflow

1. Import the selected module proposal and a BOM linked to its current local record.
2. In the controlling window, select **Check DigiKey sourcing** for the registered item. The current project hash and BOM revision/hash are checked before reading; controller admission is checked between authentication, product retrieval and persistence.
3. Review the timestamped observation, exact SKU, packaging, requested quantity, standard unit price and package-specific stock. Unavailable attempts retain a reason. No automatic retry occurs.
4. **Export BOM proposal with this observation** produces a separate portable revision with the normalized offer appended. The original BOM and reviewed module remain unchanged. Importing the proposal is a separate user action; alternatives are never automatically substituted.

Completed request IDs return their saved receipts and cannot be retargeted. Receipts survive restart. Controller release and shutdown drain admitted library work. An interrupted read without a persisted receipt has no confirmed observation; the application does not automatically replay it.

## Transport and data limits

Only `api.digikey.com` is supported: POST `/v1/oauth2/token` with `client_credentials`, then GET `/products/v4/search/{registeredSku}/productdetails`. There is no cart or order operation. Each request uses validated public IPv4 resolution pinned to TLS hostname verification. Redirects, proxy configuration, cookies, compression, arbitrary headers and alternative hosts are unsupported. The full operation has a twenty-second deadline; token/product responses are limited to 16 KiB/1 MiB and headers to 16 KiB. Tokens remain in memory for that operation and are not cached or persisted.

Normalization verifies returned account, US/en/USD locale, manufacturer, MPN and exactly one registered non-marketplace SKU/package variation. It selects the highest standard price break at or below the requested quantity and rejects requests below the minimum quantity. Numeric unit-price source tokens preserve decimal precision and trailing zeros, with at most eight decimal places; scientific notation and excessive precision fail instead of being rounded. Missing prices or package-specific stock remain unknown. Aggregate product stock and account-specific `MyPricing` are not substituted for these fields.

Only normalized offer fields, response SHA-256, timestamp, selected price break, minimum quantity and a bounded outcome are persisted. Raw product/token responses, client identifiers, secrets, account/customer identifiers and account pricing fields are excluded. Shipping, tax, tariffs, order multiples, stock reservation and shipped hardware revision remain unverified. These observations do not authorize purchasing or redistribution of vendor content.

## Qualification and references

The [BL-07 evidence](evidence/BL-07.md) records 19 focused checks, the 313-test regression and an explicitly offline production UI qualification. The browser fixture uses an absent credential file for the real unavailable path, then seeds a clearly labeled offline observation through the production store with injected transport while its disposable server is stopped. It does not enable a fake provider mode in production or satisfy the required live check.

The implementation follows the official [two-legged OAuth flow](https://developer.digikey.com/tutorials-and-resources/oauth-20-2-legged-flow), [ProductDetails](https://developer.digikey.com/products/product-information-v4/productsearch/productdetails) and [Product Information V4](https://developer.digikey.com/products/product-information-v4/productsearch) documentation retrieved on 2026-09-10. The embedded V4 Swagger was inspected for account headers, product variations, package stock and price-break fields. Private snapshots remain in `.runtime/bl07-digikey-01`; documentation inspection is not API execution evidence.

The approved local DigiKey Product Information API credential file is now configured on the host and one exact-match read-only lookup succeeded. No credential values are stored in the project or chat, and no cart, order or customer BOM upload was performed. If the owner instead selects Mouser later, its own service-specific implementation and live qualification remain necessary.

On 2026-09-15 the signed-in developer portal was rechecked. **Benchline Product Research** still reports **Approved** and **ProductInformation V4 — Enabled**. The successful live receipt is `.runtime/bl07-digikey-live-read-2026-09-15.json`; it records only normalized offer metadata and a response hash. The separate API terms/data-retention clarification remains open for broader release or redistribution decisions.
