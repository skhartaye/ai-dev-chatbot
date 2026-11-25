import test from 'node:test';
import assert from 'node:assert/strict';
import {requestEmailLink,emailError} from '../public/email-auth.js';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {runInContext} from 'node:vm';
import {JSDOM} from 'jsdom';

test('email login and guest upgrade use the correct auth operation and chat callback',async()=>{
  const calls=[],auth={signInWithOtp:async args=>{calls.push(['signin',args]);return {}},updateUser:async(...args)=>{calls.push(['upgrade',...args]);return {}}};
  await requestEmailLink(auth,'test@example.com');await requestEmailLink(auth,'test@example.com',{upgrade:true});
  assert.deepEqual(calls,[['signin',{email:'test@example.com',options:{emailRedirectTo:'https://kahuron.netlify.app/chat'}}],['upgrade',{email:'test@example.com'},{emailRedirectTo:'https://kahuron.netlify.app/chat'}]]);
  auth.updateUser=async()=>({error:{code:'email_exists'}});
  await assert.rejects(requestEmailLink(auth,'test@example.com',{upgrade:true}),e=>e.code==='email_exists');
  assert.match(emailError({code:'email_exists'}),/existing account/);
  assert.match(emailError({status:429}),/Wait a minute/);
});

test('guest email UI keeps the same workspace on verified upgrade and does not sign out the guest',async()=>{
  const result=await build({entryPoints:['public/app.js'],bundle:true,write:false,format:'iife',plugins:[{name:'auth',setup(b){
    b.onResolve({filter:/\/cloud\.js$/},()=>({path:'cloud',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:`
      export const supabase={auth:{onAuthStateChange(cb){window.authChange=cb;const session={user:{id:'owner',is_anonymous:true}};cb('INITIAL_SESSION',session);cb('SIGNED_IN',session)},updateUser:async(...args)=>{window.authArgs=args;return {}},signInWithOtp:async()=>({}),signOut:async()=>{throw new Error('Must not sign out guest')}}};
      export const rpc=async()=>[];export const listConversations=async()=>{await new Promise(r=>setTimeout(r,10));return [{id:'chat',title:'Keep me',remote:true,createdAt:1,prompts:[],jobs:[],draft:''}]};
      export const loadConversation=async()=>({prompts:[{id:'p',content:'Keep my question',createdAt:1}],jobs:[{id:'j',promptIds:['p'],createdAt:2,status:'complete',answer:'Keep my answer'}]});
      export const wakeWorker=async()=>true;export const uploadAttachment=async()=>{};export const downloadAttachment=async()=>{};
    `}));}}]});
  const dom=new JSDOM(await readFile('public/index.html','utf8'),{url:'https://kahuron.netlify.app/chat?signin=1',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
  w.matchMedia=()=>({matches:false,addEventListener(){}});w.setInterval=()=>0;w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
  try{
    runInContext(result.outputFiles[0].text,dom.getInternalVMContext());await new Promise(r=>setTimeout(r,100));
    assert.equal(d.querySelector('#sign-in-dialog').open,true,'explicit email entry survives simultaneous auth callbacks');
    assert.equal(d.querySelector('#connection-status'),null);
    assert.equal(d.querySelector('#sign-in').textContent,'Save with email');d.querySelector('#sign-in').click();
    assert.equal(d.querySelector('#sign-in-dialog').open,true);assert.match(d.querySelector('#sign-in-title').textContent,/Save your workspace/);
    d.querySelector('#email').value='test@example.com';d.querySelector('#sign-in-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
    await new Promise(r=>setTimeout(r,10));assert.equal(w.authArgs[0].email,'test@example.com');assert.match(d.querySelector('#sign-in-feedback').textContent,/confirmation link/);
    w.authChange('USER_UPDATED',{user:{id:'owner',is_anonymous:false,email_confirmed_at:'2026-11-25'}});
    await new Promise(r=>setTimeout(r,10));
    assert.equal(d.querySelector('#sign-in').textContent,'Sign out');assert.equal(d.querySelector('#sign-in-dialog').open,false);
    assert.match(d.querySelector('#prompt-list').textContent,/Keep my question/);assert.match(d.querySelector('#prompt-list').textContent,/Keep my answer/);
  }finally{dom.window.close();}
});
