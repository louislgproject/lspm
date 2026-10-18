# Supabase migration

Target project: `ahzpuefosoajwwgbfhng`. The frontend uses its public publishable key in `supabase-config.js`; that key is not a password. GitHub Pages serves the application and Supabase Auth, PostgreSQL and the `ontology` Edge Function provide storage and editing. The normal URL now opens a public read-only workspace without login. No Firebase deployment is involved.

## Public viewing

`https://louiscxcix.github.io/lspm/` displays the published workspace without a sign-in panel. Public API endpoints allow only reads of the published graph and its WIP/staffing observations. Source-file bytes, raw logs, source excerpts, exports, audit diffs and all write operations are excluded. Public reads use the Supabase HTTPS Data API and the fixed, SELECT-only `public.pm_public_read` function, so guest views do not open direct PostgreSQL connections from Edge. The function has no owner-ID parameter and explicitly filters every table to the administrator-pinned publication; other users' records remain private. Anonymous users receive permission to call this function, not permission to read the underlying tables.

Migration `202610170001_public_workspace.sql` pins the single populated account if one exists. With no populated account it uses the sole existing Auth user, or creates an empty, dedicated publication scope if there is no unambiguous user. If multiple populated accounts already exist, deployment stops rather than exposing all accounts. The original SQLite records are still not imported automatically.

Editing remains available at `https://louiscxcix.github.io/lspm/?edit=1` and requires sign-in. If publication was initialized before an editor account existed, first create/sign in to the editor account, then use the Supabase SQL editor to set `pm.publication.owner_id` to that account's Auth UUID. That is an administrator-only selection, never a browser parameter. To withdraw publication, remove the row from `pm.publication`; changing browser configuration alone does not revoke the public API.

## Current status

The code is migrated and tested locally. Applying the remote schema, deploying the Edge Function, and moving the original data require access to the live project. The cloud onboarding SQLite database is empty; it is not a copy of the original computer's data. Do not describe an empty account as a successful data migration.

## Deploy

Use Node 24 LTS (validated with 24.19.0). From the repository root:

```sh
npm ci
npm run build:supabase
node scripts/deploy-supabase.js
npm run build:cloud
```

Set `SUPABASE_ACCESS_TOKEN` securely before running the deployment script. Obtain a personal access token with access to this project through your Supabase account settings. Do not commit it, put it in browser configuration, or paste it into chat. The script applies ordered SQL migrations through the Supabase Management API and deploys the Edge Function using the pinned official Supabase CLI. It refuses an unknown existing `pm` schema and recognizes applied versions on repeated runs. Add future changes in new numbered migration files instead of modifying applied SQL. Schema changes and function deployment are separate remote operations; a failed function deployment may leave the schema successfully installed, and retrying recognizes that state.

GitHub Actions splits deployment into **Apply Supabase database migrations**, **Deploy Supabase Edge Function**, and **Verify hosted Supabase endpoint**. The release check requires the private API's unauthorized response, a working public database-backed health response, actual public workspace data, and matching CORS headers before publishing the frontend. The handler accepts both the gateway path `/functions/v1/ontology/api/...` and the runtime path `/ontology/api/...`, because Supabase removes `/functions/v1` before forwarding requests. An actual signed-in write test is still required to validate the editor's write path. `npm run verify:supabase` repeats the endpoint checks.

The function uses Supabase's injected `SUPABASE_DB_URL` and public keys. It verifies every access token against Supabase Auth before opening a database transaction. Gateway JWT verification is disabled to support publishable keys; the function's own user authentication is mandatory. Database queries run as `authenticated` under the verified user's identity, with row-level security. Database credentials and service-role keys never enter the browser.

In Supabase Authentication, enable Email/password and set the Site URL to `https://louiscxcix.github.io/lspm/`. Email confirmations use the project's email delivery settings; check their rate limits before inviting users. Sign up and confirm the account, then sign in. Accounts currently have independent private workspaces; team sharing/invitations are not implemented.

The allowed browser origin defaults to `https://louiscxcix.github.io`. For another frontend, set the Edge Function secret `PM_ALLOWED_ORIGINS` to a comma-separated list of exact origins. No wildcard is accepted by the implementation. Optional AI extraction requires the Edge Function secret `GEMINI_API_KEY`; ordinary saves and CSV input do not require it.

## GitHub delivery

