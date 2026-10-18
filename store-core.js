// Shared storage rules. Generator effects support synchronous SQLite and asynchronous PostgreSQL.
'use strict';

const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const Projects = require('./projects.js');
const Model = require('./ontology-model.js');
const Ingest = require('./ingestion.js');
const ASSESSMENT_FIELDS = new Set(['power', 'influence', 'currentRole', 'desiredRole', 'currentEngagement', 'desiredEngagement', 'assessmentNote', 'assessedOn']);
const PROJECT_SCHEDULE_FIELDS = new Set(['status', ...Model.DATE_FIELDS.filter((field) => field !== 'assessedOn')]);
const CORE_CHANGE_TABLES = {wip_snapshots:['id'],wip_counts:['id'],hourly_records:['id'], sample_preparation_records:['id'], project_view_settings:['project_id','view_key'],  projects: ['id'], entities: ['id'], project_memberships: ['project_id', 'entity_id'], project_assessments: ['project_id', 'entity_id'], project_schedules: ['project_id', 'entity_id'], project_workstreams: ['project_id', 'entity_id', 'code'], relations: ['id'], entity_changes: ['id'], ingestion_jobs: ['id'] };
const CHANGE_TABLES = { ...CORE_CHANGE_TABLES, wip_snapshots: ['id'], wip_counts: ['id'], staffing_counts: ['id'], production_staffing_counts: ['id'] };

