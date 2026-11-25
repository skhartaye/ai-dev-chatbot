// Explicit live integration check; never run automatically during deploy builds.
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const client=()=>createClient('https://vkpvgpbdnlnngwzttciy.supabase.co','sb_publishable_YQXcdbCiQQg7KFdABqsNBw_px6r07_r',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(20000)})}});
const owner=client(),other=client();
try {
  const first=await owner.auth.signInAnonymously(),second=await other.auth.signInAnonymously();
  assert.equal(first.error,null);assert.equal(second.error,null);
  const chat=crypto.randomUUID(),prompt=crypto.randomUUID(),file=crypto.randomUUID();
  const path=`${first.data.user.id}/${prompt}/${file}`;
  const blob=new Blob(['PRIVATE-ATTACHMENT-4827'],{type:'text/plain'});
  const params={p_id:file,p_prompt_id:prompt,p_name:'private-test.txt',p_mime_type:'text/plain',p_size:blob.size};
  assert.equal((await owner.rpc('create_conversation',{p_id:chat,p_title:'Attachment isolation check'})).error,null);
  assert.equal((await owner.rpc('save_prompt',{p_id:prompt,p_conversation_id:chat,p_content:'Reply exactly ATTACHMENT-ISOLATION-PASS.'})).error,null);
  assert.ok((await owner.rpc('register_attachment',params)).error,'missing uploads must not register');
  const manifest={p_id:prompt,p_conversation_id:chat,p_content:'Reply exactly ATTACHMENT-ISOLATION-PASS.',p_files:[{id:file,name:'private-test.txt',mimeType:'text/plain',size:blob.size}]};
  assert.equal((await owner.rpc('save_prompt_with_attachments',manifest)).error,null);
  assert.ok((await owner.rpc('compile_prompts',{p_id:crypto.randomUUID(),p_conversation_id:chat,p_prompt_ids:[prompt]})).error,'incomplete files must block queueing from any tab');
  assert.ok((await other.storage.from('chat-attachments').upload(path,blob,{contentType:'text/plain'})).error,'cross-owner upload must fail');
  assert.equal((await owner.storage.from('chat-attachments').upload(path,blob,{contentType:'text/plain'})).error,null);
  assert.equal((await owner.rpc('register_attachment',params)).error,null);
  assert.equal((await owner.rpc('register_attachment',params)).error,null,'retry is idempotent');
  assert.ok((await owner.rpc('register_attachment',{...params,p_name:'changed.txt'})).error,'registered metadata is immutable');
  const hidden=await other.from('attachments').select('id').eq('id',file);
  assert.equal(hidden.error,null);assert.deepEqual(hidden.data,[]);
  assert.ok((await other.storage.from('chat-attachments').download(path)).error,'cross-owner file reads must fail');
  assert.equal(await (await owner.storage.from('chat-attachments').download(path)).data.text(),'PRIVATE-ATTACHMENT-4827');
  assert.ok((await owner.storage.from('chat-attachments').update(path,new Blob(['tamper']))).error,'uploaded files are immutable');
  assert.equal((await owner.rpc('compile_prompts',{p_id:crypto.randomUUID(),p_conversation_id:chat,p_prompt_ids:[prompt]})).error,null);
  assert.equal((await owner.rpc('register_attachment',params)).error,null,'acknowledged retry works after queueing');
  assert.equal((await owner.rpc('save_prompt_with_attachments',manifest)).error,null,'manifest delivery is idempotent after queueing');
  console.log('PASS: private ownership, complete upload, immutable files/metadata, idempotent retry and queue submission.');
} finally {await owner.auth.signOut();await other.auth.signOut();}
