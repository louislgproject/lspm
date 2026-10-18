# Scheduled Kakao and personnel publication

The retained Firebase export and missing application records are already in Supabase. See [the transfer guide](firebase-supabase-transfer.md) for the original archive and verification workflow. The operational web application is https://louiscxcix.github.io/lspm/; the older Firebase Hosting address is a separate legacy client, not proof that its data reads have changed.

After the existing local review and Event commit, run `node people-context.js`, review the private personnel context file, then run `node publish-supabase.js` and `node publish-supabase.js --status`. Routine collection must not run `publish-private.js`, push conversations to GitHub, or change Firebase records. Keep the original four-conversation read-only allowlist and the existing Mexico City schedule.

Expand evidence-backed people coverage to named contacts as well as senders: titles, organizations/teams, line/project associations, requests, responses, approvals, contact instructions, reporting and handoffs. Existing names and account IDs remain separate unless identity evidence confirms a match. A name mention is not employment evidence. Uncertain roles or company membership remain review items, and a contact mention never assigns a machine or changes a production route.

The local capability in `../.local-data/supabase-publisher.json` is owner-bound, stored with mode 0600, and never committed. It is not a service-role key. The publisher cannot delete records, reset passwords, alter project settings, or overwrite existing production objects. Existing Person/Organization/Event/Evidence updates require a matching previously acknowledged preimage and the same existing object type.

Publication reads one consistent SQLite snapshot and validates the graph. A fresh operation key is saved locally before network I/O; only an uncertain retry of that operation reuses it. Repeating an earlier value later is a new operation. Only acknowledged rows advance the confirmed checkpoint. Source collection checkpoints and remote publication checkpoints remain independent.

A definite PostgreSQL validation or constraint rollback is retained in a private rejected-batch file without advancing checkpoints. Corrected input gets a new operation. Network failures and uncertain responses retain the exact pending operation for safe replay. Incomplete object identity, type, name or status is rejected server-side before updates.

Source bytes are preserved, including binary files and text byte-order marks. Declared credential redactions carry original and published content hashes plus the original metadata hash. A differing source never replaces the existing source: its full incoming version is retained in administrator-only `pm.publisher_source_versions`, and conflicting business changes remain unacknowledged for review. Verified credential-redacted variants may be acknowledged without discarding the existing original. Oversized records stop explicitly for a dedicated attachment transfer.

An unchanged second publication still checks the remote connection. Failures and conflicts must not be reported as completed. The Mac, Codex, and local Kakao database must remain available; sleep is not continuous server operation.
