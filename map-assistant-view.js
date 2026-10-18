(function(root){
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
 function answerHTML(message){
  const text=message.content||'',spans=(message.spans||[]).filter(span=>span&&typeof span.start==='number'&&typeof span.end==='number'&&typeof span.id==='string'&&span.start>=0&&span.end<=text.length&&span.start<span.end).sort((a,b)=>a.start-b.start);
  if(!spans.length)return '<p>'+escape(text)+'</p>';
  let html='<p>',cursor=0;
  for(const span of spans){if(span.start<cursor)continue;html+=escape(text.slice(cursor,span.start))+'<button type="button" class="map-assistant-link" data-ai-object="'+escape(span.id)+'">'+escape(text.slice(span.start,span.end))+'</button>';cursor=span.end;}
  return html+escape(text.slice(cursor))+'</p>';
 }
 root.MapAssistantView=class{
  constructor({getScope,ask,highlight}){this.getScope=getScope;this.ask=ask;this.highlight=highlight;this.chats=new Map();this.openPanel=null;this.buttons=[];
   for(const panelSelector of ['.map-panel','#productionView']){
    const panel=document.querySelector(panelSelector),button=document.createElement('button');button.className='map-copilot-button';button.type='button';button.hidden=true;button.setAttribute('aria-label','Copilot');button.setAttribute('aria-expanded','false');button.innerHTML='<svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 3c0 5-4 9-9 9 5 0 9 4 9 9 0-5 4-9 9-9-5 0-9-4-9-9Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\"/></svg>';
    const drawer=document.createElement('aside');drawer.className='map-assistant-drawer';drawer.hidden=true;drawer.setAttribute('aria-label','Copilot');drawer.innerHTML='<div class="map-assistant-heading"><h3>Copilot</h3><button type="button" class="text-button" data-ai-close aria-label="닫기">닫기</button></div><div class="map-assistant-messages" role="log" aria-live="polite"></div><p class="map-assistant-error" role="alert"></p><form class="map-assistant-form"><textarea name="question" rows="3" maxlength="4000" required placeholder="질문"></textarea><div class="actions"><button class="button primary" type="submit">보내기</button><button class="text-button" type="button" data-ai-clear>대화 지우기</button></div></form>';
    panel.append(button,drawer);button.onclick=()=>{if(this.openPanel===panel)this.close();else{this.close();this.openPanel=panel;drawer.hidden=false;button.setAttribute('aria-expanded','true');this.update();drawer.querySelector('textarea').focus();}};
    drawer.querySelector('[data-ai-close]').onclick=()=>this.close();drawer.querySelector('[data-ai-clear]').onclick=()=>{const s=this.getScope();if(s&&!this.state(s).busy){this.chats.delete(s.key);this.update();}};
    drawer.querySelector('form').onsubmit=e=>this.submit(e,drawer);
    drawer.querySelector('.map-assistant-messages').onclick=e=>{const b=e.target.closest('[data-ai-object]');if(b)this.highlight(b.dataset.aiObject);};
    this.buttons.push(button);
   }
  }
  state(s){if(!this.chats.has(s.key))this.chats.set(s.key,{messages:[],busy:false,error:''});return this.chats.get(s.key);}
  close(){if(!this.openPanel)return;const p=this.openPanel;p.querySelector('.map-assistant-drawer').hidden=true;p.querySelector('.map-copilot-button').setAttribute('aria-expanded','false');this.openPanel=null;}
  update(){const scope=this.getScope();for(const b of this.buttons)b.hidden=!scope;if(!scope){this.close();return;}if(!this.openPanel)return;const d=this.openPanel.querySelector('.map-assistant-drawer'),state=this.state(scope);if(this.activeKey!==scope.key){d.querySelector('textarea').value='';this.activeKey=scope.key;}d.querySelector('.map-assistant-error').textContent=state.error;d.querySelector('textarea').disabled=state.busy;d.querySelector('[type=submit]').disabled=state.busy||!scope.configured;d.querySelector('[type=submit]').textContent=state.busy?'답변 중…':'보내기';d.querySelector('[data-ai-clear]').disabled=state.busy;
   const messages=d.querySelector('.map-assistant-messages');messages.innerHTML=state.messages.map(m=>'<article class="map-assistant-message '+escape(m.role)+'">'+(m.role==='assistant'?answerHTML(m):'<p>'+escape(m.content)+'</p>')+'</article>').join('');messages.scrollTop=messages.scrollHeight;
  }
  async submit(e,drawer){e.preventDefault();const scope=this.getScope();if(!scope?.configured)return;const state=this.state(scope),field=drawer.querySelector('textarea'),question=field.value.trim();if(!question||state.busy)return;const history=state.messages.slice(-10).map(({role,content})=>({role,content}));state.messages.push({role:'user',content:question});state.busy=true;state.error='';field.value='';this.update();try{const answer=await this.ask({scopeId:scope.scopeId,visibleIds:null,question,history,consent:true});state.messages.push({role:'assistant',content:answer.answer,spans:answer.spans||[]});}catch(error){state.error=error.message;}finally{state.busy=false;this.update();}}
 };
})(window);
