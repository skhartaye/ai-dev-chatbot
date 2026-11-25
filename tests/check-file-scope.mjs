// Explicit live regression in a separate guest workspace, not the user's chat.
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const db=createClient('https://vkpvgpbdnlnngwzttciy.supabase.co','sb_publishable_YQXcdbCiQQg7KFdABqsNBw_px6r07_r',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(20000)})}});
async function rpc(name,args){const result=await db.rpc(name,args);if(result.error)throw result.error;return result.data;}
console.log('Waiting for the attachment-scope fix deployment.');
const expectedRevision=process.argv[2];
let ready=false;
for(let i=0;i<36;i++) {
  const health=await fetch('https://ai-dev-chatbot.onrender.com/health',{signal:AbortSignal.timeout(10000)}).then(r=>r.json()).catch(()=>({}));
  if(health.queue==='ready' && (!expectedRevision || health.revision===expectedRevision)){ready=true;break;}
  await pause(5000);
}
assert.ok(ready,'The required backend revision did not become available.');
const auth=await db.auth.signInAnonymously();assert.equal(auth.error,null);
const chat=crypto.randomUUID();
await rpc('create_conversation',{p_id:chat,p_title:'Current attachment scope regression'});
async function ask(question,file) {
  const prompt=crypto.randomUUID(),job=crypto.randomUUID();
  if(file) {
    const blob=new Blob([file.text],{type:'text/plain'}),id=crypto.randomUUID();
    await rpc('save_prompt_with_attachments',{p_id:prompt,p_conversation_id:chat,p_content:question,p_files:[{id,name:file.name,mimeType:'text/plain',size:blob.size}]});
    const upload=await db.storage.from('chat-attachments').upload(`${auth.data.user.id}/${prompt}/${id}`,blob,{contentType:'text/plain'});assert.equal(upload.error,null);
  } else await rpc('save_prompt',{p_id:prompt,p_conversation_id:chat,p_content:question});
  await rpc('compile_prompts',{p_id:job,p_conversation_id:chat,p_prompt_ids:[prompt]});
  for(let i=0;i<60;i++) {
    const {data,error}=await db.from('compilations').select('status,answer,error_code').eq('id',job).single();if(error)throw error;
    if(data.status==='complete')return data.answer;
    if(data.status==='failed')throw new Error(`AI job failed: ${data.error_code}`);
    await pause(3000);
  }
  throw new Error('AI test is still queued or processing.');
}
try {
  await ask('Acknowledge this attachment with exactly OLD-FILE-ACK. Do not summarize it.',{name:'old-invoice.txt',text:'This old invoice is for customer Luna, number 4827, PHP 1234.50. It is not a supplier catalog.'});
  const answer=await ask('Can you read what this is about?',{name:'Supplier Price List.xlsx',text:'Supplier price catalog. Printable vinyl code VINYL-8273 costs PHP 82.73 per meter. Foam board costs PHP 240 per sheet.'});
  assert.match(answer,/vinyl|supplier|price catalog/i);
  assert.doesNotMatch(answer,/4827|1234\.50|Luna|old-invoice/i);
  console.log('PASS: the ambiguous new-file question summarized only the newly attached supplier catalog.');
  const followup=await ask('What is the vinyl product code and price from the supplier price list?');
  assert.match(followup,/VINYL-8273/i);assert.match(followup,/82\.73/);
  console.log('PASS: follow-up without reattaching retrieved VINYL-8273 and PHP 82.73.');
}finally{await db.auth.signOut();}
