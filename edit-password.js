'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const expected=Buffer.from('8c1cdb9cb4dbac6dbb6ebd118ec8f9523d22e4e4cb8cc9df5f7e1e499bba3c10','hex');
function ok(value){
  if(typeof value!=='string'||value.length<4||value.length>72)return false;
  const digest=createHash('sha256').update(value).digest();
  return digest.length===expected.length&&timingSafeEqual(digest,expected);
}
module.exports={ok};
