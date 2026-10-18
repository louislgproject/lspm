# Louis Kim LGLS

Production application: **https://louiscxcix.github.io/lspm/**. GitHub owns application code and deployment; Supabase owns projects, ontology, History, Progress, hourly production, access settings, source originals and collection checkpoints. A local PM database is not an operational source or fallback.

Only read-only Kakao collection runs on the Mac. Run `node kakao-cloud.js collect` to obtain cursors from Supabase and retain new originals directly there. Review the private temporary context and use `node kakao-cloud.js review review.json` for a source-backed, atomic cloud History commit. See [cloud-authoritative collection](docs/supabase-publisher.md). The existing publisher credential remains private; routine runs do not open the retired PM database.

Changes to `main` use the existing GitHub Actions deployment. `Verify cloud authority and archive retired local data` verifies direct collection/review and preserves the final local audit/source rows privately without replacing online edits. The old Firebase site contains only a route-preserving redirect; Firestore and Firebase Auth are not application dependencies.

## Archived local development documentation

The material below documents the former offline application for recovery and development only. Do not run its local server, importers or database publisher as a production workflow. Existing local files are retained, not deleted.

Historically, one local SQLite database held the ontology objects and projects were saved selections of those objects. The original local and Firebase data have since been retained in private Supabase archives; current application records are in Supabase. Never import a blank or old local snapshot over the live workspace.

## Start

Use Node.js 24 LTS (validated with 24.19.0), with built-in `node:sqlite`.

