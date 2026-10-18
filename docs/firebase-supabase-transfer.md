# Firebase data transfer and ongoing Kakao publication

**Operational cutover:** the SQLite-to-cloud publisher below is a retained migration utility, not the ongoing pipeline. Use `kakao-cloud.js` and [the current collection guide](supabase-publisher.md). Supabase owns collection cursors and review outcomes; local PM data is an archive, never a fallback.

## Verified transfer status

The fixed-time export from **2026-10-16 20:38:57 (Mexico City)** was imported and
independently verified in [workflow run 39073655742](https://github.com/louiscxcix/lspm/actions/runs/39073655742).
All 2,449 documents passed their SHA-256 checks. All 467 application candidates
matched their stored rows, with no missing rows, unexplained differences or
preserved conflicts. An unchanged rerun confirmed idempotency, and the original
local publisher capability was registered without publishing its credential.

The owner workspace advanced to revision 339: 7 projects, 1,715 entities, 4,141
relations and 853 retained sources. Three Progress snapshots contain 234 count
rows; two checksheet versions project to one current checksheet. All 383 current
History event IDs exist in the application tables, and the legacy attachment's
bytes match its original Firestore chunks. Earlier seed variants and legacy
projects remain recoverable in the restricted original-document archive.

Actual browser verification opened the migrated Progress and preparation screens
without login, checked their saved records and read-only controls, and reported
zero browser errors. Authenticated save/reload was verified separately with a
temporary isolated account, then the account and its records were removed.
Database size after transfer was about 67 MB, within the current free-plan
storage allowance. This verifies the captured export; later Firebase writes need
a new export rather than an assumption that Firebase and Supabase still sync.

## Sources and destination

The operational destination is Supabase project `ahzpuefosoajwwgbfhng`. Keep the existing owner workspace and all online edits. Firebase project `ontho-166a6` remains a retained source; this migration does not delete its records or change its passwords.

The fixed-time Firebase export contains 2,449 documents, including 17 retained seed versions, 383 current History details, three legacy user projects, the cloud-created Knowledge 360 project, three Progress uploads, two preparation records, and one chunked original attachment. The two configured Cloud Storage bucket names returned not found; no bucket objects were silently omitted.

GitHub stores the complete export as `backups/firebase-latest.json.gz.enc` and a combined SQLite restore image as `backups/ontology-with-firebase.sqlite.enc`. Both use the existing separately retained backup key. Authentication credentials and files that never existed in Firebase are excluded. Do not commit plaintext databases, decrypted conversations, service-role keys, publisher capabilities, or `.env` files.

## One-time transfer

Run the `Transfer retained Firebase data to Supabase` workflow. It runs preservation/idempotency and capability checks against a disposable PostgreSQL database before applying additive migrations and importing business data. Its optional `publisher_hash` input accepts only the SHA-256 of a locally generated device capability, never that capability itself.

Original Firestore documents are retained in administrator-only `pm.firebase_documents`; their JSON bytes and per-document hashes remain independently recoverable. Missing current records are added to normal project, ontology, source, WIP, and preparation tables. Historical workspace variants are archived rather than merged into current people or production routes. `pm.firebase_conflicts` retains differing online records without overwriting them. A revision check and transaction guard the application merge. Re-running a committed export does not duplicate it.

## Ongoing Kakao data

After the existing local source review and Event commit succeeds, run:

```sh
node publish-supabase.js
node publish-supabase.js --status
```

Before reviewing personnel information, run `node people-context.js` and inspect the private `../.local-data/people-context-review.json`. It exposes recorded titles, teams, line/work links, reporting links, evidence-verified account mappings, and source references for named mentions. It never turns a name match into confirmed identity or employment, and never modifies the database by itself.

The publisher reads the local SQLite database without modifying it. The local capability is in `../.local-data/supabase-publisher.json` with mode 0600; it is not a Supabase service-role credential and is never committed. The capability authorizes only the pinned owner workspace's source/ontology/membership publication functions. It cannot reset passwords, write production quantities, edit project settings, delete records, or read another workspace.

Sources and relationships are append-only. Existing Person, Organization, Evidence, and Event records may change only when their previously confirmed preimage still matches; other existing production objects cannot be changed by this capability. Conflicts are retained for review. Request keys make uncertain retries idempotent. Local publication state advances only for acknowledged records; failed and conflicting records remain retryable. Collection checkpoints and Supabase publication checkpoints are separate.

Do not run `publish-private.js`, create public snapshots, push new chat data to GitHub, or redeploy Firebase Hosting as part of routine chat collection. Supabase data publication is independent of Hosting deployment. Macs still need to be awake and able to access the local Kakao database.

## People evidence policy

Review the four approved conversations only. Include explicitly identified LG Innotek contacts mentioned in messages, not just message senders. Retain original author IDs, display-name variants, named references, organization/team, role, request/action/approval/handoff/contact context, project/line associations, source message IDs, source excerpts, and reported times whenever actually stated.

An account is not automatically a confirmed employee identity. Do not merge people from a first name, display name, or guessed translation. Link confirmed identities and affiliations with source evidence; preserve uncertain affiliations and roles as reviewable assertions, not confirmed assignments. Do not infer machine responsibility, direct reporting hierarchy, customer/model changes, completion, or stock changes from contact mentions. Routine greetings remain source-only; meaningful personnel changes, work requests, handoffs, responsibilities, and contact instructions may be business Events. Evidence-backed people/organization links must also be visible in the relevant project/line map when the project association is confirmed.

## Verification and rollback

Verify Supabase document counts, source counts, owner workspace revision, and actual public project/Progress API responses after transfer. Test the publisher twice; the second unchanged run must not create new records. Do not declare success from a GitHub push or a queued workflow alone.

Firebase and the original local database remain unchanged, so rollback does not require deletion of any source. Disable the publisher device if necessary, retain the export and conflict ledger, and review imported IDs before any separately authorized reversal. Supabase-only online records must never be replaced by an older local restore image.


## Migrated owner sign-in

The verified original Firebase owner email is configured server-side as
`PM_WORKSPACE_OWNER_EMAIL`. When that email signs in through Supabase Auth, the
Edge Function opens the preserved owner workspace; it does not move or duplicate
its rows. The email must be confirmed. Other users keep their own isolated
workspaces, and browser-supplied metadata cannot select the migration owner.
Firebase passwords and sessions are not imported: the owner must create a
Supabase account using the same email and complete email confirmation once.

The deploy workflow verifies a real authenticated create/save/reload with a
short-lived synthetic account, checks that the project is absent from public
reads, then removes the test account and its records. It never changes the
owner's data or credentials. All numbered migrations and the Firebase transfer,
publisher and identity guards are part of normal CI checks.


## Optional map AI

Map questions now use the authenticated Supabase Edge Function rather than
Firebase's browser SDK. Set `GEMINI_API_KEY` in Supabase Edge Function secrets to
enable it. The key stays server-side; source messages and Evidence are excluded
from map context. Without this separate credential the health response marks AI
as unconfigured, while all ordinary data operations continue to work. The old
Firebase browser API key is not an AI server credential and must not be reused.
