const Model = window.OntologyModel, Projects = window.ProjectStore, Flow = window.PMWorkflow, Analysis = window.AnalysisViews, APQP = window.APQP, LocalAPI = window.LocalAPI;
const Ingest = window.Ingestion, Logs = window.ProductionLogs;
let basicAccess=false;
let historyGroups={};
const eventHistoryUI=new window.HistoryView(async()=>{const id=store?.id;workspace=await LocalAPI.load();store=id==='library'?workspace.library:workspace.projects.find(p=>p.id===id)||null;render();});
const progressUI=new window.ProgressView(()=>{render();},async(next)=>{const id=store?.id;workspace=next||await LocalAPI.load();store=workspace.projects.find(p=>p.id===id)||null;render();});
const hourlyUI=new window.HourlyView(()=>{render();},async()=>{const id=store?.id;workspace=await LocalAPI.load();store=workspace.projects.find(p=>p.id===id)||null;render();});
const samplePreparationUI=new window.SamplePreparationView(async result=>{const id=store?.id;workspace=result?.workspace||await LocalAPI.load();store=workspace.projects.find(p=>p.id===id)||null;render();});
const $ = selector => document.querySelector(selector);
$('#projectName').closest('label').insertAdjacentHTML('afterend','<label>Project type<select id="newProjectType">'+window.ProjectTypes.TYPES.map(t=>'<option value="'+t.id+'"'+(t.id==='sample'?' selected':'')+'>'+t.label+'</option>').join('')+'</select></label>');
$('#projectList').insertAdjacentHTML('beforebegin','<label class="project-type-filter">Project type<select id="projectTypeFilter"><option value="">All types</option>'+window.ProjectTypes.TYPES.map(t=>'<option value="'+t.id+'">'+t.label+'</option>').join('')+'</select></label>');
$('#projectTypeFilter').onchange=()=>render();
$('#recordsView').insertAdjacentHTML('afterbegin','<nav id="sampleRiskTabs" class="sample-risk-tabs" hidden><button class="button" data-sample-risk="risks">Risk / Issues</button><button class="button" data-sample-risk="preparation">Sample Preparation Checksheet</button></nav><div id="samplePreparationPanel" hidden></div>');
let sampleRiskMode='risks',routeSerial=0;
$('#sampleRiskTabs').onclick=e=>{const mode=e.target.closest('[data-sample-risk]')?.dataset.sampleRisk;if(mode){sampleRiskMode=mode;render();}};
const projectTypeButton=document.createElement('button');projectTypeButton.id='editProjectType';projectTypeButton.className='button';projectTypeButton.textContent='Project type';$('#projectBar').append(projectTypeButton);
projectTypeButton.onclick=()=>{if(!store||store.id==='library'||window.PUBLIC_READ_ONLY)return;const d=document.createElement('dialog');d.className='dialog';d.innerHTML='<form><h2>Project type</h2><label>Type<select>'+window.ProjectTypes.TYPES.map(t=>'<option value="'+t.id+'"'+(window.ProjectTypes.kind(store)===t.id?' selected':'')+'>'+t.label+'</option>').join('')+'</select></label><p>Classification does not change passwords or access.</p><p role="alert"></p><button class="button primary" type="submit">Save type</button><button class="button" type="button" data-close>Cancel</button></form>';document.body.append(d);d.onclose=()=>d.remove();d.querySelector('[data-close]').onclick=()=>d.close();d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type="submit"]');b.disabled=true;try{const value=d.querySelector('select').value;if(LocalAPI.projectTypeSave){workspace=await LocalAPI.projectTypeSave({projectId:store.id,projectType:value,revision:workspace.revision});store=workspace.projects.find(p=>p.id===store.id);}else await changeProject(p=>{p.projectType=value;});d.close();render();}catch(err){d.querySelector('[role="alert"]').textContent=err.message;b.disabled=false;}};d.showModal();};
$('#renameProject').insertAdjacentHTML('afterend','<button id="projectFeatures" class="button" type="button">프로젝트 기능</button>');
$('#projectFeatures').onclick=()=>{
 const settings=workspace.viewSettings?.[store.id]?.features||window.HourlyProduction.defaults(store),d=document.createElement('dialog');d.className='dialog';
 d.innerHTML='<h2>프로젝트 기능 · '+h(store.name)+'</h2><label class="check"><input type="checkbox" data-wip '+(settings.wip?'checked':'')+'> Progress · WIP</label><label class="check"><input type="checkbox" data-hourly '+(settings.hourly?'checked':'')+'> 시간별 생산량 · 목표·실적·미달 사유</label><p>기능을 꺼도 기존 기록은 삭제하지 않습니다. 입력 구조는 다음 단계에서 추가합니다.</p><p data-error role="alert"></p><div class="actions"><button class="button" data-close>닫기</button><button class="button primary" data-save>기능 저장</button></div>';
 document.body.append(d);d.onclose=()=>d.remove();d.querySelector('[data-close]').onclick=()=>d.close();d.querySelector('[data-save]').onclick=async e=>{e.target.disabled=true;try{await LocalAPI.featureSave({projectId:store.id,revision:workspace.revision,features:{wip:d.querySelector('[data-wip]').checked,hourly:d.querySelector('[data-hourly]').checked}});d.close();await hourlyUI.refreshApp();}catch(err){d.querySelector('[data-error]').textContent=err.message;e.target.disabled=false;}};d.showModal();
};
$('#recordsView').insertAdjacentHTML('afterend','<section id="copilotView" class="copilot-view" hidden><div class="panel-heading"><div><h1>Copilot</h1><p id="copilotStatus" class="muted"></p></div><button id="copilotClear" class="button" type="button">대화 지우기</button></div><div class="copilot-body"><div id="copilotMessages" class="copilot-messages" role="log" aria-label="Copilot conversation" aria-live="polite"></div><p id="copilotError" class="form-error" role="alert"></p><form id="copilotForm"><textarea id="copilotQuestion" rows="3" maxlength="4000" required aria-label="질문" placeholder="G65 Integration에 어떤 Risk가 있어?"></textarea><div class="actions"><button id="copilotSend" class="button primary" type="submit">보내기</button><span class="muted">보내면 질문·최근 대화·프로젝트 데이터가 OpenAI로 전송됩니다.</span></div></form></div></section>');
$('#projectEntry .entry-footer').insertAdjacentHTML('afterbegin','<button id="entryCopilot" class="button" type="button">Copilot</button>');
$('#processFields').before($('#productionEntityFields').content);
$('#dateFields').before($('#productionEventFields').content);
$('#wipView').after($('#productionLogView').content);
$('#partFields').append($('#partClassificationFields').content);
$('#partFields .form-grid').insertAdjacentHTML('beforeend','<label>모델 코드<input id="modelCode" maxlength="120"></label><label>코드 출처<input id="codeNamespace" maxlength="120" placeholder="LS MES"></label>');
$('#relationEvidence').closest('label').after($('#materialRelationFields').content);
$('#entityName').parentElement.after($('#workstreamFields').content);
$('#entityError').insertAdjacentHTML('beforebegin','<label id="entityMatchReview" class="entity-match-review" hidden>Same-name object exists in Library · choose explicitly<select id="entityMatchChoice"><option value="">Choose reuse or separate</option></select></label>');
$('#focusMode').closest('label').insertAdjacentHTML('afterend','<label id="mapNumbersControl">Show numbers<select id="showNumbers"><option value="none">None</option><option value="parts">Parts</option><option value="workers">Workers</option></select></label>');
$('#productionPart').closest('label').insertAdjacentHTML('afterend','<details id="productionPartMulti" class="map-part-multi"><summary>Choose Parts</summary><div class="map-part-picker"><label>Find Part<input id="productionPartSearch" type="search" placeholder="Search Parts"></label><div id="productionPartChoices" class="map-part-choices"></div></div></details><label>Show numbers<select id="productionNumbers"><option value="none">None</option><option value="parts">Parts</option><option value="workers">Workers</option></select></label><button id="addProductionExcel" type="button" class="button">Add Excel data</button>');
$('#productionPart').closest('label').insertAdjacentHTML('beforebegin','<label>Production line<select id="productionLine"><option value="">All lines</option><option value="SMT">SMT</option><option value="LDM">LDM</option><option value="Nexlide">Nexlide</option><option value="TEM">TEM</option></select></label>');
for(const id of ['showNumbers','productionNumbers'])$('#'+id).add(new Option('Pending time','pending'));
$('#addProductionExcel').insertAdjacentHTML('afterend','<button id="addProductionLogs" type="button" class="button">Add process logs</button>');
$('#productionTabs [data-production-view="APQP & gates"]').insertAdjacentHTML('beforebegin','<button data-production-view="Process logs">Process logs</button>');
$('#mapPartMulti').insertAdjacentHTML('afterend','<label id="mapHighlightControl" hidden>Highlight Part<select id="mapHighlight"><option value="">All selected Parts</option></select></label>');
$('#mapPartMulti').insertAdjacentHTML('beforebegin','<label id="mapProductionLineControl" hidden>Production line<select id="mapProductionLine"><option value="">All lines</option><option value="LDM">LDM</option><option value="Nexlide">Nexlide</option><option value="TEM">TEM</option><option value="SMT">SMT</option></select></label>');
$('#lensHeader').append($('#mapProductionLineControl'));
$('#productionView .production-legend').insertAdjacentHTML('beforeend','<button id="productionClearSelection" class="text-button">Clear selection</button>');
$('#mapHighlightControl').insertAdjacentHTML('afterend','<div id="mapContextControls" class="map-context-controls"><label class="check production-context-toggle"><input id="mapSeeMachines" type="checkbox" checked>See Machines</label><label class="check production-context-toggle"><input id="mapSeeComponents" type="checkbox" checked>See Components</label></div>');
$('#productionPartMulti').insertAdjacentHTML('afterend','<label>Highlight Part<select id="productionHighlight"><option value="">All selected Parts</option></select></label>');
$('#productionHighlight').closest('label').after($('#productionContextControls').content);
$('#productionFit').textContent='Fit';
$('#mapContextControls').insertAdjacentHTML('beforeend','<label class="check production-context-toggle"><input id="mapSeeStakeholders" type="checkbox" checked>See Stakeholders · line only</label>');
$('#productionSeeMachines').closest('label').insertAdjacentHTML('afterend','<label class="check production-context-toggle"><input id="productionSeeStakeholders" type="checkbox" checked>See Stakeholders · line only</label>');
for(const id of ['mapSeeStakeholders','productionSeeStakeholders'])$('#'+id).addEventListener('change',()=>render());
const fullscreenZoomBefore=new WeakMap();
const fullscreenMaps=[];
let fullscreenMap=null,fullscreenRequest=null,fullscreenEscapeUntil=0;
const mapFullscreenContext=()=>[store?.id,location.hash,selectedWorkstream].join('|');
function syncMapFullscreen(next,message=''){
  const previous=fullscreenMap;
  if(previous&&previous!==next){
    for(const {node,marker} of previous.borrowed||[])marker.replaceWith(node);
    previous.borrowed=[];
    previous.panel.classList.remove('map-fullscreen');
    const before=fullscreenZoomBefore.get(previous.panel);
    if(before?.context===mapFullscreenContext()){
      if(previous.kind==='production'){productionZoom=before.zoom;applyProductionZoom();}
      else{zoom=before.zoom;applyZoom();}
    }
    fullscreenZoomBefore.delete(previous.panel);
  }
  fullscreenMap=next;
  if(next&&next!==previous){
    next.borrowed=[];
    const line=next.kind==='overview'&&!$('#mapProductionLineControl').hidden?$('#mapProductionLineControl'):null;
    for(const [node,target] of [[$('#inspector'),next.panel],[line,next.panel.querySelector('.map-controls')]]){
      if(!node||next.panel.contains(node))continue;
      const marker=document.createComment('Map fullscreen position');node.before(marker);
      if(node===line)target.prepend(node);else target.append(node);
      next.borrowed.push({node,marker});
    }
  }
  document.body.classList.toggle('map-fullscreen-open',Boolean(next));
  for(const entry of fullscreenMaps){
    const open=entry===next;
    entry.panel.classList.toggle('map-fullscreen',open);
    entry.button.textContent=open?(document.fullscreenElement===entry.panel?'Exit full screen':'Exit expanded view'):'Full screen';
    entry.button.setAttribute('aria-pressed',String(open));
    entry.status.textContent=open?message:'';entry.status.hidden=!open||!message;
  }
  if(next&&next!==previous)requestAnimationFrame(()=>{if(fullscreenMap===next&&fullscreenZoomBefore.get(next.panel)?.context===mapFullscreenContext())focusMapSelection(next.kind);});
}
async function exitMapFullscreen(){
  if(fullscreenRequest)fullscreenRequest.cancelled=true;
  if(fullscreenMaps.some(entry=>entry.panel===document.fullscreenElement)){
    try{await document.exitFullscreen();}
    catch(error){
      if(fullscreenMap){fullscreenMap.status.textContent='Could not exit full screen: '+error.message+'. Press Esc to exit.';fullscreenMap.status.hidden=false;}
    }
  }else syncMapFullscreen(null);
}
for(const [fitId,panelSelector] of [['fitMap','.map-panel'],['productionFit','#productionView']]){
  const panel=$(panelSelector),kind=panelSelector==='#productionView'?'production':'overview';
  const button=document.createElement('button');button.className='button map-fullscreen-button';button.type='button';button.textContent='Full screen';button.setAttribute('aria-pressed','false');
  $('#'+fitId).parentElement.appendChild(button);
  const status=document.createElement('p');status.className='map-fullscreen-status';status.setAttribute('role','status');status.hidden=true;
  button.parentElement.parentElement.append(status);
  const entry={panel,button,status,kind};fullscreenMaps.push(entry);
  button.addEventListener('click',async()=>{
    if(fullscreenMap===entry){await exitMapFullscreen();return;}
    if(fullscreenRequest)return;
    syncMapFullscreen(null);
    fullscreenZoomBefore.set(panel,{zoom:kind==='production'?productionZoom:zoom,context:mapFullscreenContext()});
    const request={entry,cancelled:false};fullscreenRequest=request;button.disabled=true;
    try{
      if(typeof panel.requestFullscreen!=='function')throw Error('Native fullscreen is not supported by this browser');
      await panel.requestFullscreen();
      if(request.cancelled||panel.closest('[hidden]'))await exitMapFullscreen();
    }catch(error){
      if(!request.cancelled&&!panel.closest('[hidden]'))syncMapFullscreen(entry,'Full screen unavailable: '+error.message+'. Expanded view fills this browser window. Press Esc or Exit expanded view to close.');
    }finally{if(fullscreenRequest===request)fullscreenRequest=null;button.disabled=false;}
  });
}
document.addEventListener('fullscreenchange',()=>{
  const next=fullscreenMaps.find(entry=>entry.panel===document.fullscreenElement)||null;
  if(next&&(fullscreenRequest?.cancelled||next.panel.closest('[hidden]'))){exitMapFullscreen();return;}
  // Browser Escape can deliver its key event after fullscreenchange.
  if(fullscreenMap&&!next)fullscreenEscapeUntil=performance.now()+250;
  syncMapFullscreen(next);
});
const fullscreenVisibility=new MutationObserver(()=>{
  const entry=fullscreenMap||fullscreenRequest?.entry;
  if(entry?.panel.closest('[hidden]'))exitMapFullscreen();
});
for(const {panel} of fullscreenMaps)for(let ancestor=panel;ancestor;ancestor=ancestor.parentElement)fullscreenVisibility.observe(ancestor,{attributes:true,attributeFilter:['hidden']});
window.addEventListener('hashchange',()=>{if(fullscreenMap||fullscreenRequest)exitMapFullscreen();});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  if(fullscreenMap||fullscreenRequest||performance.now()<fullscreenEscapeUntil){event.preventDefault();event.stopImmediatePropagation();exitMapFullscreen();}
  else if(mapAssistantUI.openPanel)mapAssistantUI.close();
},true);
$('#fitMap').insertAdjacentHTML('beforebegin','<span id="mapZoomLevel" class="map-zoom-level" aria-live="polite">100%</span>');
$('#productionFit').insertAdjacentHTML('beforebegin','<span id="productionZoomLevel" class="map-zoom-level" aria-live="polite">100%</span>');
$('#mapPartChoices').insertAdjacentHTML('beforebegin','<div class="map-part-actions"><button type="button" data-map-parts-action="all">All</button><button type="button" data-map-parts-action="none">None</button></div>');
$('#productionPartChoices').insertAdjacentHTML('beforebegin','<div class="map-part-actions"><button type="button" data-production-parts-action="all">All</button><button type="button" data-production-parts-action="none">None</button></div>');
$('.production-legend span:last-of-type').textContent='Click chips to select multiple objects; click again to deselect. ? opens details. Dashed card: order unconfirmed.';
const h = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const allTypes = Model.ENTITY_TYPES.filter(t => t !== 'Project');
const presets = {process:['Work Item','Production Step','Part','Part Revision','Gate','Deliverable','Build','Event','Decision'], stakeholders:['Person','Organization','Assignment','Part','Part Revision','Work Item'], all:allTypes};
const tabTypes = {
  Objects:allTypes, Parts:['Part','Part Revision','Build'], Stakeholders:['Person','Organization','Assignment'],
  Production:['Production Step','Gate','Requirement','Characteristic','Deliverable','Evidence'], RACI:['Assignment'], Deliverables:['Deliverable'],
  'Risk / Issues':['Risk','Issue'], Resources:['Resource'], Records:['Event','Evidence','Decision']
};
const tabs = ['Overview',...Object.keys(tabTypes),'Input','History'];
let workspace = null, store = null, startupError = '', selectedId = null, activeTab = 'Overview', types = new Set(presets.process);
const mapSelectedIds=new Set();
let pendingMapSelection='';
const qualityExpanded=new Set();
let mapSelectionContext='';
let selectedWorkstream = '', historyRows = [], historyMore = false, historyOffset = 0;
let editingId = null, preview = null, csvChoices = {}, zoom = 1, graphSize = {width:550,height:400}, toastTimer;
let productionZoom = 1, productionSize = {width:560,height:330}, mapPartId = '', mapPartIds = [], productionPartIds = [], mapPartsCustomized = false, productionPartsCustomized = false, mapHighlightPartId = '', productionHighlightPartId = '';
let productionSelections={};
let logDraft=null, logSaving=false, pendingCache=null;
let stakeholderView = 'People & roles', productionMode = 'Process map', apqpView = 'Phase dashboard';
const openStakeholderGroups = new Set();
let stakeholderGroupsInitialized = false;
let preferredStakeholderDepartment = '';
const viewTimers = new Map();
let inputMode = 'single';
let aiConfigured = false;
let copilotConfigured=false,copilotModel='';
let mapAssistantConfigured=false;
const copilotChats=new Map();
let ingestionDraft = null, ingestionSource = null, ingestionJobId = null;
let ingestionSelection = null, ingestionConfirm = false;
let wipData = null, wipHistoryData = null, wipDraft = null, wipFile = null, staffingData = [], productionStaffingData = [], selectedWipSnapshotId = '', wipPartMappings = {}, wipStepMappings = {};
let inspectorView = 'overview', inspectorDepth = 1;
let membershipSelection = new Set();
const projectOwnedTypes = Model.PROJECT_OWNED_TYPES;
const stakeholderViews = ['People & roles','Power / influence','Engagement'];
const apqpViews = ['Phase dashboard','Gate reviews','Part readiness','Traceability'];
const profileFields = ['title','power','influence','currentRole','desiredRole','currentEngagement','desiredEngagement','assessmentNote','assessedOn'];
let month = new Date(new Date().getFullYear(),new Date().getMonth(),1);
let metricLoadSerial=0;
const dateLabel = key => key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
const iso = date => date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
const short = (text,n=29) => text.length > n ? text.slice(0,n-1)+'…' : text;

