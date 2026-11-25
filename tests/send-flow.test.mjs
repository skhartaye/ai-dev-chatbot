import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInContext } from 'node:vm';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

for (const mode of ['send','failure','restore']) test(`Guest attachment flow: ${mode}`, async () => {
  const fails=mode==='failure';
  const result = await build({entryPoints:['public/app.js'],bundle:true,write:false,format:'iife',plugins:[{
    name:'fake-cloud',setup(b){b.onResolve({filter:/\/cloud\.js$/},()=>({path:'cloud',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:`
      window.calls=[];
      export const supabase={auth:{onAuthStateChange(cb){if(window.initialSession)cb('INITIAL_SESSION',window.initialSession)},signInAnonymously:async()=>${fails ? "({data:{session:null},error:new Error('Unavailable')})" : "({data:{session:{user:{id:'owner',is_anonymous:true}}},error:null})"},signOut:async()=>({}),signInWithOtp:async()=>({})}};
      export const rpc=async(name,args)=>{window.calls.push({name,args});return []};
      export const listConversations=async()=>[];
      export const loadConversation=async()=>({prompts:[],jobs:[]});
      export const wakeWorker=async()=>true;
      export const uploadAttachment=async()=>{};
      export const downloadAttachment=async()=>new Blob(['test']);
    `}));}
  }]});
  const dom = new JSDOM(await readFile('public/index.html','utf8'),{url:'https://kahuron.netlify.app/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.matchMedia=()=>({matches:false,addEventListener(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.setInterval=()=>0;
  if(mode==='restore') {
    w.initialSession={user:{id:'owner',is_anonymous:true}};
    w.history.replaceState({},'', '/?conversation=draft-chat');
    w.localStorage.setItem('kahuron.drafts.owner',JSON.stringify({'draft-chat':{text:'Question about my file',draftOnly:true,title:'Unsent chat',createdAt:Date.now(),attachments:[{id:'file-id',name:'report.pdf',mimeType:'application/pdf',size:100}]}}));
  }
  try {
    runInContext(result.outputFiles[0].text,dom.getInternalVMContext());
    const input=w.document.querySelector('#prompt');
    if(mode==='restore') {
      await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(input.value,'Question about my file');
      assert.match(w.document.querySelector('#draft-attachments').textContent,/report.pdf/);
      assert.equal(w.document.querySelector('#prompt-form').inert,false);
      assert.equal(w.calls.length,0);
      return;
    }
    input.value='Answer this saved prompt';
    const enter=opts=>input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...opts}));
    enter({shiftKey:true});
    enter({isComposing:true});
    assert.equal(w.sessionStorage.getItem('kahuron.send-after-sign-in'),null);
    enter({});
    const intent=JSON.parse(w.sessionStorage.getItem('kahuron.send-after-sign-in'));
    assert.equal(intent.promptIds.length,1);
    assert.equal(w.document.querySelector('#sign-in-dialog').open,false);
    await new Promise(resolve=>setTimeout(resolve,100));
    const compile=w.calls.filter(c=>c.name==='compile_prompts');
    assert.equal(w.document.querySelector('#prompt-form').inert,false);
    if (fails) {
      assert.equal(compile.length,0);
      assert.equal(JSON.parse(w.sessionStorage.getItem('kahuron.send-after-sign-in')).jobId,intent.jobId);
      assert.match(w.document.querySelector('#prompt-error').textContent,/Press Send to retry/);
      assert.match(w.localStorage.getItem('kahuron.preview.v1'),/Answer this saved prompt/);
    } else {
      assert.equal(compile.length,1);
      assert.deepEqual(Array.from(compile[0].args.p_prompt_ids),Array.from(intent.promptIds));
      assert.equal(w.sessionStorage.getItem('kahuron.send-after-sign-in'),null);
      assert.equal(w.document.querySelector('#workspace-name').textContent,'Guest workspace');
      // Each subsequent Enter creates its own durable request, even before prior work completes.
      input.value='Second queued prompt';enter({});
      input.value='Third queued prompt';enter({});
      await new Promise(resolve=>setTimeout(resolve,100));
      const requests=w.calls.filter(c=>c.name==='compile_prompts');
      assert.equal(requests.length,3);
      assert.equal(new Set(requests.map(c=>c.args.p_id)).size,3);
      assert.deepEqual(Array.from(requests,c=>c.args.p_prompt_ids.length),[1,1,1]);

    }
  } finally {dom.window.close();}
});