function createStore(db) {
  const read = function* (sql, ...params) {return yield db.prepare(sql).all(...params);};
  const rowKey = (table, row) => JSON.stringify(CHANGE_TABLES[table].map((column) => row[column]));
  function* snapshot() {const result = {};for (const table of Object.keys(CORE_CHANGE_TABLES)) result[table] = yield* read('SELECT * FROM ' + table);return result;}
  function rowDiff(before, after) {
    const rows = [];
    for (const table of Object.keys(before)) {
      const left = new Map(before[table].map((row) => [rowKey(table, row), row]));
      const right = new Map(after[table].map((row) => [rowKey(table, row), row]));
      for (const key of new Set([...left.keys(), ...right.keys()])) {
        const prior = left.get(key) || null,next = right.get(key) || null;
        if (!isDeepStrictEqual(prior, next)) rows.push({ table, key: JSON.parse(key), before: prior, after: next });
      }
    }
    return rows;
  }
  function changeItems(rows, before, after) {
    const entities = new Map([...before.entities, ...after.entities].map((row) => [row.id, JSON.parse(row.data_json)]));
    const name = (id) => entities.get(id)?.name || id;
    const fields = (prior, next) => [...new Set([...Object.keys(prior || {}), ...Object.keys(next || {})])].filter((key) => key !== 'projectId' && !isDeepStrictEqual(prior?.[key], next?.[key])).map((key) => ({ key, before: prior?.[key] ?? null, after: next?.[key] ?? null }));
    const items = [];
    for (const row of rows) {
      if (row.table === 'entity_changes') continue;
      const action = !row.before ? 'Added' : !row.after ? 'Removed' : 'Updated';
      if (row.table === 'entities') {
        const prior = row.before ? JSON.parse(row.before.data_json) : null,next = row.after ? JSON.parse(row.after.data_json) : null,entity = next || prior;
        items.push({ action, label: entity.type + ' · ' + entity.name, fields: row.before && row.after ? fields(prior, next) : [] });
      } else if (row.table === 'relations') {
        const relation = row.after || row.before;
        items.push({ action, label: 'Connection · ' + name(relation.from_id) + ' ' + relation.type + ' ' + name(relation.to_id) });
      } else if (row.table === 'project_memberships') {
        const member = row.after || row.before;
        items.push({ action, label: 'Project selection · ' + name(member.entity_id) });
      } else if (row.table === 'project_workstreams') {
        const lane = row.after || row.before,code = Model.WORKSTREAMS.find((item) => item.code === lane.code)?.label || lane.code;
        items.push({ action, label: 'Workstream · ' + code + ' · ' + name(lane.entity_id) });
      } else if (['project_assessments', 'project_schedules'].includes(row.table)) {
        const record = row.after || row.before,prior = row.before ? JSON.parse(row.before.data_json) : null,next = row.after ? JSON.parse(row.after.data_json) : null;
        items.push({ action, label: (row.table === 'project_assessments' ? 'Stakeholder assessment' : 'Schedule') + ' · ' + name(record.entity_id), fields: fields(prior, next) });
      } else if (row.table === 'projects') {
        const prior = row.before,next = row.after,changed = prior && next ? fields(prior, next).filter((field) => !['id', 'created_at', 'updated_at'].includes(field.key)) : [];
        if (changed.length || !prior || !next) items.push({ action, label: 'Project · ' + (next || prior).name, fields: changed });
      } else if (row.table === 'ingestion_jobs') items.push({ action: 'Saved', label: 'Reviewed AI extraction' });
    }
    return items.length ? items : [{ action: 'Saved', label: 'Project update' }];
  }
  const publicChange = (row) => row ? { id: row.id, scope: row.scope, recordedAt: row.recorded_at, revision: row.revision, items: JSON.parse(row.items_json), acknowledgedAt: row.acknowledged_at, revertedAt: row.reverted_at, revertOf: row.revert_of } : null;
  function* listChanges(scope, offset = 0, date = '') {
    if (scope !== 'library' && !(yield db.prepare('SELECT id FROM projects WHERE id=?').get(scope))) throw Error('Unknown project.');
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid history filter.');
    const rows = scope === 'library' ? yield*
    read("SELECT * FROM change_sets WHERE (?='' OR substr(recorded_at,1,10)=?) ORDER BY rowid DESC LIMIT 51 OFFSET ?", date, date, offset) : yield*
    read("SELECT * FROM change_sets WHERE scope=? AND (?='' OR substr(recorded_at,1,10)=?) ORDER BY rowid DESC LIMIT 51 OFFSET ?", scope, date, date, offset);
    return { changes: rows.slice(0, 50).map(publicChange), more: rows.length > 50 };
  }
  function* pendingChange() {
    return publicChange(yield db.prepare('SELECT * FROM change_sets WHERE acknowledged_at IS NULL AND reverted_at IS NULL AND revert_of IS NULL ORDER BY rowid DESC LIMIT 1').get());
  }
  function* load() {
    const revision = Number((yield db.prepare("SELECT value FROM meta WHERE key='revision'").get()).value);
    const entities = (yield* read('SELECT data_json FROM entities ORDER BY rowid')).map((row) => {const e=JSON.parse(row.data_json);if(e.type==='Event'){e.status||='active';if(e.sourceId||e.id.startsWith('cloud-event-'))delete e.rawLog;}return e;});
    const relations = (yield* read('SELECT data_json,scope_project_id FROM relations ORDER BY rowid')).map((row) => ({ ...JSON.parse(row.data_json), scopeProjectId: row.scope_project_id }));
    const changes = (yield* read('SELECT project_id,data_json FROM entity_changes ORDER BY rowid')).map((row) => ({ scope: row.project_id, change: JSON.parse(row.data_json) }));
    const library = { id: 'library', name: 'Global Library', status: 'active', version: 2, entities: entities.map((e) => ({ ...e, projectId: 'library' })), relations: relations.map((r) => ({ ...r, projectId: 'library' })), changes: changes.filter((c) => !c.scope).map((c) => c.change) };
    const memberships = yield* read('SELECT project_id, entity_id FROM project_memberships');
    const assessments = new Map((yield* read('SELECT project_id,entity_id,data_json FROM project_assessments')).map((row) => [row.project_id + ':' + row.entity_id, JSON.parse(row.data_json)]));
    const schedules = new Map((yield* read('SELECT project_id,entity_id,data_json FROM project_schedules')).map((row) => [row.project_id + ':' + row.entity_id, JSON.parse(row.data_json)]));
    const lanes = yield* read('SELECT project_id,entity_id,code FROM project_workstreams');
    const projects = (yield* read('SELECT * FROM projects ORDER BY rowid')).map((row) => ({
      id: row.id, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, version: 2,
      projectType:row.project_type||null,
      entities: entities.filter((e) => memberships.some((m) => m.project_id === row.id && m.entity_id === e.id)).map((e) => ({ ...e, ...assessments.get(row.id + ':' + e.id), ...schedules.get(row.id + ':' + e.id), projectId: row.id })),
      relations: relations.filter((r) => (!r.scopeProjectId || r.scopeProjectId === row.id) && memberships.some((m) => m.project_id === row.id && m.entity_id === r.from) && memberships.some((m) => m.project_id === row.id && m.entity_id === r.to)).map((r) => ({ ...r, projectId: row.id })),
      changes: changes.filter((c) => (!c.scope || c.scope === row.id) && memberships.some((m) => m.project_id === row.id && m.entity_id === c.change.entityId)).map((c) => c.change),
      workstreams: Object.fromEntries([...new Set(lanes.filter((item) => item.project_id === row.id).map((item) => item.entity_id))].map((id) => [id, lanes.filter((item) => item.project_id === row.id && item.entity_id === id).map((item) => item.code)]))
    }));
    const viewSettings = {};
    for (const row of yield* read('SELECT project_id,view_key,data_json FROM project_view_settings')) {
      (viewSettings[row.project_id] ||= {})[row.view_key] = JSON.parse(row.data_json);
    }
    return { revision, library, projects, viewSettings, pendingChange: yield* pendingChange() };
  }
  function* putSettings(projectId, viewKey, data) {
    if (projectId !== 'library' && !(yield db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))) throw Error('Unknown project.');
    if (!['overview', 'production', 'stakeholders', 'library', 'universalGroups','eventHistory','features','hourlyRates', ...Model.WORKSTREAMS.map((item) => 'lens-' + item.code)].includes(viewKey) || !data || (Array.isArray(data)&&viewKey!=='hourlyRates') || typeof data !== 'object') throw Error('Invalid view settings.');
    const value = JSON.stringify(data);
    if (value.length > 16000) throw Error('View settings exceed 16 KB.');
    yield db.prepare('INSERT INTO project_view_settings(project_id,view_key,data_json) VALUES (?,?,?) ON CONFLICT(project_id,view_key) DO UPDATE SET data_json=excluded.data_json').run(projectId, viewKey, value);
    return data;
  }
  function* exportAll() {
    return {
      format: 'pm-process-twin-local', version: 1, exportedAt: new Date().toISOString(),
      revision: (yield* load()).revision,
      projects: yield* read('SELECT * FROM projects ORDER BY rowid'),
      entities: yield* read('SELECT * FROM entities ORDER BY rowid'),
      relations: yield* read('SELECT * FROM relations ORDER BY rowid'),
      memberships: yield* read('SELECT * FROM project_memberships ORDER BY rowid'),
      assessments: yield* read('SELECT * FROM project_assessments ORDER BY rowid'),
      projectSchedules: yield* read('SELECT * FROM project_schedules ORDER BY rowid'),
      workstreams: yield* read('SELECT * FROM project_workstreams ORDER BY rowid'),
      viewSettings: yield* read('SELECT * FROM project_view_settings ORDER BY rowid'),
      changes: yield* read('SELECT * FROM entity_changes ORDER BY rowid'),
      changeSets: yield* read('SELECT * FROM change_sets ORDER BY rowid'),
      sources: (yield* read('SELECT * FROM sources ORDER BY rowid')).map((row) => ({ ...row, content: Buffer.from(row.content).toString('base64') })),
      ingestionJobs: yield* read('SELECT * FROM ingestion_jobs ORDER BY rowid'),
      wipSnapshots: yield* read('SELECT * FROM wip_snapshots ORDER BY rowid'),
      wipCounts: yield* read('SELECT * FROM wip_counts ORDER BY rowid'),
      staffingCounts: yield* read('SELECT * FROM staffing_counts ORDER BY rowid'),
      hourlyRecords: yield* read('SELECT * FROM hourly_records ORDER BY rowid'),
      samplePreparationRecords: yield* read('SELECT * FROM sample_preparation_records ORDER BY rowid'),
      productionStaffingCounts: yield* read('SELECT * FROM production_staffing_counts ORDER BY rowid')
    };
  }
  function* listWip(projectId, snapshotId = '') {
    if (!(yield db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))) throw Error('Unknown project.');
    const snapshots = (yield* read('SELECT id,captured_at,filename,sheet,created_at FROM wip_snapshots WHERE project_id=? ORDER BY captured_at DESC,created_at DESC LIMIT 100', projectId)).map((row) => ({ id: row.id, capturedAt: row.captured_at, filename: row.filename, sheet: row.sheet, createdAt: row.created_at }));
    const selected = snapshotId || snapshots[0]?.id || '';
    if (selected && !(yield db.prepare('SELECT id FROM wip_snapshots WHERE id=? AND project_id=?').get(selected, projectId))) throw Error('Unknown WIP snapshot.');
    const counts = selected ? (yield* read('SELECT source_row,source_column,product_code,part_label,part_id,stage_label,step_id,quantity FROM wip_counts WHERE snapshot_id=? ORDER BY source_row,source_column', selected)).map((row) => ({ row: row.source_row, column: row.source_column, code: row.product_code, partName: row.part_label, partId: row.part_id || '', stage: row.stage_label, stepId: row.step_id || '', quantity: row.quantity })) : [];
    return { snapshots, selected, counts };
  }
  function* saveWip({ projectId, revision, capturedAt, filename, sheet, rows }) {
    if (revision !== (yield* load()).revision) throw Error('STALE_REVISION');
    const project = (yield* load()).projects.find((item) => item.id === projectId);
    if (!project || project.status === 'archived') throw Error('Open an active project.');
    if (typeof capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) throw Error('Choose snapshot date and time.');
    if (!filename || String(filename).length > 200 || !sheet || String(sheet).length > 120) throw Error('Invalid workbook name or sheet.');
    if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw Error('WIP upload must contain 1–10,000 counts.');
    const members = new Map(project.entities.map((entity) => [entity.id, entity])),seen = new Set();
    for (const row of rows) {
      if (!Number.isInteger(row.row) || row.row < 1 || !Number.isInteger(row.column) || row.column < 1 || !Number.isSafeInteger(row.quantity) || row.quantity < 0 || !String(row.partName || '').trim() || !String(row.stage || '').trim()) throw Error('Invalid WIP count row.');
      const key = row.row + ':' + row.column;if (seen.has(key)) throw Error('Duplicate worksheet cell.');seen.add(key);
      if (row.partId && !['Part', 'Part Revision'].includes(members.get(row.partId)?.type)) throw Error('Part mapping must select a project Part.');
      if (row.stepId) {
        if (!row.partId || members.get(row.stepId)?.type !== 'Production Step' || !project.relations.some((relation) => ['applies_to', 'produces'].includes(relation.type) && relation.from === row.stepId && relation.to === row.partId)) throw Error('Step mapping must belong to the selected Part.');
      }
    }
    const id = 'wip-' + randomUUID(),now = new Date().toISOString();
    yield db.exec('BEGIN IMMEDIATE');
    try {
      const inserted = [];
      const snap = { id, project_id: projectId, captured_at: capturedAt, filename: String(filename), sheet: String(sheet), created_at: now };
      yield db.prepare('INSERT INTO wip_snapshots(id,project_id,captured_at,filename,sheet,created_at) VALUES (?,?,?,?,?,?)').run(...Object.values(snap));
      inserted.push({ table: 'wip_snapshots', key: [id], before: null, after: snap });
      const statement = db.prepare('INSERT INTO wip_counts(id,snapshot_id,source_row,source_column,product_code,part_label,part_id,stage_label,step_id,quantity) VALUES (?,?,?,?,?,?,?,?,?,?)');
      for (const row of rows) {
        const count = { id: 'count-' + randomUUID(), snapshot_id: id, source_row: row.row, source_column: row.column, product_code: String(row.code || ''), part_label: String(row.partName).trim(), part_id: row.partId || null, stage_label: String(row.stage).trim(), step_id: row.stepId || null, quantity: row.quantity };
        yield statement.run(...Object.values(count));inserted.push({ table: 'wip_counts', key: [count.id], before: null, after: count });
      }
      yield db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(String(revision + 1));
      yield db.prepare('UPDATE change_sets SET acknowledged_at=? WHERE acknowledged_at IS NULL AND reverted_at IS NULL AND revert_of IS NULL').run(now);
      yield db.prepare('INSERT INTO change_sets(id,scope,recorded_at,revision,items_json,rows_json,acknowledged_at,reverted_at,revert_of) VALUES (?,?,?,?,?,?,NULL,NULL,NULL)').run('change-' + randomUUID(), projectId, now, revision + 1, JSON.stringify([{ action: 'Imported', label: 'WIP · ' + filename + ' · ' + rows.length + ' counts' }]), JSON.stringify(inserted));
      yield db.exec('COMMIT');
    } catch (error) {yield db.exec('ROLLBACK');throw error;}
    return yield* load();
  }
  function* listStaffing(projectId) {
    if (!(yield db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))) throw Error('Unknown project.');
    return (yield* read('SELECT * FROM staffing_counts WHERE project_id=? ORDER BY captured_at DESC,created_at DESC LIMIT 200', projectId)).map((row) => ({ id: row.id, partId: row.part_id, capturedAt: row.captured_at, shift: row.shift, basis: row.basis, count: row.count, note: row.note }));
  }
  function* saveStaffing({ projectId, revision, partId, count, capturedAt, shift = '', basis = 'observed', note = '' }) {
    if (revision !== (yield* load()).revision) throw Error('STALE_REVISION');
    const project = (yield* load()).projects.find((item) => item.id === projectId);
    if (!project || project.status === 'archived') throw Error('Open an active project.');
    if (!project.entities.some((item) => item.id === partId && ['Part', 'Part Revision'].includes(item.type))) throw Error('Choose a project Part.');
    if (!Number.isSafeInteger(count) || count < 0 || count > 100000) throw Error('Worker count must be a non-negative whole number.');
    if (typeof capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) throw Error('Choose snapshot date and time.');
    if (!['observed', 'planned'].includes(basis) || String(shift).length > 40 || String(note).length > 1000) throw Error('Invalid worker count details.');
    const row = { id: 'staff-' + randomUUID(), project_id: projectId, part_id: partId, captured_at: capturedAt, shift: String(shift), basis, count, note: String(note), created_at: new Date().toISOString() };
    yield db.exec('BEGIN IMMEDIATE');
    try {
      yield db.prepare('INSERT INTO staffing_counts(id,project_id,part_id,captured_at,shift,basis,count,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
      yield db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(String(revision + 1));
      yield db.prepare('UPDATE change_sets SET acknowledged_at=? WHERE acknowledged_at IS NULL AND reverted_at IS NULL AND revert_of IS NULL').run(row.created_at);
      yield db.prepare('INSERT INTO change_sets(id,scope,recorded_at,revision,items_json,rows_json,acknowledged_at,reverted_at,revert_of) VALUES (?,?,?,?,?,?,NULL,NULL,NULL)').run('change-' + randomUUID(), projectId, row.created_at, revision + 1, JSON.stringify([{ action: 'Recorded', label: 'Workers · ' + project.entities.find((item) => item.id === partId).name + ' · ' + count + ' ' + basis }]), JSON.stringify([{ table: 'staffing_counts', key: [row.id], before: null, after: row }]));
      yield db.exec('COMMIT');
    } catch (error) {yield db.exec('ROLLBACK');throw error;}
    return yield* load();
  }
  function* listProductionStaffing(projectId) {
    if (!(yield db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))) throw Error('Unknown project.');
    return (yield* read('SELECT * FROM production_staffing_counts WHERE project_id=? ORDER BY captured_at DESC,created_at DESC LIMIT 500', projectId)).map((row) => ({ id: row.id, targetId: row.target_id, targetType: row.target_type, capturedAt: row.captured_at, shift: row.shift, basis: row.basis, count: row.count, note: row.note }));
  }
  function* saveProductionStaffing({ projectId, revision, targetId, targetType, count, capturedAt, shift = '', basis = 'observed', note = '' }) {
    if (revision !== (yield* load()).revision) throw Error('STALE_REVISION');
    const project = (yield* load()).projects.find((item) => item.id === projectId);
    if (!project || project.status === 'archived') throw Error('Open an active project.');
    const target = project.entities.find((item) => item.id === targetId);
    if (!['Production Step', 'Resource'].includes(targetType) || target?.type !== targetType) throw Error('Choose a project Production Step or Resource.');
    if (!Number.isSafeInteger(count) || count < 0 || count > 100000) throw Error('Worker count must be a non-negative whole number.');
    if (typeof capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) throw Error('Choose observation date and time.');
    if (!['observed', 'planned'].includes(basis) || String(shift).length > 40 || String(note).length > 1000) throw Error('Invalid worker count details.');
    const row = { id: 'prod-staff-' + randomUUID(), project_id: projectId, target_id: targetId, target_type: targetType, captured_at: capturedAt, shift: String(shift), basis, count, note: String(note), created_at: new Date().toISOString() };
    yield db.exec('BEGIN IMMEDIATE');
    try {
      yield db.prepare('INSERT INTO production_staffing_counts(id,project_id,target_id,target_type,captured_at,shift,basis,count,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
      yield db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(String(revision + 1));
      yield db.prepare('UPDATE change_sets SET acknowledged_at=? WHERE acknowledged_at IS NULL AND reverted_at IS NULL AND revert_of IS NULL').run(row.created_at);
      yield db.prepare('INSERT INTO change_sets(id,scope,recorded_at,revision,items_json,rows_json,acknowledged_at,reverted_at,revert_of) VALUES (?,?,?,?,?,?,NULL,NULL,NULL)').run('change-' + randomUUID(), projectId, row.created_at, revision + 1, JSON.stringify([{ action: 'Recorded', label: 'Production workers · ' + target.name + ' · ' + count + ' ' + basis }]), JSON.stringify([{ table: 'production_staffing_counts', key: [row.id], before: null, after: row }]));
      yield db.exec('COMMIT');
    } catch (error) {yield db.exec('ROLLBACK');throw error;}
    return yield* load();
  }
  function* saveIngestion({ filename, mimeType, content, draft, scope }) {
    const sourceId = 'source-' + randomUUID(),jobId = 'job-' + randomUUID(),now = new Date().toISOString();
    yield db.exec('BEGIN IMMEDIATE');
    try {
      yield db.prepare('INSERT INTO sources(id,kind,filename,mime_type,content,created_at) VALUES (?,?,?,?,?,?)').run(sourceId, mimeType === 'application/pdf' ? 'file' : 'text', filename, mimeType, content, now);
      yield db.prepare('INSERT INTO ingestion_jobs(id,source_id,status,draft_json,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(jobId, sourceId, 'ready_for_review', JSON.stringify({ scope, draft }), now, now);
      yield db.exec('COMMIT');
    } catch (error) {yield db.exec('ROLLBACK');throw error;}
    return { source: { sourceId, filename, mimeType, size: content.length }, jobId, draft };
  }
  function* save(next, scope, revision, ingestionCommit = null) {
    const previous = yield* load();
    if (revision !== previous.revision) throw Error('STALE_REVISION');
    Projects.validateWorkspace({ version: 2, projects: next.projects });
    const active = scope === 'library' ? next.library : next.projects.find((p) => p.id === scope);
    if (scope && !active) throw Error('Unknown save scope.');
    if (active) Projects.validate(active);
    const projectIds = new Set(next.projects.map((p) => p.id));
    if (previous.projects.some((p) => !projectIds.has(p.id))) throw Error('Project deletion is not supported.');
    for (const project of next.projects) {
      const before = previous.projects.find((p) => p.id === project.id);
      if (!before) {
        if (scope !== null) throw Error('Project creation is outside the save scope.');
        continue;
      }
      if (project.id !== scope && ['name', 'status', 'createdAt', 'updatedAt'].some((key) => project[key] !== before[key])) throw Error('Project metadata changed outside the save scope.');
      if (project.id === scope && (before.status === 'archived' || project.status === 'archived') &&
      !isDeepStrictEqual([project.entities, project.relations, project.changes || [], project.workstreams || {}], [before.entities, before.relations, before.changes || [], before.workstreams || {}])) throw Error('Archived project is read only.');
    }
    if (scope === 'library') {
      const ids = new Set(active.entities.map((e) => e.id));
      if (previous.library.entities.some((e) => !ids.has(e.id))) throw Error('Global deletion requires impact review.');
    }
    if (active && scope !== 'library') {
      const memberIds = new Set(active.entities.map((entity) => entity.id));
      const codes = new Set(Model.WORKSTREAMS.map((item) => item.code));
      for (const [entityId, selected] of Object.entries(active.workstreams || {})) {
        if (!memberIds.has(entityId) || !Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some((code) => !codes.has(code))) throw Error('Invalid workstream membership.');
      }
    }
    yield db.exec('BEGIN IMMEDIATE');
    try {
      const beforeRows = yield* snapshot();
      let reviewedJob = null;
      if (ingestionCommit) {
        const { jobId, selectedIds, draft } = ingestionCommit;
        const row = yield db.prepare('SELECT status,draft_json FROM ingestion_jobs WHERE id=?').get(jobId);
        if (!row) throw Error('Ingestion job not found.');
        if (row.status !== 'ready_for_review') throw Error('Ingestion job already committed.');
        const saved = JSON.parse(row.draft_json);
        if (saved.scope !== scope) throw Error('Ingestion job belongs to another scope.');
        const allowed = new Set([...(saved.draft.objects || []), ...(saved.draft.relationships || [])].map((item) => item.candidateId));
        if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !allowed.has(id))) throw Error('Invalid selected candidate IDs.');
        const checked = Ingest.validateDraft(previous.library, draft);
        if (checked.errors.length) throw Error('Invalid reviewed AI draft: ' + checked.errors.join(' '));
        const reviewedIds = new Set([...checked.objects, ...checked.relationships].map((item) => item.candidateId));
        if (reviewedIds.size !== allowed.size || [...allowed].some((id) => !reviewedIds.has(id))) throw Error('Reviewed AI candidate IDs changed.');
        reviewedJob = { jobId, saved, selectedIds, draft: checked };
      }
      const known = new Set((yield* read('SELECT id FROM projects')).map((row) => row.id));
      for (const project of next.projects) {
        if (project.id !== scope && previous.projects.some((p) => p.id === project.id)) continue;
        if (known.has(project.id)) {
          yield db.prepare('UPDATE projects SET name=?, status=?, updated_at=?, project_type=? WHERE id=?').run(project.name, project.status, project.updatedAt || new Date().toISOString(), project.projectType||null, project.id);
        } else {
          const now = new Date().toISOString();
          yield db.prepare('INSERT INTO projects(id,name,status,created_at,updated_at,project_type) VALUES (?,?,?,?,?,?)').run(project.id, project.name, project.status, project.createdAt || now, project.updatedAt || now, project.projectType||null);
        }
      }
      if (active) {
        const upsert = db.prepare('INSERT INTO entities(id,type,data_json) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,data_json=excluded.data_json');
        const member = db.prepare('INSERT OR IGNORE INTO project_memberships(project_id,entity_id) VALUES (?,?)');
        const assessmentUpsert = db.prepare('INSERT INTO project_assessments(project_id,entity_id,data_json) VALUES (?,?,?) ON CONFLICT(project_id,entity_id) DO UPDATE SET data_json=excluded.data_json');
        const assessmentDelete = db.prepare('DELETE FROM project_assessments WHERE project_id=? AND entity_id=?');
        const scheduleUpsert = db.prepare('INSERT INTO project_schedules(project_id,entity_id,data_json) VALUES (?,?,?) ON CONFLICT(project_id,entity_id) DO UPDATE SET data_json=excluded.data_json');
        const scheduleDelete = db.prepare('DELETE FROM project_schedules WHERE project_id=? AND entity_id=?');
        for (const item of active.entities) {
          const entity = {},assessment = {},schedule = {};
          const prior = yield db.prepare('SELECT type,data_json FROM entities WHERE id=?').get(item.id);
          for (const [key, value] of Object.entries(item)) {
            if (key === 'projectId') continue;
            if (ASSESSMENT_FIELDS.has(key)) {if (value !== '' && value != null) assessment[key] = value;} else
            if (scope !== 'library' && item.type === 'Production Step' && PROJECT_SCHEDULE_FIELDS.has(key)) {if (value !== '' && value != null) schedule[key] = value;} else
            entity[key] = value;
          }
          if (scope === 'library' && item.type === 'Production Step' && [...PROJECT_SCHEDULE_FIELDS].some((key) => key !== 'status' && item[key])) throw Error('Production Step dates belong to a project.');
          if (scope !== 'library' && item.type === 'Production Step') entity.status = prior ? JSON.parse(prior.data_json).status : 'active';
          if (scope === 'library' && Object.keys(assessment).length) throw Error('Stakeholder assessment needs a project.');
          if (Object.keys(assessment).length && !['Person', 'Organization'].includes(entity.type)) throw Error('Assessment target must be a stakeholder.');
          if (prior && prior.type !== entity.type) throw Error('Canonical object type cannot change.');
          if (scope !== 'library' && prior) {
            const wasMember = previous.projects.find((p) => p.id === scope)?.entities.some((e) => e.id === entity.id);
            if (!wasMember && !isDeepStrictEqual(entity, JSON.parse(prior.data_json))) throw Error('Attached object conflicts with global facts; choose the existing Library object.');
            if (Model.PROJECT_OWNED_TYPES.has(entity.type) && previous.projects.some((p) => p.id !== scope && p.entities.some((e) => e.id === entity.id))) throw Error('This project-owned object already belongs to another project.');
          }
          yield upsert.run(entity.id, entity.type, JSON.stringify(entity));
          if (scope !== 'library') {
            yield member.run(scope, entity.id);
            if (Object.keys(assessment).length) yield assessmentUpsert.run(scope, entity.id, JSON.stringify(assessment));else
            yield assessmentDelete.run(scope, entity.id);
            if (entity.type === 'Production Step') {
              if (schedule.status === entity.status) delete schedule.status;
              if (Object.keys(schedule).length) yield scheduleUpsert.run(scope, entity.id, JSON.stringify(schedule));else
              yield scheduleDelete.run(scope, entity.id);
            }
          }
        }
        const relationUpsert = db.prepare('INSERT INTO relations(id,type,from_id,to_id,scope_project_id,data_json) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,from_id=excluded.from_id,to_id=excluded.to_id,scope_project_id=excluded.scope_project_id,data_json=excluded.data_json');
        for (const item of active.relations) {
          const { projectId, ...relation } = item;
          const old = yield db.prepare('SELECT scope_project_id,data_json FROM relations WHERE id=?').get(relation.id);
          const scopeProjectId = old ? old.scope_project_id : Object.hasOwn(relation, 'scopeProjectId') ? relation.scopeProjectId : Model.defaultRelationScope(active, relation, scope);
          if (scopeProjectId && scopeProjectId !== scope) {
            if (scope !== 'library' || !old) throw Error('Relationship belongs to another project.');
          }
          if (scope === 'library' && scopeProjectId && old) continue;
          relation.scopeProjectId = scopeProjectId;
          if (scope !== 'library' && old && !old.scope_project_id && !isDeepStrictEqual(relation, JSON.parse(old.data_json))) throw Error('Global relationship must be edited in Library.');
          yield relationUpsert.run(relation.id, relation.type, relation.from, relation.to, scopeProjectId, JSON.stringify(relation));
        }
        for (const change of active.changes || []) {
          if (yield db.prepare('SELECT id FROM entity_changes WHERE id=?').get(change.id)) continue;
          const fields = new Set([...Object.keys(change.before || {}), ...Object.keys(change.after || {})]);
          const altered = [...fields].filter((key) => JSON.stringify(change.before?.[key]) !== JSON.stringify(change.after?.[key]));
          const privateChange = altered.some((key) => ASSESSMENT_FIELDS.has(key) || active.entities.find((e) => e.id === change.entityId)?.type === 'Production Step' && PROJECT_SCHEDULE_FIELDS.has(key));
          const changeScope = privateChange && scope !== 'library' ? scope : null;
          yield db.prepare('INSERT INTO entity_changes(id,entity_id,project_id,data_json) VALUES (?,?,?,?)').run(change.id, change.entityId, changeScope, JSON.stringify(change));
        }
        const previousGraph = scope === 'library' ? previous.library : previous.projects.find((p) => p.id === scope);
        const incomingRelationIds = new Set(active.relations.map((r) => r.id));
        const incomingEntityIds = new Set(active.entities.map((e) => e.id));
        for (const relation of previousGraph?.relations || []) {
          if (incomingRelationIds.has(relation.id)) continue;
          if (scope === 'library' && relation.scopeProjectId) continue;
          if (relation.scopeProjectId === scope || incomingEntityIds.has(relation.from) && incomingEntityIds.has(relation.to)) {
            yield db.prepare('DELETE FROM relations WHERE id=?').run(relation.id);
          }
        }
        if (scope !== 'library') {
          for (const row of yield* read('SELECT entity_id FROM project_memberships WHERE project_id=?', scope)) {
            if (incomingEntityIds.has(row.entity_id)) continue;
            yield db.prepare('DELETE FROM relations WHERE scope_project_id=? AND (from_id=? OR to_id=?)').run(scope, row.entity_id, row.entity_id);
            yield assessmentDelete.run(scope, row.entity_id);
            yield scheduleDelete.run(scope, row.entity_id);
            yield db.prepare('DELETE FROM project_workstreams WHERE project_id=? AND entity_id=?').run(scope, row.entity_id);
            yield db.prepare('DELETE FROM project_memberships WHERE project_id=? AND entity_id=?').run(scope, row.entity_id);
          }
          yield db.prepare('DELETE FROM project_workstreams WHERE project_id=?').run(scope);
          const laneInsert = db.prepare('INSERT INTO project_workstreams(project_id,entity_id,code) VALUES (?,?,?)');
          for (const [entityId, codes] of Object.entries(active.workstreams || {})) for (const code of codes) yield laneInsert.run(scope, entityId, code);
        }
      }
      if (reviewedJob) {
        const now = new Date().toISOString();
        const content = { ...reviewedJob.saved, reviewedDraft: reviewedJob.draft, selectedIds: reviewedJob.selectedIds, committedAt: now };
        yield db.prepare('UPDATE ingestion_jobs SET status=?,draft_json=?,updated_at=? WHERE id=?').run('committed', JSON.stringify(content), now, reviewedJob.jobId);
      }
      yield db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(String(revision + 1));
      const afterRows = yield* snapshot(),rows = rowDiff(beforeRows, afterRows);
      if (rows.length) {
        const now = new Date().toISOString();
        yield db.prepare('UPDATE change_sets SET acknowledged_at=? WHERE acknowledged_at IS NULL AND reverted_at IS NULL AND revert_of IS NULL').run(now);
        const newProject = next.projects.find((project) => !previous.projects.some((old) => old.id === project.id));
        yield db.prepare('INSERT INTO change_sets(id,scope,recorded_at,revision,items_json,rows_json,acknowledged_at,reverted_at,revert_of) VALUES (?,?,?,?,?,?,NULL,NULL,NULL)').run('change-' + randomUUID(), scope || newProject?.id || null, now, revision + 1, JSON.stringify(changeItems(rows, beforeRows, afterRows)), JSON.stringify(rows));
      }
      yield db.exec('COMMIT');
    } catch (error) {yield db.exec('ROLLBACK');throw error;}
    return yield* load();
  }
  function* keepChange(id) {
    const current = yield* pendingChange();
    if (!current || current.id !== id) throw Error('Change already reviewed or no longer latest.');
    yield db.prepare('UPDATE change_sets SET acknowledged_at=? WHERE id=?').run(new Date().toISOString(), id);
    return yield* load();
  }
  function* revertChange(id, revision) {
    const row = yield db.prepare('SELECT * FROM change_sets WHERE id=?').get(id);
    if (!row) throw Error('Change not found.');
    if (row.acknowledged_at || row.reverted_at) throw Error('Change already reviewed or reverted.');
    if (row.revision !== revision || (yield* load()).revision !== revision || (yield* pendingChange())?.id !== id) throw Error('Only the latest saved change can be reverted. Reload and review current data.');
    const rows = JSON.parse(row.rows_json),now = new Date().toISOString();
    yield db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of rows) {
        const where = CHANGE_TABLES[item.table].map((column) => column + '=?').join(' AND ');
        const current = (yield db.prepare('SELECT * FROM ' + item.table + ' WHERE ' + where).get(...item.key)) || null;
        if (!isDeepStrictEqual(current ? { ...current } : null, item.after)) throw Error('Saved data changed after this update. Reload before reverting.');
      }
      yield db.exec('PRAGMA defer_foreign_keys=ON');
      for (const item of rows) {
        const where = CHANGE_TABLES[item.table].map((column) => column + '=?').join(' AND ');
        if (item.after) yield db.prepare('DELETE FROM ' + item.table + ' WHERE ' + where).run(...item.key);
      }
      for (const item of rows) {
        if (!item.before) continue;
        const columns = Object.keys(item.before);
        yield db.prepare('INSERT INTO ' + item.table + '(' + columns.join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')').run(...columns.map((column) => item.before[column]));
      }
      yield db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(String(revision + 1));
      yield db.prepare('UPDATE change_sets SET acknowledged_at=?,reverted_at=? WHERE id=?').run(now, now, id);
      yield db.prepare('INSERT INTO change_sets(id,scope,recorded_at,revision,items_json,rows_json,acknowledged_at,reverted_at,revert_of) VALUES (?,?,?,?,?,?,?,?,?)').run('change-' + randomUUID(), row.scope, now, revision + 1, JSON.stringify([{ action: 'Reverted', label: 'Saved change from ' + row.recorded_at, fields: [] }]), JSON.stringify(rows.map((item) => ({ ...item, before: item.after, after: item.before }))), now, null, id);
      yield db.exec('COMMIT');
    } catch (error) {yield db.exec('ROLLBACK');throw error;}
    return yield* load();
  }
  return { ...require('./production-store')({db,load,read,snapshot,rowDiff,putSettings}), load, save, putSettings, exportAll, saveIngestion, listChanges, listWip, saveWip, listStaffing, saveStaffing, listProductionStaffing, saveProductionStaffing, keepChange, revertChange, close: function* () {return yield db.close();} };
}

module.exports = { createStore, ASSESSMENT_FIELDS, PROJECT_SCHEDULE_FIELDS };