function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>$('#toast').classList.remove('visible'),3500);
}
async function commit(next,ingestionCommit=null) {
  if (!workspace) throw Error('Local database is not ready.');
  const scope=store?.id||null;
  workspace=await LocalAPI.save(next,scope,workspace.revision,ingestionCommit);
  store=scope==='library'?workspace.library:workspace.projects.find(p=>p.id===scope)||null;
  renderSavedChange();
  if(activeTab==='History')loadHistory(true);
}
async function changeProject(change,ingestionCommit=null) {
  if (!store || store.status==='archived') throw Error('Open an active project first.');
  const next = structuredClone(workspace), project = store.id==='library'?next.library:next.projects.find(p=>p.id===store.id);
  const result = change(project); if(project.id!=='library')project.updatedAt = new Date().toISOString();
  await commit(next,ingestionCommit); return result;
}
async function startLocal() {
  if(location.protocol==='file:'){
    location.replace('http://127.0.0.1:4173/'+location.hash);return;
  }
  const host=location.hostname.toLowerCase();
  const localHost=location.protocol==='http:'&&(host==='127.0.0.1'||host==='localhost');
  const previewHost=location.protocol==='https:'&&(host==='grok-sandbox.com'||host.endsWith('.grok-sandbox.com')||host==='preview.grok.genai.mil'||host==='preview.grok.mil'||host==='preview.grokgsac.com');
  if(!window.PUBLIC_READ_ONLY&&!window.CLOUD_BACKEND&&!localHost&&!previewHost){
    startupError='This version is local only. Start it with start-local.command, then open http://127.0.0.1:4173/.';render();return;
  }
  if(window.EDIT_LOCKED){startupError='';render();return;}
  try {
    $('#projectList').innerHTML='<p class="muted" role="status">프로젝트 불러오는 중…</p>';
    if(LocalAPI.catalog){workspace=await LocalAPI.catalog();render();}
    workspace=await LocalAPI.load();basicAccess=workspace.access?.mode==='basic';window.OwnerAccess?.init(workspace.access,{whole:openWholeProcess,production:()=>openWorkstream('production')});const health=await LocalAPI.health();aiConfigured=health.aiConfigured;mapAssistantConfigured=Boolean(health.mapAssistantConfigured);copilotConfigured=Boolean(health.copilotConfigured);copilotModel=health.copilotModel||'';startupError='';route();
  } catch (error) { startupError=window.CLOUD_BACKEND||window.PUBLIC_READ_ONLY?error.message:(/failed to fetch/i.test(error.message)?'Local server is offline. Open start-local.command and reload this page.':'Local database error: '+error.message);render(); }
}
function invalidatePreview() { preview = null; $('#applyCSV').disabled = true; }
function setInputMode(mode) {
  inputMode=mode;
  document.querySelectorAll('[data-input-mode]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.inputMode===mode)));
  $('#singleInputPanel').hidden=mode!=='single'; $('#csvInputPanel').hidden=mode!=='csv'; $('#aiInputPanel').hidden=mode!=='ai';
}
function resetFilters() {
  $('#dateStart').value=''; $('#dateEnd').value=''; $('#searchInput').value=''; $('#statusFilter').value='';
  $('#focusMode').value=''; $('#perspective').value='process'; $('#keepPredecessors').checked=true; $('#showSubprocesses').checked=true;$('#showNumbers').value='none';mapPartId='';mapPartIds=[];mapPartsCustomized=false;mapHighlightPartId='';
  types = new Set(presets.process); zoom=1; renderTypeFilters();
}
const mapViewKey=()=>selectedWorkstream?'lens-'+selectedWorkstream:'overview';
function viewSnapshot(key) {
  if(key==='production')return {line:$('#productionLine').value,selections:{...productionSelections,[$('#productionLine').value||'all']:{partIds:[...productionPartIds],partSelectionCustomized:productionPartsCustomized,highlightPartId:productionHighlightPartId}},partIds:[...productionPartIds],partSelectionCustomized:productionPartsCustomized,highlightPartId:productionHighlightPartId,numbers:$('#productionNumbers').value,machines:$('#productionSeeMachines').checked,components:$('#productionSeeComponents').checked,snapshotId:selectedWipSnapshotId,zoom:productionZoom};
  if(key==='stakeholders')return {view:stakeholderView,area:$('#stakeholderArea').value,department:$('#stakeholderDepartment').value,grouping:$('#stakeholderGrouping').value,openGroups:[...openStakeholderGroups]};
  return {line:$('#mapProductionLine').value,dateStart:$('#dateStart').value,dateEnd:$('#dateEnd').value,search:$('#searchInput').value,status:$('#statusFilter').value,focus:$('#focusMode').value,perspective:$('#perspective').value,partIds:[...mapPartIds],partSelectionCustomized:mapPartsCustomized,highlightPartId:key==='lens-production'?mapHighlightPartId:'',numbers:$('#showNumbers').value,machines:$('#mapSeeMachines').checked,components:$('#mapSeeComponents').checked,keepPredecessors:$('#keepPredecessors').checked,showSubprocesses:$('#showSubprocesses').checked,types:[...types],zoom,month:iso(month),ganttScale:$('#ganttScale').value,scheduleMode:$('#scheduleMode').value};
}
function saveViewSettings(key,delay=180) {
  if(!store||!workspace)return;
  if(basicAccess){sessionStorage.setItem('pm-basic-view:'+key,JSON.stringify(viewSnapshot(key)));return;}
  const projectId=store.id,viewKey=projectId==='library'&&key==='overview'?'library':key;
  const data={...workspace.viewSettings?.[projectId]?.[viewKey],...viewSnapshot(key)};
  (workspace.viewSettings[projectId] ||= {})[viewKey]=data;
  clearTimeout(viewTimers.get(projectId+':'+viewKey));
  viewTimers.set(projectId+':'+viewKey,setTimeout(async ()=>{
    try{await LocalAPI.settings(projectId,viewKey,data);}
    catch(error){toast('View settings: '+error.message);}
  },delay));
}
function restoreMapSettings(key) {
  const overview=workspace.viewSettings?.[store.id]?.[key]||{};
  if(key==='lens-production')$('#mapProductionLine').value=['','LDM','Nexlide','TEM','SMT'].includes(overview.line)?overview.line:store.entities.some(e=>e.productionFamily==='LDM')?'LDM':'';
  const validPart=id=>store.entities.some(e=>e.id===id&&Model.isProductPart(e));
  const allParts=store.entities.filter(Model.isProductPart).map(e=>e.id);
  mapPartsCustomized=overview.partSelectionCustomized===true;
  mapPartIds=(mapPartsCustomized&&Array.isArray(overview.partIds)?overview.partIds:allParts).filter((id,index,all)=>validPart(id)&&all.indexOf(id)===index);
  mapPartId=mapPartIds.includes(overview.partId)?overview.partId:mapPartIds[0]||'';
  mapHighlightPartId=mapPartIds.includes(overview.highlightPartId)?overview.highlightPartId:'';
  $('#showNumbers').value=['none','parts','workers','pending'].includes(overview.numbers)?overview.numbers:'none';
  $('#mapSeeMachines').checked=overview.machines!==false;$('#mapSeeComponents').checked=overview.components!==false;
  for(const [key,id] of [['dateStart','dateStart'],['dateEnd','dateEnd'],['search','searchInput'],['status','statusFilter'],['focus','focusMode'],['perspective','perspective'],['ganttScale','ganttScale'],['scheduleMode','scheduleMode']])if(overview[key]!==undefined)$('#'+id).value=overview[key];
  for(const [key,id] of [['keepPredecessors','keepPredecessors'],['showSubprocesses','showSubprocesses']])if(typeof overview[key]==='boolean')$('#'+id).checked=overview[key];
  if(Array.isArray(overview.types))types=new Set(overview.types.filter(type=>allTypes.includes(type)));
  if(Number.isFinite(overview.zoom))zoom=Math.max(.1,Math.min(2,overview.zoom));
  if(/^\d{4}-\d{2}-\d{2}$/.test(overview.month||'')){const [year,mon,day]=overview.month.split('-').map(Number);month=new Date(year,mon-1,day);}
  renderTypeFilters();
}
function restoreViewSettings() {
  if(!store)return;
  const settings=workspace.viewSettings?.[store.id]||{};
  restoreMapSettings(store.id==='library'?'library':'overview');
  const production=settings.production||{};
  $('#productionLine').value=['','SMT','LDM','Nexlide','TEM'].includes(production.line)?production.line:'';
  $('#productionLine').dataset.previous=$('#productionLine').value;
  productionSelections=production.selections&&typeof production.selections==='object'&&!Array.isArray(production.selections)?production.selections:{};
  const lineSettings=productionSelections[$('#productionLine').value||'all']||production;
  productionPartsCustomized=lineSettings.partSelectionCustomized===true;
  productionPartIds=(productionPartsCustomized&&Array.isArray(lineSettings.partIds)?lineSettings.partIds:store.entities.filter(e=>Model.isProductPart(e)&&(!$('#productionLine').value||e.productionFamily===$('#productionLine').value)).map(e=>e.id)).filter(id=>store.entities.some(e=>e.id===id&&Model.isProductPart(e)&&(!$('#productionLine').value||e.productionFamily===$('#productionLine').value)));
  productionHighlightPartId=productionPartIds.includes(lineSettings.highlightPartId)?lineSettings.highlightPartId:'';
  $('#productionNumbers').value=['none','parts','workers','pending'].includes(production.numbers)?production.numbers:'none';
  $('#productionSeeMachines').checked=production.machines!==false;
  $('#productionSeeComponents').checked=production.components!==false;
  selectedWipSnapshotId=production.snapshotId||settings['lens-production']?.snapshotId||'';
  if(Array.isArray(production.layers))document.querySelectorAll('[data-production-layer]').forEach(input=>input.checked=production.layers.includes(input.dataset.productionLayer));
  if(typeof production.subprocesses==='boolean')$('#productionSubprocesses').checked=production.subprocesses;
  if(Number.isFinite(production.zoom))productionZoom=Math.max(.15,Math.min(2,production.zoom));
  const stakeholders=settings.stakeholders||{};
  if(stakeholderViews.includes(stakeholders.view))stakeholderView=stakeholders.view;
  if(stakeholders.area!==undefined)$('#stakeholderArea').value=stakeholders.area;
  if(stakeholders.grouping!==undefined)$('#stakeholderGrouping').value=stakeholders.grouping;
  preferredStakeholderDepartment=stakeholders.department||'';
  openStakeholderGroups.clear();for(const id of stakeholders.openGroups||[])openStakeholderGroups.add(id);
  stakeholderGroupsInitialized=Array.isArray(stakeholders.openGroups);
}
async function route() {
  const serial=++routeSerial;
  metricLoadSerial++;
  qualityExpanded.clear();
  if(!location.hash)history.replaceState(null,'','#/projects');
  const pendingId=location.hash.startsWith('#/projects/')?decodeURIComponent(location.hash.slice(11)):'';
  if(workspace?.catalogOnly&&location.hash==='#/library'){const loaded=await LocalAPI.load();if(serial!==routeSerial)return;workspace=loaded;}
  if(LocalAPI.projectOpen&&workspace?.projects.some(p=>p.id===pendingId&&p.viewPending)){
    $('#projectError').textContent='프로젝트 내용을 불러오는 중…';
    try{const loaded=await LocalAPI.projectOpen(pendingId);if(serial!==routeSerial)return;workspace=loaded;basicAccess=workspace.access?.mode==='basic';window.OwnerAccess?.init(workspace.access,{whole:openWholeProcess,production:()=>openWorkstream('production')});}
    catch(e){if(e.message==='PROJECT_PASSWORD_REQUIRED'){projectPasswordDialog(pendingId);return;}$('#projectError').textContent=e.message;return;}
  }
  if(basicAccess&&workspace?.access?.projectId&&!['#/projects','#/projects/'+workspace.access.projectId].includes(location.hash))history.replaceState(null,'','#/projects');
  $('#copilotQuestion').value='';
  logDraft=null;pendingCache=null;$('#logText').value='';$('#logName').value='';$('#logPreview').innerHTML='';$('#logError').textContent='';$('#saveLogs').disabled=true;
  let id=''; try { if(location.hash.startsWith('#/projects/')) id=decodeURIComponent(location.hash.slice(11)); } catch {}
  if(workspace?.projectAliases?.[id]){id=workspace.projectAliases[id];history.replaceState(null,'','#/projects/'+id);}
  store=location.hash==='#/library'?workspace?.library:workspace?.projects.find(p=>p.id===id)||null;
  wipData=null;wipHistoryData=null;wipDraft=null;wipFile=null;staffingData=[];productionStaffingData=[];selectedWipSnapshotId='';wipPartMappings={};wipStepMappings={};
  selectedId=null; selectedWorkstream=''; activeTab=store&&store.id!=='library'?'Entry':'Overview'; stakeholderView='People & roles'; productionMode='Process map';productionPartIds=[];productionPartsCustomized=false;productionSelections={};$('#productionLine').value='';$('#productionLine').dataset.previous='';apqpView='Phase dashboard'; openStakeholderGroups.clear(); stakeholderGroupsInitialized=false; resetFilters(); invalidatePreview();
  productionZoom=1;month=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  $('#ganttScale').value='month';$('#scheduleMode').value='gantt';
  document.querySelectorAll('[data-production-layer]').forEach(input=>input.checked=input.dataset.productionLayer!=='parts');$('#productionSubprocesses').checked=true;
  $('#stakeholderArea').value='';$('#stakeholderDepartment').value='';$('#stakeholderGrouping').value='department';
  if(store?.id==='library'){$('#perspective').value='all';types=new Set(allTypes);renderTypeFilters();}
  if(basicAccess){activeTab='Overview';selectedWorkstream='production';}
  restoreViewSettings();
  $('#csvText').value=''; $('#csvResult').innerHTML=''; $('#csvFile').value='';csvChoices={};
  ingestionDraft=null;ingestionSource=null;ingestionJobId=null;ingestionSelection=null;ingestionConfirm=false;$('#aiSourceText').value='';$('#aiSourceFile').value='';renderIngestionReview();
  $('#inspector').hidden=true; document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  sampleRiskMode='risks';
  render();
  if(store&&store.id!=='library')loadProjectMetrics();
}
function options() {
  return {types:[...types].filter(type=>!['Risk','Issue'].includes(type)),query:$('#searchInput').value,status:$('#statusFilter').value,
    start:$('#dateStart').value,end:$('#dateEnd').value,selectedId,
    focus:selectedId&&!mapSelectedIds.size ? $('#focusMode').value : '',keepPredecessors:$('#keepPredecessors').checked,showSubprocesses:$('#showSubprocesses').checked};
}
function render() {
  if(basicAccess){activeTab='Overview';selectedWorkstream='production';}
  $('#projectHome').hidden=Boolean(store); $('#projectShell').hidden=!store;
  $('#projectForm').hidden=!workspace||window.PUBLIC_READ_ONLY;
  $('#projectError').textContent=startupError;
  $('#localStartHelp').hidden=!startupError||window.CLOUD_BACKEND||window.PUBLIC_READ_ONLY;
  const projectFilter=$('#projectTypeFilter').value,listed=(workspace?.projects||[]).filter(p=>!workspace.projectAliases?.[p.id]);
  $('#projectList').innerHTML=window.ProjectTypes.TYPES.filter(t=>!projectFilter||projectFilter===t.id).map(t=>{const group=listed.filter(p=>window.ProjectTypes.kind(p)===t.id);return group.length?'<section class="project-type-group"><h2>'+h(t.label)+' <small>'+group.length+'</small></h2><div class="project-type-cards">'+group.map(p=>'<article class="project-card"><a href="#/projects/'+encodeURIComponent(p.id)+'">'+h(p.name)+'</a><span>'+h(p.status)+(p.viewPending?' · 프로젝트 열기':' · '+p.entities.length+' objects')+'</span></article>').join('')+'</div></section>':'';}).join('');
  $('#editProjectType').hidden=!store||store.id==='library'||window.PUBLIC_READ_ONLY||basicAccess;
  if(!store){eventHistoryUI.update(null);progressUI.update(null);hourlyUI.update(null);samplePreparationUI.update(null);$('#sampleRiskTabs').hidden=true;$('#samplePreparationPanel').hidden=true;$('#projectFeatures').hidden=true;return;}
  const selectionContext=[store.id,selectedWorkstream,activeTab,$('#mapProductionLine').value,$('#productionLine').value].join('|');
  if(selectionContext!==mapSelectionContext){mapSelectedIds.clear();mapSelectionContext=selectionContext;if(pendingMapSelection&&Model.byId(store,pendingMapSelection))mapSelectedIds.add(pendingMapSelection);}
  for(const id of mapSelectedIds)if(!Model.byId(store,id))mapSelectedIds.delete(id);
  const library=store.id==='library',archived=store.status==='archived';
  $('#entryCopilot').hidden=library;
  const entry=activeTab==='Entry'&&!library,lens=activeTab==='Overview'&&Boolean(selectedWorkstream);
  $('#projectEntry').hidden=!entry;$('#projectMenuButton').hidden=library||entry;
  const productionScope=selectedWorkstream==='production';
  $('#tabs').hidden=entry||(lens&&!productionScope)||activeTab==='History';
  $('#lensHeader').hidden=!selectedWorkstream;$('#viewFilters').hidden=entry||activeTab==='History';
  $('#projectHistory').hidden=activeTab!=='History';
  $('#overview').classList.toggle('lens-only',lens);
  $('.schedule-panel').hidden=activeTab!=='Timeline';
  $('.map-panel').hidden=activeTab==='Timeline';
  $('#overview').classList.toggle('library-single-panel',true);
  $('#perspectiveControl').hidden=lens;
  $('#mapPartControl').hidden=true;
  $('#mapPartMulti').hidden=activeTab!=='Overview'||Boolean(selectedWorkstream&&selectedWorkstream!=='production');
  $('#mapProductionLineControl').hidden=!productionScope;
  $('#mapHighlightControl').hidden=!lens||selectedWorkstream!=='production';
  $('#mapContextControls').hidden=activeTab!=='Overview'||$('#perspective').value!=='process';
  $('#overview .layer-menu').hidden=lens&&selectedWorkstream==='production';
  $('#mapTitle').textContent=lens?Model.WORKSTREAMS.find(item=>item.code===selectedWorkstream)?.label+' process map':'Process map';
  if(selectedWorkstream){$('#lensTitle').textContent=Model.WORKSTREAMS.find(item=>item.code===selectedWorkstream)?.label||'';$('#lensHeader div > p:last-child').textContent=selectedWorkstream==='production'?'Production scope · Parts, machines, people and related records. Select a process for risks and issues.':'Recorded work and dependencies. Select a node for its people, Parts and other context.';}
  if(entry)renderProjectEntry();
  if(activeTab==='History')renderHistory();
  $('#projectTitle').textContent=store.name; $('#projectState').textContent=library?'All ontology · shared DB':(window.ProjectTypes.TYPES.find(t=>t.id===window.ProjectTypes.kind(store))?.label||'')+(archived?' · Archived · read only':'');
  $('#addFromLibrary').hidden=library;$('#renameProject').hidden=library;$('#archiveProject').hidden=library;$('#removeFromProject').hidden=library;
  $('#projectFeatures').hidden=library||basicAccess;$('#projectFeatures').disabled=store.status==='archived';
  $('#scopeLabel').textContent=library?'Global Library · unassigned objects':'Project: '+store.name+' · writes to shared DB';
  $('#archiveProject').textContent=archived?'Restore':'Archive';
  ['renameProject','addFromLibrary','removeFromProject','recordsAdd','productionConnect','addEntityButton','addRelationButton','editEntity','previewCSV','extractSource'].forEach(id=>$('#'+id).disabled=archived);
  $('#extractSource').disabled=archived||!aiConfigured;
  $('#externalTransfer').textContent=aiConfigured?'추출은 이 원문만 OpenAI로 보냅니다. 온톨로지 전체는 보내지 않습니다.':'AI가 연결되지 않았습니다. 서버에 OPENAI_API_KEY가 있어야 합니다. 수동 입력과 CSV는 그대로 됩니다.';
  if(archived) invalidatePreview();
  const visibleTabs=productionScope?['Overview','Parts','Risk / Issues','Resources','Stakeholders','Records']:['Overview','Timeline',...tabs.filter(tab=>tab!=='Overview')];
  if(!library)visibleTabs.push('Copilot');
  $('#tabs').innerHTML=visibleTabs.map(tab=>'<button data-tab="'+h(tab)+'"'+(activeTab===tab?' aria-current="page"':'')+'>'+h(tab==='Overview'?'Process map':tab)+'</button>').join('');
  $('#overview').hidden=!['Overview','Timeline'].includes(activeTab); $('#inputView').hidden=activeTab!=='Input';
  $('#recordsView').hidden=['Entry','Overview','Timeline','Input','History','Copilot'].includes(activeTab);
  $('#copilotView').hidden=activeTab!=='Copilot';
  $('#productionView').hidden=activeTab!=='Production'||productionMode!=='Process map';
  $('#wipView').hidden=activeTab!=='Production'||productionMode!=='WIP snapshots';
  $('#productionStaffingView').hidden=activeTab!=='Production'||productionMode!=='WIP snapshots';
  $('#productionLogsView').hidden=activeTab!=='Production'||productionMode!=='Process logs';
  const opt=options(), invalid=opt.start && opt.end && opt.start>opt.end;
  $('#filterError').textContent=invalid?'From must be on or before Through. Fix the range to see results.':'';
  if(activeTab==='Overview') renderMap(invalid);
  else if(activeTab==='Timeline')renderSchedule(invalid);
  else if(activeTab==='Copilot')renderCopilot();
  else if(!['Entry','Input','History'].includes(activeTab)) renderRecords(invalid);
  if(!$('#inspector').hidden) renderInspector();
  decorateMapSelection();
  eventHistoryUI.update(!basicAccess&&!progressUI.active&&!hourlyUI.active&&['Overview','Production'].includes(activeTab)?{workspace,store,kind:activeTab==='Production'?'production':'overview',viewKey:activeTab==='Production'?'production':selectedWorkstream?'lens-'+selectedWorkstream:'overview',selection:mapSelectedIds,workstream:selectedWorkstream,groups:historyGroups,lineId:selectedWorkstream==='production'?store.entities.find(e=>e.type==='Resource'&&e.resourceKind==='line'&&e.name===$('#mapProductionLine').value)?.id||'':''}:null);
  const progressKind=activeTab==='Production'&&productionMode==='Process map'?'production':activeTab==='Overview'&&selectedWorkstream==='production'?'overview':'';
  const features=workspace.viewSettings?.[store.id]?.features||window.HourlyProduction.defaults(store);
  progressUI.update(progressKind&&store.id!=='library'&&(basicAccess||features.wip)?{workspace,store,basic:basicAccess,kind:progressKind,partIds:progressKind==='production'?productionPartIds:mapPartIds,zoom:progressKind==='production'?productionZoom:zoom,selectPart:id=>{if(progressKind==='production'){productionPartIds=[id];productionPartsCustomized=true;}else{mapPartIds=[id];mapPartsCustomized=true;}},restore:s=>{if(progressKind==='production'){productionPartIds=[...s.ids];productionZoom=s.zoom;}else{mapPartIds=[...s.ids];zoom=s.zoom;}}}:null);
  hourlyUI.update(!basicAccess&&features.hourly&&progressKind?{workspace,store,kind:progressKind,select:id=>{mapSelectedIds.clear();mapSelectedIds.add(id);decorateMapSelection();}}:null);
  document.querySelectorAll('.production-mode-toolbar').forEach(bar=>bar.hidden=true);
  if(progressKind&&(progressUI.ctx||hourlyUI.ctx)){
    const stage=$('#'+(progressKind==='production'?'productionMapStage':'mapStage')),container=stage.closest('.event-history-layout')||stage;
    let bar=container.parentElement.querySelector(':scope > .production-mode-toolbar');
    if(!bar){bar=document.createElement('nav');bar.className='production-mode-toolbar';bar.setAttribute('aria-label','Production data views');}
    container.before(bar);bar.hidden=false;
    if(progressUI.ctx){bar.append(progressUI.toggleButton);progressUI.view.bar.hidden=!progressUI.active;}
    if(hourlyUI.ctx){bar.append(hourlyUI.toggleButton);hourlyUI.bar.hidden=!hourlyUI.active;}
  }
  const sizedMap=activeTab==='Production'&&productionMode==='Process map'?$('#productionMapStage'):['Overview','Timeline'].includes(activeTab)?$('#mapStage'):null;
  if(sizedMap)placeMapResize(sizedMap);
  renderSavedChange();
  mapAssistantUI.update();
  const sampleRisk=activeTab==='Risk / Issues'&&window.SamplePreparation.isSample(store)&&!basicAccess,showPreparation=sampleRisk&&sampleRiskMode==='preparation';
  $('#sampleRiskTabs').hidden=!sampleRisk;$('#samplePreparationPanel').hidden=!showPreparation;$('#recordsTable').hidden=showPreparation;
  $('#sampleRiskTabs').querySelectorAll('[data-sample-risk]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sampleRisk===sampleRiskMode)));
  samplePreparationUI.update(showPreparation?{workspace,store,container:$('#samplePreparationPanel'),readOnly:window.PUBLIC_READ_ONLY||basicAccess}:null);
}
function placeMapResize(stage){
  const layout=stage.closest('.event-history-layout'),host=layout||stage.parentElement;
  let handle=host.querySelector(':scope > .map-resize-bar');
  if(!handle){
    handle=document.createElement('div');handle.className='map-resize-bar';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','horizontal');handle.setAttribute('aria-label','프로세스 맵 크기');
    const apply=height=>{const next=Math.round(Math.max(220,Math.min(window.innerHeight*1.8,height)));stage.style.setProperty('--map-h',next+'px');stage.classList.add('map-user-height');localStorage.setItem('pm-map-height:'+stage.id,String(next));};
    handle.onpointerdown=event=>{
      if(event.button!==0)return;event.preventDefault();
      const startY=event.clientY,startH=stage.getBoundingClientRect().height;
      handle.setPointerCapture(event.pointerId);
      const move=ev=>apply(startH+ev.clientY-startY);
      const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
    };
    handle.onkeydown=event=>{if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;event.preventDefault();apply(stage.getBoundingClientRect().height+(event.key==='ArrowDown'?48:-48));};
  }
  if(layout)layout.append(handle);else stage.after(handle);
  const saved=Number(localStorage.getItem('pm-map-height:'+stage.id));
  if(saved){stage.style.setProperty('--map-h',saved+'px');stage.classList.add('map-user-height');}
}
function renderProjectEntry() {
  const workstreams=store.workstreams||{};
  const descriptions={commercial:'Customer requests, quotation, orders and forecasts',engineering:'Requirements, design, revisions and validation',purchasing:'Suppliers, materials, tooling and purchasing',production:'Part routes, machines, workers and line release',quality:'APQP, gates, inspection and approval evidence',logistics:'Inbound supply, inventory, packing and delivery'};
  $('#workstreamCards').innerHTML=Model.WORKSTREAMS.map(item=>{
    const count=Object.values(workstreams).filter(codes=>codes.includes(item.code)).length;
    return '<button class="workstream-choice" data-workstream="'+item.code+'"><span class="workstream-code">'+h(item.code)+'</span><strong>'+h(item.label)+'</strong><span>'+h(descriptions[item.code])+'</span><small>'+count+' assigned object'+(count===1?'':'s')+' <span aria-hidden="true">→</span></small></button>';
  }).join('');
  const unassigned=store.entities.filter(entity=>entity.status!=='archived'&&!['Person','Organization'].includes(entity.type)&&!(workstreams[entity.id]||[]).length);
  $('#unassignedCount').textContent='Unassigned objects · '+unassigned.length;
  $('#unassignedItems').innerHTML=unassigned.slice(0,100).map(entity=>'<button data-select="'+h(entity.id)+'">'+h(entity.type+' · '+entity.name)+'</button>').join('')+(unassigned.length>100?'<p>Showing first 100. Find the rest in Objects.</p>':'')||'<p>Every object is classified.</p>';
}
const changeValue=value=>value==null||value===''?'—':typeof value==='object'?JSON.stringify(value):String(value);
function changeMarkup(change) {
  return '<ol class="change-items">'+change.items.map(item=>'<li><strong>'+h(item.action+' · '+item.label)+'</strong>'+(item.fields?.length?'<dl>'+item.fields.map(field=>'<div><dt>'+h(dateLabel(field.key))+'</dt><dd>'+h(changeValue(field.before))+' → '+h(changeValue(field.after))+'</dd></div>').join('')+'</dl>':'')+'</li>').join('')+'</ol>';
}
function renderSavedChange() {
  const change=workspace?.pendingChange;
  const visible=Boolean(change&&store&&(change.scope===store.id||change.scope===null&&store.id==='library'));
  $('#savedChangeReview').hidden=!visible;
  if(!visible)return;
  $('#savedChangeTime').textContent=new Date(change.recordedAt).toLocaleString();
  $('#savedChangeCount').textContent=change.items.length+' recorded change'+(change.items.length===1?'':'s');
  $('#savedChangeItems').innerHTML=changeMarkup(change);
  $('#savedChangeError').textContent='';
}
function renderHistory() {
  let day='';
  $('#historyEntries').innerHTML=historyRows.map(change=>{
    const recorded=change.recordedAt.slice(0,10),heading=recorded!==day?'<h2>'+h(recorded)+'</h2>':'';day=recorded;
    const origin=store.id==='library'?(workspace.projects.find(project=>project.id===change.scope)?.name||'Global Library')+' · ':'';
    return heading+'<details class="history-change"><summary><span>'+h(new Date(change.recordedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))+'</span><strong>'+h(origin+(change.revertOf?'Reverted a save':change.items.map(item=>item.label).slice(0,2).join(' · ')))+'</strong><small>'+change.items.length+' changes'+(change.revertedAt?' · reverted':'')+'</small></summary>'+changeMarkup(change)+'</details>';
  }).join('')||'<p class="empty-note">No saved changes on this date. New edits will appear here; older database history was not invented.</p>';
  $('#historyMore').hidden=!historyMore;
}
async function loadHistory(reset=true) {
  if(!store)return;
  const scope=store.id,date=$('#historyDate').value,offset=reset?0:historyOffset;
  try{
    const result=await LocalAPI.changes(scope,offset,date);
    if(store?.id!==scope||$('#historyDate').value!==date)return;
    historyRows=reset?result.changes:[...historyRows,...result.changes];
    historyOffset=offset+result.changes.length;historyMore=result.more;renderHistory();
  }catch(error){$('#historyEntries').innerHTML='<p class="form-error">'+h(error.message)+'</p>';}
}
function renderTypeFilters() {
  $('#typeFilters').innerHTML=allTypes.map(type=>'<label class="check"><input type="checkbox" data-type="'+h(type)+'"'+(types.has(type)?' checked':'')+'>'+h(type)+'</label>').join('');
}
function renderMapPartOptions() {
  const line=selectedWorkstream==='production'?$('#mapProductionLine').value:'';
  const finalOnly=selectedWorkstream==='production';
  const parts=(finalOnly?window.FinalParts.list(store):store.entities.filter(Model.isProductPart)).filter(e=>!line||e.productionFamily===line).sort(partFamilyOrder);
  if(finalOnly)mapPartIds=window.FinalParts.expand(store,mapPartIds);
  if(!mapPartsCustomized)mapPartIds=parts.map(part=>part.id);
  const ids=new Set(parts.map(part=>part.id));mapPartIds=mapPartIds.filter(id=>ids.has(id));
  if(!mapPartIds.includes(mapPartId))mapPartId=mapPartIds[0]||'';
  $('#mapPart').innerHTML='<option value="">All parts</option>'+parts.map(e=>'<option value="'+h(e.id)+'">'+h(e.name)+'</option>').join('');
  $('#mapPart').value=mapPartId;
  const term=$('#mapPartSearch').value.trim().toLowerCase();
  $('#mapPartChoices').innerHTML=partChoiceRows(parts,term,mapPartIds,'map');$('#mapPartChoices').querySelectorAll('[data-partial]').forEach(input=>input.indeterminate=true);
  $('#mapPartNav').hidden=true;
  $('#mapPartMulti').querySelector('summary').textContent=(finalOnly&&!progressUI.active?'Models · '+window.FinalParts.models(store,parts).filter(g=>g.parts.some(p=>mapPartIds.includes(p.id))).length+' / '+window.FinalParts.models(store,parts).length:(finalOnly?'Final parts':'Parts')+' · '+mapPartIds.length+' / '+parts.length);
  if(!mapPartIds.includes(mapHighlightPartId))mapHighlightPartId='';
  $('#mapHighlight').innerHTML='<option value="">All selected Parts</option>'+parts.filter(part=>mapPartIds.includes(part.id)).map(part=>'<option value="'+h(part.id)+'">'+h(part.name)+'</option>').join('');
  $('#mapHighlight').value=mapHighlightPartId;
}
function renderProductionPartOptions() {
  const line=$('#productionLine').value;
  const parts=window.FinalParts.list(store).filter(e=>!line||e.productionFamily===line).sort(partFamilyOrder);
  productionPartIds=window.FinalParts.expand(store,productionPartIds);
  if(!productionPartsCustomized)productionPartIds=parts.map(part=>part.id);
  const ids=new Set(parts.map(part=>part.id));productionPartIds=productionPartIds.filter(id=>ids.has(id));
  const term=$('#productionPartSearch').value.trim().toLowerCase();
  $('#productionPartChoices').innerHTML=partChoiceRows(parts,term,productionPartIds,'production');$('#productionPartChoices').querySelectorAll('[data-partial]').forEach(input=>input.indeterminate=true);
  $('#productionPartMulti summary').textContent=(!progressUI.active?'Models · '+window.FinalParts.models(store,parts).filter(g=>g.parts.some(p=>productionPartIds.includes(p.id))).length+' / '+window.FinalParts.models(store,parts).length:'Final parts · '+productionPartIds.length+' / '+parts.length);
  if(!productionPartIds.includes(productionHighlightPartId))productionHighlightPartId='';
  $('#productionHighlight').innerHTML='<option value="">All selected Parts</option>'+parts.filter(part=>productionPartIds.includes(part.id)).map(part=>'<option value="'+h(part.id)+'">'+h(part.name)+'</option>').join('');
  $('#productionHighlight').value=productionHighlightPartId;
}
const partFamily=part=>part.productionFamily?.trim()||'Unclassified';
const partFamilyOrder=(a,b)=>partFamily(a).localeCompare(partFamily(b))||(a.productFamily||'').localeCompare(b.productFamily||'')||a.name.localeCompare(b.name);
function partChoiceRows(parts,term,selected,prefix){
  const production=prefix==='production'||selectedWorkstream==='production',chosen=new Set(selected);
  const leaf=part=>'<div class="map-part-choice"><label class="check"><input type="'+(production&&progressUI.active?'radio':'checkbox')+'" name="'+prefix+'-final-part" data-'+prefix+'-part-choice="'+h(part.id)+'"'+(chosen.has(part.id)?' checked':'')+'>'+h(window.FinalParts.label(part)+(part.modelCode?' · '+part.modelCode:''))+(part.routeStatus==='unregistered'?'<small>공정 미등록</small>':'')+'</label><button type="button" data-'+prefix+'-only="'+h(part.id)+'">Only</button></div>';
  const matches=part=>!term||window.FinalParts.label(part).toLowerCase().includes(term)||partFamily(part).toLowerCase().includes(term)||(part.productFamily||'').toLowerCase().includes(term)||(part.modelCode||'').toLowerCase().includes(term);
  let last='';const heading=part=>{const family=partFamily(part)+(part.productFamily?' / '+part.productFamily:''),text=family===last?'':'<strong class="part-family-heading">'+h(family)+'</strong>';last=family;return text;};
  if(!production)return parts.filter(matches).map(part=>heading(part)+leaf(part)).join('')||'<p class="muted">No matching Parts.</p>';
  return window.FinalParts.models(store,parts).filter(group=>group.parts.some(matches)).map(group=>{
    const shown=group.parts.filter(matches),ids=group.parts.map(p=>p.id),count=ids.filter(id=>chosen.has(id)).length;
    return heading(group.parts[0])+'<details class="part-model-group"'+(progressUI.active||term?' open':'')+'><summary><label class="check"><input type="checkbox" data-'+prefix+'-model-choice="'+h(ids.join(','))+'"'+(count===ids.length?' checked':'')+(count&&count<ids.length?' data-partial="true"':'')+'>'+h(group.name)+' <small>'+group.parts.length+' 세부 파츠</small></label><button type="button" data-'+prefix+'-model-only="'+h(ids.join(','))+'">Only</button></summary><div class="part-model-children">'+shown.map(leaf).join('')+'</div></details>';
  }).join('')||'<p class="muted">No matching Parts.</p>';
}
function durationLabel(seconds) {
  if(seconds<60)return Math.round(seconds)+'s';
  if(seconds<3600)return (seconds/60).toFixed(seconds%60?1:0)+'m';
  return (seconds/3600).toFixed(1)+'h';
}
function networkMetric(node,mode,highlightPartId='') {
  if(mode==='none'||node.entity.type!=='Production Step')return null;
  if(highlightPartId&&node.partIds?.length&&!node.partIds.includes(highlightPartId))return null;
  if(mode==='pending'){
    const start=$('#dateStart').value,end=$('#dateEnd').value;
    if(pendingCache?.project!==store||pendingCache.start!==start||pendingCache.end!==end)pendingCache={project:store,start,end,rows:Logs.pending(store,{start,end})};
    const partIds=highlightPartId?[highlightPartId]:node.partIds?.length?node.partIds:null;
    const rows=pendingCache.rows.filter(item=>item.stepId===node.id&&(!partIds||partIds.includes(item.partId)));
    const seconds=rows.map(row=>row.seconds).sort((a,b)=>a-b),n=seconds.length,median=n?(seconds[Math.floor(n/2)]+seconds[Math.ceil(n/2)-1])/2:null;
    return {text:median===null?'— pending':durationLabel(median)+' pending',title:n?'Median of '+n+' measured interval'+(n===1?'':'s')+' · '+[...new Set(rows.map(row=>row.basis))].join('; ')+' · '+rows.map(row=>row.traceId+': '+durationLabel(row.seconds)).join('; '):'No reviewed, linked arrival/start or previous-completion/start pair. No time is estimated.'};
  }
  if(mode==='parts'){
    const partIds=highlightPartId?[highlightPartId]:node.partIds?.length?node.partIds:store.relations.filter(r=>['applies_to','produces'].includes(r.type)&&r.from===node.id).map(r=>r.to);
    const cells=(wipData?.counts||[]).filter(item=>item.stepId===node.id&&partIds.includes(item.partId));
    const snapshot=wipData?.snapshots.find(item=>item.id===wipData.selected);
    return {text:(cells.length?cells.reduce((sum,item)=>sum+item.quantity,0):'—')+' parts',title:snapshot?'MES WIP · '+snapshot.filename+' · '+snapshot.capturedAt+' · '+(cells.length?cells.map(item=>'row '+item.row+', column '+item.column).join('; '):'no linked count'):'No saved WIP snapshot'};
  }
  const machines=store.relations.filter(r=>r.type==='requires'&&r.from===node.id&&Model.byId(store,r.to)?.type==='Resource').map(r=>r.to);
  const direct=productionStaffingData.find(item=>item.targetId===node.id);
  const row=direct||(machines.length===1?productionStaffingData.find(item=>item.targetId===machines[0]):null);
  return {text:(row?row.count:'—')+' workers',title:row?'Direct '+row.basis+' at '+row.capturedAt+' · '+(direct?'Step':'one linked machine')+' · shift '+(row.shift||'not recorded'):'No direct Step observation'+(machines.length===1?' or linked-machine observation':'')};
}
function mapGroupFrames(layout) {
  return (layout.frames||[]).map(f=>'<g class="universal-group" data-model-parts="'+h((f.partIds||[]).join(','))+'" transform="translate('+f.x+' '+f.y+')"><rect class="universal-group-boundary" width="'+f.width+'" height="'+f.height+'" rx="16"></rect>'+(f.collapsed?'':f.static?'<text x="20" y="32">'+h(f.kind+' · '+f.name)+'</text>':'<g data-group-toggle="'+h(f.id)+'" tabindex="0" role="button" aria-expanded="true" aria-label="Collapse '+h(f.name)+'"><rect class="universal-group-heading" x="8" y="8" width="'+(f.width-16)+'" height="36" rx="8"></rect><text x="20" y="32">'+h(f.kind+' · '+f.name)+' −</text></g>')+'</g>').join('');
}
function mapGroupSettings(network,whole=false) {
  const saved=workspace.viewSettings?.[store.id]?.universalGroups;
  if(saved)return saved.collapsed||[];
  const groups=MapGroups.universalGraph({entities:network.nodes.map(n=>n.entity),relations:network.edges},[],store).groups;
  return [...groups.values()].filter(g=>g.kind==='Team'||whole&&g.kind==='Part family').map(g=>g.id);
}
function presentNetwork(kind,network,layout,partOnly=false,whole=false) {
  const production=kind==='production',options={showMachines:$(production?'#productionSeeMachines':'#mapSeeMachines').checked,showComponents:$(production?'#productionSeeComponents':'#mapSeeComponents').checked,collapsed:mapGroupSettings(network,whole)};
  if(partOnly){const row=MapGroups.partRows(store,network,options);network=row.network;layout=row.layout;historyGroups=Object.fromEntries([...row.groups].map(([id,g])=>[id,[...new Set(g.members.map(n=>n.entity.id))]]));}
  const quality=QualityMap.augment(store,network,layout,qualityExpanded,{showPeople:$(production?'#productionSeeStakeholders':'#mapSeeStakeholders').checked});
  if(partOnly)return quality;
  const grouped=MapGroups.networkGroups(store,quality.network,{...options,layout:quality.layout});
  historyGroups=Object.fromEntries([...grouped.groups].map(([id,g])=>[id,[...new Set(g.members.map(n=>n.entity.id))]]));
  return grouped;
}
function drawNetworkCanvas(kind,projection,layout) {
  const production=kind==='production',edgeLayer=$(production?'#productionEdges':'#edgeLayer'),nodeLayer=$(production?'#productionNodes':'#nodeLayer');
  const progress=progressUI.enabled(kind,store)||hourlyUI.enabled(kind,store);
  if(production)$('#productionLaneLabels').innerHTML='';
  const mode=$(production?'#productionNumbers':'#showNumbers').value,highlight=production?productionHighlightPartId:selectedWorkstream==='production'?mapHighlightPartId:'';
  const stage=$(production?'#productionMapStage':'#mapStage');
  let notice=stage.querySelector('.highlight-note');
  if(!notice){notice=document.createElement('p');notice.className='highlight-note';notice.setAttribute('role','status');stage.appendChild(notice);}
  notice.hidden=!highlight||projection.nodes.some(node=>Flow.belongsToPart(node,highlight));
  notice.textContent=notice.hidden?'':'No recorded route for '+(Model.byId(store,highlight)?.name||'this Part')+'. Add confirmed process links before highlighting.';
  const related=!highlight&&selectedId&&!$('#inspector').hidden?($('#focusMode').value==='downstream'&&!production?Flow.downstream(store,selectedId):Flow.neighborhood(store,selectedId)):null;
  const query=$('#searchInput').value.trim(),matches=query?new Set(Model.search(store,query).map(item=>item.id)):null;
  if(matches)for(const relation of store.relations)if(matches.has(relation.from)||matches.has(relation.to)){matches.add(relation.from);matches.add(relation.to);}
  const contextMode=Array.isArray(layout.satellites);
  const satellites=(layout.satellites||[]).filter(item=>item.kind==='machine'?$(production?'#productionSeeMachines':'#mapSeeMachines').checked:$(production?'#productionSeeComponents':'#mapSeeComponents').checked);
  const satelliteEdges=satellites.map(item=>{
    const position=layout.positions[item.stepId],x=item.x,y=item.y;
    if(!position)return '';
    const incoming=item.direction==='input',sx=incoming?x+188:position.x+194,ex=incoming?position.x:x;
    const sy=y+24,ey=position.y+30;
    const path='M '+sx+' '+(incoming?sy:ey)+' C '+((sx+ex)/2)+' '+(incoming?sy:ey)+', '+((sx+ex)/2)+' '+(incoming?ey:sy)+', '+ex+' '+(incoming?ey:sy);
    const muted=!Flow.belongsToPart(item,highlight);
    return '<g data-from="'+h(item.stepId)+'" data-to="'+h(item.entity.id)+'" class="production-context-link '+(item.kind==='machine'?'machine-link ':'material-link ')+(muted?'route-muted':'')+'"><title>'+h(item.relation.type+' · '+item.entity.name)+'</title><path d="'+path+'" marker-end="url(#'+(production?'productionArrow':'arrow')+')"></path></g>';
  }).join('');
  edgeLayer.innerHTML=projection.edges.map(edge=>{
    const from=layout.positions[edge.from],to=layout.positions[edge.to];if(!from||!to)return '';
    const horizontal=progress||layout.horizontal&&Math.abs(from.y-to.y)<1;
    const sx=from.x+(horizontal?194:97),sy=from.y+(progress?50:horizontal?30:60),ex=to.x+(horizontal?-3:97),ey=to.y+(progress?50:horizontal?30:-3);
    const path=horizontal?'M '+sx+' '+sy+' C '+((sx+ex)/2)+' '+sy+', '+((sx+ex)/2)+' '+ey+', '+ex+' '+ey:ey>sy?'M '+sx+' '+sy+' C '+sx+' '+((sy+ey)/2)+', '+ex+' '+((sy+ey)/2)+', '+ex+' '+ey:'M '+sx+' '+sy+' C '+(sx+105)+' '+(sy+26)+', '+(ex+105)+' '+(ey-26)+', '+ex+' '+ey;
    const failure=edge.type==='on_failure',rework=edge.type==='rework_of',context=edge.qualityEdge||['supports_line','operated_in','subprocess','member_of','reports_via','escalates_to','reports_to','manages','works_on','assigned'].includes(edge.type);
    const muted=!Flow.belongsToPart(edge,highlight)||related&&!related.has(edge.from)&&!related.has(edge.to);
    const arrow=production?failure?'productionFailureArrow':rework?'productionReturnArrow':'productionArrow':'arrow';
    const width=Math.min(4,1.7+(edge.partIds?.length||0)*.35);
    const originReturn=Model.byId(store,edge.to)?.parentWorkId&&edge.to.startsWith('smt-origin-')&&failure;
    const disposition=Model.byId(store,edge.to)?.productionStage==='Scrap'?'Not fixed · Scrap':originReturn?'Confirmed SMT origin only':rework?(edge.from.startsWith('smt-origin-')?'Accepted · original step':'Fixed · retest'):'';
    return '<g data-from="'+h(projection.nodes.find(n=>n.id===edge.from)?.entity.id||edge.from)+'" data-to="'+h(projection.nodes.find(n=>n.id===edge.to)?.entity.id||edge.to)+'" class="'+(muted?'route-muted':'')+(edge.qualityEdge?' quality-link':'')+(['operated_in','supports_line'].includes(edge.type)?' contact-link':'')+'"><title>'+h(edge.type+(edge.evidence?' · '+edge.evidence:'')+(edge.partIds?.length?' · '+edge.partIds.length+' selected Parts':''))+'</title><path class="edge flow-edge '+(failure?'failure-edge':rework?'return-edge':context?'context-edge':'normal-edge')+'" style="--flow-width:'+width+'" d="'+path+'" marker-end="url(#'+arrow+')"></path>'+(disposition?'<text class="edge-label" x="'+((sx+ex)/2)+'" y="'+((sy+ey)/2-8)+'" text-anchor="middle">'+h(disposition)+'</text>':'')+'</g>';
  }).join('')+satelliteEdges;
  nodeLayer.innerHTML=mapGroupFrames(layout)+projection.nodes.map(node=>{
    const entity=node.entity,pos=layout.positions[node.id];if(!pos)return '';
    if(node.groupId)return '<g class="node flow-node collapsed-map-group" data-group-toggle="'+h(node.groupId)+'" tabindex="0" role="button" aria-expanded="false" aria-label="Expand '+h(entity.name)+'" transform="translate('+pos.x+' '+pos.y+')"><rect class="flow-card" width="194" height="60" rx="18"></rect><text class="node-name" x="14" y="27">'+h(short(entity.name,24))+' +</text><text class="flow-machine" x="14" y="47">'+node.groupCount+' objects · 펼치기</text></g>';
    const resources=store.relations.filter(r=>r.type==='requires'&&r.from===entity.id).map(r=>Model.byId(store,r.to)).filter(item=>item?.type==='Resource');
    const machineMode=resources.length===1?resources[0].machineMode:'';
    const machineName=resources[0]?.name||'';
    const machinePrefix=/^(shared|common|pool|dedicated|specific)\b/i.test(machineName)?'':machineMode==='shared_pool'?'Shared · ':machineMode==='specific_asset'?'Dedicated · ':'';
    const machine=resources.length===1?machinePrefix+machineName:resources.length>1?resources.length+' linked resources':'';
    const metric=entity.type==='Production Step'?networkMetric(node,mode,highlight):null;
    const failure=['exception','rework'].includes(entity.branchKind),sub=Flow.isSubprocess(entity);
    const muted=!progress&&(!Flow.belongsToPart(node,highlight)||related&&!related.has(entity.id)||matches&&!matches.has(entity.id));
    const parts=(node.partIds||[]).map(id=>{const p=Model.byId(hourlyUI.enabled(kind,store)&&hourlyUI.previewProject?hourlyUI.previewProject:store,id);return (p?.name||id)+(progress&&p?.modelCode?' · '+p.modelCode:'');});
    const full=[entity.name,resources.map(item=>item.name+(item.machineMode==='shared_pool'?' · common':item.machineMode==='specific_asset'?' · dedicated':'')).join(', '),parts.length?'Parts: '+parts.join(', '):'',metric?.text,metric?.title,node.unconfirmed?'Order not recorded':''].filter(Boolean).join(' · ');
    const stage=node.qualityLabel||(contextMode&&entity.type==='Production Step'?(entity.displayProcessName||entity.productionStage||entity.name.split('·').at(-1).trim()):entity.name);
    const secondary=node.qualitySubtitle||(entity.type==='Person'?short((entity.title||'Person')+' · '+(entity.shift||'Line level'),31):entity.resourceKind==='line'?short(entity.capacityNote||'Production line',31):contextMode&&entity.type==='Production Step'?(failure?'Shared · problem path':parts.length===1?short(parts[0].replace(' (route label)',''),25):parts.length>1?parts.length+' shared Part routes':node.unconfirmed?'Order unconfirmed':'No linked Part'):machine||entity.type);
    const qualityAttrs=node.qualityToggle?' data-quality-toggle="'+h(node.qualityToggle)+'" aria-expanded="'+node.qualityExpanded+'"':'';
    return '<g class="node flow-node '+(node.qualityViewKind?'quality-chip quality-'+h(node.qualityViewKind)+' '+(entity.qualityColor?'quality-color-'+h(entity.qualityColor)+' ':''):'')+(progress?'progress-chip ':'')+(sub?'subprocess ':'')+(failure?'failure-step ':'')+(node.unconfirmed?'unplaced-step ':'')+(muted?'route-muted ':'')+(selectedId===entity.id?'selected':'')+'" data-select="'+h(entity.id)+'" data-route-parts="'+h((node.partIds||[]).join(','))+'"'+qualityAttrs+' tabindex="0" role="button" aria-pressed="'+(selectedId===entity.id)+'" aria-label="'+h(node.qualityViewKind?[stage,secondary,entity.context].filter(Boolean).join(' · '):full)+'" style="--node-color:'+(Model.COLORS[entity.type]||'#138bbb')+'" transform="translate('+pos.x+' '+pos.y+')"><title>'+h(node.qualityViewKind?[stage,secondary,entity.context].filter(Boolean).join(' · '):full)+'</title><rect class="flow-card" width="194" height="'+(progress?108:60)+'" rx="18"></rect><polygon class="activity-mark" points="14,22 23,17 32,22 32,32 23,37 14,32"></polygon><text class="node-name" x="41" y="27">'+h(short(stage,21))+'</text><text class="flow-machine '+(machineMode==='shared_pool'?'shared':machineMode==='specific_asset'?'specific':'')+'" x="41" y="47">'+h(short(secondary,25))+'</text>'+(metric&&!progress?'<rect class="metric-badge" x="105" y="-23" width="94" height="22" rx="11"></rect><text class="metric-text" x="152" y="-8" text-anchor="middle">'+h(metric.text)+'</text>':'')+'</g>';
  }).join('')+satellites.map(item=>{
    const entity=item.entity,relation=item.relation,material=item.kind==='part',qty=relation.quantity?' ×'+relation.quantity:'',mode=entity.machineMode==='shared_pool'?'Shared pool':entity.machineMode==='specific_asset'?'Specific asset':'Machine family · use unconfirmed';
    const label=material?short(entity.name,23):short(entity.tier?.split('/').at(-1).trim()||entity.machineFamily||entity.name,23);
    const itemKind=Model.isComponentPart(entity)?'C':'P';
    const sublabel=material?(itemKind==='C'?'Component (C)':'Product (P)')+qty:mode;
    const full=[entity.name,relation.type,relation.quantity?'quantity '+relation.quantity+' '+(relation.unit||'pieces'):'quantity unconfirmed',relation.basis,relation.reviewState,relation.evidence].filter(Boolean).join(' · ');
    const muted=!Flow.belongsToPart(item,highlight);
    return '<g class="production-satellite '+(material?'component-satellite':'machine-satellite')+(relation.reviewState==='proposed'?' proposed-satellite':'')+(muted?' route-muted':'')+(selectedId===entity.id?' selected':'')+'" data-select="'+h(entity.id)+'" tabindex="0" role="button" aria-label="'+h(full)+'" transform="translate('+item.x+' '+item.y+')"><title>'+h(full)+'</title><rect width="188" height="48" rx="13"></rect><text class="satellite-kind" x="12" y="18">'+(material?itemKind:'M')+'</text><text class="satellite-name" x="32" y="20">'+h(label)+'</text><text class="satellite-meta" x="32" y="37">'+h(sublabel)+'</text></g>';
  }).join('');
}
function focusPartInMap(kind,partId) {
  if(!partId)return;
  const stage=$(kind==='production'?'#productionMapStage':'#mapStage'),layer=$(kind==='production'?'#productionNodes':'#nodeLayer');
  const nodes=[...layer.querySelectorAll('[data-route-parts]')].filter(node=>node.dataset.routeParts.split(',').includes(partId));
  const target=nodes.find(node=>node.dataset.routeParts===partId)||nodes[0];
  const match=target?.getAttribute('transform').match(/translate\(([\d.]+) ([\d.]+)\)/);
  if(!match)return;
  const scale=kind==='production'?productionZoom:zoom;
  stage.scrollTo({left:Math.max(0,Number(match[1])*scale-stage.clientWidth/2+100),top:Math.max(0,Number(match[2])*scale-90),behavior:'auto'});
}
function summaryLayout(entities) {
  const columns=$('#mapStage').clientWidth<550?1:2,positions={};
  entities.forEach((entity,index)=>{positions[entity.id]={x:16+(index%columns)*256,y:40+Math.floor(index/columns)*132};});
  return {positions,width:columns*256+32,height:Math.max(320,Math.ceil(entities.length/columns)*132+72)};
}
function renderMap(invalid) {
  historyGroups={};
  renderMapPartOptions();
  const opt=options(),whole=!opt.focus;
  if((!invalid||progressUI.enabled('overview',store))&&(store.id!=='library'&&selectedWorkstream==='production'||!selectedWorkstream&&mapPartsCustomized)){
    $('#fitMap').textContent='Fit';$('#mapStage').classList.add('network-map');
    $('.map-footer span').innerHTML='Arrows: recorded order · red dashed: problem path<br>Counts: latest saved WIP or direct worker observation · click a Step for source';
    const projection=progressUI.filter('overview',store,Flow.productionNetwork(store,{showStakeholders:hourlyUI.enabled('overview',store)||$('#mapSeeStakeholders').checked,showLineReferences:!mapPartsCustomized,line:hourlyUI.enabled('overview',store)&&store.name==='SMT'?'SMT':selectedWorkstream==='production'?$('#mapProductionLine').value:'',partIds:mapPartIds,start:progressUI.enabled('overview',store)?'':opt.start,end:progressUI.enabled('overview',store)?'':opt.end}));
    let shown=hourlyUI.graph('overview',store,projection);
    graphSize=hourlyUI.layout('overview',store,shown,progressUI.layout('overview',store,shown,Flow.productionContextLayout(store,shown,{showMachines:!progressUI.enabled('overview',store)&&$('#mapSeeMachines').checked,showComponents:!progressUI.enabled('overview',store)&&$('#mapSeeComponents').checked})));applyZoom();
    if(!progressUI.enabled('overview',store)&&!hourlyUI.enabled('overview',store)){const view=presentNetwork('overview',shown,graphSize,mapPartsCustomized);shown=view.network;graphSize=view.layout;applyZoom();}
    drawNetworkCanvas('overview',shown,graphSize);
    $('#mapCount').textContent=projection.parts.length+' Parts · '+projection.nodes.filter(n=>n.entity.type==='Production Step').length+' steps · '+projection.nodes.filter(n=>n.entity.type!=='Production Step').length+' related objects · '+projection.unlinked.length+' unlinked';
    $('#emptyState').hidden=shown.nodes.length>0;
    $('#emptyState').querySelector('strong').textContent='No process recorded for '+($('#mapProductionLine').value||'selected Parts');
    return;
  }
  if(!invalid&&store.id!=='library'&&$('#perspective').value==='process'&&(!selectedWorkstream||selectedWorkstream!=='production')){
    $('#fitMap').textContent='Fit';$('#mapStage').classList.add('network-map');
    $('.map-footer span').innerHTML='Arrows show recorded dependencies; missing arrows mean order unknown.<br>Select an activity to trace Parts, people, machines and evidence.';
    const all=Flow.workstreamLanes(store,{...opt,query:'',focus:'',selectedId:null});
    let projection=all;
    if(selectedWorkstream){
      const primary={code:selectedWorkstream,label:Model.WORKSTREAMS.find(s=>s.code===selectedWorkstream)?.label||selectedWorkstream,items:all.entities.filter(e=>(store.workstreams[e.id]||[]).includes(selectedWorkstream)).map(entity=>({id:entity.id,entity,secondary:[]}))};
      const own=new Set(primary.items.map(item=>item.id));
      const near=new Set(all.edges.flatMap(edge=>own.has(edge.from)?[edge.to]:own.has(edge.to)?[edge.from]:[]).filter(id=>!own.has(id)));
      const related=all.entities.filter(entity=>near.has(entity.id)).map(entity=>({id:entity.id,entity,secondary:[]}));
      projection={...all,lanes:[primary,...(related.length?[{code:'related',label:'Linked from other streams',items:related}]:[])],edges:all.edges.filter(edge=>(own.has(edge.from)||near.has(edge.from))&&(own.has(edge.to)||near.has(edge.to)))};
    }
    const nodes=projection.lanes.flatMap(lane=>lane.items.map(item=>({id:item.id,entity:item.entity,partIds:[]})));
    let network={nodes:[...new Map(nodes.map(node=>[node.id,node])).values()],edges:projection.edges,parts:store.entities.filter(Model.isProductPart)};
    if(!selectedWorkstream){
      const graph=Flow.projectGraph(store,opt),present=new Set(network.nodes.map(n=>n.id));
      const machines=new Set(graph.relations.filter(r=>r.type==='requires'&&present.has(r.from)&&['machine','test_equipment'].includes(Model.byId(store,r.to)?.resourceKind)).map(r=>r.to));
      for(const entity of graph.entities)if(!present.has(entity.id)&&!entity.qualityKind&&!entity.productionEventKind&&['Part','Part Revision','Resource','Person','Organization'].includes(entity.type)&&(!['Person','Organization'].includes(entity.type)||$('#mapSeeStakeholders').checked)&&!machines.has(entity.id))network.nodes.push({id:entity.id,entity,partIds:[]});
      const visible=new Set(network.nodes.map(n=>n.id)),edgeIds=new Set(network.edges.map(e=>e.id));
      for(const edge of graph.relations)if(visible.has(edge.from)&&visible.has(edge.to)&&!edgeIds.has(edge.id))network.edges.push({...edge,partIds:[]});
    }
    for(const node of network.nodes)node.partIds=store.relations.filter(relation=>relation.from===node.id&&relation.type==='applies_to'&&Model.isProductPart(Model.byId(store,relation.to))).map(relation=>relation.to);
    graphSize=Flow.productionContextLayout(store,network,{showMachines:$('#mapSeeMachines').checked,showComponents:$('#mapSeeComponents').checked});applyZoom();
    if(!selectedWorkstream){const view=presentNetwork('overview',network,graphSize,false,true);network=view.network;graphSize=view.layout;applyZoom();}
    else if(selectedWorkstream==='quality'){const quality=QualityMap.augment(store,network,graphSize,qualityExpanded,{showPeople:$('#mapSeeStakeholders').checked});network=quality.network;graphSize=quality.layout;applyZoom();}
    drawNetworkCanvas('overview',network,graphSize);
    $('#mapCount').textContent=network.nodes.length+' process records · '+network.edges.length+' recorded links';
    $('#emptyState').hidden=network.nodes.length>0;
    return;
  }
  $('#mapStage').classList.remove('network-map');$('#fitMap').textContent='Fit';
  $('.map-footer span').innerHTML='Solid: recorded dependency · dashed: context / branch<br>Select an object to inspect its typed relationships.';
  let graph=invalid?{entities:[],relations:[],context:new Set(),boundary:new Set()}:selectedWorkstream==='production'&&mapPartId?Flow.partFocusedGraph(store,mapPartId,opt):selectedWorkstream==='production'&&whole?Flow.partSummary(store,opt):!selectedWorkstream&&$('#perspective').value==='process'&&whole?Flow.workstreamSummary(store,opt):selectedWorkstream?Flow.workstreamGraph(store,selectedWorkstream,opt):Flow.projectGraph(store,opt);
  if(store.id==='library'&&!invalid){
    const settings=workspace.viewSettings?.library?.universalGroups||{};
    graph=MapGroups.universalGraph(Flow.projectGraph(store,opt),settings.collapsed||[],store);
  }
  if(graph.summary&&!graph.matched)graph={...graph,entities:[],relations:[]};
  historyGroups=graph.groups?Object.fromEntries([...graph.groups].map(([id,g])=>[id,g.members.map(e=>e.id)])):{};
  const layout=graph.groups&&store.id==='library'?MapGroups.universalLayout(graph,Flow.layout):graph.summary?summaryLayout(graph.entities):selectedWorkstream==='production'&&mapPartId?Flow.productionLayout(graph,{compact:true}):Flow.layout(graph.entities,graph.relations), pos=layout.positions;
  graphSize=layout; applyZoom();
  const related=!graph.summary&&selectedId ? ($('#focusMode').value==='downstream'?Flow.downstream(store,selectedId):Flow.neighborhood(store,selectedId)):null;
  const total=selectedWorkstream?Object.values(store.workstreams||{}).filter(codes=>codes.includes(selectedWorkstream)).length:store.entities.length;
  $('#mapCount').textContent=(graph.summary?graph.matched:graph.entities.length)+' / '+total+' objects'+(graph.summary?' · '+graph.entities.length+' groups':'')+(mapPartId&&!graph.entities.some(e=>e.type==='Production Step')?' · No linked process':'')+(graph.context.size?' · '+graph.context.size+' date context':'');
  $('#emptyState').hidden=graph.entities.length>0;
  $('#emptyState').querySelector('strong').textContent=selectedWorkstream==='production'?'No matching parts or steps':selectedWorkstream?'No '+(Model.WORKSTREAMS.find(item=>item.code===selectedWorkstream)?.label||'workstream')+' objects':'No matching objects';
  $('#emptyState').querySelector('span').textContent='Change search, date, status, or layer filters; or add objects in Input.';
  const drawRelations=graph.relations.filter(r=>r.type!=='subprocess'||!graph.relations.some(other=>other.type!=='subprocess'&&((other.from===r.from&&other.to===r.to)||(other.from===r.to&&other.to===r.from))));
  $('#edgeLayer').innerHTML=drawRelations.map(r=>{
    const a=pos[r.from],b=pos[r.to], same=a.y===b.y;
    const startX=a.x+110, endX=b.x+110, startY=a.y+(b.y<a.y?0:94), endY=b.y+(b.y<a.y?94:0);
    const path=same?'M '+(a.x+220)+' '+(a.y+46)+' C '+(a.x+248)+' '+(a.y+10)+', '+(b.x-24)+' '+(b.y+10)+', '+b.x+' '+(b.y+46)
      :'M '+startX+' '+startY+' C '+startX+' '+((startY+endY)/2)+', '+endX+' '+((startY+endY)/2)+', '+endX+' '+endY;
    const highlight=selectedId && (r.from===selectedId||r.to===selectedId);
    const sub=!graph.summary&&[r.from,r.to].some(id=>{const entity=graph.entities.find(e=>e.id===id);return entity&&Flow.isSubprocess(entity);});
    return '<g data-from="'+h(r.from)+'" data-to="'+h(r.to)+'" class="'+(sub&&!highlight?'sub-edge ':related&&!highlight?'dimmed':'')+'"><path class="edge '+(r.type==='precedes'?'':'context-edge ')+(highlight?'highlighted':'')+'" d="'+path+'"></path><text class="edge-label" x="'+((a.x+b.x+220)/2)+'" y="'+(same?a.y+32:(startY+endY)/2-5)+'" text-anchor="middle">'+h(r.type)+'</text></g>';
  }).join('');
  $('#nodeLayer').innerHTML=(layout.frames||[]).map(f=>'<g class="universal-group" data-model-parts="'+h((f.partIds||[]).join(','))+'" transform="translate('+f.x+' '+f.y+')"><rect class="universal-group-boundary" width="'+f.width+'" height="'+f.height+'" rx="16"></rect><g data-group-toggle="'+h(f.id)+'" tabindex="0" role="button" aria-expanded="true" aria-label="Collapse '+h(f.name)+'"><rect class="universal-group-heading" x="8" y="8" width="'+(f.width-16)+'" height="36" rx="8"></rect><text x="20" y="32">'+h(f.kind+' · '+f.name)+' −</text></g></g>').join('')+graph.entities.map(e=>{
    const p=pos[e.id], r=Flow.range(e), context=graph.context.has(e.id);
    if(e.groupId)return '<g class="node summary-node" data-group-toggle="'+h(e.groupId)+'" tabindex="0" role="button" aria-label="Expand '+h(e.name)+'" transform="translate('+p.x+' '+p.y+')"><rect width="220" height="94"></rect><text class="node-name" x="14" y="39">'+h(short(e.name))+'</text><text class="node-meta" x="14" y="65">'+e.summaryCount+' objects · Expand</text></g>';
    if(graph.summary){
      const action=e.summaryKind==='workstream'?'data-summary-workstream="'+h(e.summaryCode)+'"':e.summaryKind==='part'?'data-summary-part="'+h(e.partId)+'"':e.summaryKind==='unassigned'?'data-summary-unassigned="true"':'data-summary-unlinked="true"';
      return '<g class="node summary-node '+(e.summaryKind==='workstream'&&!e.summaryCount?'empty-summary':'')+'" '+action+' tabindex="0" role="button" aria-label="Open '+h(e.name)+'" style="--node-color:'+(Model.COLORS[e.type]||'#1261d8')+'" transform="translate('+p.x+' '+p.y+')"><rect width="220" height="94"></rect><text class="summary-kind" x="14" y="20">'+h(e.summaryKind==='workstream'?'WORKSTREAM':e.summaryKind==='part'?e.type.toUpperCase():'UNLINKED')+'</text><text class="summary-count" x="204" y="20" text-anchor="end">'+h(e.summaryCount)+'</text><text class="node-name" x="14" y="48">'+h(short(e.name,27))+'</text><text class="summary-detail" x="14" y="72">'+h(short(e.summaryDetail,31))+'</text></g>';
    }
    const date=r ? r.end+' · '+r.basis : Flow.SCHEDULE_TYPES.includes(e.type)?'Unscheduled':'';
    return '<g class="node '+(Flow.isSubprocess(e)?'subprocess ':'main-process ')+(graph.boundary?.has(e.id)?'boundary ':'')+(e.id===selectedId?'selected ':'')+(related&&!related.has(e.id)?'dimmed ':'')+(context?'outside-range':'')+'" data-select="'+e.id+'" tabindex="0" role="button" aria-pressed="'+(e.id===selectedId)+'" aria-label="'+h(e.type+': '+e.name)+'" style="--node-color:'+Model.COLORS[e.type]+'" transform="translate('+p.x+' '+p.y+')"><title>'+h(e.name+(context?' · Outside date range, predecessor':''))+'</title><rect width="220" height="94"></rect><rect class="cap" width="4" height="94"></rect><text class="node-type" x="14" y="19">'+h(graph.boundary?.has(e.id)?'LINKED · '+e.type:Flow.isSubprocess(e)?'SUB · '+(e.branchKind||'support'):e.type)+'</text><text class="node-name" x="14" y="39">'+h(short(e.name))+'</text><text class="node-meta" x="14" y="58">'+h(e.status.replaceAll('_',' '))+(context?' · date context':'')+'</text><text class="node-meta" x="14" y="74">'+h(date)+'</text><text class="node-phase" x="14" y="87">'+h(short(e.phase||'',32))+'</text></g>';
  }).join('');
}
function saveGlobalGroups(collapsed){
  const data={collapsed};
  (workspace.viewSettings[store.id] ||= {}).universalGroups=data;
  if(!basicAccess&&workspace.access?.mode!=='project')LocalAPI.settings(store.id,'universalGroups',data).catch(error=>toast(error.message));
}
document.addEventListener('keydown',event=>{const node=event.target.closest?.('[data-group-toggle]');if(node&&['Enter',' '].includes(event.key)){event.preventDefault();node.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
function applyZoom() {
  const svg=$('#ontologyMap');
  svg.setAttribute('viewBox','0 0 '+graphSize.width+' '+graphSize.height);
  svg.style.width=graphSize.width*zoom+'px'; svg.style.height=graphSize.height*zoom+'px';
  $('#mapZoomLevel').textContent=Math.round(zoom*100)+'%';
  $('#zoomOut').disabled=zoom<=.15;
}
function toggleMapObject(id) {
  if(mapSelectedIds.has(id))mapSelectedIds.delete(id);else mapSelectedIds.add(id);
  selectedId=null;$('#inspector').hidden=true;render();
}
function decorateMapSelection() {
  const activeLayer=activeTab==='Overview'?$('#nodeLayer'):activeTab==='Production'?$('#productionNodes'):null;
  if(activeLayer){const visible=new Set([...activeLayer.querySelectorAll('[data-select]')].map(node=>node.dataset.select));for(const id of mapSelectedIds)if(!visible.has(id))mapSelectedIds.delete(id);}
  const related=Flow.selectionNeighborhood(store,mapSelectedIds),active=mapSelectedIds.size>0;
  for(const layerId of ['nodeLayer','productionNodes'])for(const node of $('#'+layerId).querySelectorAll('[data-select]')){
    node.querySelectorAll('.map-detail-button').forEach(button=>button.remove());
    const id=node.dataset.select,selected=mapSelectedIds.has(id);
    node.classList.toggle('selected',selected);node.classList.remove('ai-highlight','ai-emphasis');node.setAttribute('aria-pressed',String(selected));
    if(active){node.classList.remove('route-muted','dimmed');node.classList.toggle('selection-muted',!related.has(id));node.classList.toggle('selection-related',related.has(id)&&!selected);}
    else node.classList.remove('selection-muted','selection-related');
    if(selected&&!basicAccess){
      const button=document.createElementNS('http://www.w3.org/2000/svg','g');
      button.setAttribute('class','map-detail-button');button.setAttribute('data-open-detail',id);button.setAttribute('role','button');button.setAttribute('tabindex','0');button.setAttribute('aria-label','Open details: '+Model.byId(store,id).name);
      button.innerHTML='<circle cx="8" cy="0" r="12"></circle><text x="8" y="5" text-anchor="middle">?</text>';
      node.appendChild(button);
    }
  }
  if(active)for(const layerId of ['edgeLayer','productionEdges'])for(const edge of $('#'+layerId).querySelectorAll('[data-from][data-to]')){
    const incident=mapSelectedIds.has(edge.dataset.from)||mapSelectedIds.has(edge.dataset.to);
    edge.classList.remove('route-muted','dimmed','ai-emphasis-edge');edge.classList.toggle('selection-muted',!incident);edge.classList.toggle('selection-edge',incident);
  }
}
function selectEntity(id, jump=true) {
  if(basicAccess){toggleMapObject(id);return;}
  const entity=Model.byId(store,id);if(!entity) return;
  selectedId=id;
  if(['Part','Part Revision'].includes(entity.type)) inspectorView='workflow';
  else if(inspectorView==='workflow') inspectorView='overview';
  const r=Flow.range(entity);
  if(jump&&r) { const [y,m,d]=r.start.split('-').map(Number); month=new Date(y,m-1,d); }
  $('#inspector').hidden=false; render();
}
function scheduleButton(e, className='schedule-item') {
  const r=Flow.range(e), related=selectedId && Flow.neighborhood(store,selectedId).has(e.id);
  return '<button data-select="'+e.id+'" class="'+className+' '+(e.id===selectedId?'selected':related?'related':'')+' '+h(e.status)+'" title="'+h(e.name+(r?' · '+r.start+' → '+r.end+' · '+r.basis:''))+'">'+h(e.name)+(className==='schedule-item'?'<small>'+h(r?r.start+' → '+r.end+' · '+r.basis:'Unscheduled')+'</small>':'')+'</button>';
}
function renderSchedule(invalid) {
  const opt=options(); opt.keepPredecessors=false;
  const items=(invalid?[]:Flow.projectGraph(store,opt).entities).filter(e=>Flow.SCHEDULE_TYPES.includes(e.type)&&!e.productionEventKind);
  const scheduled=items.filter(e=>Flow.range(e)).sort((a,b)=>Flow.range(a).start.localeCompare(Flow.range(b).start));
  const undated=items.filter(e=>!Flow.range(e));
  $('#unscheduledLabel').textContent='Unscheduled ('+undated.length+')';
  $('#unscheduledList').innerHTML=undated.map(e=>scheduleButton(e)).join('')||'<p class="empty-note">All matching work has a date.</p>';
  const mode=$('#scheduleMode').value,scale=$('#ganttScale').value;
  let windowStart,windowEnd;
  if(scale==='week'){windowStart=new Date(month);windowEnd=new Date(month);windowEnd.setDate(windowEnd.getDate()+6);}
  else if(scale==='quarter'){windowStart=new Date(month.getFullYear(),Math.floor(month.getMonth()/3)*3,1);windowEnd=new Date(windowStart.getFullYear(),windowStart.getMonth()+3,0);}
  else{windowStart=new Date(month.getFullYear(),month.getMonth(),1);windowEnd=new Date(month.getFullYear(),month.getMonth()+1,0);}
  const start=iso(windowStart),end=iso(windowEnd);
  $('#monthLabel').textContent=scale==='month'?windowStart.toLocaleDateString('en',{month:'long',year:'numeric'}):start+' → '+end;
  {
    const visible=scheduled.filter(e=>Flow.overlaps(e,start,end));
    if(mode==='agenda') $('#scheduleContent').innerHTML=visible.map(e=>scheduleButton(e)).join('')||'<p class="empty-note">No matching schedule this month.</p>';
    else {
      const ganttItems=items.filter(e=>['baseline','actual'].some(k=>(e[k+'Start']||e[k+'End'])&&(e[k+'Start']||e[k+'End'])<=end&&(e[k+'End']||e[k+'Start'])>=start)||visible.some(v=>v.id===e.id));
      const projection=Flow.ganttWindow(ganttItems,start,end,scale),projected=new Map(projection.items.map(item=>[item.id,item]));
      const bar=(e,segment,cls,milestone=false,label=false)=>segment?'<button data-select="'+e.id+'" class="gantt-bar '+cls+(milestone?' milestone':'')+'" style="left:'+segment.left+'%;width:'+Math.max(segment.width,.7)+'%" aria-label="'+h(e.name+' · '+segment.basis+' '+segment.start+' to '+segment.end)+'" title="'+h(segment.basis+' '+segment.start+' → '+segment.end)+'">'+(label&&segment.width>=18?'<span class="gantt-bar-title">'+h(e.name)+'</span>':'')+'</button>':'';
      const callout=(e,p)=>p.current&&(p.milestone||p.current.width<18)?'<button data-select="'+e.id+'" class="gantt-callout'+(p.current.left>72?' align-right':'')+'" style="--callout-left:'+Math.min(96,p.current.left+p.current.width)+'%">'+h(e.name)+'</button>':'';
      const ticks=projection.ticks.map(tick=>'<span style="left:'+tick.left+'%">'+h(tick.label)+'</span>').join('');
      $('#scheduleContent').innerHTML='<div class="gantt-key">'+start+' → '+end+'<br>Gray: baseline · Blue: forecast/planned/due · Green: actual<br>No automatic rescheduling or critical-path calculation.</div><div class="gantt-scale" aria-label="Day of month">'+ticks+'</div>'+ganttItems.map(e=>{
        const r=Flow.range(e),p=projected.get(e.id);
        const state=p.late?'late':e.status==='blocked'?'blocked':e.status==='completed'?'completed':'';
        return '<div class="gantt-row '+(e.id===selectedId?'selected':'')+(Flow.isSubprocess(e)?' subprocess':'')+'"><div class="gantt-track" style="background-size:'+(projection.ticks.length?100/projection.ticks.length:100)+'% 100%">'+bar(e,p.current,state,p.milestone,true)+callout(e,p)+bar(e,p.baseline,'baseline')+bar(e,p.actual,'actual')+'</div><small class="muted">'+h(r?r.basis+' · '+r.start+' → '+r.end+(p.late?' · Late':''):'No current plan')+'</small></div>';
      }).join('')+(ganttItems.length?'':'<p class="empty-note">No matching timeline this month.</p>');
    }
  }
}
function assignments(scopeId) {
  return store.entities.filter(e=>e.type==='Assignment' && store.relations.some(r=>r.type==='assignment_scope'&&r.from===e.id&&r.to===scopeId));
}
function assignees(a) {
  return store.relations.filter(r=>r.type==='assigned_to'&&r.from===a.id).map(r=>Model.byId(store,r.to));
}
function link(e) { return '<button data-select="'+e.id+'">'+h(e.name)+'</button><small>'+h(e.id)+'</small>'; }
function table(headers, rows) { return '<table><thead><tr>'+headers.map(v=>'<th scope="col">'+h(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>'; }
function renderStakeholders(invalid) {
  $('#stakeholderTabs').innerHTML=stakeholderViews.map(view=>'<button data-stakeholder-view="'+h(view)+'"'+(stakeholderView===view?' aria-current="page"':'')+'>'+h(view)+'</button>').join('');
  $('#stakeholderGroupLabel').hidden=stakeholderView!=='People & roles';
  const all=recordEntities(invalid).filter(e=>['Person','Organization'].includes(e.type));
  const area=$('#stakeholderArea').value,areaOf=e=>e.type==='Organization'?'organization':e.workArea||'unknown';
  const areaPeople=all.filter(e=>!area||areaOf(e)===area);
  const departments=[...new Set(areaPeople.map(e=>e.type==='Organization'?'Organizations':e.department||'Department not recorded'))].sort();
  const selectedDepartment=preferredStakeholderDepartment||$('#stakeholderDepartment').value;
  $('#stakeholderDepartment').innerHTML='<option value="">All departments</option>'+departments.map(name=>'<option value="'+h(name)+'">'+h(name)+'</option>').join('');
  $('#stakeholderDepartment').value=departments.includes(selectedDepartment)?selectedDepartment:'';
  preferredStakeholderDepartment='';
  const people=areaPeople.filter(e=>!$('#stakeholderDepartment').value||(e.type==='Organization'?'Organizations':e.department||'Department not recorded')===$('#stakeholderDepartment').value);
  $('#recordsTitle').textContent='Stakeholder analysis · '+people.length+(people.length!==all.length?' / '+all.length:'');
  $('#recordsNote').textContent='Group by work area, department and role, or switch to reporting lines. Unrecorded fields stay unclassified; affiliation does not imply responsibility.';
  if(!people.length) { $('#recordsTable').innerHTML='<p class="empty-note">Add a Person or Organization to start stakeholder analysis.</p>'; return; }
  const named=e=>link(e)+'<small>'+h([e.title,e.workerRole,e.tier].filter(Boolean).join(' · ')||'Title/role not recorded')+'</small>';
  const countText=(n,word)=>n+' '+(word==='person'?(n===1?'person':'people'):word+(n===1?'':'s'));
  if(stakeholderView==='People & roles') {
    const personRow=e=>{
      const org=store.relations.filter(r=>r.type==='works_at'&&r.from===e.id).map(r=>Model.byId(store,r.to));
      const manager=store.relations.find(r=>r.type==='reports_to'&&r.from===e.id);
      const roles=store.entities.filter(a=>a.type==='Assignment'&&store.relations.some(r=>r.type==='assigned_to'&&r.from===a.id&&r.to===e.id)).flatMap(a=>store.relations.filter(r=>r.type==='assignment_scope'&&r.from===a.id).map(r=>h((a.role||'Role unknown')+' · '+(a.raci||'RACI unknown'))+' → '+link(Model.byId(store,r.to))));
      return '<tr><td>'+named(e)+'</td><td>'+(org.map(link).join('<br>')||'Not recorded')+'</td><td>'+(manager?link(Model.byId(store,manager.to)):'Not recorded')+'</td><td>'+(roles.join('<br>')||'No scoped assignments')+'</td></tr>';
    };
    if($('#stakeholderGrouping').value==='manager') {
      const tree=Analysis.reportingTree(store,people),organizations=people.filter(e=>e.type==='Organization');
      const branch=node=>'<div class="reporting-person">'+(node.reports.length?'<details data-stakeholder-group="manager:'+h(node.entity.id)+'"'+(openStakeholderGroups.has('manager:'+node.entity.id)?' open':'')+'><summary>'+h(node.entity.name)+' <span>'+h(node.entity.title||node.entity.workerRole||'Role not recorded')+' · '+node.reports.length+' direct</span></summary><div class="reporting-children">'+node.reports.map(branch).join('')+'</div></details>':'<div class="reporting-leaf">'+link(node.entity)+'<span>'+h(node.entity.title||node.entity.workerRole||'Role not recorded')+'</span></div>')+'</div>';
      if(!stakeholderGroupsInitialized){tree.forEach(node=>{if(node.reports.length)openStakeholderGroups.add('manager:'+node.entity.id);});stakeholderGroupsInitialized=true;}
      $('#recordsTable').innerHTML='<div class="stakeholder-directory"><p class="muted">Direct reports come only from recorded reports_to links. Unlinked people appear at root.</p>'+tree.map(branch).join('')+(organizations.length?'<h3>Organizations · '+organizations.length+'</h3>'+organizations.map(e=>'<div class="reporting-leaf">'+link(e)+'</div>').join(''):'')+'</div>';
    } else {
      const groups=Analysis.stakeholderGroups(people);
      if(!stakeholderGroupsInitialized&&groups.length){const first=groups[0],department=first.departments[0],role=department.roles[0];openStakeholderGroups.add('area:'+first.name);openStakeholderGroups.add('department:'+first.name+':'+department.name);openStakeholderGroups.add('role:'+first.name+':'+department.name+':'+role.name);stakeholderGroupsInitialized=true;}
      const roleView=(area,department,role)=>{const key='role:'+area.name+':'+department.name+':'+role.name;return '<details class="stakeholder-group role-group" data-stakeholder-group="'+h(key)+'"'+(openStakeholderGroups.has(key)?' open':'')+'><summary>'+h(role.name)+' <span>'+countText(role.people.length,'person')+'</span></summary><div class="table-scroll">'+table(['Name / title / role','Organization','Reports to','Assigned scope'],role.people.map(personRow))+'</div></details>';};
      const departmentView=(area,department)=>{const key='department:'+area.name+':'+department.name,count=department.roles.reduce((n,role)=>n+role.people.length,0);return '<details class="stakeholder-group department-group" data-stakeholder-group="'+h(key)+'"'+(openStakeholderGroups.has(key)?' open':'')+'><summary>'+h(department.name)+' <span>'+countText(count,'person')+' · '+countText(department.roles.length,'role')+'</span></summary>'+department.roles.map(role=>roleView(area,department,role)).join('')+'</details>';};
      $('#recordsTable').innerHTML='<div class="stakeholder-directory">'+groups.map(area=>{const key='area:'+area.name,count=area.departments.reduce((n,department)=>n+department.roles.reduce((m,role)=>m+role.people.length,0),0);return '<details class="stakeholder-group area-group" data-stakeholder-group="'+h(key)+'"'+(openStakeholderGroups.has(key)?' open':'')+'><summary>'+h(area.name)+' <span>'+countText(count,'person')+' · '+countText(area.departments.length,'department')+'</span></summary>'+area.departments.map(department=>departmentView(area,department)).join('')+'</details>';}).join('')+'</div>';
    }
  } else if(stakeholderView==='Power / influence') {
    const placed=people.map(e=>({e,pos:Analysis.quadrant(e)})).filter(item=>item.pos),unknown=people.filter(e=>!Analysis.quadrant(e));
    const tone=e=>['supportive','leading'].includes(e.currentEngagement)?'supportive':e.currentEngagement==='resistant'?'resistant':e.currentEngagement==='neutral'?'neutral':'unknown';
    let html='<div class="matrix-wrap"><h3>Power × influence</h3><p class="muted">Position uses only recorded ratings. Color shows current engagement.</p><div class="stakeholder-quadrant" aria-label="Stakeholder power and influence chart"><span class="axis influence-axis">Influence over project →</span><span class="axis power-axis">Power in organization →</span><span class="quadrant-name q-manage">Manage closely</span><span class="quadrant-name q-satisfy">Keep satisfied</span><span class="quadrant-name q-inform">Keep informed</span><span class="quadrant-name q-monitor">Monitor</span>'+placed.map(({e,pos})=>'<button data-select="'+e.id+'" class="quadrant-point '+tone(e)+'" style="left:'+pos.x+'%;top:'+pos.y+'%" title="'+h((e.power||'unknown')+' power · '+(e.influence||'unknown')+' influence')+'">'+h(short(e.name,22))+'</button>').join('')+'</div><div class="chart-legend"><span class="supportive">Supportive</span><span class="neutral">Neutral</span><span class="resistant">Resistant</span></div><div class="unclassified"><strong>Unassessed · '+unknown.length+'</strong>'+unknown.map(named).join(' ')+'</div></div>';
    const matrix=Analysis.influenceMatrix(store,new Set(people.map(e=>e.id)));
    html+='<h3 class="section-title">Who influences whom</h3>'+(matrix.stakeholders.length>30?'<div class="stakeholder-directory"><p>More than 30 people in this view. Narrow work area or department for matrix.</p>'+store.relations.filter(r=>r.type==='influences'&&matrix.stakeholders.some(e=>e.id===r.from)&&matrix.stakeholders.some(e=>e.id===r.to)).map(r=>'<p>'+link(Model.byId(store,r.from))+' → '+link(Model.byId(store,r.to))+'</p>').join('')+'</div>':'<div class="table-scroll influence-matrix"><table><thead><tr><th scope="col">Influencer ↓ / Target →</th>'+matrix.stakeholders.map(e=>'<th scope="col" title="'+h(e.name)+'">'+h(short(e.name,14))+'</th>').join('')+'</tr></thead><tbody>'+matrix.stakeholders.map(from=>'<tr><th scope="row">'+link(from)+'</th>'+matrix.stakeholders.map(to=>'<td>'+(from.id===to.id?'—':matrix.cells.has(from.id+':'+to.id)?'<button data-select="'+to.id+'" aria-label="'+h(from.name+' influences '+to.name)+'">→</button>':'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');
    if(!matrix.cells.size) html+='<p class="empty-note">No stakeholder-to-stakeholder influence links recorded. Add an influences relationship to populate this matrix.</p>';
    $('#recordsTable').innerHTML=html;
  } else {
    $('#recordsTable').innerHTML='<div class="engagement-chart"><div class="engagement-head"><span>Stakeholder</span><div class="engagement-scale">'+Model.ENGAGEMENT.map(level=>'<span>'+h(level)+'</span>').join('')+'</div><span>Reason / evidence</span></div>'+people.map(e=>{
      const track=Analysis.engagementTrack(e);
      const marks=track?'<span class="engagement-line" style="left:'+(10+Math.min(track.current,track.desired)*20)+'%;width:'+Math.abs(track.desired-track.current)*20+'%"></span><span class="engagement-marker current" style="left:'+(10+track.current*20)+'%">C</span><span class="engagement-marker desired" style="left:'+(10+track.desired*20)+'%">D</span>':'<span class="engagement-missing">Assessment incomplete</span>';
      return '<div class="engagement-row"><button data-select="'+e.id+'">'+h(e.name)+'<small>'+h(e.title||'Title not recorded')+'</small></button><div class="engagement-track">'+Model.ENGAGEMENT.map(()=>'<span></span>').join('')+marks+'</div><p>'+h(e.assessmentNote||'No reason recorded')+'<small>'+h(e.assessedOn||'Not dated')+'</small></p></div>';
    }).join('')+'</div>';
  }
}
function renderCopilot(){
  const state=copilotChats.get(store.id)||{messages:[],error:'',busy:false};
  $('#copilotStatus').textContent=copilotConfigured?store.name+' · '+copilotModel:'Copilot이 연결되지 않았습니다.';
  $('#copilotSend').disabled=!copilotConfigured||state.busy;
  $('#copilotSend').textContent=state.busy?'답변 중…':'보내기';
  $('#copilotClear').disabled=state.busy;
  $('#copilotQuestion').disabled=state.busy;
  $('#copilotError').textContent=state.error;
  $('#copilotMessages').innerHTML=state.messages.map(m=>'<article class="copilot-message '+h(m.role)+'"><strong>'+h(m.role==='user'?'You':'Copilot')+'</strong><p>'+h(m.content)+'</p>'+(m.references?.length?'<div class="copilot-references">'+m.references.map(e=>'<button class="button" data-select="'+h(e.id)+'">'+h(e.name)+'</button>').join('')+'</div>':'')+'</article>').join('');
}
$('#entryCopilot').onclick=()=>{activeTab='Copilot';render();};
$('#copilotClear').onclick=()=>{copilotChats.delete(store.id);renderCopilot();};
$('#copilotForm').onsubmit=async event=>{
  event.preventDefault();if(!store||window.PUBLIC_READ_ONLY)return;
  const id=store.id,question=$('#copilotQuestion').value.trim();
  const state=copilotChats.get(id)||{messages:[],error:'',busy:false};
  if(state.busy||!question||!copilotConfigured)return;
  const history=state.messages.slice(-10).map(({role,content})=>({role,content}));
  state.busy=true;state.error='';copilotChats.set(id,state);renderCopilot();
  try{
    const result=await LocalAPI.copilot({projectId:id,question,history,consent:true});
    state.messages.push({role:'user',content:question},{role:'assistant',content:result.answer,references:result.references});
    if(store?.id===id)$('#copilotQuestion').value='';
  }catch(error){state.error=error.message;}
  finally{state.busy=false;if(store?.id===id&&activeTab==='Copilot')renderCopilot();}
};
function recordEntities(invalid) {
  if(invalid)return [];
  const scope=selectedWorkstream?new Set(Flow.workstreamRecords(store,selectedWorkstream).map(e=>e.id)):null;
  return Model.search(store,$('#searchInput').value).filter(e=>e.status!=='archived'&&(!scope||scope.has(e.id))&&Flow.overlaps(e,$('#dateStart').value,$('#dateEnd').value));
}
function renderRecords(invalid) {
  $('#stakeholderTabs').hidden=activeTab!=='Stakeholders';
  $('#stakeholderFilters').hidden=activeTab!=='Stakeholders';
  $('#productionTabs').hidden=activeTab!=='Production';
  $('#apqpTabs').hidden=activeTab!=='Production'||productionMode!=='APQP & gates';
  $('#recordsTable').hidden=activeTab==='Production'&&productionMode!=='APQP & gates';
  $('#recordsAdd').hidden=activeTab==='Production'&&['WIP snapshots','Process logs'].includes(productionMode);
  $('#recordsAdd').textContent=activeTab==='Production'?(productionMode==='Process map'?'Add production step':'Add APQP object'):'Add object';
  if(activeTab==='Stakeholders') { renderStakeholders(invalid); return; }
  if(activeTab==='Production') { renderProduction(invalid); return; }
  const entities=recordEntities(invalid).filter(e=>tabTypes[activeTab].includes(e.type));
  $('#recordsTitle').textContent=(selectedWorkstream==='production'?'Production · ':'')+activeTab+' · '+entities.length;
  const notes={RACI:'Only explicitly recorded R/A/C/I assignments appear. Missing or multiple accountable people require review; affiliation never implies responsibility.',
    Resources:'Equipment and non-human resources. Connections show requirements, not reservations or calculated capacity conflicts.',
    Records:'Events are actual records; Evidence stores notes. Edits keep before/after values in each object’s detail history.'};
  $('#recordsNote').textContent=notes[activeTab]||'Click a record to trace its typed relationships. Search and dates apply; undated objects stay visible. Map-layer filters apply only to Overview.';
  if(!entities.length) { $('#recordsTable').innerHTML='<p class="empty-note">No matching records. Add an object or use Input to import a CSV batch.</p>'; return; }
  if(activeTab==='Parts') {
    $('#recordsTable').innerHTML=table(['Part / component','Kind','Production line / group','Variant / links'],entities.sort(partFamilyOrder).map(e=>{
      const kind=Model.isComponentPart(e)?'C · Component':'P · Route Part';
      const variant=[e.side,e.verticalPosition,e.pieceIndex&&'Piece '+e.pieceIndex].filter(Boolean).join(' · ');
      return '<tr><td>'+link(e)+'</td><td>'+kind+'</td><td>'+h([e.productionFamily,e.productFamily].filter(Boolean).join(' / ')||'Unclassified')+'</td><td>'+h(variant||'Variant not confirmed')+'<small>'+Model.relationsFor(store,e.id).length+' recorded links</small></td></tr>';
    }));return;
  }
  if(activeTab==='Resources') {
    const scopeIds=selectedWorkstream?new Set(Flow.workstreamRecords(store,selectedWorkstream).map(e=>e.id)):null;
    $('#recordsTable').innerHTML=table(['Resource','Kind / tier','Asset / model','Production use'],entities.map(e=>{
      const steps=store.relations.filter(r=>r.type==='requires'&&r.to===e.id&&(!scopeIds||scopeIds.has(r.from))).map(r=>Model.byId(store,r.from)).filter(Boolean);
      return '<tr><td>'+link(e)+'</td><td>'+h(e.resourceKind||'Not classified')+'<small>'+h([e.machineMode==='shared_pool'?'Shared pool':e.machineMode==='specific_asset'?'Specific asset':'Use not classified',e.machineFamily,e.tier].filter(Boolean).join(' · '))+'</small></td><td>'+h(e.assetId||'No asset ID')+'<small>'+h([e.model,e.site].filter(Boolean).join(' · ')||'Model/site not recorded')+'</small></td><td>'+(steps.map(link).join('<br>')||'Not linked to a step')+'<small>'+h(e.capacityNote||'Capacity not recorded')+'</small></td></tr>';
    }));return;
  }
  if(activeTab==='RACI') {
    const matrix=Analysis.raciMatrix(store);
    $('#recordsTable').innerHTML='<div class="table-scroll raci-matrix"><table><thead><tr><th scope="col">Work scope</th>'+matrix.stakeholders.map(e=>'<th scope="col">'+h(short(e.name,18))+'<small>'+h(e.title||e.type)+'</small></th>').join('')+'<th scope="col">Review</th></tr></thead><tbody>'+matrix.rows.map(row=>'<tr><th scope="row">'+link(row.scope)+'</th>'+matrix.stakeholders.map(e=>'<td class="raci-cell">'+h(row.cells.get(e.id)||'—')+'</td>').join('')+'<td class="raci-review '+(/Missing|Multiple/.test(row.review)?'warning':'')+'">'+h(row.review)+'</td></tr>').join('')+'</tbody></table></div>';
    if(!matrix.rows.length) $('#recordsTable').innerHTML='<p class="empty-note">Assignments need assignment_scope and assigned_to links. Set an explicit RACI value through Edit object.</p>';
    return;
  }
  const headers=['Object','Type / status','Phase / dates','People / relationships'];
  $('#recordsTable').innerHTML=table(headers,entities.map(e=>{
    const r=Flow.range(e), people=assignments(e.id).flatMap(a=>assignees(a).map(p=>p.name+' ('+(a.raci||a.role||'role unknown')+')'));
    const last=h(people.join(', ')||Model.relationsFor(store,e.id).length+' typed links');
    return '<tr class="'+(selectedId===e.id?'selected':'')+'"><td>'+link(e)+'</td><td>'+h(e.type)+'<small>'+h(e.status.replaceAll('_',' '))+'</small></td><td>'+h(e.phase||'Unassigned phase')+'<small>'+h(r?r.start+' → '+r.end+' · '+r.basis:'No schedule')+'</small></td><td>'+last+'</td></tr>';
  }));
}
function applyProductionZoom() {
  const svg=$('#productionMap');
  svg.setAttribute('viewBox','0 0 '+productionSize.width+' '+productionSize.height);
  svg.style.width=productionSize.width*productionZoom+'px';
  svg.style.height=productionSize.height*productionZoom+'px';
  $('#productionZoomLevel').textContent=Math.round(productionZoom*100)+'%';
  $('#productionZoomOut').disabled=productionZoom<=.15;
}
function showProductionRouteStart() {
  $('#productionMapStage').scrollLeft=0;
}
async function loadProjectMetrics(){
  const projectId=store?.id;if(!projectId||projectId==='library')return;
  const serial=++metricLoadSerial,snapshotId=selectedWipSnapshotId;
  const results=await Promise.allSettled([
    (async()=>{const latest=await LocalAPI.wipList(projectId);let history=latest;if(snapshotId&&snapshotId!==latest.selected){try{history=await LocalAPI.wipList(projectId,snapshotId);}catch{history=latest;}}return {latest,history};})(),
    LocalAPI.staffingList(projectId),LocalAPI.productionStaffingList(projectId)
  ]);
  if(serial!==metricLoadSerial||store?.id!==projectId)return;
  const [wip,staff,production]=results;
  if(wip.status==='fulfilled'){wipData=wip.value.latest;wipHistoryData=wip.value.history;selectedWipSnapshotId=wipHistoryData.selected;}
  if(staff.status==='fulfilled')staffingData=staff.value;
  if(production.status==='fulfilled')productionStaffingData=production.value;
  render();
  results.forEach((result,i)=>{if(result.status==='rejected')$(['#wipError','#staffError','#productionStaffError'][i]).textContent=result.reason.message;});
}
async function loadWip(snapshotId='') {
  const projectId=store?.id;if(!projectId||projectId==='library')return;
  try{
    const latest=await LocalAPI.wipList(projectId);
    const history=snapshotId&&snapshotId!==latest.selected?await LocalAPI.wipList(projectId,snapshotId):latest;
    if(store?.id===projectId){wipData=latest;wipHistoryData=history;selectedWipSnapshotId=history.selected;render();}
  }catch(error){if(snapshotId){selectedWipSnapshotId='';loadWip();return;}if(store?.id===projectId)$('#wipError').textContent=error.message;}
}
async function loadStaffing() {
  const projectId=store?.id;if(!projectId||projectId==='library')return;
  try{const data=await LocalAPI.staffingList(projectId);if(store?.id===projectId){staffingData=data;render();}}
  catch(error){if(store?.id===projectId)$('#staffError').textContent=error.message;}
}
async function loadProductionStaffing() {
  const projectId=store?.id;if(!projectId||projectId==='library')return;
  try{const data=await LocalAPI.productionStaffingList(projectId);if(store?.id===projectId){productionStaffingData=data;render();}}
  catch(error){if(store?.id===projectId)$('#productionStaffError').textContent=error.message;}
}
function wipCountForStep(stepId,partId='') {
  const counts=(wipData?.counts||[]).filter(item=>item.stepId===stepId&&(!partId||item.partId===partId));
  return counts.length?counts.reduce((sum,item)=>sum+item.quantity,0):null;
}
function wipMatrix(rows,columns,limit=35) {
  if(!rows.length)return '<p class="empty-note">No count rows in this sheet.</p>';
  const list=rows.slice(0,limit),cells=list.map(row=>'<tr><th scope="row">'+h(row.partName)+'<small>'+h(row.code||'No model code')+'</small></th>'+columns.map(column=>{
    const found=row.counts.find(item=>item.column===column.column);
    return '<td'+(found?.stepId?' title="Linked to production step"':'')+'>'+(found?h(found.quantity):'—')+'</td>';
  }).join('')+'</tr>').join('');
  return '<div class="table-scroll wip-matrix"><table><thead><tr><th scope="col">Part / model</th>'+columns.map(item=>'<th scope="col">'+h(item.name)+'</th>').join('')+'</tr></thead><tbody>'+cells+'</tbody></table></div>'+(rows.length>limit?'<p class="muted">Showing first '+limit+' of '+rows.length+' rows. All rows save to DB.</p>':'');
}
function renderWipPreview() {
  if(!wipDraft){$('#wipPreviewResult').innerHTML='';$('#wipSave').disabled=true;return;}
  const parts=store.entities.filter(e=>['Part','Part Revision'].includes(e.type)).sort((a,b)=>a.name.localeCompare(b.name));
  const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
  const stageKey=value=>normalize(value).replace(/\(ls\)/g,'').replace(/[^a-z0-9가-힣]/g,'');
  const rows=wipDraft.rows,counts=rows.reduce((sum,row)=>sum+row.counts.length,0);
  const mappedPart=row=>{
    if(Object.hasOwn(wipPartMappings,row.row))return wipPartMappings[row.row];
    const matches=parts.filter(part=>normalize(part.name)===normalize(row.partName));
    return matches.length===1?matches[0].id:'';
  };
  const mappings=rows.map(row=>{
    const selected=mappedPart(row);
    return '<label>'+h(row.code?row.code+' · '+row.partName:row.partName)+'<select data-wip-map="'+row.row+'"><option value="">Keep raw name · no Part link</option>'+parts.map(part=>'<option value="'+h(part.id)+'"'+(part.id===selected?' selected':'')+'>'+h(part.name)+'</option>').join('')+'</select></label>';
  }).join('');
  const groups=new Map();
  for(const row of rows){
    const partId=mappedPart(row);if(!partId)continue;
    for(const count of row.counts){
      const key=partId+':'+count.column;
      if(!groups.has(key))groups.set(key,{key,partId,partName:parts.find(part=>part.id===partId)?.name||partId,stage:count.stage,column:count.column,rows:0});
      groups.get(key).rows++;
    }
  }
  const stageMappings=[...groups.values()].map(group=>{
    const steps=store.relations.filter(relation=>['applies_to','produces'].includes(relation.type)&&relation.to===group.partId).map(relation=>Model.byId(store,relation.from)).filter(step=>step?.type==='Production Step');
    const unique=[...new Map(steps.map(step=>[step.id,step])).values()];
    const exact=unique.filter(step=>stageKey(step.productionStage||step.name.split('·').at(-1))===stageKey(group.stage));
    const selected=Object.hasOwn(wipStepMappings,group.key)?wipStepMappings[group.key]:exact.length===1?exact[0].id:'';
    return '<label>'+h(group.partName+' · '+group.stage+' · '+group.rows+' row'+(group.rows===1?'':'s'))+'<select data-wip-step-map="'+h(group.key)+'"><option value="">Keep raw label · no Step link</option>'+unique.map(step=>'<option value="'+h(step.id)+'"'+(selected===step.id?' selected':'')+'>'+h(step.name)+'</option>').join('')+'</select><small>'+h(exact.length===1?'Unique exact label proposed · confirm before Save':exact.length>1?'Ambiguous · choose the correct Step or keep raw':'No exact Step label · choose manually or keep raw')+'</small></label>';
  }).join('');
  $('#wipPreviewResult').innerHTML='<div class="wip-preview-heading"><strong>'+h(wipDraft.sheet)+'</strong><span>'+rows.length+' product rows · '+counts+' nonblank unit counts</span></div>'+(wipDraft.warnings.length?'<p class="form-error">'+h(wipDraft.warnings.slice(0,8).join(' · '))+' · Correct workbook before saving.</p>':'')+'<details class="wip-mapping" open><summary>Review Part links · unmatched names stay raw</summary><div id="wipPartMaps">'+mappings+'</div></details><details class="wip-mapping" open><summary>Review process-column links · '+groups.size+' Part/stage combinations</summary><div id="wipStepMaps">'+(stageMappings||'<p>No mapped Part rows. Choose Part links first.</p>')+'</div></details>'+wipMatrix(rows,wipDraft.columns,20);
  $('#wipSave').disabled=store.status==='archived'||!counts||wipDraft.warnings.length>0;
}
function renderWip() {
  $('#recordsTitle').textContent='Production · WIP snapshots';
  $('#recordsNote').textContent='MES counts are unit snapshots by product row and process column. They are not work instructions or live inventory.';
  renderStaffing();
  renderProductionStaffing();
  const data=wipHistoryData||wipData;
  $('#wipSnapshot').innerHTML=data?.snapshots.length?data.snapshots.map(item=>'<option value="'+h(item.id)+'"'+(item.id===data.selected?' selected':'')+'>'+h(item.capturedAt+' · '+item.filename+' · '+item.sheet)+'</option>').join(''):'<option value="">No snapshots yet</option>';
  if(!data?.selected){$('#wipSnapshotTable').innerHTML='<p class="empty-note">Upload an .xlsx MES WIP sheet to see counts for every recorded process column.</p>';renderWipPreview();return;}
  const rowsById=new Map(),columnsById=new Map();
  for(const item of data.counts){
    if(!rowsById.has(item.row))rowsById.set(item.row,{row:item.row,code:item.code,partName:item.partName,counts:[]});
    rowsById.get(item.row).counts.push(item);
    if(!columnsById.has(item.column))columnsById.set(item.column,{column:item.column,name:item.stage});
  }
  const unmapped=data.counts.filter(item=>!item.stepId);
  $('#wipSnapshotTable').innerHTML='<p class="muted">'+h(data.snapshots.find(item=>item.id===data.selected)?.capturedAt||'')+' · '+data.counts.length+' unit counts · '+unmapped.length+' unmapped. Unlinked labels stay exactly as uploaded.</p>'+wipMatrix([...rowsById.values()],[...columnsById.values()])+(unmapped.length?'<details class="wip-mapping"><summary>Unmapped MES data · '+unmapped.length+' counts</summary>'+table(['Source cell','Part label','Process column','Units'],unmapped.map(item=>'<tr><td>Row '+h(item.row)+' · column '+h(item.column)+'</td><td>'+h(item.partName)+'</td><td>'+h(item.stage)+'</td><td>'+h(item.quantity)+'</td></tr>'))+'</details>':'');
  renderWipPreview();
}
function renderProductionStaffing() {
  const type=$('#productionStaffTargetType').value,selector=$('#productionStaffTarget'),selected=selector.value;
  const targets=store.entities.filter(item=>item.type===type).sort((a,b)=>a.name.localeCompare(b.name));
  selector.innerHTML='<option value="">Choose '+h(type==='Resource'?'Resource':'Step')+'</option>'+targets.map(item=>'<option value="'+h(item.id)+'">'+h(item.name+(item.machineMode?' · '+item.machineMode.replace('_',' '):''))+'</option>').join('');
  selector.value=targets.some(item=>item.id===selected)?selected:'';
  $('#productionStaffSave').disabled=store.status==='archived';
  $('#productionStaffHistory').innerHTML=productionStaffingData.length?table(['Target','People','Date / shift','Basis / note'],productionStaffingData.map(item=>'<tr><td>'+h(Model.byId(store,item.targetId)?.name||'Object no longer in project')+'<small>'+h(item.targetType)+'</small></td><td>'+h(item.count)+'</td><td>'+h(item.capturedAt)+'<small>'+h(item.shift||'Shift not recorded')+'</small></td><td>'+h(item.basis)+'<small>'+h(item.note||'No note')+'</small></td></tr>')):'<p class="empty-note">No Step or Resource worker observation yet. Map overlay shows — until one is recorded.</p>';
}
function renderStaffing() {
  const selector=$('#staffPart'),selected=selector.value;
  const parts=store.entities.filter(item=>['Part','Part Revision'].includes(item.type)).sort((a,b)=>a.name.localeCompare(b.name));
  selector.innerHTML='<option value="">Choose Part</option>'+parts.map(item=>'<option value="'+h(item.id)+'">'+h(item.name)+'</option>').join('');
  selector.value=parts.some(item=>item.id===selected)?selected:'';
  $('#staffSave').disabled=store.status==='archived';
  const names=new Map(parts.map(item=>[item.id,item.name]));
  $('#staffHistory').innerHTML=staffingData.length?table(['Part','People','Date / shift','Basis / note'],staffingData.map(item=>'<tr><td>'+h(names.get(item.partId)||'Part no longer in project')+'</td><td>'+h(item.count)+'</td><td>'+h(item.capturedAt)+'<small>'+h(item.shift||'Shift not recorded')+'</small></td><td>'+h(item.basis)+'<small>'+h(item.note||'No note')+'</small></td></tr>')):'<p class="empty-note">No worker count recorded yet.</p>';
}
function renderProductionMap(invalid) {
  renderProductionPartOptions();
  const projection=progressUI.filter('production',store,invalid&&!progressUI.enabled('production',store)?{nodes:[],edges:[],parts:[],unlinked:[]}:Flow.productionNetwork(store,{showStakeholders:hourlyUI.enabled('production',store)||$('#productionSeeStakeholders').checked,showLineReferences:!productionPartsCustomized,line:hourlyUI.enabled('production',store)&&store.name==='SMT'?'SMT':$('#productionLine').value,partIds:productionPartIds,start:progressUI.enabled('production',store)?'':$('#dateStart').value,end:progressUI.enabled('production',store)?'':$('#dateEnd').value}));
  let shown=hourlyUI.graph('production',store,projection);
  productionSize=hourlyUI.layout('production',store,shown,progressUI.layout('production',store,shown,Flow.productionContextLayout(store,shown,{showMachines:!progressUI.enabled('production',store)&&$('#productionSeeMachines').checked,showComponents:!progressUI.enabled('production',store)&&$('#productionSeeComponents').checked})));applyProductionZoom();
  if(!progressUI.enabled('production',store)&&!hourlyUI.enabled('production',store)){const view=presentNetwork('production',shown,productionSize,productionPartsCustomized);shown=view.network;productionSize=view.layout;applyProductionZoom();}
  drawNetworkCanvas('production',shown,productionSize);
  $('#productionCount').textContent=projection.parts.length+' Parts · '+projection.nodes.filter(n=>n.entity.type==='Production Step').length+' steps · '+projection.nodes.filter(n=>n.entity.type!=='Production Step').length+' related objects · '+projection.unlinked.length+' unlinked';
  $('#productionEmpty').hidden=shown.nodes.length>0;
}
function resetLogReview() {
  logDraft=null;$('#saveLogs').disabled=true;$('#logPreview').innerHTML='';$('#logError').textContent='';
}
function setLogSaving(saving) {
  logSaving=saving;
  $('#productionLogsView').querySelectorAll('input,select,textarea,button').forEach(control=>control.disabled=saving||store?.status==='archived');
  if(logDraft)updateLogReviewStatus();else $('#saveLogs').disabled=true;
}
function renderLogs() {
  const partId=$('#logPart').value,parts=store.entities.filter(entity=>['Part','Part Revision'].includes(entity.type)).sort(partFamilyOrder);
  $('#logPart').innerHTML='<option value="">Choose Part / Component</option>'+parts.map(part=>'<option value="'+h(part.id)+'">'+h((Model.isComponentPart(part)?'C · ':'P · ')+part.name)+'</option>').join('');
  $('#logPart').value=parts.some(part=>part.id===partId)?partId:productionHighlightPartId||productionPartIds[0]||'';
  $('#previewLogs').disabled=store.status==='archived';
  if(!logDraft)$('#saveLogs').disabled=true;
  const sourceIds=new Set(store.relations.filter(relation=>relation.from===$('#logPart').value&&relation.type==='supported_by').map(relation=>relation.to));
  const sources=store.entities.filter(entity=>sourceIds.has(entity.id)&&entity.rawLog).sort((a,b)=>(b.recordedAt||'').localeCompare(a.recordedAt||''));
  $('#logHistory').innerHTML=sources.length?table(['Source','Saved','Reviewed events'],sources.map(source=>'<tr><td>'+link(source)+'</td><td>'+h(source.recordedAt||'—')+'</td><td>'+store.relations.filter(relation=>relation.to===source.id&&relation.type==='supported_by'&&Model.byId(store,relation.from)?.productionEventKind).length+'</td></tr>')):'<p class="empty-note">No saved logs for this Part yet.</p>';
  if(logDraft)renderLogPreview();
  setLogSaving(logSaving);
}
function updateLogReviewStatus() {
  if(!logDraft)return;
  for(const row of logDraft.rows)row.error=Logs.rowError(store,logDraft.partId,row);
  const errors=logDraft.rows.filter(row=>row.include&&row.error);
  $('#saveLogs').disabled=logSaving||store.status==='archived'||errors.length>0;
  $('#saveLogs').textContent=logDraft.rows.some(row=>row.include)?'Save reviewed logs':'Save raw log';
  for(const message of $('#logPreview').querySelectorAll('[data-log-error]'))message.textContent=logDraft.rows[Number(message.dataset.logError)]?.error||'Ready';
  $('#logError').textContent=errors.length?errors.length+' selected row(s) need review before saving.':'';
}
function renderLogPreview() {
  if(!logDraft)return;
  const steps=Logs.stepsForPart(store,logDraft.partId);
  const select=(field,options,value)=>'<select data-log-field="'+field+'" aria-label="'+(field==='stepId'?'Operation':'Event kind')+'">'+options.map(([id,label])=>'<option value="'+h(id)+'"'+(id===value?' selected':'')+'>'+h(label)+'</option>').join('')+'</select>';
  $('#logPreview').innerHTML='<p class="log-review-note">'+h(logDraft.note)+'</p>'+(logDraft.rows.length?table(['Use','Trace ID','Operation','Event','Timestamp · timezone required','Review'],logDraft.rows.map((row,index)=>'<tr data-log-row="'+index+'"><td><input type="checkbox" data-log-field="include" aria-label="Include log row '+row.row+'"'+(row.include?' checked':'')+'></td><td><input data-log-field="traceId" aria-label="Trace ID for row '+row.row+'" maxlength="120" value="'+h(row.traceId)+'"></td><td>'+select('stepId',[['','Choose operation'],...steps.map(step=>[step.id,step.name])],row.stepId)+'<small>Source: '+h(row.stepLabel)+'</small></td><td>'+select('kind',[['','Choose event'],...Model.PRODUCTION_EVENT_KINDS.map(kind=>[kind,kind])],row.kind)+'</td><td><input data-log-field="occurredAt" aria-label="Timestamp for row '+row.row+'" maxlength="120" value="'+h(row.occurredAt)+'"></td><td class="log-row-error" data-log-error="'+index+'"></td></tr>')):'');
  updateLogReviewStatus();
}
for(const id of ['logPart','logTraceKind','logName','logText'])$('#'+id).addEventListener('input',()=>{resetLogReview();if(id==='logPart')renderLogs();});
$('#previewLogs').onclick=()=>{
  try {
    const partId=$('#logPart').value,text=$('#logText').value;
    logDraft={...Logs.preview(store,partId,text),partId,text,name:$('#logName').value,traceKind:$('#logTraceKind').value};
    renderLogPreview();
  }catch(error){resetLogReview();$('#logError').textContent=error.message;}
};
$('#logPreview').addEventListener('input',event=>{
  const field=event.target.dataset.logField,index=event.target.closest('[data-log-row]')?.dataset.logRow;
  if(!logDraft||!field||index===undefined)return;
  logDraft.rows[Number(index)][field]=field==='include'?event.target.checked:event.target.value;
  updateLogReviewStatus();
});
$('#logHistory').onclick=event=>{const button=event.target.closest('[data-select]');if(button)selectEntity(button.dataset.select);};
$('#saveLogs').onclick=async()=>{
  if(!logDraft||logSaving)return;
  const draft=logDraft;setLogSaving(true);
  try {
    const result=await changeProject(project=>Logs.append(project,draft));
    resetLogReview();$('#logText').value='';$('#logName').value='';render();
    toast(result.added+' events saved · '+result.duplicates+' duplicates skipped · source retained');
  }catch(error){updateLogReviewStatus();$('#logError').textContent=error.message;}
  finally{setLogSaving(false);}
};
function renderProduction(invalid) {
  $('#productionTabs').querySelectorAll('[data-production-view]').forEach(button=>button.setAttribute('aria-current',productionMode===button.dataset.productionView?'page':'false'));
  $('#recordsTitle').textContent=productionMode==='APQP & gates'?'APQP & gates':'Production';
  $('#recordsNote').textContent=productionMode==='Process map'?'Trace each recorded operation to parts, workers, machines and failure branches. Click a node for detailed actions.':'APQP controls and gate evidence stay separate from the production process map.';
  if(productionMode==='Process map'){renderProductionMap(invalid);return;}
  if(productionMode==='WIP snapshots'){renderWip();return;}
  if(productionMode==='Process logs'){$('#recordsNote').textContent='Retain source logs, review their links, then measure recorded waiting intervals.';renderLogs();return;}
  $('#apqpTabs').innerHTML=apqpViews.map(view=>'<button data-apqp-view="'+h(view)+'"'+(apqpView===view?' aria-current="page"':'')+'>'+h(view)+'</button>').join('');
  if(invalid){$('#recordsTable').innerHTML='<p class="empty-note">Fix the date range.</p>';return;}
  if(apqpView==='Phase dashboard') {
    const phases=APQP.dashboard(store).phases;
    $('#recordsTable').innerHTML='<div class="apqp-actions"><button id="applyAPQPStarter" class="button primary"'+(store.entities.some(e=>e.framework==='APQP'||e.apqpPhase)?' disabled':'')+'>Apply 5-phase starter</button><span>Starter appends 5 gates and 5 evidence packs. It never replaces current data.</span></div>'+table(['Phase','Records','Approved','Blocked','Missing owner'],phases.map(p=>'<tr><td><strong>'+h(p.id+' · '+p.name)+'</strong></td><td>'+p.total+'</td><td>'+p.approved+'</td><td>'+p.blocked+'</td><td>'+p.missingOwner+'</td></tr>'));
  } else if(apqpView==='Gate reviews') {
    const gates=APQP.gateReviews(store);
    $('#recordsTable').innerHTML=table(['Gate','Phase','Readiness','Decision','Required evidence'],gates.map(g=>'<tr><td>'+link(g)+'</td><td>'+h(g.apqpPhase||'—')+'</td><td>'+h(g.readiness||'unknown')+'</td><td>'+h(g.decision||'not_decided')+'</td><td>'+(g.required.map(link).join('<br>')||'No required_for links')+'</td></tr>'));
  } else if(apqpView==='Part readiness') {
    const rows=APQP.partReadiness(store);
    $('#recordsTable').innerHTML=table(['Part / revision','Linked production / APQP records','Blocked','Review'],rows.map(r=>'<tr><td>'+link(r.part)+'</td><td>'+r.items.length+'</td><td>'+r.blocked+'</td><td>'+(r.items.length?'Trace links in object details':'No production or APQP linkage')+'</td></tr>'));
  } else {
    const trace=APQP.traceability(store);
    $('#recordsTable').innerHTML='<div class="trace-summary"><strong>'+trace.covered.length+' / '+trace.total+'</strong><span>requirements and characteristics have satisfies, verifies, or controls evidence</span></div>'+table(['Uncovered object','Type','Action'],trace.broken.map(e=>'<tr><td>'+link(e)+'</td><td>'+h(e.type)+'</td><td>Add a verifies, satisfies, or controls relationship</td></tr>'));
  }
}
function partWorkflowHTML(part) {
  const rows=Flow.partWorkflow(store,part.id);
  const childParts=store.relations.filter(r=>r.type==='part_of'&&r.to===part.id).map(r=>Model.byId(store,r.from)).filter(Boolean);
  const names=items=>items.length?items.map(item=>'<button data-select="'+h(item.id)+'">'+h(item.name)+'</button>').join(', '):'Not recorded';
  const machineNames=items=>items.length?items.map(item=>'<button data-select="'+h(item.id)+'">'+h(item.name)+'</button> <small>'+h([item.machineMode==='shared_pool'?'Shared pool':item.machineMode==='specific_asset'?'Specific asset':'Use not classified',item.machineFamily,item.assetId].filter(Boolean).join(' · '))+'</small>').join('<br>'):'Not recorded';
  const materials=(step,type)=>{
    const links=store.relations.filter(relation=>relation.from===step.id&&relation.type===type&&(!relation.routePartId||relation.routePartId===part.id||Model.isComponentPart(part)));
    return links.length?links.map(relation=>{
      const item=Model.byId(store,relation.to);
      return item?'<button data-select="'+h(item.id)+'">'+h(item.name)+'</button> <small>'+h([relation.quantity?'×'+relation.quantity:'Quantity unconfirmed',relation.basis,relation.reviewState].filter(Boolean).join(' · '))+'</small>':'';
    }).join('<br>'):'Not recorded';
  };
  const stage=row=>{
    const step=row.step,children=rows.filter(item=>item.step.parentWorkId===step.id),details=children.filter(item=>item.lane==='detail');
    const failureSteps=[...new Map([...children.filter(item=>item.lane==='failure').map(item=>item.step),...row.failures,...details.flatMap(item=>item.failures)].map(item=>[item.id,item])).values()];
    const roles=row.assignments.map(item=>{
      const people=store.relations.filter(r=>r.type==='assigned_to'&&r.from===item.id).map(r=>Model.byId(store,r.to)?.name).filter(Boolean);
      return h(item.role||item.name)+' · '+h(people.join(', ')||'Unassigned');
    });
    const normalDetails=details.length?'<ol class="workflow-detail-list">'+details.map(item=>'<li><strong>'+h(item.step.name)+'</strong><p>'+h(item.step.operatorAction||'Action not recorded.')+'</p></li>').join('')+'</ol>':'';
    const failureDetails=failureSteps.length?'<ul class="workflow-failure-list">'+failureSteps.map(item=>{
      const cause=store.relations.find(r=>r.type==='on_failure'&&r.to===item.id),source=Model.byId(store,cause?.from);
      return '<li><span>'+h(source?.name||'Check not recorded')+' → </span><button data-select="'+h(item.id)+'">'+h(item.name)+'</button><p>'+h(item.operatorAction||'Disposition not recorded.')+'</p></li>';
    }).join('')+'</ul>':'<p>No failure route recorded.</p>';
    return '<details class="workflow-stage" data-workflow-stage="'+h(step.id)+'"><summary><strong>'+h(step.name)+'</strong><small>'+h([step.operationCode,step.productionStage].filter(Boolean).join(' · ')||'Operation details')+'</small><span>'+details.length+' details · '+failureSteps.length+' problem paths</span></summary><div class="workflow-stage-body"><section><h4>Normal work</h4><p>'+h(step.operatorAction||step.context||'Worker action not recorded.')+'</p>'+normalDetails+'</section><section class="workflow-failure"><h4>If check fails</h4>'+(step.failureAction?'<p>'+h(step.failureAction)+'</p>':'')+failureDetails+'</section><dl><dt>Part / revision</dt><dd>'+names(row.parts)+'</dd><dt>Input components</dt><dd>'+materials(step,'consumes')+'</dd><dt>Output components</dt><dd>'+materials(step,'produces')+'</dd><dt>Machine / resource</dt><dd>'+machineNames(row.resources)+'</dd><dt>Worker / role</dt><dd>'+(roles.join('<br>')||names(row.workers))+'</dd><dt>Pass condition</dt><dd>'+h(step.acceptanceCriteria||'Not recorded')+'</dd></dl></div></details>';
  };
  const normal=rows.filter(row=>row.lane==='normal'),unplaced=rows.filter(row=>row.lane==='unplaced');
  return '<div class="part-workflow"><div class="workflow-intro"><p>'+rows.length+' production operations linked to this part'+(childParts.length?' and its child parts':'')+'. Only recorded arrows confirm sequence.</p><button id="openPartProduction" class="button primary">Open production map for this part</button></div>'+(childParts.length?'<p class="workflow-family"><strong>Child parts</strong> '+names(childParts)+'</p>':'')+(rows.length?'<section class="workflow-route"><h3>Normal route</h3>'+(normal.length?normal.map(stage).join(''):'<p class="empty-note">No recorded sequence for this part.</p>')+'</section>'+(unplaced.length?'<section class="workflow-unplaced"><h3>Order not confirmed</h3><p>These observations are linked to the part but have no recorded sequence.</p>'+unplaced.map(stage).join('')+'</section>':''):'<p class="empty-note">No production steps linked yet. Add a step and connect it with applies_to or produces.</p>')+'</div>';
}
function renderInspector() {
  const e=Model.byId(store,selectedId); if(!e) { $('#inspector').hidden=true; return; }
  const relations=[...Model.relationsFor(store,e.id),...store.entities.filter(child=>child.parentWorkId&&(child.id===e.id||child.parentWorkId===e.id)).map(child=>({from:child.parentWorkId,to:child.id,type:'subprocess',evidence:child.branchKind||'support'}))];
  const meta=[['ID',e.id],['Status',e.status],['Phase',e.phase||'Unknown']];
  if(e.type==='Person'){
    const matches=workspace.library.entities.find(item=>item.id==='kakao-identity-review-20261015')?.identityReview?.mappings||[];
    for(const match of matches.filter(item=>item.accountId===e.id||item.personId===e.id)){
      const person=Model.byId(workspace.library,match.personId);
      meta.push([match.status==='confirmed'?'Kakao identity · confirmed':'Kakao identity · needs confirmation',String(match.authorId)+' · '+(person?.name||'Unknown')+' · '+match.reason]);
    }
  }
  for(const key of [...Model.DATE_FIELDS,...Model.TEXT_FIELDS.filter(k=>!['phase','operatorAction','acceptanceCriteria','failureAction','rawLog'].includes(k))]) if(e[key]) meta.push([dateLabel(key),e[key]]);
  const changes=(store.changes||[]).filter(c=>c.entityId===e.id).slice().reverse();
  const local=Flow.localGraph(store,e.id,{depth:inspectorDepth,limit:18}),positions=new Map([[e.id,{x:280,y:145}]]),neighbors=local.nodes.filter(n=>n.id!==e.id);
  neighbors.forEach((node,i)=>{const angle=(Math.PI*2*i/Math.max(1,neighbors.length))-Math.PI/2;positions.set(node.id,{x:280+Math.cos(angle)*180,y:145+Math.sin(angle)*105});});
  const edges=local.relations.map(r=>{const a=positions.get(r.from),b=positions.get(r.to);if(!a||!b)return '';return '<g><line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" class="mini-edge" marker-end="url(#miniArrow)"></line><text x="'+((a.x+b.x)/2)+'" y="'+((a.y+b.y)/2-5)+'" class="mini-edge-label" text-anchor="middle">'+h(r.type)+'</text></g>';}).join('');
  const nodes=local.nodes.map(node=>{const p=positions.get(node.id),center=node.id===e.id;return '<g data-select="'+node.id+'" data-inspector-neighbor="true" class="mini-node '+(center?'center':'')+'" transform="translate('+(p.x-60)+' '+(p.y-24)+')" tabindex="0" role="button"><rect width="120" height="48" style="--mini-color:'+Model.COLORS[node.type]+'"></rect><text x="10" y="18">'+h(short(node.type,16))+'</text><text x="10" y="36" class="mini-name">'+h(short(node.name,18))+'</text></g>';}).join('');
  const relationshipList=relations.map(r=>{const outgoing=r.from===e.id,other=Model.byId(store,outgoing?r.to:r.from);return other?'<button class="relation-card" data-select="'+other.id+'" data-inspector-neighbor="true"><small>'+h(outgoing?r.type+' →':'← '+r.type)+'</small><strong>'+h(other.name)+'</strong><span>'+h(r.evidence||'No evidence note')+'</span></button>':'';}).join('');
  const instructions=e.type==='Production Step'?'<section class="work-instructions"><h3>Worker operation</h3><p>'+h(e.operatorAction||'Action not recorded.')+'</p><h3>Pass condition</h3><p>'+h(e.acceptanceCriteria||'Not recorded.')+'</p><h3>Failure / escalation</h3><p>'+h(e.failureAction||'Not recorded.')+'</p></section>':'';
  const includedIn=(workspace?.projects||[]).filter(p=>p.entities.some(item=>item.id===e.id)).map(p=>p.name).join(', ')||'No project views';
  const assignedLanes=(store.workstreams?.[e.id]||[]).map(code=>Model.WORKSTREAMS.find(item=>item.code===code)?.label||code);
  let routeInfo='';
  if(e.type==='Production Step'&&store.id!=='library'){
    const partIds=activeTab==='Production'?productionPartIds:selectedWorkstream==='production'?mapPartIds:null;
    const route=Flow.productionNetwork(store,{partIds}).nodes.find(node=>node.id===e.id)||{id:e.id,entity:e,partIds:[]};
    const mode=activeTab==='Production'?$('#productionNumbers').value:$('#showNumbers').value;
    const highlight=activeTab==='Production'?productionHighlightPartId:selectedWorkstream==='production'?mapHighlightPartId:'';
    const metric=networkMetric(route,mode,highlight);
    routeInfo='<section class="inspector-section"><h3>Route &amp; observation</h3><p><strong>Parts:</strong> '+h(route.partIds.map(id=>Model.byId(store,id)?.name||id).join(', ')||'No linked Part')+'</p>'+(metric?'<p><strong>'+h(metric.text)+'</strong> · '+h(metric.title)+'</p>':'<p class="muted">Select Parts, Workers or Pending time in Show numbers.</p>')+'</section>';
  }
  const risks=Flow.relatedRisks(store,e.id);
  const riskDetails=risks.length?'<section class="inspector-section"><h3>Related risks / issues · '+risks.length+'</h3>'+risks.map(item=>'<button class="relation-card" data-select="'+h(item.id)+'"><small>'+h(item.type)+' · '+h(item.status)+'</small><strong>'+h(item.name)+'</strong><span>'+h(item.context)+'</span></button>').join('')+'</section>':'';
  const overview='<p class="inspector-context">'+h(e.context||'No context recorded.')+'</p><p class="muted">Global object · in '+h(includedIn)+'</p>'+(store.id==='library'?'':'<p class="muted">Project workstreams: '+h(assignedLanes.join(', ')||'Unassigned · use Edit object to classify')+'</p>')+routeInfo+instructions+riskDetails+'<dl class="meta-grid">'+meta.map(([key,val])=>'<dt>'+h(key)+'</dt><dd>'+h(val)+'</dd>').join('')+'</dl>'+(e.rawLog?'<details class="raw-log"><summary>Original process log</summary><pre>'+h(e.rawLog)+'</pre></details>':'');
  const relationshipView='<div class="mini-map-controls"><button class="button" data-depth="1"'+(inspectorDepth===1?' aria-pressed="true"':'')+'>Direct</button><button class="button" data-depth="2"'+(inspectorDepth===2?' aria-pressed="true"':'')+'>Two hops</button><button id="openMainMap" class="text-button">Open in main map</button></div><svg class="mini-map" viewBox="0 0 560 290" role="img" aria-label="Relationships around '+h(e.name)+'"><defs><marker id="miniArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"></path></marker></defs>'+edges+nodes+'</svg>'+(local.truncated?'<p class="muted">'+local.truncated+' more objects hidden. Open main map.</p>':'')+'<section class="inspector-section"><h3>Relationship list · '+relations.length+'</h3>'+relationshipList+(relations.length?'':'<p class="muted">No links yet. Use Input → Connect objects.</p>')+'</section>';
  const history='<section class="inspector-section"><h3>Edit history · '+changes.length+'</h3>'+changes.map(c=>{
    const fields=Object.keys(c.after||{}).filter(k=>JSON.stringify(c.before?.[k])!==JSON.stringify(c.after[k]));
    return '<div class="change-entry"><small>'+h(c.recordedAt)+'</small>'+fields.map(k=>'<p>'+h(dateLabel(k))+': '+h(c.before?.[k]||'Unknown')+' → '+h(c.after[k]||'Unknown')+'</p>').join('')+'</div>';
  }).join('')+(changes.length?'':'<p class="muted">No edits recorded.</p>')+'</section>';
  const isPart=['Part','Part Revision'].includes(e.type);
  const workflow=isPart?riskDetails+partWorkflowHTML(e):'';
  const views={overview,workflow,relationships:relationshipView,history};
  const workflowButton=isPart?'<button data-inspector-view="workflow"'+(inspectorView==='workflow'?' aria-current="page"':'')+'>Workflow</button>':'';
  $('#inspectorContent').innerHTML='<span class="inspector-type" style="--entity-color:'+Model.COLORS[e.type]+'">'+h(e.type)+'</span><h2>'+h(e.name)+'</h2><nav class="inspector-tabs" aria-label="Object detail views"><button data-inspector-view="overview"'+(inspectorView==='overview'?' aria-current="page"':'')+'>Overview</button>'+workflowButton+['relationships','history'].map(view=>'<button data-inspector-view="'+view+'"'+(inspectorView===view?' aria-current="page"':'')+'>'+h(view)+'</button>').join('')+'</nav>'+views[inspectorView];
  if(['overview','workflow'].includes(inspectorView)&&window.SamplePreparation.isSample(store)&&window.LocalAPI?.samplePreparationList){
    const project=store,entityId=e.id,mount=document.createElement('section');mount.className='inspector-section';$('#inspectorContent').append(mount);
    LocalAPI.samplePreparationList(project.id).then(sheets=>{
      if(!mount.isConnected||store!==project||selectedId!==entityId)return;
      const issues=sheets.flatMap(sheet=>sheet.answers.filter(a=>a.status==='issue'&&(sheet.partId===entityId||a.referenceIds?.includes(entityId))).map(answer=>({sheet,answer})));
      if(!issues.length){mount.remove();return;}
      mount.innerHTML='<h3>Sample preparation issues · '+issues.length+'</h3>'+issues.map(({sheet,answer})=>'<div class="relation-card"><small>'+h(sheet.runName)+' · '+h(Model.byId(project,sheet.partId)?.name||sheet.partId)+'</small><strong>'+h(SamplePreparation.questions(sheet).find(q=>q.id===answer.questionId)?.question||answer.questionId)+'</strong><span>'+h(answer.note||'No evidence note recorded.')+'</span></div>').join('')+'<button class="button" data-open-preparation>Open Sample Preparation Checksheet</button>';
      mount.querySelector('[data-open-preparation]').onclick=()=>{activeTab='Risk / Issues';sampleRiskMode='preparation';selectedId=null;$('#inspector').hidden=true;render();};
    }).catch(()=>{if(mount.isConnected)mount.remove();});
  }
  if(inspectorView==='overview'){
    const contacts=Flow.reportingContacts(store,e.id),personButton=person=>'<button class="relation-card" data-select="'+h(person.id)+'"><strong>'+h(person.name)+'</strong><span>'+h(person.title||'Role member')+'</span></button>';
    if(contacts.firstContacts.length)$('#inspectorContent').insertAdjacentHTML('beforeend','<section class="inspector-section"><h3>Report a problem · '+h(contacts.line.name)+'</h3><p>Contact the line Leader or Supervisor first. Either is a first reporting option; managers are later escalation.</p><p class="muted">Confirm who is on duty. Contact details and individual station responsibility are not confirmed; this is not an emergency procedure.</p>'+contacts.firstContacts.map(({group,members})=>'<h4><button class="text-button" data-select="'+h(group.id)+'">'+h(group.name)+'</button></h4>'+(members.length?members.map(personButton).join(''):'<p>Named contact not recorded. Find the on-duty Leader or Supervisor.</p>')).join('')+(contacts.laterManagers.length?'<details><summary>Later escalation · managers</summary>'+contacts.laterManagers.map(personButton).join('')+'</details>':'')+'</section>');
    else if(['Production Step','Work Item'].includes(e.type)||e.type==='Resource'&&e.resourceKind==='line')$('#inspectorContent').insertAdjacentHTML('beforeend','<section class="inspector-section"><h3>Report a problem</h3><p>'+h(contacts.status==='ambiguous'?'Several lines are linked. Confirm the actual line, then contact its Leader or Supervisor first.':'Line Leader / Supervisor not confirmed for this object. Confirm the line and on-duty contact; do not assume a manager is the first contact.')+'</p></section>');
  }
}
function entityFields() {
  const type=$('#entityType').value;
  $('#assignmentFields').hidden=type!=='Assignment'; $('#gateFields').hidden=type!=='Gate';
  $('#dateFields').hidden=!Flow.SCHEDULE_TYPES.includes(type);
  $('#eventLogFields').hidden=type!=='Event';
  $('#stakeholderFields').hidden=!['Person','Organization'].includes(type);
  $('#workerFields').hidden=type!=='Person';
  $('#partFields').hidden=!['Part','Part Revision'].includes(type);
  $('#parentPart').parentElement.hidden=type!=='Part';
  $('#resourceFields').hidden=type!=='Resource';
  $('#productionFields').hidden=type!=='Production Step';
  $('#processFields').hidden=!['Work Item','Production Step','Gate','Deliverable'].includes(type);
  $('#apqpFields').hidden=!['Work Item','Gate','Deliverable','Evidence','Requirement','Characteristic'].includes(type);
  $('#characteristicFields').hidden=type!=='Characteristic';
  const parent=$('#parentWorkId'),value=parent.value, parentType=type==='Production Step'?'Production Step':'Work Item';
  parent.parentElement.firstChild.textContent=type==='Production Step'?'Parent production step':'Parent work item';
  parent.innerHTML='<option value="">Choose parent '+(type==='Production Step'?'step':'work')+'</option>'+store.entities.filter(p=>p.type===parentType&&p.id!==editingId).map(p=>'<option value="'+h(p.id)+'">'+h(p.name)+'</option>').join('');
  parent.value=value;
  $('#parentWorkId').disabled=$('#processLevel').value!=='sub';
  $('#branchKind').disabled=$('#processLevel').value!=='sub';
  $('#dateInputs').querySelectorAll('label').forEach(label=>{label.hidden=label.dataset.date==='assessedOn'||(type==='Event'?label.dataset.date!=='occurredDate':label.dataset.date==='occurredDate');});
  const projectScheduleOnly=store.id==='library'&&type==='Production Step';
  $('#dateInputs').querySelectorAll('input').forEach(input=>input.disabled=projectScheduleOnly);
  $('#dateFields legend').textContent=projectScheduleOnly?'Dates · set inside a project view':'Dates · leave unknown values blank';
}
function openEntity(id=null) {
  editingId=id; const e=id?Model.byId(store,id):null;
  $('#entityForm').reset(); $('#entityError').textContent='';
  $('#entityMatchReview').hidden=true;$('#entityMatchReview').dataset.key='';
  $('#entityDialogTitle').textContent=id?'Edit object':'Add object';
  $('#entityType').innerHTML=allTypes.map(t=>'<option>'+h(t)+'</option>').join('');
  $('#entityType').value=e?.type || (activeTab==='Production'&&productionMode==='APQP & gates'?'Gate':tabTypes[activeTab]?.[0]||'Work Item'); $('#entityType').disabled=Boolean(id);
  $('#workstreamChoices').hidden=store.id==='library';
  const chosen=id?store.workstreams?.[id]||[]:selectedWorkstream?[selectedWorkstream]:[];
  $('#workstreamChecks').innerHTML=Model.WORKSTREAMS.map(item=>'<label class="check"><input type="checkbox" data-workstream-choice="'+item.code+'"'+(chosen.includes(item.code)?' checked':'')+'>'+h(item.label)+'</label>').join('');
  const bindings={Name:'name',Context:'context',Status:'status',Phase:'phase',Role:'role',Raci:'raci',Readiness:'readiness',Decision:'decision'};
  for(const [suffix,key] of Object.entries(bindings)) {
    const input=$('#entity'+suffix), value=e?.[key]||(key==='status'?'planned':'');
    if(input.tagName==='SELECT'&&value&&!Array.from(input.options).some(o=>o.value===value)) input.add(new Option(value,value));
    input.value=value;
  }
  $('#dateInputs').innerHTML=Model.DATE_FIELDS.map(key=>'<label data-date="'+key+'">'+h(dateLabel(key))+'<input id="field-'+key+'" type="date" value="'+h(e?.[key]||'')+'"></label>').join('');
  $('#stakeholderInputs').innerHTML=profileFields.map(key=>{
    const values=['power','influence'].includes(key)?['low','medium','high']:key.endsWith('Engagement')?Model.ENGAGEMENT:null;
    const disabled=store.id==='library'&&key!=='title'?' disabled':'';
    const control=values?'<select id="profile-'+key+'"'+disabled+'><option value="">Unknown / not assessed</option>'+values.map(v=>'<option value="'+v+'"'+(e?.[key]===v?' selected':'')+'>'+h(v)+'</option>').join('')+'</select>':key==='assessmentNote'?'<textarea id="profile-'+key+'" rows="3" maxlength="2000"'+disabled+'>'+h(e?.[key]||'')+'</textarea>':'<input id="profile-'+key+'" type="'+(key==='assessedOn'?'date':'text')+'" maxlength="120" value="'+h(e?.[key]||'')+'"'+disabled+'>';
    return '<label>'+h(key==='power'?'Power · decision authority':key==='influence'?'Influence · ability to shape outcomes':dateLabel(key))+(disabled?' · project only':'')+control+'</label>';
  }).join('');
  $('#processLevel').value=e?.processLevel||'main';
  $('#branchKind').value=e?.branchKind||'';
  for(const [field,key] of [['workArea','workArea'],['department','department'],['workerRole','workerRole'],['workerTier','tier'],['workerQualification','qualification'],['workerShift','shift'],['workerSite','site'],['resourceKind','resourceKind'],['machineMode','machineMode'],['machineFamily','machineFamily'],['resourceTier','tier'],['assetId','assetId'],['resourceModel','model'],['resourceSite','site'],['capacityNote','capacityNote'],['operationCode','operationCode'],['productionStage','productionStage'],['workCenter','workCenter'],['operatorAction','operatorAction'],['acceptanceCriteria','acceptanceCriteria'],['failureAction','failureAction']]) $('#'+field).value=e?.[key]||'';
  $('#personManager').innerHTML='<option value="">Not recorded</option>'+store.entities.filter(p=>p.type==='Person'&&p.id!==id).map(p=>'<option value="'+h(p.id)+'">'+h(p.name)+'</option>').join('');
  $('#personManager').value=id?store.relations.find(r=>r.type==='reports_to'&&r.from===id)?.to||'':'';
  $('#parentPart').innerHTML='<option value="">No parent recorded</option>'+store.entities.filter(p=>p.type==='Part'&&p.id!==id).map(p=>'<option value="'+h(p.id)+'">'+h(p.name)+'</option>').join('');
  $('#parentPart').value=id?store.relations.find(r=>r.type==='part_of'&&r.from===id)?.to||'':'';
  $('#productionFamily').value=e?.productionFamily||'';
  $('#itemKind').value=e?.itemKind||'product';
  $('#productFamily').value=e?.productFamily||'';
  $('#partSide').value=e?.side||'';
  $('#verticalPosition').value=e?.verticalPosition||'';
  $('#pieceIndex').value=e?.pieceIndex||'';
  $('#modelCode').value=e?.modelCode||'';$('#codeNamespace').value=e?.codeNamespace||'';
  for(const [field,key] of [['eventOccurredAt','occurredAt'],['eventLogKind','productionEventKind'],['eventTraceId','traceId'],['eventTraceKind','traceKind']])$('#'+field).value=e?.[key]||'';
  for(const key of ['apqpPhase','completionState','applicability','requirementSource','notApplicableReason','approvedBy','characteristicKind','classification','specification','tolerance','measurementMethod']) $('#'+key).value=e?.[key]||(['characteristicKind'].includes(key)?'product':key==='classification'?'normal':'');
  entityFields(); $('#parentWorkId').value=e?.parentWorkId||''; $('#entityDialog').showModal();
}
function openRelation() {
  $('#relationForm').reset(); $('#relationError').textContent='';
  const html=store.entities.map(e=>'<option value="'+e.id+'">'+h(e.type+' · '+e.name)+'</option>').join('');
  $('#relationFrom').innerHTML=html; $('#relationTo').innerHTML=html;
  $('#relationType').innerHTML=Model.RELATION_TYPES.map(t=>'<option>'+t+'</option>').join('');
  if(selectedId) $('#relationFrom').value=selectedId;
  $('#relationRoutePart').innerHTML='<option value="">Not specified</option>'+store.entities.filter(Model.isProductPart).sort(partFamilyOrder).map(part=>'<option value="'+h(part.id)+'">'+h(part.name)+'</option>').join('');
  $('#relationScope').value=store.id==='library'?'global':'auto';$('#relationScope').disabled=store.id==='library';
  syncMaterialRelationFields();
  $('#relationDialog').showModal();
}
function syncMaterialRelationFields() {
  const from=Model.byId(store,$('#relationFrom').value),to=Model.byId(store,$('#relationTo').value),type=$('#relationType').value;
  const material=from?.type==='Production Step'&&['consumes','produces'].includes(type)&&['Part','Part Revision'].includes(to?.type);
  $('#relationMaterialFields').hidden=!material;
  $('#relationHint').textContent=material?'Connect each physical Component separately. Quantity is per stated basis (e.g. one input plate), not live WIP. Select the product route when this Step serves several Parts.':'Production Step → applies_to → Part; Step → requires → Resource; Step → consumes/produces → individual Component; only precedes confirms normal sequence.';
}
function otherProjectOwner(entityId) {
  return workspace.projects.find(p=>p.id!==store.id && p.entities.some(e=>e.id===entityId));
}
function renderMembershipPicker() {
  const query=$('#membershipSearch').value.trim().toLowerCase();
  const present=new Set(store.entities.map(e=>e.id));
  const available=workspace.library.entities.filter(e=>!present.has(e.id));
  const shown=available.filter(e=>!query||[e.id,e.type,e.name,e.context].some(value=>String(value||'').toLowerCase().includes(query)));
  $('#membershipList').innerHTML=shown.slice(0,200).map(e=>{
    const owner=projectOwnedTypes.has(e.type)?otherProjectOwner(e.id):null;
    return '<label class="membership-option"><input type="checkbox" data-member-id="'+h(e.id)+'"'+(membershipSelection.has(e.id)?' checked':'')+(owner?' disabled':'')+'><span><strong>'+h(e.name)+'</strong><small>'+h(e.type+' · '+e.id+(owner?' · belongs to '+owner.name:''))+'</small></span></label>';
  }).join('')||'<p class="muted">No matching Library objects outside this project.</p>';
  let candidates=[];
  try {candidates=Projects.membershipCandidates(workspace.library,store,[...membershipSelection],$('#includeRoute').checked).filter(id=>{
    const e=Model.byId(workspace.library,id);
    return !projectOwnedTypes.has(e?.type)||!otherProjectOwner(id);
  });}
  catch(error){$('#membershipSummary').textContent=error.message;return;}
  const names=candidates.slice(0,8).map(id=>Model.byId(workspace.library,id)?.name).filter(Boolean);
  $('#membershipSummary').textContent=candidates.length+' objects will be linked'+(names.length?' · '+names.join(', ')+(candidates.length>8?'…':''):'')+'. No global copies.';
  $('#applyMembership').disabled=!candidates.length||store.status==='archived';
}
function download(name,text,type) {
  const url=URL.createObjectURL(new Blob([text],{type})), a=document.createElement('a');
  a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function previewCSV() {
  invalidatePreview(); const result=Flow.previewCSV(store,$('#csvText').value,$('#csvKind').value,{library:workspace.library,choices:csvChoices});
  const appendable=Flow.importedIds(result.rows).length;
  if(!result.errors.length && appendable){preview={projectId:store.id,text:$('#csvText').value,kind:$('#csvKind').value,choices:structuredClone(csvChoices)};$('#applyCSV').disabled=false;}
  const display=result.rows.map(row=>row.resolved?{...row.resolved,status:row.status,note:row.explanation}:row);
  const errors=result.errors.length?'<p class="form-error">Nothing saved. Review these rows before applying.</p><ul class="error-list">'+result.errors.map(e=>'<li>'+h(e)+'</li>').join('')+'</ul>':'<p class="success-note">'+appendable+' rows ready to add or link in '+h(store.name)+'.</p>';
  const rowHtml=display.map(row=>{
    const csvId=row.csvId||row.id,selected=csvChoices[csvId];
    const choice=row.matches?.length?'<label class="csv-choice-label">Match decision<select data-csv-choice="'+h(csvId)+'"><option value="">Choose action</option>'+row.matches.filter(match=>!projectOwnedTypes.has(match.type)||store.id==='library'||store.entities.some(e=>e.id===match.id)).map(match=>'<option value="reuse:'+h(match.id)+'"'+(selected?.action==='reuse'&&selected.targetId===match.id?' selected':'')+'>Reuse '+h(match.name)+' ('+h(match.id)+')</option>').join('')+(workspace.library.entities.some(e=>e.id===csvId)?'':'<option value="create"'+(selected?.action==='create'?' selected':'')+'>Create separate object</option>')+'<option value="skip"'+(selected?.action==='skip'?' selected':'')+'>Skip row</option></select></label>':'';
    return '<tr><td>'+h(csvId===row.id?row.id:csvId+' → '+row.id)+'</td><td>'+h(row.type)+'</td><td>'+h(row.name||row.from+' → '+row.to)+'</td><td><span class="import-status '+h(row.status||'ready')+'">'+h(row.status||'ready')+'</span><small>'+h(row.note||'')+'</small>'+choice+'</td></tr>';
  });
  $('#csvResult').innerHTML=errors+(display.length?'<div class="table-scroll">'+table(['ID','Type','Name / endpoints','Result'],rowHtml)+'</div>':'');
}
function renderIngestionReview() {
  if(!ingestionDraft){$('#ingestionResult').innerHTML='';return;}
  if(ingestionConfirm){
    const selected=ingestionSelection||new Set(),objects=ingestionDraft.objects.filter(item=>selected.has(item.candidateId)),relations=ingestionDraft.relationships.filter(item=>selected.has(item.candidateId));
    const create=objects.filter(item=>item.suggestedAction==='create').length,link=objects.length-create;
    $('#ingestionResult').innerHTML='<section class="ontology-update-review"><h3>Ready to update ontology</h3><p>Only these reviewed items will be appended. Existing records will not be replaced.</p><dl><div><dt>New objects</dt><dd>'+create+'</dd></div><div><dt>Existing links</dt><dd>'+link+'</dd></div><div><dt>Relationships</dt><dd>'+relations.length+'</dd></div><div><dt>Unresolved</dt><dd>'+ingestionDraft.unresolved.length+'</dd></div></dl><div class="dialog-actions"><button id="backIngestion" class="button">Back to extracted draft</button><button id="updateOntology" class="button primary">Update ontology</button></div></section>';
    return;
  }
  const included=item=>!ingestionSelection||ingestionSelection.has(item.candidateId);
  const objectRows=ingestionDraft.objects.map((item,i)=>{
    const matches=item.possibleMatches||[];
    const decision=matches.length?'<label>Existing-name match · choose explicitly<select data-candidate-object="'+i+'" data-field="matchAction"><option value="">Choose reuse or separate</option>'+matches.map(match=>'<option value="reuse:'+h(match.id)+'"'+(item.matchReviewed&&item.matchedObjectId===match.id?' selected':'')+'>Reuse '+h(match.name)+' ('+h(match.id)+')</option>').join('')+'<option value="create"'+(item.matchReviewed&&item.suggestedAction==='create'?' selected':'')+'>Create separate object</option></select></label>':'';
    const fields=['status','context',...Model.DATE_FIELDS,...Model.TEXT_FIELDS].filter(field=>item[field]!=null&&item[field]!=='').map(field=>'<label>'+h(dateLabel(field))+'<input data-candidate-object="'+i+'" data-field="'+h(field)+'" value="'+h(item[field])+'"></label>').join('');
    return '<article class="candidate-card"><label class="check"><input type="checkbox" data-ingestion-select="'+h(item.candidateId)+'"'+(included(item)?' checked':'')+'>Include</label><span class="candidate-kind">'+h(item.suggestedAction.replace('_',' '))+' · '+Math.round((item.confidence||0)*100)+'%</span><div class="form-grid"><label>Type<select data-candidate-object="'+i+'" data-field="type">'+allTypes.map(type=>'<option'+(type===item.type?' selected':'')+'>'+h(type)+'</option>').join('')+'</select></label><label>Name<input data-candidate-object="'+i+'" data-field="name" value="'+h(item.name)+'"></label>'+decision+'</div>'+(item.suggestedAction==='link_existing'?'<p class="muted">Reuse links the existing object without changing its facts.</p>':'')+(fields?'<details class="candidate-fields"><summary>Extracted fields · review before accepting</summary><div class="form-grid">'+fields+'</div></details>':'')+'<label>Source excerpt<textarea rows="2" data-candidate-object="'+i+'" data-field="sourceExcerpt">'+h(item.sourceExcerpt||'')+'</textarea></label></article>';
  }).join('');
  const relationRows=ingestionDraft.relationships.map((item,i)=>{
    const material=['consumes','produces'].includes(item.type);
    const materialFields=material?'<details class="candidate-fields" open><summary>Material quantity & route · review</summary><div class="form-grid"><label>Quantity per basis<input type="number" min="1" step="1" data-candidate-relation="'+i+'" data-field="quantity" value="'+h(item.quantity||'')+'"></label><label>Unit<input data-candidate-relation="'+i+'" data-field="unit" value="'+h(item.unit||'')+'"></label><label>Basis<input data-candidate-relation="'+i+'" data-field="basis" value="'+h(item.basis||'')+'"></label><label>Route Part ID<input data-candidate-relation="'+i+'" data-field="routePartId" value="'+h(item.routePartId||'')+'"></label><label>Review state<select data-candidate-relation="'+i+'" data-field="reviewState"><option value="">Not assessed</option>'+['confirmed','proposed','unverified'].map(state=>'<option value="'+state+'"'+(state===item.reviewState?' selected':'')+'>'+state+'</option>').join('')+'</select></label></div><p class="muted">One physical output per relationship. Missing quantity stays unknown, never zero.</p></details>':'';
    return '<article class="candidate-card"><label class="check"><input type="checkbox" data-ingestion-select="'+h(item.candidateId)+'"'+(included(item)?' checked':'')+'>Include</label><span class="candidate-kind">relationship · '+Math.round((item.confidence||0)*100)+'%</span><div class="form-grid"><label>Relationship<select data-candidate-relation="'+i+'" data-field="type">'+Model.RELATION_TYPES.map(type=>'<option'+(type===item.type?' selected':'')+'>'+h(type)+'</option>').join('')+'</select></label><label>From candidate/object ID<input data-candidate-relation="'+i+'" data-field="from" value="'+h(item.from)+'"></label><label>To candidate/object ID<input data-candidate-relation="'+i+'" data-field="to" value="'+h(item.to)+'"></label><label>Evidence note<input data-candidate-relation="'+i+'" data-field="evidence" value="'+h(item.evidence||'')+'"></label></div>'+materialFields+'<label>Source excerpt<textarea rows="2" data-candidate-relation="'+i+'" data-field="sourceExcerpt">'+h(item.sourceExcerpt||'')+'</textarea></label></article>';
  }).join('');
  $('#ingestionResult').innerHTML='<div class="review-heading"><div><h3>Review extracted draft</h3><p>'+h(ingestionDraft.summary||'No summary returned')+'</p></div><button id="reviewIngestion" class="button primary">Review selected changes</button></div><h3>Objects · '+ingestionDraft.objects.length+'</h3>'+objectRows+'<h3>Relationships · '+ingestionDraft.relationships.length+'</h3>'+relationRows+(ingestionDraft.unresolved.length?'<h3>Unresolved</h3><ul class="error-list">'+ingestionDraft.unresolved.map(item=>'<li>'+h(item.text)+' — '+h(item.reason)+'</li>').join('')+'</ul>':'');
}

function openWholeProcess(){selectedWorkstream='';activeTab='Overview';resetFilters();restoreMapSettings('overview');render();}
function openWorkstream(code){
  if(!Model.WORKSTREAMS.some(item=>item.code===code))return;
  selectedWorkstream=code;activeTab='Overview';resetFilters();types=new Set(allTypes);renderTypeFilters();restoreMapSettings('lens-'+code);render();
}
$('#projectMenuButton').onclick=()=>{selectedWorkstream='';activeTab='Entry';selectedId=null;$('#inspector').hidden=true;render();};
$('#openWholeProcess').onclick=openWholeProcess;
$('#workstreamCards').onclick=event=>{const button=event.target.closest('[data-workstream]');if(button)openWorkstream(button.dataset.workstream);};
$('#openDailyInput').onclick=()=>{selectedWorkstream='';activeTab='Input';render();};
$('#lensAddUpdate').onclick=()=>{activeTab='Input';render();};
$('#openHistory').onclick=()=>{selectedWorkstream='';activeTab='History';render();loadHistory(true);};
$('#historyDate').onchange=()=>loadHistory(true);
$('#historyMore').onclick=()=>loadHistory(false);
$('#tabs').addEventListener('click',event=>{const button=event.target.closest('[data-tab]');if(button){if(selectedWorkstream!=='production')selectedWorkstream='';activeTab=button.dataset.tab;selectedId=null;$('#inspector').hidden=true;if(activeTab==='Production')productionMode='Process map';if(activeTab==='Overview')restoreMapSettings(selectedWorkstream?'lens-'+selectedWorkstream:'overview');render();if(activeTab==='Production')showProductionRouteStart();if(activeTab==='History')loadHistory(true);}});
$('.input-choices').addEventListener('click',event=>{const button=event.target.closest('[data-input-mode]');if(button)setInputMode(button.dataset.inputMode);});
document.addEventListener('click',event=>{
  if(!store)return;
  const detail=event.target.closest('[data-open-detail]');
  if(detail){inspectorView='overview';selectEntity(detail.dataset.openDetail,false);return;}
  const group=event.target.closest('[data-group-toggle]');
  if(group){
    const current=workspace.viewSettings?.[store.id]?.universalGroups?.collapsed;
    const defaultFolded=[...document.querySelectorAll('#nodeLayer .collapsed-map-group,#productionNodes .collapsed-map-group')].map(n=>n.dataset.groupToggle);
    const collapsed=new Set(current||defaultFolded),id=group.dataset.groupToggle;
    collapsed.has(id)?collapsed.delete(id):collapsed.add(id);saveGlobalGroups([...collapsed]);selectedId=null;$('#inspector').hidden=true;render();return;
  }
  const quality=event.target.closest('[data-quality-toggle]');
  if(quality){const key=quality.dataset.qualityToggle;if(qualityExpanded.has(key)){qualityExpanded.delete(key);mapSelectedIds.delete(quality.dataset.select);}else{qualityExpanded.add(key);mapSelectedIds.add(quality.dataset.select);}selectedId=null;$('#inspector').hidden=true;render();return;}
  const node=event.target.closest('[data-select]');
  if(node){if(node.closest('#nodeLayer,#productionNodes')){toggleMapObject(node.dataset.select);return;}if(node.dataset.inspectorNeighbor)inspectorView='relationships';selectEntity(node.dataset.select,!node.closest('#scheduleContent'));}
});
$('#inspector').addEventListener('click',event=>{const view=event.target.closest('[data-inspector-view]');if(view){inspectorView=view.dataset.inspectorView;renderInspector();return;}const depth=event.target.closest('[data-depth]');if(depth){inspectorDepth=Number(depth.dataset.depth);renderInspector();return;}if(event.target.closest('#openMainMap')){selectedWorkstream='';activeTab='Overview';restoreMapSettings('overview');$('#focusMode').value='direct';render();saveViewSettings('overview');}if(event.target.closest('#openPartProduction')){const chosen=Model.byId(store,selectedId),route=Model.isProductPart(chosen)?chosen:Model.byId(store,store.relations.find(relation=>relation.to===selectedId&&relation.routePartId)?.routePartId);if(!Model.isProductPart(route)){toast('This Component has no linked product route yet.');return;}selectedWorkstream='';activeTab='Production';productionMode='Process map';productionPartIds=[route.id];productionPartsCustomized=true;render();showProductionRouteStart();saveViewSettings('production');}});
$('#inspector').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const node=event.target.closest('[data-inspector-neighbor]');if(node){event.preventDefault();selectEntity(node.dataset.select,false);}}});
function openSummary(node) {
  if(node.dataset.summaryWorkstream){openWorkstream(node.dataset.summaryWorkstream);return;}
  if(node.dataset.summaryPart){mapPartId=node.dataset.summaryPart;if(!mapPartIds.includes(mapPartId))mapPartIds.push(mapPartId);selectedId=null;$('#focusMode').value='';$('#inspector').hidden=true;render();saveViewSettings('lens-production');return;}
  if(node.dataset.summaryUnassigned){selectedWorkstream='';activeTab='Entry';render();return;}
  if(node.dataset.summaryUnlinked){selectedWorkstream='';activeTab='Production';productionMode='Process map';productionPartsCustomized=false;render();showProductionRouteStart();}
}
$('#nodeLayer').addEventListener('click',event=>{const node=event.target.closest('[data-summary-workstream],[data-summary-part],[data-summary-unassigned],[data-summary-unlinked]');if(node)openSummary(node);});
$('#nodeLayer').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const node=event.target.closest('[data-open-detail],[data-summary-workstream],[data-summary-part],[data-summary-unassigned],[data-summary-unlinked],[data-select]');if(!node)return;event.preventDefault();node.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
$('#productionNodes').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const node=event.target.closest('[data-open-detail],[data-select]');if(node){event.preventDefault();node.dispatchEvent(new MouseEvent('click',{bubbles:true}));}}});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!document.querySelector('dialog[open]')) $('#inspector').hidden=true;
  if(store&&event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();$('#searchInput').focus();}
});
['searchInput','dateStart','dateEnd'].forEach(id=>$('#'+id).addEventListener('input',()=>{render();saveViewSettings(mapViewKey());}));
['statusFilter','focusMode','keepPredecessors','showSubprocesses'].forEach(id=>$('#'+id).addEventListener('change',()=>{render();saveViewSettings(mapViewKey());}));
$('#mapPart').addEventListener('change',()=>{mapPartId=$('#mapPart').value;if(mapPartId&&!mapPartIds.includes(mapPartId))mapPartIds.push(mapPartId);if(!mapPartId)mapPartIds=[];selectedId=null;$('#focusMode').value='';$('#inspector').hidden=true;render();saveViewSettings('lens-production');});
$('#mapPartSearch').addEventListener('input',renderMapPartOptions);
$('#productionPartSearch').addEventListener('input',renderProductionPartOptions);
$('#mapPartMulti').addEventListener('click',event=>{
  const model=event.target.closest('[data-map-model-only]');if(model){mapPartsCustomized=true;mapPartIds=model.dataset.mapModelOnly.split(',');if(progressUI.active&&!mapPartIds.includes(progressUI.finalPartId))progressUI.finalPartId=mapPartIds[0];render();saveViewSettings(mapViewKey());$('#mapPartMulti').open=false;return;}
  const only=event.target.closest('[data-map-only]'),action=event.target.closest('[data-map-parts-action]');if(!only&&!action)return;
  const all=store.entities.filter(item=>['Part','Part Revision'].includes(item.type)).map(item=>item.id);
  mapPartsCustomized=action?.dataset.mapPartsAction!=='all';mapPartIds=only?[only.dataset.mapOnly]:action.dataset.mapPartsAction==='all'?all:[];
  if(only&&progressUI.active)progressUI.finalPartId=only.dataset.mapOnly;
  selectedId=null;$('#inspector').hidden=true;render();saveViewSettings(mapViewKey());if(only)$('#mapPartMulti').open=false;
});
$('#productionPartMulti').addEventListener('click',event=>{
  const model=event.target.closest('[data-production-model-only]');if(model){productionPartsCustomized=true;productionPartIds=model.dataset.productionModelOnly.split(',');if(progressUI.active&&!productionPartIds.includes(progressUI.finalPartId))progressUI.finalPartId=productionPartIds[0];render();saveViewSettings('production');$('#productionPartMulti').open=false;return;}
  const only=event.target.closest('[data-production-only]'),action=event.target.closest('[data-production-parts-action]');if(!only&&!action)return;
  const all=store.entities.filter(item=>['Part','Part Revision'].includes(item.type)).map(item=>item.id);
  productionPartsCustomized=action?.dataset.productionPartsAction!=='all';productionPartIds=only?[only.dataset.productionOnly]:action.dataset.productionPartsAction==='all'?all:[];
  if(only&&progressUI.active)progressUI.finalPartId=only.dataset.productionOnly;
  render();saveViewSettings('production');if(only)$('#productionPartMulti').open=false;
});
$('#mapPartChoices').addEventListener('change',event=>{if(event.target.dataset.mapModelChoice){const ids=event.target.dataset.mapModelChoice.split(',');mapPartsCustomized=true;mapPartIds=event.target.checked?[...new Set([...mapPartIds,...ids])]:mapPartIds.filter(id=>!ids.includes(id));render();saveViewSettings(mapViewKey());return;}const id=event.target.dataset.mapPartChoice;if(!id)return;mapPartsCustomized=true;if(progressUI.active&&event.target.checked){progressUI.finalPartId=id;mapPartIds=[];}if(event.target.checked){if(!mapPartIds.includes(id))mapPartIds.push(id);if(!mapPartId)mapPartId=id;}else{mapPartIds=mapPartIds.filter(item=>item!==id);if(mapPartId===id)mapPartId=mapPartIds[0]||'';}selectedId=null;$('#focusMode').value='';$('#inspector').hidden=true;render();saveViewSettings(mapViewKey());});
$('#productionPartChoices').addEventListener('change',event=>{if(event.target.dataset.productionModelChoice){const ids=event.target.dataset.productionModelChoice.split(',');productionPartsCustomized=true;productionPartIds=event.target.checked?[...new Set([...productionPartIds,...ids])]:productionPartIds.filter(id=>!ids.includes(id));render();saveViewSettings('production');return;}const id=event.target.dataset.productionPartChoice;if(!id)return;productionPartsCustomized=true;if(progressUI.active&&event.target.checked){progressUI.finalPartId=id;productionPartIds=[];}if(event.target.checked){if(!productionPartIds.includes(id))productionPartIds.push(id);}else productionPartIds=productionPartIds.filter(item=>item!==id);render();saveViewSettings('production');});
$('#showNumbers').addEventListener('change',()=>{render();saveViewSettings(mapViewKey());});
$('#productionNumbers').addEventListener('change',()=>{render();saveViewSettings('production');});
$('#mapHighlight').addEventListener('change',()=>{mapHighlightPartId=$('#mapHighlight').value;selectedId=null;$('#inspector').hidden=true;$('#focusMode').value='';render();focusPartInMap('overview',mapHighlightPartId);saveViewSettings('lens-production');});
$('#productionHighlight').addEventListener('change',()=>{productionHighlightPartId=$('#productionHighlight').value;selectedId=null;$('#inspector').hidden=true;render();focusPartInMap('production',productionHighlightPartId);saveViewSettings('production');});
$('#productionLine').addEventListener('change',event=>{const nextLine=event.target.value,previousLine=$('#productionLine').dataset.previous||'';productionSelections[previousLine||'all']={partIds:[...productionPartIds],partSelectionCustomized:productionPartsCustomized,highlightPartId:productionHighlightPartId};const saved=productionSelections[nextLine||'all'];productionPartsCustomized=saved?.partSelectionCustomized===true;productionPartIds=productionPartsCustomized?[...(saved?.partIds||[])]:[];productionHighlightPartId=saved?.highlightPartId||'';$('#productionLine').dataset.previous=nextLine;render();showProductionRouteStart();saveViewSettings('production');});
$('#mapProductionLine').addEventListener('change',()=>{mapPartsCustomized=false;mapPartIds=[];mapHighlightPartId='';selectedId=null;$('#inspector').hidden=true;render();$('#mapStage').scrollTop=0;$('#mapStage').scrollLeft=0;saveViewSettings('lens-production');});
for(const id of ['productionSeeMachines','productionSeeComponents'])$('#'+id).addEventListener('change',()=>{render();saveViewSettings('production');});
for(const id of ['mapSeeMachines','mapSeeComponents'])$('#'+id).addEventListener('change',()=>{render();saveViewSettings(mapViewKey());});
$('#addProductionExcel').onclick=()=>{productionMode='WIP snapshots';render();$('#wipFile').focus();};
$('#addProductionLogs').onclick=()=>{productionMode='Process logs';render();$('#logText').focus();};
for(const [id,direction] of [['mapPartPrev',-1],['mapPartNext',1]])$('#'+id).addEventListener('click',()=>{if(!mapPartIds.length)return;mapPartId=mapPartIds[(mapPartIds.indexOf(mapPartId)+direction+mapPartIds.length)%mapPartIds.length];selectedId=null;$('#inspector').hidden=true;render();saveViewSettings('lens-production');});
$('#typeFilters').addEventListener('change',event=>{const type=event.target.dataset.type;if(!type)return;if(event.target.checked)types.add(type);else types.delete(type);render();saveViewSettings(mapViewKey());});
$('#perspective').addEventListener('change',()=>{types=new Set(presets[$('#perspective').value]);$('#focusMode').value='';renderTypeFilters();zoom=1;render();saveViewSettings(mapViewKey());});
$('#allTypes').onclick=()=>{types=new Set(allTypes);renderTypeFilters();render();saveViewSettings(mapViewKey());};
$('#noTypes').onclick=()=>{types.clear();renderTypeFilters();render();saveViewSettings(mapViewKey());};
$('#resetFilters').onclick=()=>{resetFilters();if(selectedWorkstream){types=new Set(allTypes);renderTypeFilters();}render();saveViewSettings(mapViewKey());};
$('#clearSelection').onclick=()=>{pendingMapSelection='';mapSelectedIds.clear();selectedId=null;$('#focusMode').value='';$('#inspector').hidden=true;render();};
$('#productionClearSelection').onclick=$('#clearSelection').onclick;
$('#closeInspector').onclick=()=>{$('#inspector').hidden=true;};
$('#zoomIn').onclick=()=>{zoom=Math.min(2,zoom*1.2);applyZoom();saveViewSettings(mapViewKey());};
$('#zoomOut').onclick=()=>{zoom=Math.max(.15,zoom/1.2);applyZoom();saveViewSettings(mapViewKey());};
$('#fitMap').onclick=()=>{zoom=Math.max(.15,Math.min(1,($('#mapStage').clientWidth-24)/graphSize.width,($('#mapStage').clientHeight-24)/graphSize.height));applyZoom();saveViewSettings(mapViewKey());};
$('#productionLayers').onchange=()=>{render();saveViewSettings('production');};
$('#productionConnect').onclick=openRelation;
$('#productionZoomIn').onclick=()=>{productionZoom=Math.min(2,productionZoom*1.2);applyProductionZoom();saveViewSettings('production');};
$('#productionZoomOut').onclick=()=>{productionZoom=Math.max(.15,productionZoom/1.2);applyProductionZoom();saveViewSettings('production');};
$('#productionFit').onclick=()=>{productionZoom=Math.max(.15,Math.min(1,($('#productionMapStage').clientWidth-24)/productionSize.width,($('#productionMapStage').clientHeight-24)/productionSize.height));applyProductionZoom();saveViewSettings('production');};
function movePeriod(direction){const scale=$('#ganttScale').value;if(scale==='week')month=new Date(month.getFullYear(),month.getMonth(),month.getDate()+7*direction);else month=new Date(month.getFullYear(),month.getMonth()+(scale==='quarter'?3:1)*direction,1);render();saveViewSettings('overview');}
$('#prevMonth').onclick=()=>movePeriod(-1);
$('#nextMonth').onclick=()=>movePeriod(1);
$('#todayButton').onclick=()=>{month=new Date();render();saveViewSettings('overview');};
$('#scheduleMode').onchange=()=>{render();saveViewSettings('overview');};$('#ganttScale').onchange=()=>{render();saveViewSettings('overview');};
$('#recordsAdd').onclick=()=>openEntity(); $('#addEntityButton').onclick=()=>openEntity(); $('#editEntity').onclick=()=>openEntity(selectedId);
$('#addRelationButton').onclick=openRelation; $('#entityType').onchange=entityFields;
$('#addFromLibrary').onclick=()=>{membershipSelection=new Set();$('#membershipSearch').value='';$('#includeRoute').checked=false;renderMembershipPicker();$('#membershipDialog').showModal();};
$('#closeMembership').onclick=()=>$('#membershipDialog').close();
$('#membershipSearch').oninput=renderMembershipPicker;
$('#includeRoute').onchange=renderMembershipPicker;
$('#membershipList').onchange=event=>{const id=event.target.dataset.memberId;if(!id)return;if(event.target.checked)membershipSelection.add(id);else membershipSelection.delete(id);renderMembershipPicker();};
$('#applyMembership').onclick=async ()=>{
  try{
    const ids=Projects.membershipCandidates(workspace.library,store,[...membershipSelection],$('#includeRoute').checked).filter(id=>{
      const e=Model.byId(workspace.library,id);return !projectOwnedTypes.has(e?.type)||!otherProjectOwner(id);
    });
    if(!ids.length)return;
    await changeProject(project=>{Projects.attachMembers(project,workspace.library,ids);if(selectedWorkstream){project.workstreams||={};for(const id of ids)project.workstreams[id]=[...new Set([...(project.workstreams[id]||[]),selectedWorkstream])];}});
    $('#membershipDialog').close();render();toast(ids.length+' Library objects linked');
  }catch(error){$('#membershipSummary').textContent=error.message;}
};
$('#removeFromProject').onclick=async ()=>{
  if(!selectedId||store?.id==='library')return;
  const entity=Model.byId(store,selectedId);
  if(!confirm('Remove '+entity.name+' from this project view? The global object and other projects stay unchanged.'))return;
  try{
    const id=selectedId;
    await changeProject(project=>{project.entities=project.entities.filter(e=>e.id!==id);project.relations=project.relations.filter(r=>r.from!==id&&r.to!==id);delete project.workstreams?.[id];});
    selectedId=null;$('#inspector').hidden=true;render();toast('Removed from project view');
  }catch(error){toast(error.message);}
};
$('#processLevel').onchange=entityFields;
$('#stakeholderTabs').onclick=event=>{const button=event.target.closest('[data-stakeholder-view]');if(button){stakeholderView=button.dataset.stakeholderView;render();saveViewSettings('stakeholders');}};
$('#productionTabs').onclick=event=>{const button=event.target.closest('[data-production-view]');if(button){productionMode=button.dataset.productionView;render();if(productionMode==='Process map')showProductionRouteStart();}};
$('#wipCapturedAt').value=(()=>{const date=new Date();return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);})();
$('#wipFile').addEventListener('change',()=>{wipDraft=null;wipFile=null;$('#wipError').textContent='';renderWipPreview();});
for(const id of ['wipSheet','wipHeaderRow','wipPartColumn'])$('#'+id).addEventListener('input',()=>{wipDraft=null;wipPartMappings={};wipStepMappings={};$('#wipSave').disabled=true;$('#wipPreviewResult').innerHTML='';});
$('#wipPreviewResult').addEventListener('change',event=>{
  if(event.target.dataset.wipMap){wipPartMappings[event.target.dataset.wipMap]=event.target.value;wipStepMappings={};renderWipPreview();}
  if(event.target.dataset.wipStepMap)wipStepMappings[event.target.dataset.wipStepMap]=event.target.value;
});
$('#wipPreview').onclick=async()=>{
  const file=$('#wipFile').files[0];$('#wipError').textContent='';
  if(!file){$('#wipError').textContent='Choose an .xlsx workbook.';return;}
  if(file.size>10_000_000){$('#wipError').textContent='Workbook exceeds 10 MB.';return;}
  const options={};if($('#wipSheet').value.trim())options.sheetName=$('#wipSheet').value.trim();
  if($('#wipHeaderRow').value)options.headerRow=Number($('#wipHeaderRow').value);
  if($('#wipPartColumn').value)options.partColumn=Number($('#wipPartColumn').value);
  $('#wipPreview').disabled=true;
  try{wipDraft=await LocalAPI.wipPreview(store.id,file,options);wipFile=file;wipPartMappings={};wipStepMappings={};renderWipPreview();}
  catch(error){wipDraft=null;$('#wipError').textContent=error.message;renderWipPreview();}
  finally{$('#wipPreview').disabled=false;}
};
$('#wipSave').onclick=async()=>{
  if(!wipDraft||!wipFile)return;
  $('#wipError').textContent='';$('#wipSave').disabled=true;
  try{
    if(!$('#wipCapturedAt').value)throw Error('Choose snapshot date and time.');
    const partMappings=Object.fromEntries([...document.querySelectorAll('[data-wip-map]')].map(select=>[select.dataset.wipMap,select.value]));
    const stepMappings=Object.fromEntries([...document.querySelectorAll('[data-wip-step-map]')].map(select=>[select.dataset.wipStepMap,select.value]));
    const options={revision:workspace.revision,capturedAt:new Date($('#wipCapturedAt').value).toISOString(),sheetName:wipDraft.sheet,headerRow:wipDraft.headerRow,partColumn:wipDraft.partColumn,codeColumn:wipDraft.codeColumn,partMappings,stepMappings};
    const projectId=store.id;workspace=await LocalAPI.wipImport(projectId,wipFile,options);store=workspace.projects.find(project=>project.id===projectId);
    wipDraft=null;wipFile=null;wipPartMappings={};wipStepMappings={};$('#wipFile').value='';renderSavedChange();await loadWip();saveViewSettings('production');toast('WIP snapshot saved');
  }catch(error){$('#wipError').textContent=error.message;renderWipPreview();}
};
$('#wipSnapshot').addEventListener('change',async()=>{await loadWip($('#wipSnapshot').value);saveViewSettings('production');});
$('#staffCapturedAt').value=$('#wipCapturedAt').value;
$('#productionStaffCapturedAt').value=$('#wipCapturedAt').value;
$('#productionStaffTargetType').onchange=renderProductionStaffing;
$('#productionStaffSave').onclick=async()=>{
  $('#productionStaffError').textContent='';
  try{
    if(!$('#productionStaffTarget').value)throw Error('Choose a Process Step or Resource.');
    if(!$('#productionStaffCount').value||!Number.isSafeInteger(Number($('#productionStaffCount').value))||Number($('#productionStaffCount').value)<0)throw Error('Enter a whole-number worker count.');
    if(!$('#productionStaffCapturedAt').value)throw Error('Choose observation date and time.');
    const projectId=store.id;
    workspace=await LocalAPI.productionStaffingSave({projectId,revision:workspace.revision,targetId:$('#productionStaffTarget').value,targetType:$('#productionStaffTargetType').value,count:Number($('#productionStaffCount').value),capturedAt:new Date($('#productionStaffCapturedAt').value).toISOString(),shift:$('#productionStaffShift').value.trim(),basis:$('#productionStaffBasis').value,note:$('#productionStaffNote').value.trim()});
    store=workspace.projects.find(project=>project.id===projectId);renderSavedChange();await loadProductionStaffing();toast('Production worker observation saved');
  }catch(error){$('#productionStaffError').textContent=error.message;}
};
$('#staffSave').onclick=async()=>{
  $('#staffError').textContent='';
  try{
    if(!$('#staffPart').value)throw Error('Choose a Part.');
    if(!$('#staffCount').value||!Number.isSafeInteger(Number($('#staffCount').value))||Number($('#staffCount').value)<0)throw Error('Enter a whole-number worker count.');
    if(!$('#staffCapturedAt').value)throw Error('Choose an observation date and time.');
    const projectId=store.id;
    workspace=await LocalAPI.staffingSave({projectId,revision:workspace.revision,partId:$('#staffPart').value,count:Number($('#staffCount').value),capturedAt:new Date($('#staffCapturedAt').value).toISOString(),shift:$('#staffShift').value.trim(),basis:$('#staffBasis').value,note:$('#staffNote').value.trim()});
    store=workspace.projects.find(project=>project.id===projectId);renderSavedChange();await loadStaffing();toast('Worker count saved');
  }catch(error){$('#staffError').textContent=error.message;}
};
['stakeholderArea','stakeholderDepartment','stakeholderGrouping'].forEach(id=>$('#'+id).addEventListener('change',()=>{openStakeholderGroups.clear();stakeholderGroupsInitialized=false;render();saveViewSettings('stakeholders');}));
$('#recordsTable').addEventListener('toggle',event=>{const key=event.target.dataset?.stakeholderGroup;if(!key)return;if(event.target.open)openStakeholderGroups.add(key);else openStakeholderGroups.delete(key);saveViewSettings('stakeholders');},true);
$('#apqpTabs').onclick=event=>{const button=event.target.closest('[data-apqp-view]');if(button){apqpView=button.dataset.apqpView;render();}};
$('#recordsTable').addEventListener('click',async event=>{if(!event.target.closest('#applyAPQPStarter'))return;try{const count=await changeProject(project=>APQP.applyStarter(project));render();toast(count+' APQP starter records added');}catch(error){toast(error.message);}});
$('#entityForm').addEventListener('submit',async event=>{
  if(event.submitter?.value==='cancel')return; event.preventDefault();
  try {
    const input={type:$('#entityType').value,name:$('#entityName').value,context:$('#entityContext').value,status:$('#entityStatus').value,phase:$('#entityPhase').value};
    if(input.type==='Assignment'){input.role=$('#entityRole').value;input.raci=$('#entityRaci').value;}
    if(input.type==='Gate'){input.readiness=$('#entityReadiness').value;input.decision=$('#entityDecision').value;}
    if(['Work Item','Gate','Deliverable','Evidence','Requirement','Characteristic'].includes(input.type)) {
      input.framework='APQP';
      for(const key of ['apqpPhase','completionState','applicability','requirementSource','notApplicableReason','approvedBy']) input[key]=$('#'+key).value;
    }
    if(input.type==='Characteristic') for(const key of ['characteristicKind','classification','specification','tolerance','measurementMethod']) input[key]=$('#'+key).value;
    if(['Person','Organization'].includes(input.type)) for(const key of profileFields.filter(key=>store.id!=='library'||key==='title')) input[key]=$('#profile-'+key).value;
    if(input.type==='Person') for(const [field,key] of [['workArea','workArea'],['department','department'],['workerRole','workerRole'],['workerTier','tier'],['workerQualification','qualification'],['workerShift','shift'],['workerSite','site']]) input[key]=$('#'+field).value;
    if(input.type==='Resource') for(const [field,key] of [['resourceKind','resourceKind'],['machineMode','machineMode'],['machineFamily','machineFamily'],['resourceTier','tier'],['assetId','assetId'],['resourceModel','model'],['resourceSite','site'],['capacityNote','capacityNote']]) input[key]=$('#'+field).value;
    if(['Part','Part Revision'].includes(input.type)){
      input.productionFamily=$('#productionFamily').value.trim();
      for(const [field,key] of [['itemKind','itemKind'],['productFamily','productFamily'],['partSide','side'],['verticalPosition','verticalPosition'],['pieceIndex','pieceIndex']])input[key]=$('#'+field).value.trim();
      input.modelCode=$('#modelCode').value.trim();input.codeNamespace=$('#codeNamespace').value.trim();
    }
    if(input.type==='Production Step') for(const key of ['operationCode','productionStage','workCenter','operatorAction','acceptanceCriteria','failureAction']) input[key]=$('#'+key).value;
    if(input.type==='Event')for(const [field,key] of [['eventOccurredAt','occurredAt'],['eventLogKind','productionEventKind'],['eventTraceId','traceId'],['eventTraceKind','traceKind']])input[key]=$('#'+field).value.trim();
    if(['Work Item','Production Step','Gate','Deliverable'].includes(input.type)) {
      input.processLevel=$('#processLevel').value;
      input.parentWorkId=input.processLevel==='sub'?$('#parentWorkId').value:'';
      input.branchKind=input.processLevel==='sub'?$('#branchKind').value:'';
    }
    if(Flow.SCHEDULE_TYPES.includes(input.type) && !(store.id==='library'&&input.type==='Production Step')) for(const key of Model.DATE_FIELDS) {
      if(key!=='assessedOn'&&(input.type==='Event'?key==='occurredDate':key!=='occurredDate')) input[key]=$('#field-'+key).value;
    }
    if(!editingId){
      const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
      const key=input.type+'|'+normalized(input.name);
      const matches=workspace.library.entities.filter(e=>e.type===input.type&&normalized(e.name)===normalized(input.name));
      if(matches.length){
        const review=$('#entityMatchReview'),choice=$('#entityMatchChoice');
        if(review.dataset.key!==key){
          review.dataset.key=key;review.hidden=false;
          choice.innerHTML='<option value="">Choose reuse or separate</option>'+matches.filter(e=>!projectOwnedTypes.has(e.type)||store.id==='library'||store.entities.some(item=>item.id===e.id)).map(e=>'<option value="reuse:'+h(e.id)+'">Reuse '+h(e.name)+' ('+h(e.id)+')</option>').join('')+'<option value="create">Create separate object</option>';
          $('#entityError').textContent='Review the existing Library match before saving.';return;
        }
        if(!choice.value){$('#entityError').textContent='Choose reuse or separate.';return;}
        if(choice.value.startsWith('reuse:')){
          const id=choice.value.slice(6),existing=matches.find(e=>e.id===id);
          if(!existing)throw Error('Library match changed. Review again.');
          if(store.id!=='library'&&(!store.entities.some(e=>e.id===id)||selectedWorkstream&&!(store.workstreams?.[id]||[]).includes(selectedWorkstream)))await changeProject(project=>{if(!project.entities.some(e=>e.id===id))Projects.attachMembers(project,workspace.library,[id]);if(selectedWorkstream)(project.workstreams||={})[id]=[...new Set([...(project.workstreams?.[id]||[]),selectedWorkstream])];});
          $('#entityDialog').close();invalidatePreview();selectEntity(id);toast('Existing Library object selected; no facts overwritten.');return;
        }
      }
    }
    const e=await changeProject(project=>{
      const saved=editingId?Model.updateEntity(project,editingId,input):Model.addEntity(project,input);
      if(project.id!=='library'){
        const codes=[...document.querySelectorAll('#workstreamChecks [data-workstream-choice]:checked')].map(input=>input.dataset.workstreamChoice);
        project.workstreams||={};if(codes.length)project.workstreams[saved.id]=codes;else delete project.workstreams[saved.id];
      }
      for(const [relation,to] of input.type==='Person'?[['reports_to',$('#personManager').value]]:input.type==='Part'?[['part_of',$('#parentPart').value]]:[]){
        const old=project.relations.find(r=>r.type===relation&&r.from===saved.id);
        if((old?.to||'')===to)continue;
        if(old)project.relations=project.relations.filter(r=>r.id!==old.id);
        if(to)Model.addRelation(project,{from:saved.id,type:relation,to,evidence:'Recorded in object details'});
      }
      return saved;
    });
    $('#entityDialog').close(); invalidatePreview(); selectEntity(e.id); toast('Object saved');
  } catch(error){$('#entityError').textContent=error.message;}
});
$('#relationForm').addEventListener('submit',async event=>{
  if(event.submitter?.value==='cancel')return;event.preventDefault();
  try{await changeProject(project=>{
    const input={from:$('#relationFrom').value,type:$('#relationType').value,to:$('#relationTo').value,evidence:$('#relationEvidence').value};
    if(!$('#relationMaterialFields').hidden){
      if($('#relationQuantity').value)input.quantity=Number($('#relationQuantity').value);
      for(const [field,key] of [['relationUnit','unit'],['relationBasis','basis'],['relationRoutePart','routePartId'],['relationReviewState','reviewState']])if($('#'+field).value)input[key]=$('#'+field).value.trim();
    }
    input.scopeProjectId=$('#relationScope').value==='auto'?Model.defaultRelationScope(project,input,project.id):$('#relationScope').value==='project'?project.id:null;
    Model.addRelation(project,input);
  });$('#relationDialog').close();invalidatePreview();render();toast('Connection saved');}
  catch(error){$('#relationError').textContent=error.message;}
});
for(const id of ['relationFrom','relationType','relationTo'])$('#'+id).addEventListener('change',syncMaterialRelationFields);
$('#previewCSV').onclick=previewCSV;
$('#csvResult').onchange=event=>{
  const select=event.target.closest('[data-csv-choice]');if(!select)return;
  const value=select.value;
  if(!value)delete csvChoices[select.dataset.csvChoice];
  else csvChoices[select.dataset.csvChoice]=value.startsWith('reuse:')?{action:'reuse',targetId:value.slice(6)}:{action:value};
  previewCSV();
};
$('#csvText').oninput=()=>{csvChoices={};invalidatePreview();$('#csvResult').innerHTML='';};
$('#csvKind').onchange=()=>{csvChoices={};invalidatePreview();$('#csvResult').innerHTML='';};
$('#csvFile').onchange=async event=>{
  const file=event.target.files[0], projectId=store.id;if(!file)return;
  try{if(file.size>2_000_000)throw Error('CSV exceeds 2 MB.');const text=await file.text();if(store?.id!==projectId)return;$('#csvText').value=text;csvChoices={};invalidatePreview();previewCSV();}
  catch(error){invalidatePreview();$('#csvResult').textContent=error.message;}event.target.value='';
};
$('#applyCSV').onclick=async ()=>{
  if(!preview||preview.projectId!==store.id)return;
  try {
    const data=preview;
    const count=await changeProject(project=>{
      const result=Flow.previewCSV(project,data.text,data.kind,{library:workspace.library,choices:data.choices});if(result.errors.length)throw Error(result.errors.join(' '));
      project.entities=result.project.entities;project.relations=result.project.relations;
      const ids=Flow.importedIds(result.rows);
      if(selectedWorkstream&&project.id!=='library'){
        project.workstreams||={};
        for(const id of ids)if(project.entities.some(entity=>entity.id===id))project.workstreams[id]=[...new Set([...(project.workstreams[id]||[]),selectedWorkstream])];
      }
      (project.imports ||= []).push({recordedAt:new Date().toISOString(),kind:data.kind,ids});
      return ids.length;
    });
    invalidatePreview();$('#csvResult').innerHTML='<p class="success-note">'+count+' records saved to '+h(store.name)+'. Open Objects or Overview to explore.</p>';render();toast('Import saved');
  }catch(error){$('#csvResult').textContent=error.message;invalidatePreview();}
};
$('#csvTemplate').onclick=()=>{
  const kind=$('#csvKind').value, columns=kind==='objects'?Flow.OBJECT_COLUMNS:Flow.RELATION_COLUMNS;
  const example=kind==='objects'?{id:'P001',type:'Part',name:'Camera PCB',status:'active'}:{id:'link-001',type:'precedes',from:'work-001',to:'work-002',evidence:'Confirmed sequence'};
  download(kind+'-template.csv',columns.join(',')+'\r\n'+columns.map(c=>example[c]||'').join(',')+'\r\n','text/csv;charset=utf-8');
};
$('#extractSource').onclick=async ()=>{
  const text=$('#aiSourceText').value.trim(),file=$('#aiSourceFile').files[0];
  if(!text&&!file){toast('Paste text or choose a source file.');return;}
  if(text&&file){toast('Use pasted text or one file, not both.');return;}
  const button=$('#extractSource');button.disabled=true;$('#ingestionResult').innerHTML='<p class="muted">Extracting draft from source…</p>';
  try{
    const result=await LocalAPI.extract(store.id,file||text);
    ingestionSource=result.source;ingestionJobId=result.jobId;
    const draft=Ingest.validateDraft(workspace.library,result.draft);
    if(draft.errors.length)throw Error(draft.errors.join(' '));
    ingestionDraft=draft;ingestionSelection=null;ingestionConfirm=false;renderIngestionReview();
  }catch(error){$('#ingestionResult').innerHTML='<p class="form-error">'+h(error.message)+'</p>';}
  finally{button.disabled=store?.status==='archived'||!aiConfigured;}
};
$('#ingestionResult').addEventListener('input',event=>{
  const objectIndex=event.target.dataset.candidateObject,relationIndex=event.target.dataset.candidateRelation,field=event.target.dataset.field;
  if(objectIndex!==undefined){
    const item=ingestionDraft.objects[Number(objectIndex)];
    if(field==='matchAction'){
      item.matchReviewed=Boolean(event.target.value);
      item.suggestedAction=event.target.value.startsWith('reuse:')?'link_existing':'create';
      if(item.suggestedAction==='link_existing')item.matchedObjectId=event.target.value.slice(6);else delete item.matchedObjectId;
    }else{item[field]=event.target.value;if(['type','name'].includes(field)&&item.possibleMatches?.length)item.matchReviewed=false;}
  }
  if(relationIndex!==undefined)ingestionDraft.relationships[Number(relationIndex)][field]=event.target.value;
});
$('#ingestionResult').addEventListener('click',async event=>{
  if(event.target.id==='backIngestion'){ingestionConfirm=false;renderIngestionReview();return;}
  if(event.target.id==='reviewIngestion'){
    ingestionSelection=new Set([...$('#ingestionResult').querySelectorAll('[data-ingestion-select]:checked')].map(input=>input.dataset.ingestionSelect));
    if(!ingestionSelection.size){toast('Select at least one extracted item.');return;}
    const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
    let refreshed=false;
    for(const item of ingestionDraft.objects.filter(item=>ingestionSelection.has(item.candidateId))){
      const matches=workspace.library.entities.filter(e=>e.type===item.type&&normalized(e.name)===normalized(item.name)).map(e=>({id:e.id,name:e.name,type:e.type}));
      if(JSON.stringify(matches.map(e=>e.id))!==JSON.stringify((item.possibleMatches||[]).map(e=>e.id))){
        item.possibleMatches=matches;item.matchReviewed=false;item.suggestedAction='create';delete item.matchedObjectId;refreshed=true;
      }
    }
    if(refreshed){renderIngestionReview();toast('Names or types changed. Review matching objects again.');return;}
    const undecided=ingestionDraft.objects.find(item=>ingestionSelection.has(item.candidateId)&&item.possibleMatches?.length&&!item.matchReviewed);
    if(undecided){toast('Choose reuse or separate for '+undecided.name+'.');return;}
    if(store.id==='library'&&ingestionDraft.objects.some(item=>ingestionSelection.has(item.candidateId)&&item.suggestedAction==='create'&&['power','influence','currentRole','desiredRole','currentEngagement','desiredEngagement','assessmentNote','assessedOn'].some(field=>item[field]))){toast('Project-specific stakeholder assessments need a project. Clear those fields or extract inside a project.');return;}
    if(store.id==='library'&&ingestionDraft.objects.some(item=>ingestionSelection.has(item.candidateId)&&item.suggestedAction==='create'&&item.type==='Production Step'&&Model.DATE_FIELDS.some(field=>field!=='assessedOn'&&item[field]))){toast('Production Step dates need a project. Clear dates or extract inside a project.');return;}
    const checked=Ingest.validateDraft(workspace.library,ingestionDraft);
    if(checked.errors.length){toast(checked.errors[0]);return;}
    try{Ingest.applySelected(store,checked,ingestionSelection,{sourceId:ingestionSource.sourceId,filename:ingestionSource.filename,confirmedBy:'local_user',library:workspace.library});}
    catch(error){toast(error.message);return;}
    ingestionConfirm=true;renderIngestionReview();return;
  }
  if(event.target.id!=='updateOntology')return;
  const selected=ingestionSelection||new Set();
  try{
    const applied=Ingest.applySelected(store,ingestionDraft,selected,{sourceId:ingestionSource.sourceId,filename:ingestionSource.filename,confirmedBy:'local_user',extractionJobId:ingestionJobId,addEvidence:$('#aiAddEvidence').checked,library:workspace.library});
    await changeProject(project=>{const oldIds=new Set(project.entities.map(e=>e.id));project.entities=applied.project.entities;project.relations=applied.project.relations;if(selectedWorkstream&&project.id!=='library'){project.workstreams||={};for(const entity of project.entities)if(!oldIds.has(entity.id))project.workstreams[entity.id]=[selectedWorkstream];}},{jobId:ingestionJobId,selectedIds:[...selected],draft:ingestionDraft});
    const counts={objects:ingestionDraft.objects.filter(item=>selected.has(item.candidateId)).length,relationships:ingestionDraft.relationships.filter(item=>selected.has(item.candidateId)).length};
    ingestionDraft=null;ingestionSelection=null;ingestionConfirm=false;$('#aiSourceText').value='';$('#aiSourceFile').value='';render();$('#ingestionResult').innerHTML='<p class="success-note">Ontology updated: '+counts.objects+' objects/links and '+counts.relationships+' relationships appended.</p>';toast('Ontology updated');
  }catch(error){toast(error.message);}
});
$('#keepSavedChange').onclick=async ()=>{
  const change=workspace?.pendingChange;if(!change)return;
  try{workspace=await LocalAPI.keepChange(change.id);store=store?.id==='library'?workspace.library:workspace.projects.find(project=>project.id===store?.id)||null;render();toast('Saved changes kept');}
  catch(error){$('#savedChangeError').textContent=error.message;}
};
$('#revertSavedChange').onclick=async ()=>{
  const change=workspace?.pendingChange;if(!change)return;
  $('#revertSavedChange').disabled=true;
  try{
    const currentId=store?.id;
    workspace=await LocalAPI.revertChange(change.id,workspace.revision);
    store=currentId==='library'?workspace.library:workspace.projects.find(project=>project.id===currentId)||null;
    if(!store){location.hash='/projects';route();return;}
    if(selectedId&&!Model.byId(store,selectedId)){selectedId=null;$('#inspector').hidden=true;}
    render();if(change.items.some(item=>item.label.startsWith('WIP ·')))loadWip();if(change.items.some(item=>item.label.startsWith('Workers ·')))loadStaffing();if(activeTab==='History')loadHistory(true);toast('Last save reverted');
  }catch(error){$('#savedChangeError').textContent=error.message;}
  finally{$('#revertSavedChange').disabled=false;}
};
$('#projectForm').onsubmit=async event=>{
  event.preventDefault();try{const project=Projects.create($('#projectName').value,$('#newProjectType').value),next=structuredClone(workspace);next.projects.push(project);await commit(next);event.target.reset();location.hash='/projects/'+project.id;}
  catch(error){$('#projectError').textContent=error.message;}
};
function projectPasswordDialog(id){
 const d=document.createElement('dialog');d.className='access-dialog';d.innerHTML='<form><h2>'+h(workspace.projects.find(p=>p.id===id)?.name||'프로젝트')+' · 조회 접속</h2><label>프로젝트 비밀번호<input type="password" required minlength="4" autocomplete="current-password"></label><p>해당 프로젝트 조회만 가능합니다.</p><p class="form-error" role="alert"></p><button class="button primary" type="submit">열기</button><button class="button" type="button" data-close>닫기</button></form>';document.body.append(d);d.onclose=()=>d.remove();d.querySelector('[data-close]').onclick=()=>{d.close();location.hash='/projects';};d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type=submit]');b.disabled=true;try{workspace=await LocalAPI.projectLogin(id,d.querySelector('input').value);basicAccess=false;d.close();window.OwnerAccess?.init(workspace.access,{whole:openWholeProcess,production:()=>openWorkstream('production')});route();}catch(err){d.querySelector('[role=alert]').textContent=err.message;b.disabled=false;}};d.showModal();
}
if(window.CLOUD_BACKEND&&LocalAPI.projectAccessSave){
 const button=document.createElement('button');button.className='button project-access-settings';button.textContent='공개 범위 · 비밀번호';$('#projectBar').append(button);
 button.onclick=async()=>{
  if(!store||store.id==='library')return;
  const id=store.id,d=document.createElement('dialog');d.className='access-dialog';d.innerHTML='<form><h2>'+h(store.name)+' · 공개 범위</h2><label>보기 권한<select data-visibility><option value="public">공개 · 누구나 조회</option><option value="password">비밀번호 · 아는 사람만 조회</option><option value="private">숨김 · 편집 화면에서만</option></select></label><label data-password-label hidden>프로젝트 비밀번호<input type="password" minlength="4" maxlength="72" autocomplete="new-password" placeholder="새 비밀번호 4자 이상 · 기존 유지 시 비워두세요"></label><p>편집은 나만 보기 비밀번호로 합니다. 공개 범위를 바꾸면 기존 조회 접속은 끝납니다.</p><p role="alert" class="form-error"></p><button type="submit" class="button primary" disabled>저장</button><button type="button" data-close class="button">닫기</button></form>';document.body.append(d);d.onclose=()=>d.remove();d.querySelector('[data-close]').onclick=()=>d.close();
  const select=d.querySelector('select'),password=d.querySelector('input'),save=d.querySelector('[type=submit]');
  const update=()=>{d.querySelector('[data-password-label]').hidden=select.value!=='password';password.disabled=select.value!=='password';};select.onchange=update;d.showModal();
  try{select.value=(await LocalAPI.projectAccessGet(id)).visibility;update();save.disabled=false;}catch(err){d.querySelector('[role=alert]').textContent=err.message;}
  d.querySelector('form').onsubmit=async e=>{e.preventDefault();save.disabled=true;try{workspace=await LocalAPI.projectAccessSave({projectId:id,visibility:select.value,password:select.value==='password'?password.value:''});store=workspace.projects.find(p=>p.id===id);d.close();render();toast('공개 범위 저장 완료');}catch(err){d.querySelector('[role=alert]').textContent=err.message;save.disabled=false;}};
 };
}
$('#homeButton').onclick=()=>{location.hash='/projects';};
$('#renameProject').onclick=async ()=>{
  const name=prompt('Project name',store.name);if(name===null)return;
  try{await changeProject(p=>{p.name=name.trim();});render();}catch(error){toast(error.message);}
};
$('#archiveProject').onclick=async ()=>{
  try{const next=structuredClone(workspace),p=next.projects.find(p=>p.id===store.id);p.status=p.status==='archived'?'active':'archived';await commit(next);render();}catch(error){toast(error.message);}
};
window.addEventListener('hashchange',route);
function mapAssistantScope(){
  if(basicAccess||!store||!['Overview','Production'].includes(activeTab)||activeTab==='Production'&&productionMode!=='Process map')return null;
  return {scopeId:store.id,visibleIds:null,configured:mapAssistantConfigured,key:store.id,title:''};
}
function focusMapSelection(kind,idSet){
  const production=kind==='production',stage=$(production?'#productionMapStage':'#mapStage'),layer=$(production?'#productionNodes':'#nodeLayer');
  const wanted=idSet||mapSelectedIds,nodes=[...layer.querySelectorAll('[data-select]')],selected=nodes.filter(n=>wanted.has(n.dataset.select)),targets=selected.length?selected:nodes.slice(0,1);if(!targets.length)return;
  const boxes=targets.map(n=>{const b=n.getBBox(),m=n.transform.baseVal.consolidate()?.matrix;return {x:b.x+(m?.e||0),y:b.y+(m?.f||0),width:b.width,height:b.height};});
  const left=Math.min(...boxes.map(b=>b.x)),top=Math.min(...boxes.map(b=>b.y)),right=Math.max(...boxes.map(b=>b.x+b.width)),bottom=Math.max(...boxes.map(b=>b.y+b.height));
  const scale=Math.max(.8,Math.min(1.3,(stage.clientWidth-64)/Math.max(1,right-left),(stage.clientHeight-64)/Math.max(1,bottom-top)));
  if(production){productionZoom=scale;applyProductionZoom();}else{zoom=scale;applyZoom();}
  stage.scrollTo({left:Math.max(0,(left+right)/2*scale-stage.clientWidth/2),top:Math.max(0,(top+bottom)/2*scale-stage.clientHeight/2),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
function routeTarget(entity){
  const lines=new Set(),parts=new Set(),addPart=id=>{const part=Model.byId(store,id);if(part&&Model.isProductPart(part))parts.add(part.id);};
  const named=value=>['SMT','LDM','Nexlide','TEM'].includes(value)?value:'';
  const lineOf=item=>{if(!item)return '';const family=named(item.productionFamily);if(family)return family;if(item.type==='Resource'&&item.resourceKind==='line')return ['SMT','LDM','Nexlide','TEM'].find(line=>(item.name||'').includes(line))||'';return '';};
  const people=['Person','Organization'].includes(entity.type),machines=entity.type==='Resource'&&['machine','test_equipment'].includes(entity.resourceKind),components=Model.isComponentPart(entity);
  if(Model.isProductPart(entity))addPart(entity.id);
  const steps=new Set(entity.type==='Production Step'?[entity.id]:[]);
  for(const relation of store.relations){
    if(relation.to===entity.id&&['requires','applies_to','consumes','produces'].includes(relation.type)&&Model.byId(store,relation.from)?.type==='Production Step')steps.add(relation.from);
    if(components&&relation.type==='part_of'&&relation.from===entity.id)addPart(relation.to);
  }
  for(const step of steps)for(const relation of store.relations)if(relation.from===step&&['applies_to','consumes','produces'].includes(relation.type))addPart(relation.to);
  const line=lineOf(entity);
  if(line)lines.add(line);
  for(const id of parts){const family=lineOf(Model.byId(store,id));if(family)lines.add(family);}
  if(people){
    const orgs=new Set(entity.type==='Organization'?[entity.id]:store.relations.filter(relation=>relation.type==='member_of'&&relation.from===entity.id).map(relation=>relation.to));
    for(const relation of store.relations){
      if(['works_on','manages'].includes(relation.type)&&relation.from===entity.id){const found=lineOf(Model.byId(store,relation.to));if(found)lines.add(found);}
      if(relation.type==='supports_line'&&orgs.has(relation.from)){const found=lineOf(Model.byId(store,relation.to));if(found)lines.add(found);}
      if(relation.type==='escalates_to'&&orgs.has(relation.to)){const found=lineOf(Model.byId(store,relation.from));if(found)lines.add(found);}
    }
  }
  return {line:[...lines][0]||'',partIds:[...parts],people,machines,components:components||entity.type==='Part'};
}
function partsOnLine(line){return store.entities.filter(entity=>Model.isProductPart(entity)&&(!line||entity.productionFamily===line)).map(entity=>entity.id);}
function applyProductionTarget(target){
  const line=['','SMT','LDM','Nexlide','TEM'].includes(target.line)?target.line:'';
  if($('#productionLine').value!==line){productionSelections[$('#productionLine').value||'all']={partIds:[...productionPartIds],partSelectionCustomized:productionPartsCustomized,highlightPartId:productionHighlightPartId};$('#productionLine').value=line;$('#productionLine').dataset.previous=line;}
  const allowed=new Set(partsOnLine(line)),wanted=target.partIds.filter(id=>allowed.has(id));
  if(wanted.length&&!target.people){productionPartsCustomized=true;productionPartIds=wanted;}
  else {productionPartsCustomized=false;productionPartIds=[...allowed];}
  if(target.people)$('#productionSeeStakeholders').checked=true;
  if(target.machines)$('#productionSeeMachines').checked=true;
  if(target.components)$('#productionSeeComponents').checked=true;
  productionHighlightPartId='';
}
function applyOverviewTarget(target){
  const line=['','SMT','LDM','Nexlide','TEM'].includes(target.line)?target.line:'';
  $('#mapProductionLine').value=line;
  const allowed=new Set(partsOnLine(line)),wanted=target.partIds.filter(id=>allowed.has(id));
  if(wanted.length&&!target.people){mapPartsCustomized=true;mapPartIds=wanted;}
  else {mapPartsCustomized=false;mapPartIds=[...allowed];}
  if(target.people)$('#mapSeeStakeholders').checked=true;
  if(target.machines)$('#mapSeeMachines').checked=true;
  if(target.components)$('#mapSeeComponents').checked=true;
  mapHighlightPartId='';
  if($('#searchInput').value)$('#searchInput').value='';
  if($('#statusFilter').value)$('#statusFilter').value='';
}
function mapNode(id){const layer=activeTab==='Production'?$('#productionNodes'):$('#nodeLayer');return [...layer.querySelectorAll('[data-select]')].find(node=>node.dataset.select===id)||null;}
function releaseCollapsed(id){
  const settings=workspace.viewSettings?.[store.id]?.universalGroups;if(!settings?.collapsed?.length)return false;
  const next=settings.collapsed.filter(group=>!(historyGroups[group]||[]).includes(id));if(next.length===settings.collapsed.length)return false;settings.collapsed=next;return true;
}
function openLinkedObject(id){
  const entity=Model.byId(store,id);if(!entity){toast('온톨로지에 없는 이름입니다.');return;}
  const target=routeTarget(entity),onProduction=activeTab==='Production'&&productionMode==='Process map';
  const moved=onProduction||store.id!=='library'&&(target.partIds.length||target.line||target.people||target.machines);
  const arm=()=>{pendingMapSelection=id;mapSelectedIds.clear();mapSelectedIds.add(id);selectedId=null;$('#inspector').hidden=true;};
  if(!types.has(entity.type)){types.add(entity.type);renderTypeFilters();}
  if(onProduction)applyProductionTarget(target);
  else if(moved){if(selectedWorkstream!=='production'){selectedWorkstream='production';activeTab='Overview';}$('#perspective').value='process';applyOverviewTarget(target);}
  arm();render();
  if(!mapNode(id)&&releaseCollapsed(id)){arm();render();}
  if(!mapNode(id)&&target.people){if(onProduction)$('#productionSeeStakeholders').checked=true;else $('#mapSeeStakeholders').checked=true;arm();render();}
  pendingMapSelection='';
  if(mapNode(id))requestAnimationFrame(()=>focusMapSelection(activeTab==='Production'?'production':'overview',new Set([id])));
  else if(moved)toast('그 공정이 보이게 옮겼습니다. 맵에서 바로 집히는 노드는 없습니다.');
  else toast('프로세스 맵에서 이 객체의 기록된 위치를 찾지 못했습니다.');
}
const mapAssistantUI=new window.MapAssistantView({getScope:mapAssistantScope,ask:input=>LocalAPI.mapAssistant(input),highlight:openLinkedObject});
setInputMode(inputMode); route(); startLocal();
