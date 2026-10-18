(function(root) {
  function previewPrefix() {
    const match = String(location.pathname || '').match(/^\/hds-[a-z0-9]+-\d+-[a-z0-9]+/i);
    return match ? match[0] : '';
  }
  async function request(path, options) {
    const response = await fetch(previewPrefix() + path, options);
    const value = await response.json();
    if(response.status===401&&document.body.dataset.access==='owner')window.dispatchEvent(new Event('pm-access-expired'));
    if (!response.ok) throw Error(value.error || 'Local server request failed.');
    return value;
  }
  const json = value => ({headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  async function sourcePayload(scope,input) {
    if (typeof input==='string') return {scope,text:input,filename:'pasted-notes.txt',mimeType:'text/plain'};
    const bytes=new Uint8Array(await input.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    const extension=input.name.split('.').pop()?.toLowerCase();
    const mimeType=({md:'text/markdown',csv:'text/csv',pdf:'application/pdf',txt:'text/plain'}[extension]||input.type||'');
    return {scope,filename:input.name,mimeType,base64:btoa(binary)};
  }
  root.LocalAPI = {
    samplePreparationList:projectId=>request('/api/sample-preparation?'+new URLSearchParams({project:projectId})),
    samplePreparationSave:input=>request('/api/sample-preparation',{method:'POST',...json(input)}),
    hourlyRateSave:input=>request('/api/hourly/rates',{method:'POST',...json(input)}),
    hourlyList:projectId=>request('/api/hourly?'+new URLSearchParams({project:projectId})),
    hourlySave:input=>request('/api/hourly',{method:'POST',...json(input)}),
    featureSave:input=>request('/api/features',{method:'POST',...json(input)}),
    progressList:projectId=>request('/api/progress?'+new URLSearchParams({project:projectId})),
    progressSave:input=>request('/api/progress',{method:'POST',...json(input)}),
    historyQuery:input=>request('/api/history/query',{method:'POST',...json(input)}),
    historyDetail:(id,scope)=>request('/api/history/events/'+encodeURIComponent(id)+'?'+new URLSearchParams({scope})),
    historySource:async(scope,input,metadata={})=>request('/api/history/sources',{method:'POST',...json({...await sourcePayload(scope,input),metadata})}),
    historyAction:(action,input)=>request('/api/history/'+action,{method:'POST',...json(input)}),
    historyJobs:scope=>request('/api/history/jobs?'+new URLSearchParams({scope})),
    load:() => request('/api/workspace'),
    save:(workspace,scope,revision,ingestionCommit=null) => request('/api/workspace',{method:'POST',...json({workspace,scope,revision,ingestionCommit})}),
    changes:(scope,offset=0,date='') => request('/api/changes?'+new URLSearchParams({scope,offset:String(offset),date})),
    keepChange:id => request('/api/changes/'+encodeURIComponent(id)+'/keep',{method:'POST'}),
    revertChange:(id,revision) => request('/api/changes/'+encodeURIComponent(id)+'/revert',{method:'POST',...json({revision})}),
    settings:(projectId,viewKey,data) => request('/api/settings/'+encodeURIComponent(projectId)+'/'+encodeURIComponent(viewKey),{method:'PUT',...json(data)}),
    health:() => request('/api/health'),
    copilot:input => request('/api/copilot',{method:'POST',...json(input)}),
    mapAssistant:input => request('/api/map-assistant',{method:'POST',...json(input)}),
    extract:async (scope,input) => request('/api/extract',{method:'POST',...json(await sourcePayload(scope,input))}),
    wipList:(projectId,snapshotId='') => request('/api/wip?'+new URLSearchParams({project:projectId,snapshot:snapshotId})),
    wipPreview:async (projectId,file,options={}) => request('/api/wip/preview',{method:'POST',...json({...await sourcePayload(projectId,file),projectId,...options})}),
    wipImport:async (projectId,file,options) => request('/api/wip',{method:'POST',...json({...await sourcePayload(projectId,file),projectId,...options})}),
    staffingList:projectId => request('/api/staffing?'+new URLSearchParams({project:projectId})),
    staffingSave:input => request('/api/staffing',{method:'POST',...json(input)}),
    productionStaffingList:projectId => request('/api/production-staffing?'+new URLSearchParams({project:projectId})),
    productionStaffingSave:input => request('/api/production-staffing',{method:'POST',...json(input)})
  };
})(window);
