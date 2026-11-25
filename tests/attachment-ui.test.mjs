import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInContext} from 'node:vm';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('file cards preserve focus during refresh and previews render untrusted text literally',async()=>{
  const built=await build({entryPoints:['public/attachment-ui.js'],bundle:true,write:false,format:'iife',globalName:'FileUI',plugins:[{name:'private-file',setup(b){b.onResolve({filter:/\/cloud\.js$/},()=>({path:'cloud',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export const downloadAttachment=async()=>new Blob(['<script>untrusted text</script>']);` }));}}]});
  const dom=new JSDOM(await readFile('public/index.html','utf8'),{url:'https://kahuron.netlify.app/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.Blob=Blob;w.URL.createObjectURL=()=> 'blob:private-preview';w.URL.revokeObjectURL=()=>{};
  w.matchMedia=()=>({matches:false,addEventListener(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
  try {
    runInContext(built.outputFiles[0].text,dom.getInternalVMContext());
    const c={id:'chat',draftAttachments:[{id:'file',name:'document.txt',mimeType:'text/plain',size:32}],prompts:[],jobs:[]};
    w.FileUI.renderAttachmentUI(c,[],()=>{});
    const card=w.document.querySelector('#draft-attachments .file-card');
    const opener=card.querySelector('.file-card-open');opener.focus();
    w.FileUI.renderAttachmentUI(c,[],()=>{});
    assert.equal(w.document.querySelector('#draft-attachments .file-card'),card);
    assert.equal(w.document.activeElement,opener);
    assert.equal(w.document.querySelector('#file-count').textContent,'1');
    opener.click();await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(w.document.querySelector('#file-preview-dialog').open,true);
    assert.equal(w.document.querySelector('#preview-text').textContent,'<script>untrusted text</script>');
    assert.equal(w.document.querySelector('#preview-text script'),null);
    assert.equal(w.document.querySelector('#preview-download').download,'document.txt');
    w.FileUI.resetAttachmentUI();
    assert.equal(w.document.querySelector('#file-preview-dialog').open,false);
  }finally{dom.window.close();}
});
