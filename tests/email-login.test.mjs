import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {runInContext} from 'node:vm';
import {JSDOM} from 'jsdom';

for(const mode of ['code','link','expired','expired-resume'])test(`email login ${mode}: verifies session and protects workspace against late initial auth`,async()=>{
  const result=await build({entryPoints:['public/app.js'],bundle:true,write:false,format:'iife',plugins:[{name:'cloud',setup(b){
    b.onResolve({filter:/\/cloud\.js$/},()=>({path:'cloud',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:`
      window.owner='guest';window.verifications=[];
      const signed={user:{id:'account',email:'login@example.com',email_confirmed_at:'2026-11-25',is_anonymous:false}};
      export const supabase={auth:{onAuthStateChange(cb){window.authChange=(event,session)=>{window.owner=session.user.id;cb(event,session)};cb('INITIAL_SESSION',{user:{id:'guest',is_anonymous:true}})},initialize:async()=>({error:null}),
      signInWithOtp:async()=>({}),verifyOtp:async args=>{
        window.verifications.push(args);if(location.search.includes('token_hash'))throw new Error('Bearer token left in history');
        await new Promise(r=>setTimeout(r,15));
        if(${mode.startsWith('expired')}||args.token==='000000')return {error:{code:'otp_expired'}};
        window.authChange('SIGNED_IN',signed);return {data:{session:signed}};
      }}};
      export const rpc=async()=>[];
      export const listConversations=async()=>{const owner=window.owner;await new Promise(r=>setTimeout(r,owner==='guest'?100:5));return [{id:owner+'-chat',title:owner+' workspace',createdAt:1,remote:true,prompts:[],jobs:[],draft:''}]};
      export const loadConversation=async()=>({prompts:[],jobs:[]});export const wakeWorker=async()=>true;export const uploadAttachment=async()=>{};export const downloadAttachment=async()=>{};
      export const loadUsage=async()=>[{status:'complete',usage:{totalTokenCount:45,promptTokenCount:20,candidatesTokenCount:25},model:'gemini'}];
    `}));}}]});
  const url=mode==='code'?'https://kahuron.netlify.app/chat?signin=1':'https://kahuron.netlify.app/chat?token_hash=test-hash&type=email';
  const dom=new JSDOM(await readFile('public/index.html','utf8'),{url,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
  w.matchMedia=()=>({matches:false,addEventListener(){}});w.setInterval=()=>0;w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
  if(mode==='expired-resume')w.sessionStorage.setItem('kahuron.email-challenge',JSON.stringify({email:'login@example.com',type:'email',sentAt:Date.now()}));
  try{
    runInContext(result.outputFiles[0].text,dom.getInternalVMContext());
    await new Promise(r=>setTimeout(r,150));
    if(mode==='code'){
      d.querySelector('#email').value='login@example.com';d.querySelector('#sign-in-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,10));
      assert.equal(d.querySelector('#verify-email-form').hidden,false);
      d.querySelector('#email-code').value='000000';d.querySelector('#verify-email-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,30));
      assert.equal(d.querySelector('#sign-in-dialog').open,true);assert.match(d.querySelector('#email-code-feedback').textContent,/invalid or expired/);
      d.querySelector('#email-code').value='123456';d.querySelector('#verify-email-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,150));
    }
    assert.equal(w.location.search.includes('token_hash'),false);
    if(mode.startsWith('expired')){
      assert.equal(d.querySelector('#sign-in-dialog').open,true);assert.match(d.querySelector(mode==='expired-resume'?'#email-code-feedback':'#sign-in-feedback').textContent,/invalid or expired/);assert.equal(d.querySelector('#workspace-name').textContent,'Guest workspace');
    }else{
      assert.equal(d.querySelector('#workspace-name').textContent,'login@example.com');
      assert.equal(d.querySelector('#conversation-title').textContent,'account workspace');
      assert.equal(d.querySelector('#sign-in-dialog').open,false);
      assert.equal(w.sessionStorage.getItem('kahuron.email-challenge'),null);
      d.querySelector('#open-settings').click();await new Promise(r=>setTimeout(r,10));
      assert.equal(d.querySelector('#settings-email').textContent,'login@example.com');assert.match(d.querySelector('#usage-summary').textContent,/45/);
    }
  }finally{dom.window.close();}
});
