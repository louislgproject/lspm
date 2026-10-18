(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OntologyModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ENTITY_TYPES = [
    "Project", "Build", "Part Revision", "Work Item", "Production Step", "Gate", "Deliverable", "Characteristic",
    "Person", "Organization", "Assignment", "Event", "Evidence", "Part", "Requirement", "Risk", "Issue", "Resource", "Decision"
  ];

  const RELATION_TYPES = [
    "reported_by", "operated_in", "supports_line", "member_of", "reports_via", "escalates_to", "works_on", "stored_at", "receives_from", "transfers_to", "manages", "scopes", "applies_to", "precedes", "assigned_to", "assignment_scope", "satisfies", "verifies", "characteristic_of", "controls", "approved_by", "blocks", "supersedes", "required_for", "apqp_input_to",
    "supplies", "works_at", "reports_to", "part_of", "consumes", "produces", "condition_target", "records_on", "supported_by", "potentially_affects", "requires", "mitigates", "resolves", "revision_of", "changes", "influences", "governs", "on_failure", "rework_of", "qualified_for"
  ];
  const PROJECT_OWNED_TYPES = new Set(["Build", "Work Item", "Gate", "Deliverable", "Assignment", "Event", "Evidence", "Risk", "Issue", "Decision"]);
  const WORKSTREAMS = [
    {code:'commercial',label:'Commercial / Customer'},
    {code:'engineering',label:'Product Engineering'},
    {code:'purchasing',label:'Suppliers / Purchasing'},
    {code:'production',label:'Production'},
    {code:'quality',label:'Quality / APQP'},
    {code:'logistics',label:'Logistics'}
  ];

  RELATION_TYPES.push('performed_by','requested_from','follows_up');
  const RULES = {
    performed_by: [['Event','Person'],['Event','Organization']],
    requested_from: [['Event','Person'],['Event','Organization']],
    follows_up: [['Event','Event']],
    reported_by: [["Event","Person"]],
    operated_in: [["Production Step","Resource"]],
    supports_line: [["Organization","Resource"]],
    member_of: [["Person","Organization"]],
    reports_via: [["Person","Organization"]],
    escalates_to: [["Resource","Organization"],["Organization","Organization"],["Organization","Person"]],
    works_on: [["Person","Resource"]],
    stored_at: [["Part","Resource"],["Part Revision","Resource"]],
    receives_from: [["Resource","Organization"],["Resource","Resource"]],
    transfers_to: [["Resource","Production Step"],["Production Step","Resource"],["Resource","Resource"]],
    manages: [["Person","Resource"]],
    satisfies: [["Deliverable","Requirement"],["Evidence","Requirement"]],
    verifies: [["Evidence","Requirement"],["Evidence","Characteristic"],["Deliverable","Requirement"],["Deliverable","Characteristic"]],
    characteristic_of: [["Characteristic","Part Revision"],["Characteristic","Part"]],
    controls: [["Deliverable","Characteristic"],["Work Item","Characteristic"],["Production Step","Characteristic"]],
    approved_by: [["Deliverable","Person"],["Deliverable","Organization"],["Gate","Person"],["Gate","Organization"],["Decision","Person"],["Decision","Organization"]],
    blocks: [["Issue","Gate"],["Risk","Gate"],["Deliverable","Gate"]],
    supersedes: [["Part Revision","Part Revision"],["Deliverable","Deliverable"],["Requirement","Requirement"]],
    required_for: [["Deliverable","Gate"],["Evidence","Gate"],["Requirement","Gate"]],
    apqp_input_to: [["Deliverable","Work Item"],["Deliverable","Gate"],["Deliverable","Deliverable"]],
    influences: ["Person","Organization"].flatMap(source => ["Person","Organization","Risk","Issue","Work Item","Production Step","Gate","Deliverable","Part","Part Revision"].map(target => [source,target])),
    governs: ["Person","Organization"].flatMap(source => ["Work Item","Production Step","Gate","Deliverable","Part","Part Revision"].map(target => [source,target])),
    on_failure: [["Work Item", "Work Item"], ["Gate", "Work Item"], ["Production Step", "Production Step"], ["Gate", "Production Step"]],
    rework_of: [["Work Item", "Work Item"], ["Production Step", "Production Step"]],
    potentially_affects: [["Risk", "Work Item"], ["Issue", "Work Item"], ["Risk", "Production Step"], ["Issue", "Production Step"], ["Risk", "Gate"], ["Issue", "Gate"], ["Risk", "Part Revision"], ["Issue", "Part Revision"]],
    requires: [["Work Item", "Resource"], ["Production Step", "Resource"], ["Gate", "Requirement"]],
    mitigates: [["Work Item", "Risk"]],
    resolves: [["Work Item", "Issue"]],
    revision_of: [["Part Revision", "Part"]],
    changes: [["Decision", "Work Item"], ["Decision", "Production Step"], ["Decision", "Requirement"]],
    scopes: [["Project", "Work Item"], ["Build", "Work Item"], ["Project", "Gate"]],
    applies_to: [["Work Item", "Part"], ["Work Item", "Part Revision"], ["Production Step", "Part"], ["Production Step", "Part Revision"], ["Deliverable", "Part Revision"], ["Gate", "Part Revision"], ["Requirement", "Part Revision"]],
    precedes: [["Work Item", "Work Item"], ["Production Step", "Production Step"]],
    assigned_to: [["Assignment", "Person"], ["Assignment", "Organization"]],
    assignment_scope: [["Assignment", "Work Item"], ["Assignment", "Production Step"], ["Assignment", "Gate"], ["Assignment", "Part Revision"], ["Assignment", "Part"], ["Assignment", "Deliverable"]],
    supplies: [["Organization", "Part Revision"], ["Organization", "Part"]],
    works_at: [["Person", "Organization"]],
    reports_to: [["Person", "Person"]],
    part_of: [["Part", "Part"],["Resource", "Resource"]],
    consumes: [["Production Step", "Part"], ["Production Step", "Part Revision"]],
    produces: [["Resource", "Part"], ["Work Item", "Deliverable"], ["Production Step", "Part"], ["Production Step", "Part Revision"], ["Production Step", "Deliverable"]],
    condition_target: [["Gate", "Work Item"], ["Gate", "Production Step"], ["Gate", "Deliverable"]],
    records_on: [["Event", "Work Item"], ["Event", "Production Step"], ["Event", "Part"], ["Event", "Part Revision"], ["Event", "Resource"], ["Event", "Gate"], ["Event", "Risk"], ["Event", "Issue"]],
    supported_by: [["Event", "Evidence"], ["Deliverable", "Evidence"], ["Production Step", "Evidence"], ["Part", "Evidence"], ["Part Revision", "Evidence"]],
    qualified_for: [["Person", "Production Step"], ["Person", "Resource"]]
  };

  RULES.supersedes.push(['Event','Event']);
  RULES.potentially_affects.push(['Risk','Resource']);
  RELATION_TYPES.push('quality_reference','quality_case_of');
  RULES.quality_reference=[['Requirement','Requirement'],['Requirement','Work Item'],['Requirement','Risk'],['Requirement','Issue'],['Work Item','Production Step']];
  RULES.quality_case_of=[['Issue','Requirement'],['Event','Requirement']];
  RULES.applies_to.push(['Requirement','Part']);
  RULES.supported_by.push(['Requirement','Evidence']);
  RULES.potentially_affects.push(['Risk','Part'],['Risk','Requirement']);
  for(const type of ['Person','Organization','Build','Deliverable','Requirement','Decision'])RULES.records_on.push(['Event',type]);
  const COLORS = {
    Project: "#283a4e", Build: "#55687b", "Part Revision": "#0d93a5",
    "Work Item": "#1261d8", "Production Step": "#1261d8", Gate: "#e8792a", Deliverable: "#2f7d58",
    Person: "#6d5ac7", Organization: "#8b5bb3", Assignment: "#786f65",
    Event: "#c94141", Evidence: "#66717d", Part: "#0d93a5", Requirement: "#55687b",
    Risk: "#c94141", Issue: "#c94141", Resource: "#2f7d58", Decision: "#786f65", Characteristic: "#9b5b17"
  };

  const seed = {
    version: 1,
    entities: [
      { id: "prj-x", type: "Project", name: "Camera ECU Program", context: "Customer A · Mexico", status: "active" },
      { id: "build-b02", type: "Build", name: "Prototype Build B02", context: "Target · 18 Oct", status: "planned" },
      { id: "part-045b", type: "Part Revision", name: "P045 Rev.B · Camera PCB", context: "B02 sample scope", status: "active" },
      { id: "supplier-b", type: "Organization", name: "Supplier B", context: "PCB supplier", status: "active" },
      { id: "jose", type: "Person", name: "José Martínez", context: "Production contact · Supplier B", status: "active" },
      { id: "elena", type: "Person", name: "Elena Park", context: "Incoming quality", status: "active" },
      { id: "wi-ship", type: "Work Item", name: "Ship P045 B02 samples", context: "Completion · carrier pickup confirmed", status: "in_progress" },
      { id: "wi-qc", type: "Work Item", name: "Inspect P045 B02 samples", context: "Completion · report submitted", status: "planned" },
      { id: "report-qc", type: "Deliverable", name: "P045 inspection report", context: "Revision pending", status: "planned" },
      { id: "gate-build", type: "Gate", name: "Release B02 build", context: "Requires accepted QC report", status: "blocked" },
      { id: "assign-jose", type: "Assignment", name: "Production responsibility", context: "P045 · B02", status: "active" },
      { id: "assign-elena", type: "Assignment", name: "Quality responsibility", context: "P045 · B02", status: "active" },
      { id: "event-call", type: "Event", name: "Shipment forecast revised", context: "Reported by José · 16 Sep", status: "completed" },
      { id: "evidence-call", type: "Evidence", name: "Supplier call note", context: "16 Sep · PM confirmed", status: "active" }
    ],
    relations: [
      { id: "r1", from: "prj-x", type: "scopes", to: "wi-ship", evidence: "Program work" },
      { id: "r2", from: "build-b02", type: "scopes", to: "wi-ship", evidence: "Build B02" },
      { id: "r3", from: "wi-ship", type: "applies_to", to: "part-045b", evidence: "50 sample pieces" },
      { id: "r4", from: "supplier-b", type: "supplies", to: "part-045b", evidence: "Project sourcing record" },
      { id: "r5", from: "jose", type: "works_at", to: "supplier-b", evidence: "Current affiliation" },
      { id: "r6", from: "assign-jose", type: "assigned_to", to: "jose", evidence: "R · Responsible" },
      { id: "r7", from: "assign-jose", type: "assignment_scope", to: "wi-ship", evidence: "Production contact" },
      { id: "r8", from: "wi-ship", type: "precedes", to: "wi-qc", evidence: "Samples required for inspection" },
      { id: "r9", from: "wi-qc", type: "applies_to", to: "part-045b", evidence: "B02 QC scope" },
      { id: "r10", from: "assign-elena", type: "assigned_to", to: "elena", evidence: "R · Responsible" },
      { id: "r11", from: "assign-elena", type: "assignment_scope", to: "wi-qc", evidence: "Incoming QC" },
      { id: "r12", from: "wi-qc", type: "produces", to: "report-qc", evidence: "Required output" },
      { id: "r13", from: "gate-build", type: "condition_target", to: "report-qc", evidence: "Accepted report required" },
      { id: "r14", from: "event-call", type: "records_on", to: "wi-ship", evidence: "Forecast changed; actual shipment unknown" },
      { id: "r15", from: "event-call", type: "supported_by", to: "evidence-call", evidence: "Original call note" }
    ]
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  const DATE_FIELDS = ["baselineStart", "baselineEnd", "plannedStart", "plannedEnd", "forecastStart", "forecastEnd", "actualStart", "actualEnd", "due", "occurredDate", "assessedOn"];
  const TEXT_FIELDS = ["phase", "role", "raci", "readiness", "decision", "title", "power", "influence", "currentEngagement", "desiredEngagement", "currentRole", "desiredRole", "assessmentNote", "processLevel", "parentWorkId", "branchKind", "framework", "apqpPhase", "apqpWorkstream", "requirementSource", "customerId", "templateItemId", "templateVersion", "applicability", "completionState", "notApplicableReason", "approvedBy", "characteristicKind", "classification", "specification", "tolerance", "measurementMethod", "operationCode", "productionStage", "workCenter", "operatorAction", "acceptanceCriteria", "failureAction", "resourceKind", "machineMode", "machineFamily", "assetId", "model", "tier", "site", "capacityNote", "workerRole", "qualification", "shift", "workArea", "department", "productionFamily", "productFamily", "itemKind", "side", "verticalPosition", "pieceIndex"];
  TEXT_FIELDS.push('occurredAt','productionEventKind','traceId','traceKind','rawLog','recordedAt','storageRole','sourceEntityId','lotCode','quantityUnit','ledRank','lotMergeRule');
  TEXT_FIELDS.push('modelCode','codeNamespace','sourcePartName','mappingState');
  TEXT_FIELDS.push('displayProcessName');
  TEXT_FIELDS.push('inOut');
  TEXT_FIELDS.push('productOption');
  TEXT_FIELDS.push('routeStatus');
  TEXT_FIELDS.push('qualityKind','qualityCode','qualityColor','qualityDisposition','qualityGroup','qualityFamily','qualityPlan','qualityCC','qualityDocument');
  const LONG_TEXT_FIELDS = ["assessmentNote", "operatorAction", "acceptanceCriteria", "failureAction"];
  const PRODUCTION_EVENT_KINDS = ['arrived','started','completed','failed','held','released'];
  function isTimestamp(value) {
    const match=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
    if(!match||!Number.isFinite(Date.parse(value)))return false;
    const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number),date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day&&hour<24&&minute<60&&second<60;
  }
  const ENGAGEMENT = ["unaware", "resistant", "neutral", "supportive", "leading"];
  function validateFields(entity) {
    if(entity.eventRecord){
      if(entity.type!=='Event')throw Error('History details belong to an Event.');
      const history=typeof module==='object'?require('./history'):globalThis.EventHistory;
      history.validateEvent(entity.eventRecord);
    }
    for (const key of DATE_FIELDS) {
      const value = entity[key];
      if (value == null || value === "") continue;
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw Error(`Invalid date: ${key}. Use YYYY-MM-DD.`);
    }
    for (const prefix of ["baseline", "planned", "forecast", "actual"]) {
      if (entity[prefix + "Start"] && entity[prefix + "End"] && entity[prefix + "Start"] > entity[prefix + "End"]) throw Error(`${prefix} end cannot be before start.`);
    }
    for (const key of TEXT_FIELDS) if (entity[key] != null && (typeof entity[key] !== "string" || entity[key].length > (key==='rawLog'?200000:LONG_TEXT_FIELDS.includes(key) ? 2000 : 120))) throw Error(`Invalid ${key}.`);
    if(['occurredAt','productionEventKind','traceId','traceKind'].some(key=>entity[key])&&entity.type!=='Event')throw Error('Production log fields belong to an Event.');
    if(entity.occurredAt&&!isTimestamp(entity.occurredAt))throw Error('Occurred at needs an ISO timestamp with timezone.');
    if(entity.recordedAt&&!isTimestamp(entity.recordedAt))throw Error('Recorded at needs an ISO timestamp with timezone.');
    if(entity.productionEventKind&&!PRODUCTION_EVENT_KINDS.includes(entity.productionEventKind))throw Error('Invalid production event kind.');
    if(entity.traceKind&&!['unit','batch'].includes(entity.traceKind))throw Error('Trace kind must be unit or batch.');
    if(entity.rawLog&&entity.type!=='Evidence')throw Error('Raw production log belongs to Evidence.');
    for (const key of ["power", "influence"]) if (entity[key] && !["low", "medium", "high"].includes(entity[key])) throw Error(`Invalid ${key}: choose low, medium or high.`);
    for (const key of ["currentEngagement", "desiredEngagement"]) if (entity[key] && !ENGAGEMENT.includes(entity[key])) throw Error(`Invalid ${key}.`);
    if (entity.processLevel && !["main", "sub"].includes(entity.processLevel)) throw Error("Invalid process level.");
    if (entity.branchKind && !["support", "exception", "rework"].includes(entity.branchKind)) throw Error("Invalid branch kind.");
    if (entity.raci && !["R", "A", "C", "I"].includes(entity.raci)) throw Error("RACI must be R, A, C or I.");
    if (entity.readiness && !["unknown", "blocked", "ready"].includes(entity.readiness)) throw Error("Invalid gate readiness.");
    if (entity.decision && !["not_decided", "passed", "conditionally_passed", "failed"].includes(entity.decision)) throw Error("Invalid gate decision.");
    if (entity.apqpPhase && !["1","2","3","4","5"].includes(entity.apqpPhase)) throw Error("Invalid APQP phase.");
    if (entity.applicability && !["applicable","not_applicable","pending_review"].includes(entity.applicability)) throw Error("Invalid APQP applicability.");
    if (entity.completionState && !["not_started","in_progress","ready_for_review","approved","blocked"].includes(entity.completionState)) throw Error("Invalid APQP completion state.");
    if (entity.requirementSource && !["customer","regulatory","internal","supplier"].includes(entity.requirementSource)) throw Error("Invalid requirement source.");
    if (entity.characteristicKind && !["product","process"].includes(entity.characteristicKind)) throw Error("Invalid characteristic kind.");
    if (entity.classification && !["normal","significant","critical","customer_specific"].includes(entity.classification)) throw Error("Invalid characteristic classification.");
    if (entity.resourceKind && !["machine","line","tooling","test_equipment","facility","other"].includes(entity.resourceKind)) throw Error("Invalid resource kind.");
    if (entity.resourceKind && entity.type !== "Resource") throw Error("Resource kind belongs to a Resource.");
    if(entity.displayProcessName&&entity.type!=='Production Step')throw Error('Display process name belongs to a Production Step.');
    if(entity.qualityKind){
      const kinds={policy:'Requirement',defect:'Requirement',visual:'Work Item',storage:'Work Item',route:'Work Item',action:'Work Item',case:'Issue'};
      if(kinds[entity.qualityKind]!==entity.type)throw Error('Invalid quality kind / object type.');
    }
    if(entity.qualityColor&&!['red','yellow'].includes(entity.qualityColor))throw Error('Invalid quality identification color.');
    if(entity.qualityDisposition&&!['hold','local','internal_smt','starpro','scrap','lot'].includes(entity.qualityDisposition))throw Error('Invalid quality disposition.');
    if(entity.qualityColor&&entity.qualityKind!=='defect'&&entity.qualityKind!=='case')throw Error('Quality identification color belongs to a defect or case.');
    if (entity.productionFamily && !["Part", "Part Revision"].includes(entity.type)) throw Error("Production family belongs to a Part.");
    if (["productFamily", "itemKind", "side", "verticalPosition", "pieceIndex"].some(key=>entity[key]) && !["Part", "Part Revision"].includes(entity.type)) throw Error("Part classification belongs to a Part.");
    if (entity.itemKind && !["product", "component"].includes(entity.itemKind)) throw Error("Invalid Part item kind.");
    if (entity.side && !["LH", "RH"].includes(entity.side)) throw Error("Invalid Part side.");
    if (entity.inOut && (!['IB','OB'].includes(entity.inOut)||!['Part','Part Revision'].includes(entity.type))) throw Error('Invalid Part IB/OB.');
    if (entity.productOption && (!['STD','OPT'].includes(entity.productOption)||!['Part','Part Revision'].includes(entity.type))) throw Error('Invalid Part STD/OPT.');
    if (entity.routeStatus && (!['registered','unregistered'].includes(entity.routeStatus)||!['Part','Part Revision'].includes(entity.type))) throw Error('Invalid Part route status.');
    if (entity.verticalPosition && !["Upper", "Lower"].includes(entity.verticalPosition)) throw Error("Invalid Part vertical position.");
    if (entity.machineMode && !["shared_pool","specific_asset"].includes(entity.machineMode)) throw Error("Invalid machine mode.");
    if ((entity.machineMode || entity.machineFamily) && entity.type !== "Resource") throw Error("Machine details belong to a Resource.");
    if (entity.workerRole && entity.type !== "Person") throw Error("Worker role belongs to a Person.");
    if (entity.workArea && !["office", "factory", "external", "unknown"].includes(entity.workArea)) throw Error("Invalid work area.");
    if ((entity.workArea || entity.department) && entity.type !== "Person") throw Error("Department and work area belong to a Person.");
    if ((entity.operationCode || entity.productionStage || entity.workCenter || entity.operatorAction || entity.acceptanceCriteria || entity.failureAction) && entity.type !== "Production Step") throw Error("Production fields belong to a Production Step.");
    if (entity.applicability === "not_applicable" && (!entity.notApplicableReason || !entity.approvedBy)) throw Error("Not-applicable APQP items require a reason and approver.");
  }
  function newStore() { return clone(seed); }
  function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function byId(store, entityId) { return store.entities.find(entity => entity.id === entityId); }
  function isProductPart(entity) { return ["Part", "Part Revision"].includes(entity?.type) && entity.itemKind !== "component"; }
  function isComponentPart(entity) { return ["Part", "Part Revision"].includes(entity?.type) && entity.itemKind === "component"; }
  function relationsFor(store, entityId) { return store.relations.filter(relation => relation.from === entityId || relation.to === entityId); }
  function normalize(value) { return String(value || "").normalize("NFKD").toLowerCase(); }
  function search(store, query, type) {
    const term = normalize(query);
    return store.entities.filter(entity => (!type || entity.type === type) && (!term || normalize(`${entity.id} ${entity.name} ${entity.context} ${entity.type} ${entity.phase || ""} ${entity.title || ""} ${entity.currentRole || ""} ${entity.operationCode || ""} ${entity.productionStage || ""} ${entity.operatorAction || ""} ${entity.resourceKind || ""} ${entity.machineMode || ""} ${entity.machineFamily || ""} ${entity.workerRole || ""} ${entity.workArea || ""} ${entity.department || ""} ${entity.tier || ""} ${entity.assetId || ""} ${entity.productFamily || ""} ${entity.side || ""} ${entity.verticalPosition || ""} ${entity.pieceIndex || ""}`).includes(term)));
  }
  function defaultRelationScope(store, relation, projectId) {
    if (!projectId || projectId === "library") return null;
    if (["supplies", "works_at", "reports_to", "part_of", "revision_of", "qualified_for", "supports_line"].includes(relation.type)) return null;
    if (["precedes", "on_failure", "rework_of", "applies_to", "consumes", "produces", "requires", "controls"].includes(relation.type) && byId(store, relation.from)?.type === "Production Step") return null;
    return projectId;
  }
  function validateRelation(store, relation) {
    const from = byId(store, relation.from), to = byId(store, relation.to);
    if (!from || !to) return "Choose two existing objects.";
    if (from.id === to.id) return "An object cannot connect to itself.";
    if(relation.type==='quality_case_of'&&!['defect','policy'].includes(to.qualityKind))return 'Quality case requires a defect definition or Part policy.';
    if (!RELATION_TYPES.includes(relation.type)) return "Choose a supported relationship.";
    const allowed = RULES[relation.type].some(([source, target]) => source === from.type && target === to.type);
    if (!allowed) return `${relation.type} does not support ${from.type} → ${to.type}.`;
    if (relation.type==='supports_line'&&to.resourceKind!=='line') return 'Line support requires a production line.';
    const material = (from.type === "Production Step" && ["consumes", "produces"].includes(relation.type) || from.type==='Resource'&&from.resourceKind==='line'&&relation.type==='produces') && ["Part", "Part Revision"].includes(to.type);
    const hasMaterialFields = ["quantity", "unit", "basis", "routePartId", "reviewState"].some(key=>relation[key] !== undefined && relation[key] !== "");
    if (hasMaterialFields && !material) return "Material details require a Production Step → Part consumes or produces relationship.";
    if (relation.quantity !== undefined && relation.quantity !== "" && (!Number.isSafeInteger(Number(relation.quantity)) || Number(relation.quantity) <= 0)) return "Material quantity must be a positive whole number.";
    if (["unit", "basis"].some(key=>relation[key] !== undefined && (typeof relation[key] !== "string" || relation[key].length > 120))) return "Invalid material unit or basis.";
    if (relation.reviewState && !["confirmed", "proposed", "unverified"].includes(relation.reviewState)) return "Invalid material review state.";
    if (relation.routePartId && !isProductPart(byId(store, relation.routePartId))) return "Material route Part must be an existing product Part.";
    const scope = relation.scopeProjectId ?? null;
    const inScope = item => (item.scopeProjectId ?? null) === scope;
    if (store.relations.some(item => inScope(item) && item.from === relation.from && item.to === relation.to && item.type === relation.type)) return "This relationship already exists.";
    if (relation.type === "reports_to" && store.relations.some(item => inScope(item) && item.type === "reports_to" && item.from === relation.from)) return "A person can have one direct reporting manager.";
    if (["precedes", "reports_to", "part_of"].includes(relation.type) && createsCycle(store, relation.from, relation.to, relation.type, scope)) return relation.type === "precedes" ? "This dependency would create a cycle." : "This " + relation.type + " relationship would create a cycle.";
    return "";
  }
  function createsCycle(store, from, to, type = "precedes", scope = null) {
    const next = new Map();
    store.relations.filter(r => r.type === type && (r.scopeProjectId ?? null) === scope).forEach(r => next.set(r.from, [...(next.get(r.from) || []), r.to]));
    next.set(from, [...(next.get(from) || []), to]);
    const seen = new Set(), stack = new Set();
    function visit(node) {
      if (stack.has(node)) return true;
      if (seen.has(node)) return false;
      seen.add(node); stack.add(node);
      for (const child of next.get(node) || []) if (visit(child)) return true;
      stack.delete(node); return false;
    }
    return [...next.keys()].some(visit);
  }
  function addEntity(store, input) {
    if (store.version === 2 && input.type === "Project") throw new Error("Create projects from Project Home.");
    if (!ENTITY_TYPES.includes(input.type)) throw new Error("Unsupported object type.");
    if (!String(input.name || "").trim()) throw new Error("Name is required.");
    const entity = { id: id("obj"), type: input.type, name: input.name.trim(), context: String(input.context || "").trim(), status: input.status || "active" };
    for (const key of [...DATE_FIELDS, ...TEXT_FIELDS]) if (input[key]) entity[key] = input[key];
    if(input.eventRecord)entity.eventRecord=clone(input.eventRecord);
    validateFields(entity);
    if (store.id) entity.projectId = store.id;
    store.entities.push(entity); return entity;
  }
  function updateEntity(store, entityId, input) {
    if (store.status === "archived") throw Error("Archived project is read only.");
    const previous = byId(store, entityId);
    if (!previous) throw Error("Object not found.");
    if (input.type && input.type !== previous.type) throw Error("Object type cannot change; create a new object.");
    const next = {...previous};
    for (const key of ["name", "context", "status", ...DATE_FIELDS, ...TEXT_FIELDS]) if (Object.hasOwn(input, key) && !(input[key] === "" && !Object.hasOwn(previous,key))) next[key] = input[key];
    const candidate = {...store, entities: store.entities.map(e => e.id === entityId ? next : e)};
    validateStore(candidate);
    if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
    store.entities = candidate.entities;
    (store.changes ||= []).push({id:id("change"), entityId, recordedAt:new Date().toISOString(), before:clone(previous), after:clone(next)});
    return next;
  }
  function addRelation(store, input) {
    const normalized = {...input};
    if (normalized.quantity === "") delete normalized.quantity;
    else if (normalized.quantity !== undefined) normalized.quantity = Number(normalized.quantity);
    const error = validateRelation(store, normalized);
    if (error) throw new Error(error);
    const relation = { id: id("rel"), from: input.from, type: input.type, to: input.to, evidence: String(input.evidence || "").trim() };
    for (const key of ["quantity", "unit", "basis", "routePartId", "reviewState"]) if (normalized[key] !== undefined && normalized[key] !== "") relation[key] = normalized[key];
    if (Object.hasOwn(input, "scopeProjectId")) relation.scopeProjectId = input.scopeProjectId;
    if (store.id) relation.projectId = store.id;
    store.relations.push(relation); return relation;
  }
  function validateStore(store) {
    if (!store || !Array.isArray(store.entities) || !Array.isArray(store.relations)) throw new Error("Invalid ontology file.");
    const ids = new Set();
    for (const entity of store.entities) {
      if (typeof entity.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(entity.id) || ids.has(entity.id) || !ENTITY_TYPES.includes(entity.type) || typeof entity.name !== "string" || !entity.name.trim() || typeof entity.status !== "string" || !/^[a-z_]+$/.test(entity.status)) throw new Error("Invalid or duplicate object.");
      ids.add(entity.id);
      validateFields(entity);
    }
    for (const entity of store.entities) {
      if (entity.processLevel === "sub" && !entity.parentWorkId && !(entity.type==='Production Step'&&['NG storage','Scrap'].includes(entity.productionStage))) throw Error("A subprocess needs a parent work item.");
      if (!entity.parentWorkId) continue;
      if (entity.processLevel !== "sub" || !["Work Item", "Production Step", "Gate", "Deliverable"].includes(entity.type)) throw Error("Only subprocess work, production steps, gates or deliverables can have a parent.");
      const parent = byId(store,entity.parentWorkId);
      if (!parent || parent.type !== (entity.type === "Production Step" ? "Production Step" : "Work Item")) throw Error("Parent must be a matching process step in this project.");
      const visited = new Set([entity.id]); let cursor = parent;
      while (cursor) {
        if (visited.has(cursor.id)) throw Error("Subprocess parent cycle is not allowed.");
        visited.add(cursor.id); cursor = cursor.parentWorkId ? byId(store,cursor.parentWorkId) : null;
      }
    }
    const checked = {entities: store.entities, relations: []};
    const relationIds = new Set();
    for (const relation of store.relations) {
      if (typeof relation.id !== "string" || !relation.id || relationIds.has(relation.id)) throw new Error("Invalid or duplicate relationship ID.");
      const error = validateRelation(checked, relation);
      if (error) throw new Error(error);
      checked.relations.push(relation);
      relationIds.add(relation.id);
    }
    return clone({ version: 1, entities: store.entities, relations: store.relations });
  }
  return { ENTITY_TYPES, RELATION_TYPES, PROJECT_OWNED_TYPES, WORKSTREAMS, COLORS, DATE_FIELDS, TEXT_FIELDS, ENGAGEMENT, PRODUCTION_EVENT_KINDS, isTimestamp, newStore, byId, isProductPart, isComponentPart, relationsFor, search, defaultRelationScope, validateRelation, addEntity, updateEntity, addRelation, validateStore, createsCycle };
});
