(function(root){
  if(root.PUBLIC_READ_ONLY)return;
  const config=root.PM_SUPABASE_CONFIG;
  const local=['localhost','127.0.0.1'].includes(location.hostname);
  if(!config?.url||!config.publishableKey||(local&&!new URLSearchParams(location.search).has('cloud')))return;
  const base=new URL(config.url);
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.pathname!=='/')throw Error('Invalid Supabase project URL.');
  if(!/^(sb_publishable_|eyJ)/.test(config.publishableKey))throw Error('Use a public Supabase key.');
  root.CLOUD_BACKEND=true;
  const key='pm-edit:'+base.hostname;
  let session='';
  try{session=sessionStorage.getItem(key)||'';}catch{session='';}
  const panel=document.createElement('section');panel.className='cloud-auth';panel.setAttribute('aria-label','편집');
  panel.innerHTML='<form id="cloudSignIn"><label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label><button class="button primary" type="submit">열기</button></form><div id="cloudSignedIn" hidden><button class="button" id="cloudSignOut" type="button">닫기</button></div><p id="cloudAuthMessage" role="status"></p>';
  document.querySelector('.app-header').after(panel);
  const form=panel.querySelector('form'),message=panel.querySelector('#cloudAuthMessage');
  const render=()=>{document.body.dataset.access=session?'owner':'anonymous';form.hidden=Boolean(session);panel.querySelector('#cloudSignedIn').hidden=!session;};
  const save=value=>{session=value||'';if(session)sessionStorage.setItem(key,session);else sessionStorage.removeItem(key);render();};
  async function request(path,method='GET',value){
    if(!session)throw Error('비밀번호를 입력하세요.');
    const response=await fetch(base.origin+'/functions/v1/ontology/api/'+path,{method,headers:{apikey:config.publishableKey,'x-edit-password':session,...(value!==undefined?{'Content-Type':'application/json'}:{})},...(value!==undefined?{body:JSON.stringify(value)}:{})});
    const result=await response.json();
    if(response.status===401){save('');message.textContent=result.error||'비밀번호가 다릅니다.';}
    if(!response.ok)throw Error(result.error||'Workspace request failed.');
    return result;
  }
  async function source(scope,input){
    if(typeof input==='string')return {scope,text:input,filename:'pasted-notes.txt',mimeType:'text/plain'};
    const bytes=new Uint8Array(await input.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    const extension=input.name.split('.').pop().toLowerCase();
    return {scope,filename:input.name,mimeType:({md:'text/markdown',csv:'text/csv',pdf:'application/pdf',txt:'text/plain'}[extension]||input.type||''),base64:btoa(binary)};
  }
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;message.textContent='';
    save(form.password.value);form.password.value='';location.reload();
  };
  panel.querySelector('#cloudSignOut').onclick=()=>{save('');location.reload();};
  render();
  root.LocalAPI={
    projectAccessGet:project=>request('project-access?'+new URLSearchParams({project})),
    projectAccessSave:input=>request('project-access','POST',input),
    progressList:project=>request('progress?'+new URLSearchParams({project})),
    hourlyList:project=>request('hourly?'+new URLSearchParams({project})),
    samplePreparationList:project=>request('sample-preparation?'+new URLSearchParams({project})),
    progressSave:input=>request('progress','POST',input),
    hourlySave:input=>request('hourly','POST',input),
    hourlyRateSave:input=>request('hourly/rates','POST',input),
    featureSave:input=>request('features','POST',input),
    samplePreparationSave:input=>request('sample-preparation','POST',input),
    historyQuery:input=>request('history/query','POST',input),
    historyJobs:scope=>request('history/jobs?'+new URLSearchParams({scope})),
    historyDetail:(id,scope)=>request('history/events/'+encodeURIComponent(id)+'?'+new URLSearchParams({scope})),
    load:()=>request('workspace'),health:()=>request('health'),
    save:(workspace,scope,revision,ingestionCommit=null)=>request('workspace','POST',{workspace,scope,revision,ingestionCommit}),
    changes:(scope,offset=0,date='')=>request('changes?'+new URLSearchParams({scope,offset:String(offset),date})),
    keepChange:id=>request('changes/'+encodeURIComponent(id)+'/keep','POST'),
    revertChange:(id,revision)=>request('changes/'+encodeURIComponent(id)+'/revert','POST',{revision}),
    settings:(projectId,viewKey,data)=>request('settings/'+encodeURIComponent(projectId)+'/'+encodeURIComponent(viewKey),'PUT',data),
    mapAssistant:input=>request('map-assistant','POST',input),
    extract:async(scope,input)=>request('extract','POST',await source(scope,input)),
    wipList:(projectId,snapshot='')=>request('wip?'+new URLSearchParams({project:projectId,snapshot})),
    wipPreview:async(projectId,file,options={})=>request('wip/preview','POST',{...await source(projectId,file),projectId,...options}),
    wipImport:async(projectId,file,options)=>request('wip','POST',{...await source(projectId,file),projectId,...options}),
    staffingList:projectId=>request('staffing?'+new URLSearchParams({project:projectId})),
    staffingSave:input=>request('staffing','POST',input),
    productionStaffingList:projectId=>request('production-staffing?'+new URLSearchParams({project:projectId})),
    productionStaffingSave:input=>request('production-staffing','POST',input),
    exportBackup:async()=>{const result=await request('export');const url=URL.createObjectURL(new Blob([JSON.stringify(result)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='pm-process-twin-backup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  };
  const exportButton=document.createElement('button');exportButton.id='exportButton';exportButton.className='button';exportButton.textContent='Export all data';exportButton.onclick=()=>root.LocalAPI.exportBackup();panel.querySelector('#cloudSignedIn').append(exportButton);
})(window);
