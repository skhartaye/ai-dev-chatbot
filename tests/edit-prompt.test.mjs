import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInContext} from 'node:vm';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('prompt edit preserves source and composer draft, validates, and restores both prompt and request from offline outbox',async()=>{
  const result=await build({entryPoints:['public/app.js'],bundle:true,write:false,format:'iife',plugins:[{
    name:'cloud',setup(b){b.onResolve({filter:/\/cloud\.js$/},()=>({path:'cloud',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:`
      export const supabase={auth:{onAuthStateChange(cb){cb('INITIAL_SESSION',{user:{id:'owner',is_anonymous:true}})}}};
      export const rpc=async()=>{throw new Error('Offline')};
      export const listConversations=async()=>[{id:'chat',title:'Test',remote:true,createdAt:1,prompts:[],jobs:[],draft:''}];
      export const loadConversation=async()=>({prompts:[{id:'source',content:'Original question',createdAt:1,attachments:[]}],jobs:[{id:'answer',status:'complete',answer:'Original answer',promptIds:['source'],createdAt:2}]});
      export const wakeWorker=async()=>true;
      export const uploadAttachment=async()=>{};export const downloadAttachment=async()=>{};
    `}));}
  }]});
  const html=await readFile('public/index.html','utf8');
  const make=delivery=>{
    const dom=new JSDOM(html,{url:'https://kahuron.netlify.app/?conversation=chat',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
    w.matchMedia=()=>({matches:false,addEventListener(){}});
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
    w.HTMLElement.prototype.scrollIntoView=()=>{};w.setInterval=()=>0;
    Object.defineProperty(w.navigator,'onLine',{value:false});
    if(delivery) w.localStorage.setItem('kahuron.delivery.owner',delivery);
    runInContext(result.outputFiles[0].text,dom.getInternalVMContext());return dom;
  };
  let dom=make();
  try {
    await new Promise(r=>setTimeout(r,100));
    const w=dom.window,d=w.document;
    d.querySelector('#prompt').value='Unsent composer draft';d.querySelector('#prompt').dispatchEvent(new w.Event('input'));
    const edit=()=>Array.from(d.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Edit prompt 1').click();
    edit();assert.equal(d.querySelector('#edited-prompt').value,'Original question');
    d.querySelector('#edited-prompt').value='Cancelled change';d.querySelector('#cancel-prompt-edit').click();
    assert.equal(d.querySelector('#prompt').value,'Unsent composer draft');
    edit();assert.equal(d.querySelector('#edited-prompt').value,'Original question');
    d.querySelector('#edited-prompt').value='  ';
    d.querySelector('#edit-prompt-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
    assert.equal(d.querySelector('#edited-prompt').getAttribute('aria-invalid'),'true');
    d.querySelector('#edited-prompt').value='Revised question';
    d.querySelector('#edit-prompt-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
    const delivery=w.localStorage.getItem('kahuron.delivery.owner'),[action]=JSON.parse(delivery);
    assert.equal(action.type,'revise');assert.equal(action.prompt.revisionOf,'source');assert.equal(action.prompt.content,'Revised question');
    assert.match(d.querySelector('#prompt-list').textContent,/Original question/);assert.match(d.querySelector('#prompt-list').textContent,/Revised question/);
    assert.equal(d.querySelector('#prompt').value,'Unsent composer draft');
    dom.window.close();dom=make(delivery);await new Promise(r=>setTimeout(r,100));
    const restored=dom.window.document.querySelector('#prompt-list').textContent;
    assert.match(restored,/Revised question/);assert.match(restored,/Saving message/);assert.match(restored,/Original answer/);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('kahuron.delivery.owner')).length,1);
  } finally {dom.window.close();}
});
