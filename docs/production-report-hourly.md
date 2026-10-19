# Production report → model hourly output

The hosted PM hourly API reads explicitly published `production.uploads`
snapshots from the shared Supabase database. **Save changes** in the input app
only saves a draft; **Upload DB** publishes it. Excel is independent.

`pm.production_report_models` maps exact external line/model codes to PM
project, Part and line IDs. The reviewed 36 LDM/TEM final identities and their
known reporting aliases are registered. Known parent-level reports remain
parent-level **기존 분류 (원본 실적)**; their quantities are never allocated to
children. Mistaken LWR IB/OB and T1-2 Lower identities, unknown models and TEST
codes have no inferred mapping. The production app's NEXLIDE identities still
need their own reviewed PM Part mapping.

The bridge uses the latest uploaded snapshot, validates the Mexico production
day's 24 hourly intervals, preserves null versus zero, and carries reported
reasons. Unrecorded slots do not become zero. Malformed mapped reports are
excluded without making the whole workspace unavailable. Existing native PM
model-hour records take precedence over overlapping imported intervals;
different reports are never added as duplicate output for the same model/hour.

This is a read projection: no original production reports, PM hourly records,
WIP, routes or ontology entities are rewritten. Re-upload replacement is visible
on the next hourly read. Opening the hourly view fetches again; the refresh
button fetches immediately, and an open active view refreshes every 30 seconds.
This works even when PM's workspace revision has not changed.

Public reads retain project visibility/password checks. Owner reads use
`public.pm_report_hourly(project_id)` with `auth.uid()` isolation. The internal
source reader and mapping table are not callable/readable by browser roles.
Missing project access returns `401 PROJECT_ACCESS_REQUIRED` with a password
instruction rather than a misleading workspace-outage response.
