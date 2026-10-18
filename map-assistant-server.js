const Assistant=require('./map-assistant');
async function answer({scope,input,key,fetchImpl=fetch}){
 if(!key){const e=Error('연결되지 않았습니다.');e.status=503;throw e;}
 const context=Assistant.context(scope,input.visibleIds),body=Assistant.request(context,input);
 const r=await fetchImpl('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const data=await r.json().catch(()=>({}));if(!r.ok){const detail=String(data?.error?.message||'').replace(/\s+/g,' ').slice(0,180);const e=Error(r.status===429?'잠시 후 다시 시도하세요.':(detail||'응답하지 못했습니다.'));e.status=r.status===429?429:502;throw e;}
 return Assistant.result(context,data.choices?.[0]?.message?.content||'',input.question);
}
module.exports={answer};