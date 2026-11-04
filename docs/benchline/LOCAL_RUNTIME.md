# Local qualified-runtime binding

Benchline now has a product-controller binding for the pinned local dispatcher
and owned Code Mode gateway. It is an explicit private-development opt-in, not
a published package, generic Codex compatibility promise, or license clearance.
The running preview is not reconfigured by editing this documentation.

Set both host environment options when deliberately launching a configured
instance:

```text
BENCHLINE_PROVIDER_RUNTIME=local-dispatch-v1
BENCHLINE_PROVIDER_MODEL=<explicit available model id>
```

The configured installed CLI, patched local app-server and Code Mode host must
match their reviewed hashes. Capability checks do not open an account profile
or call a model. Connecting a selected product rechecks binaries, effective
configuration, account sign-in and the exact selected model; there is no fallback.
Account setup must be disconnected before a model process acquires its exclusive
profile. Profiles, credentials and permission grants are never copied.

Only the product agent uses this binding. The legacy companion agent/AI studio
launcher stays disabled. Product capability responses are instance-specific.
Discuss and Agent use the same constrained dispatcher; the revision-bound action
gate enforces their different permissions. Model text cannot approve an action.

## Native model operation

`BENCHLINE_NATIVE_MODEL_REGISTRATION` optionally names a separate, host-owned JSON
record parsed by `konnectModelRegistrationSchema`. Missing, invalid, disconnected
or changed qualification leaves `native-models/set-placed-models` unsupported.
This option does not enable `refresh-footprints` or qualify customer boards.

The current record contains the existing disposable-board qualification plus
reviewed `configSha256`, `nativeRuntime: {path, sha256}`, `modelSha256` and
`modelRoots`. It is restricted to the exact private board, footprint UUIDs and
model asset (or empty model lists for an independently approved restoration).
Do not infer those pins from a model request, customer file or newly encountered
editor. A closed/replaced editor requires fresh host binding review; it is not
automatically adopted.

Registration uses Konnect MCP discovery and read-only editor identity checks.
All later CAD changes remain MCP-only, conditional on live revision, approval
and post-write verification. Neither a supported capability nor this registration
file itself approves a mutation.

## Evidence and limits

See [BL-04 evidence](evidence/BL-04.md) for the compiled dispatcher, synthetic and
signed-in probes, source regression failures reproduced on untouched upstream,
actual process-shutdown drills, and production entrypoint startup checks.
The private editor was explicitly restored and its new instance reviewed. Final
read-only verification through the actual registered server path passed: both
runtime/native capabilities supported, stale binding refused, unchanged live
revision/model lists/saved board, and all three owned MCP processes closed.
The server-shutdown cleanup-rejection, late-opening and repeated-stop regressions
also passed; [the final BL-04 review](evidence/BL-04.md#2026-09-09--registered-live-binding-and-coordinated-shutdown-review)
records 257/257 integrated tests and acceptance of the original five criteria.
BL-04 is verified only within this exact opt-in/private-native scope. The main
preview has not been reconfigured. Missing/replaced native bindings still fail
closed; BL-05/06/07 are eligible, not complete. No new customer scope, paid model
turn, license clearance or publication is authorized by this guide.
