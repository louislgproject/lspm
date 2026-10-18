const Assistant=require('./map-assistant');
async function answer({scope,input,key,fetchImpl=fetch}){
 if(!key){const e=Error('Copilot 미연결: 서버 OPENAI_API_KEY를 설정하세요.');e.status=503;throw e;}
 const context=Assistant.context(scope,input.visibleIds),body=Assistant.request(context,input);
 const r=await fetchImpl('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const data=await r.json();if(!r.ok){const e=Error(r.status===429?'OpenAI 사용 한도에 도달했습니다. 잠시 후 다시 시도하세요.':'GPT-6 Luna 응답 오류입니다. OPENAI_API_KEY를 확인하세요.');e.status=r.status===429?429:502;throw e;}
 return Assistant.result(context,data.choices?.[0]?.message?.content||'',input.question);
}
module.exports={answer};