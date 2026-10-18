(function(root){
 const M=root.OntologyModel,F=root.FinalParts,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 root.openFinalPartDialog=({workspace,projectId,refresh})=>{
  if(root.PUBLIC_READ_ONLY)return;
  const project=workspace.projects.find(p=>p.id===projectId);if(!project||project.status==='archived')return;
  const bases=project.entities.filter(p=>M.isProductPart(p)&&p.status!=='archived'&&root.ProductionProgress.steps(project,p.id).length);
  const d=document.createElement('dialog');d.className='dialog';d.innerHTML='<form><h2>최종 파츠 등록</h2><label>기준 모델·공정<select data-base>'+bases.map(p=>'<option value="'+esc(p.id)+'">'+esc(F.label(p))+'</option>').join('')+'</select></label><div class="form-grid"><label>IB / OB<select data-inout><option value="">해당 없음</option><option>IB</option><option>OB</option></select></label><label>RH / LH<select data-side><option value="">해당 없음</option><option>RH</option><option>LH</option></select></label></div><label>최종 파츠명<input data-name maxlength="180" required placeholder="LQ2 STD IB RH"></label><label>품번·모델 코드 (선택)<input data-code maxlength="120"></label><label class="check"><input type="checkbox" data-route required>기준 모델과 같은 공정 경로임을 확인했습니다.</label><p>기존 수량은 분배·복사하지 않습니다. 새 파츠부터 개별 실적을 기록합니다.</p><p role="alert"></p><button class="button primary" type="submit">등록</button><button class="button" type="button" data-close>닫기</button></form>';
  document.body.append(d);d.onclose=()=>d.remove();d.querySelector('[data-close]').onclick=()=>d.close();
  const suggest=()=>{const base=M.byId(project,d.querySelector('[data-base]').value);d.querySelector('[data-name]').value=[F.label(base),d.querySelector('[data-inout]').value,d.querySelector('[data-side]').value].filter(Boolean).join(' ');};d.querySelectorAll('select').forEach(s=>s.onchange=suggest);suggest();
  d.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=d.querySelector('[type=submit]');button.disabled=true;try{
   const next=structuredClone(workspace),target=next.projects.find(p=>p.id===projectId),name=d.querySelector('[data-name]').value.trim(),code=d.querySelector('[data-code]').value.trim();
   if(next.library.entities.some(p=>M.isProductPart(p)&&(F.label(p).toLowerCase()===name.toLowerCase()||code&&p.modelCode===code)))throw Error('이미 등록된 이름·품번입니다. Global Library의 기존 파츠를 연결하세요.');
   root.ProductionProgress.registerModel(target,{basePartId:d.querySelector('[data-base]').value,inOut:d.querySelector('[data-inout]').value,side:d.querySelector('[data-side]').value,name,modelCode:code,finalPart:true});
   const result=await root.LocalAPI.save(next,projectId,workspace.revision);d.close();await refresh(result);
  }catch(err){d.querySelector('[role=alert]').textContent=err.message;button.disabled=false;}};d.showModal();
 };
})(window);
