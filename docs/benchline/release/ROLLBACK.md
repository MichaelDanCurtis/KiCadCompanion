# Benchline private preview rollback

Rollback is a reviewable recovery procedure. It does not replay actions or
copy state back into another workspace.

1. Stop new work and inspect the local action/workflow journal for pending or
   unknown operations. Reconcile an unknown result before using either version.
2. Query `/api/state` and confirm the product, checkout, workspace and state
   directory belong to the preview being retired. If identity does not match,
   stop and leave the process untouched.
3. Stop that exact preview process. Preserve its state directory and logs for
   review; do not recursively delete a customer or prototype directory.
4. Restore the previously reviewed archive in a separate directory and verify
   its hash manifest, package version and launch identity before starting it.
5. Reopen only the synthetic sample project and confirm that no action, grant,
   provider profile or conversation was imported.

Record the stop, restore, hash and reopen observations in the candidate
manifest. A failed or uncertain rollback keeps the private preview blocked.
