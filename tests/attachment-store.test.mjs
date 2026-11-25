import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {prepareAttachment,getFile,removeFile} from '../public/attachment-store.js';
globalThis.indexedDB=indexedDB;

test('PDF stays a binary attachment in durable browser storage until acknowledged',async()=>{
  const file=new File(['%PDF-1.7\nbinary PDF content'],'scan.pdf',{type:'application/pdf'});
  const attachment=await prepareAttachment(file,new AbortController().signal,()=>{});
  assert.equal(attachment.name,'scan.pdf');
  assert.equal(attachment.mimeType,'application/pdf');
  assert.equal(attachment.text,undefined);
  assert.equal(await (await getFile(attachment.id)).text(),await file.text());
  await removeFile(attachment.id);
  assert.equal(await getFile(attachment.id),undefined);
});
test('a renamed non-PDF is rejected before staging and cancellation preserves no phantom chip',async()=>{
  await assert.rejects(prepareAttachment(new File(['not pdf'],'fake.pdf'),new AbortController().signal,()=>{}),/contents do not match/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(prepareAttachment(new File(['%PDF-1.7'],'test.pdf'),controller.signal,()=>{}),{name:'AbortError'});
});