```bash
cd "/Users/louis/Desktop/lg/mex/ontology-app"
npm ci
node server.js
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). The server listens only on this computer. The SQLite file is `../.local-data/ontology.sqlite`, outside the served web directory. Back up that file while the server is stopped, or use **Export all data** for a versioned JSON snapshot. Export includes retained source bytes; treat it as confidential. The JSON export is not yet an automated restore/import format. Opening `index.html` directly or running a static-only server will not save data.

On macOS, double-click [start-local.command](./start-local.command) to start the server and open the app. Opening `index.html` redirects to the local URL if the server is already running. If it is not running, use the launcher; a web page cannot start a local SQLite server by itself.

If the local server is offline, launch it again and reload the local URL. The old Firebase site cannot access this SQLite API.

Optional port or database path:

```bash
PORT=4180 PM_DB_PATH="/absolute/private/path/ontology.sqlite" node server.js
```

Do not point `PM_DB_PATH` at an old Firestore export or any file you need to preserve. The server creates a new SQLite database at the specified path when it does not exist.

## Work with the ontology

1. Open **Global Library** to create People, Organizations, Parts, machines/Resources, Production Steps, and other objects once.
2. Create or open a project. Its entry menu offers **See whole process** (map + Gantt) or six focused workstream maps: Commercial/Customer, Product Engineering, Suppliers/Purchasing, Production, Quality/APQP, and Logistics. Focused maps show explicitly assigned objects plus directly connected context; outlined work nodes belong to another stream. Click **Project menu** to switch views.
3. **Add from Library** selects shared objects for a project. You can optionally preview and include a Part’s connected production route. Adding an object from within a project creates it in the same global database and links it to that project. In the object form, select every applicable **Project workstream**. Existing unclassified objects appear under **Unassigned objects** on the entry menu; they remain visible in the whole-process view until classified.
4. Project process/production maps, Gantt, stakeholder views, and detail panels show that project’s selected objects and applicable relationships. Production uses one continuous graph for all selected Parts: a shared Step ID appears once, while unrelated steps remain separate even if their names match. Choose several Parts, optionally highlight one route without hiding the others, zoom 15–200%, and click an activity to inspect its Parts, equipment, people, and evidence. Blue arrows mean recorded order, red dashed arrows a recorded problem branch, and dashed activity borders mean order is unconfirmed; absent arrows are never invented. This is a process-flow view, not a factory floor plan or live machine-status system. Filters, Part selection, highlight, number mode, and zoom persist per project/view. The Library’s all-ontology map shows the whole database.
5. A shared object’s canonical name and technical facts are edited once and appear in every project that selects it. Stakeholder power/influence and engagement assessments stay project-specific. A reusable Production Step has project-specific status and dates; set those inside a project, not in Library. Project Work Items and gates use separate IDs; they are not silently shared across projects.
6. **Remove from project** unlinks the object there; it does not delete the global object or another project’s link. Archiving a project makes its graph read-only.

Set **Production family** on a Part or Part Revision to group routes and the Part picker (for example LDM, Nexlide, or TEM). Existing Parts remain **Unclassified** until confirmed. A family label is not a physical line location and does not create a production sequence.

Products and Components share Part identity, distinguished by **Item kind (P/C)**. Add product family, RH/LH and Upper/Lower when known. Link individual inputs/outputs with **consumes / produces**, including quantity, basis, product route and evidence. **See Machines / See Components** default on in Production and the main process map; their subdued nodes sit beside the prominent normal route. Each Router output is a separate Component, never a bundled text label. The LS project's G65 RH sample shows five output types totaling nine physical pieces per input plate; this is theoretical yield, not a WIP count. [Production ontology and current limits](docs/production-components-design-draft.md) records the reviewed structure and unresolved facts.

**Production → Process logs** (or **Add process logs**) retains pasted source text, previews temporary CSV/Excel-pasted rows, lets you select/edit operation matches and timestamps, and saves reviewed Events to SQLite. Unknown formats can be saved raw for later mapping. **Show numbers → Pending time** displays the median measured arrival-to-start interval for the same Part/serial or batch; absent arrival can fall back to an explicitly adjacent previous-completion-to-start gap. No log pair means `— pending`, not a guessed time. Source text, event IDs and calculation basis stay inspectable; scans do not crowd the project map/Gantt. Saves append and support the normal change-review/revert flow. Exact vendor formats, automatic free-text extraction, open waiting clocks and component/lot split-merge tracing are not implemented yet.

Under **Production → WIP snapshots** or **Add Excel data**, upload an actual MES `.xlsx` workbook, review product rows, process columns, Part links and Part-specific Step links, then save a dated snapshot. The photographed `IMG_3898` and `IMG_3899` sheets are examples of TEM/Nexlide source families, not imported workbooks. Blank cells stay unknown; zero is a recorded zero. Unmatched Part/step labels stay raw without a fabricated ontology link. Normalized counts—not the original workbook bytes—are stored in SQLite and exported. Uploads never replace earlier snapshots. **Show numbers → Parts** displays linked units at each Step from the latest dated WIP snapshot; selected Parts are summed only where that exact Step/Part mapping exists. **Workers** displays the latest direct Step observation, or the observation for its one linked machine if no Step observation exists; it never totals named stakeholders or shared staff. The historical snapshot picker lives only in the WIP tab and does not change the map. Click a Step for its count source and visible route Parts. On a Resource, use **Machine use** to distinguish a shared family/pool from a specific asset, then link its Production Step with `requires`. Unknown asset IDs remain unknown.

Each manual save, approved CSV batch, reviewed AI update, or project edit is committed to SQLite immediately. The **Review this change** panel then shows what changed. **Continue** acknowledges it; **Revert this save** undoes only that latest unacknowledged database transaction. A later save makes an older one history-only, not an arbitrary multi-step undo. **View change history** lists new saves by date, including acknowledged and reverted saves. The Library's History shows changes from every project; a project's History shows saves made from that project. History begins with this feature; earlier records are not fabricated. View settings save separately and are not included in change-set undo.

Input offers manual add, CSV append, and optional AI extraction. A same-name object requires an explicit reuse/separate choice. CSV previews all rows and requires row-level choices for global ID/name collisions; invalid batches save nothing. Relationship CSV accepts supported aliases and resolves unique names, but endpoints must already belong to the open project. Import objects or link Library objects first. Limits: 1,000 CSV rows and 2 MB per batch. Global deletion is intentionally unavailable until it has an impact review.

AI extraction is off unless `GEMINI_API_KEY` is set on the local server. With a key, pressing **Extract draft** sends only the selected text or file to Gemini; it does **not** send the whole ontology. Review object matches, relationships, and any unresolved facts before pressing **Update ontology**. Accepted changes and their local ingestion record commit in one database transaction. Work notes may be confidential; obtain permission before sending them to an external AI provider. The implementation uses Google's [Gemini 3.8 Flash generateContent API and JSON output format](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

```bash
GEMINI_API_KEY="your-key" node server.js
```

The API key remains in the server environment; do not put it in the browser, a checked-in file, or the database. Without a key, manual and CSV input still work offline. A live AI extraction has not been verified without your key.

## Check

```bash
cd "/Users/louis/Desktop/lg/mex/ontology-app"
node test.js
node --test local-store.test.js server.test.js
node --test wip.test.js
node --test components.test.js production-logs.test.js
node --test browser-smoke.test.js  # optional; requires Google Chrome on macOS
```

The older `firebase-store.js`, Firebase config, and cloud workspace code remain in this directory for now but are **not loaded** by the local app. No Firebase deployment is part of this local workflow.