The workflow `.github/workflows/supabase.yml` tests PostgreSQL and the app. On `main`, it deploys the backend before publishing the cloud frontend. Configure the repository Actions secret `SUPABASE_ACCESS_TOKEN` and set Settings → Pages → Source to **GitHub Actions**. Then merge the migration branch to `main` or run the workflow on `main`. API access to GitHub is not required for a native Git push, but is needed to configure these repository settings automatically.

The deploy job checks Pages configuration before changing Supabase. If `configure-pages` reports `Get Pages site failed` with `Not Found`, open [repository Pages settings](https://github.com/louiscxcix/lspm/settings/pages), select **Build and deployment → Source → GitHub Actions**, save, and rerun the workflow. If the source is already selected, inspect that page for repository access or Pages availability restrictions. Automatic first-time enablement requires a separate token with the permissions documented by `actions/configure-pages`; the default workflow token cannot enable a missing site. The workflow does not request another token or bypass the check.

`build:cloud` copies application assets only; it never opens SQLite or publishes project records. The old static snapshot publisher has been removed.

## Import the original data

First make a backup on the computer holding the real SQLite database. Stop that local server while exporting, or use its existing **Export all data** button. The command below reads SQLite without modifying it and refuses to overwrite the destination file:

```sh
node scripts/export-sqlite.js /absolute/path/ontology.sqlite /private/path/ontology-backup.json
```

After creating the Supabase account, copy its UUID from Authentication → Users. Obtain the project's PostgreSQL connection string from Connect, preserving TLS certificate verification, and supply it through a secure `PM_DATABASE_URL` environment variable:

```sh
node scripts/import-supabase.js /private/path/ontology-backup.json SUPABASE_AUTH_USER_UUID
```

The importer requires an empty target account. It preserves object/project IDs, memberships, relationships, project assessments and schedules, workstreams, sources, AI review records, WIP/staffing observations, change history, and revision. All rows and validation commit atomically; a failure rolls everything back. It never modifies the original SQLite file. Keep exported files private: they include source document bytes. The authenticated `/api/import` endpoint supports the same backup format for integrations, with a 16 MB request limit; use the command-line importer for larger backups.

After importing, sign in, inspect real projects and relations, export again, and compare counts/source bytes. Only then treat the original data as migrated. Changes in the local SQLite app do not automatically synchronize with Supabase; use the online app after cutover.

If Global Library is empty, open the latest GitHub Actions run's **Summary → Supabase data status**. The deployment diagnostic uses the existing repository secret to count all objects and the pinned public owner's objects without printing object contents or user IDs. `NO_OBJECTS` means the original objects have not reached this Supabase project; `PUBLIC_WORKSPACE_EMPTY` means objects exist under another owner and publication needs review; `PUBLIC_DATA_PRESENT` means the public owner has objects and the frontend/API should be investigated. These counts do not restore or modify any data. Local exports and database files are ignored by Git, so deploying repository code does not transfer them.

The checksum-verified encrypted database is retained in `backups/` in the current checkout. Its manifest records revision 338, 1,712 objects, 3,922 relations, six projects and 849 retained sources. The matching key file originally lived at `/Users/louis/Desktop/lg/mex/.local-data/lspm-github-db-backup.key`; keep its contents out of chat and Git. To inspect this backup, store the file contents as the repository Actions secret `LSPM_DB_BACKUP_KEY`, then run **Inspect original encrypted database backup**. That workflow verifies the encrypted and plaintext SHA-256 digests, SQLite integrity, foreign keys, revision and manifest counts. It uploads only table names, column names and counts, and publishes that metadata to `recovery/backup-inspection` for native Git access; the decrypted database is deleted from its temporary directory. This is an inspection, not an import. The backup's newer schema and relationship definitions must be reconciled with the current app before importing. Firebase-only uploads and cloud-created records are not included in this local backup, so it does not establish a complete Firebase migration.

The original backup was verified successfully in GitHub Actions. Migration `202610170003_backup_recovery.sql` preserves its project types and source metadata. The updated ontology model uses the definitions from that same immutable backup commit. After the latest main deployment succeeds, **Restore original objects to Supabase** verifies and decrypts the backup again, stages every original table row in administrator-only tables, and atomically imports the core records into the pinned public workspace. It refuses to import if application records already exist in any Supabase workspace. Failed commits roll back all application rows; reruns resume staging or recognize an already committed backup without overwriting later edits. Original extra tables and metadata remain in the private recovery archive, not in public JSON. Their newer dedicated editing screens are not part of this recovery.

The normal public view applies the original app's `privacy='local_only'` exclusion and removes links to those records. The complete original objects and source bytes stay in the private database. A recovery report containing only counts and verification status is published on `recovery/restore-status`; a successful import is not claimed until that report confirms it. The recovery workflow additionally checks the hosted public endpoint. The backup's pinned publication scope may not correspond to an Auth user; editor ownership assignment requires an explicit subsequent administrative choice, not a guessed account or automatic reassignment.

## Verification

```sh
npm test
npm run build:supabase
npm run build:cloud
```

For PostgreSQL integration tests, initialize an empty disposable PostgreSQL 17 database with `supabase/test-bootstrap.sql`, then apply the migration. Set `TEST_DATABASE_URL` to that test database before `npm test`. Never run the test bootstrap against Supabase. Tests verify user isolation, cross-user foreign-key rejection, concurrent revision conflicts, project-specific schedules, history/revert, WIP, retained source bytes and atomic backup imports. The browser test uses Chromium (`CHROME_PATH` override), a simulated Auth service and the real shared API/store; it does not establish live Supabase readiness.

The Edge bundle can be imported in Deno. To type-check the entrypoint, use Deno 2 with `deno check --node-modules-dir=auto --no-lock supabase/functions/ontology/index.ts`. In a proxy environment, use the system CA store through `DENO_TLS_CA_STORE=system,mozilla`; do not disable certificate verification.

The pre-existing `node test.js` CSS version assertion failure is separate from this migration. Its regex expects a numeric suffix, whereas the checked-in stylesheet version ends in `mobile`.

## Free-plan limits

Ontology rows, history and retained source bytes currently live in PostgreSQL, so they count toward the 500 MB database quota. This migration preserves the existing source-byte behavior; it does not yet move documents to Supabase Storage. Use modest uploads and monitor database size. Moving large documents to private Storage is a future improvement. The backend still loads complete workspaces and records row diffs for change review, so large datasets increase memory and bandwidth use. Edge Functions have a 256 MB memory limit and limited CPU time; large XLSX workbooks need a representative live test before relying on them operationally. The existing 10 MB upload limit is not a guarantee every workbook fits those compute limits.

Free projects can pause for low activity. Maintain independent database and source-file backups. Use a paid plan if continuous factory availability is required.

### Latest interface (2026-10-17)

The frontend uses the latest application source from `backup/local-pm-20261016`,
including project types, improved maps,
hourly production charts, progress playback and sample preparation checksheets.
`client-assets.js` is the shared explicit asset list for local serving and Pages.
Builds never include database backups or retained source files.

Migration `202610170004_latest_production_views.sql` adds owner-protected hourly
and checksheet tables. Existing workspace rows remain in place; any corresponding
rows preserved in the committed recovery archive are copied forward without
replacement. New reads use a separate allowlisted public RPC; source payloads and
private checksheet references are excluded. Authenticated production writes share
the SQLite/PostgreSQL store implementation and revision checks.

Normal browsing remains public and read only. Use `?edit=1` for the authenticated
editor. Optional AI features remain unavailable until their server integration is
configured. Generic History ingestion remains disabled on the hosted interface.
The latest interface does not fetch additional Firebase-only records.

The release workflow verifies the new backend reads before publishing Pages, then
opens the actual published site in Chromium to check its UI source marker,
login-free project listing and nonempty Global Library relationship map. A failed
browser check fails the workflow even if the Pages publication itself completed.


### Repository publication controls

This repository is public. Keep plaintext SQLite exports, retained source bytes,
server credentials and environment files outside Git. Only the encrypted snapshot
and its checksum manifest belong in `backups/`. `npm run check:publication` rejects
tracked plaintext database files and detected credential formats, and checks the
browser asset allowlist. Both deployment jobs enforce it. Public publishable
Supabase keys are allowed; service-role tokens and personal access tokens are not.

Recovery workflows use the encrypted backup from their checked-out release and
verify its manifest checksums before decryption. They do not rely on commit IDs
that can change during a privacy history rewrite. Removing data from Git history
does not delete existing clones, GitHub caches or external copies. Previously
exposed keys require review or rotation with their provider.
