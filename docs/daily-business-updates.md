# Daily company updates

The goal is company information supplied in the chat or its work attachments →
the existing Supabase ontology → the web application's History view. Software
implementation, app deployment, UI changes and synthetic production checks are
excluded from business reporting.

## Record reviewed source material from a cloud task

Read the actual conversation/document first. Retain exact excerpts, file/page/
sheet/row identifiers, source timestamps, and unresolved identities. Use existing
project/Part/process IDs from Supabase. A plan, request or reported result must
keep its statement mode and verification level; it must not become an observed
production result. New entity identities or changes to quantities, routes and
ownership require the existing ontology/production editing workflow; this
adapter only appends sourced business Events and their evidence/subject links.

Save a reviewed batch outside Git, for example under `/workspace/.local-data/`:

```json
{
  "schemaVersion": 1,
  "recordedAt": "2026-10-18T01:00:00Z",
  "source": {
    "filename": "Example development note — not production data",
    "text": "Sample material arrival is planned for tomorrow.",
    "origin": {"threadId": "actual-thread-id", "messageId": "actual-message-id"}
  },
  "events": [{
    "key": "sample-material-arrival",
    "area": "development",
    "title": "Sample material arrival planned",
    "summary": "Arrival is planned; receipt has not been confirmed.",
    "sourceExcerpt": "arrival is planned for tomorrow",
    "projectIds": ["actual-project-id"],
    "subjectIds": ["actual-part-id"],
    "record": {
      "kind": "progress", "statementMode": "planned",
      "verification": "reported", "lifecycle": "active",
      "timePrecision": "unknown", "importance": "normal",
      "reportedAt": "2026-10-18T00:55:00Z", "unresolved": []
    }
  }]
}
```

For a document, retain the actual bytes in `source.base64`, set `source.mimeType`,
put its extracted text in `source.text`, and add page/sheet/row references to
`source.origin`. The current adapter supports sources up to 200 KB and 50 Events
per batch within the existing publisher's size limit. Larger attachments need
the existing dedicated attachment transfer; do not claim their bytes were saved.

From `/workspace/lspm`, with the environment's existing Supabase access binding:

```sh
export NODE_USE_ENV_PROXY=1
node scripts/record-business-update.js /workspace/.local-data/batch.json
node scripts/record-business-update.js /workspace/.local-data/batch.json --queue
node scripts/record-business-update.js /workspace/.local-data/batch.json --apply
```

The first command checks the source, schema and actual existing IDs. `--queue`
retains the reviewed batch in the existing Supabase source inbox for the daily
job; it does not yet change the ontology. `--apply` performs an immediate update.
It uses the existing owner-bound publisher in one transaction, then separately
reads every source, entity, relationship and membership back from Supabase.
It does not need the Mac's SQLite database or local publisher credential file.
The short-lived publisher capability is created/used/removed in the transaction.
Conflicting records roll back the entire batch. Keep `recordedAt`, event keys,
source bytes and origin identifiers identical on retry: stable IDs make a
successful replay a no-op instead of another Event or revision. A correction is
a new sourced Event with `followsUpId`, not a rewrite of the previous fact.

## Verify the actual user view

Open `https://louiscxcix.github.io/lspm/?edit=1`, sign in to the existing owner's
workspace, open the relevant project and enable **History**. Use the occurrence/
reported/recorded date basis appropriately and verify the Event, linked Part/
process and original evidence. A database acknowledgment alone does not prove
that the expected user view displays it.

The existing guest projection excludes `local_only` Events and hides the History
controls. This adapter preserves existing access settings; it does not change
398 previously private Events into public records. Do not claim that normal
guest browsing displays private Events just because the authenticated API works.

## Daily execution at 19:00 Mexico City

The chat agent reads accessible company conversations/uploads, extracts reviewed
batches, reconciles duplicates against existing Events (including Kakao imports),
and calls `--queue`. Do this when processing a business upload; a GitHub runner
cannot fetch conversations from this app. Later inputs retain their actual
business dates when processed.

`.github/workflows/daily-business-updates.yml` runs `--sync-pending` daily at
01:00 UTC, which is 19:00 America/Mexico_City the previous local day. GitHub may
delay a scheduled execution. A manual workflow dispatch can run it earlier.
The existing Actions secret `SUPABASE_ACCESS_TOKEN` supplies the write binding;
reviewed business content stays in Supabase rather than in the Git repository.
The worker applies pending batches, verifies the committed rows, and only then
acknowledges each inbox item. A lost acknowledgment leaves the item retryable;
stable record IDs make the next run idempotent. Applied items are not requeued.
This scheduler processes the inbox; it is not an automatic collector of all Codex
conversations, local Kakao messages or unshared Mac files. Preserve the existing
Kakao schedule. Report source collection, Supabase commit, webpage verification
and scheduling as separate outcomes, and leave failures available for retry.
