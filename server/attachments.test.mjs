import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAttachments} from './attachments.mjs';
import {generateAnswer} from './gemini.mjs';

test('Gemini receives actual PDF/image bytes and converted Office text alongside the question',async()=>{
  await generateAnswer(['What is shown?'],{apiKey:'test',attachments:[{name:'scan.pdf',scope:'current',mimeType:'application/pdf',data:'JVBERi0='},{name:'table.xlsx',scope:'history',text:'Item\tAmount\nMango\t450'}],fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body),parts=body.contents[0].parts;
    assert.equal(parts[0].text,'CURRENT ATTACHMENT: scan.pdf');
    assert.equal(parts[2].text,'EARLIER ATTACHMENT (background only): table.xlsx');
    assert.match(body.systemInstruction.parts.map(p=>p.text).join('\n'),/refer to CURRENT ATTACHMENTS only/);
    assert.deepEqual(parts[1],{inlineData:{mimeType:'application/pdf',data:'JVBERi0='}});
    assert.equal(parts[3].text,'Item\tAmount\nMango\t450');
    assert.equal(parts.at(-1).text,'What is shown?');
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Answer'}]}}]});
  }});
});
test('attachment retrieval restricts conversation and completed/current batches, validates payloads',async()=>{
  const calls=[];
  const db={from(table){assert.equal(table,'attachments');return {select(){return this},eq(...args){calls.push(args);return this},in(...args){calls.push(args);return this},order(){return Promise.resolve({data:[{name:'scan.pdf',mime_type:'application/pdf',size:5,storage_path:'owner/prompt/file',prompts:{compilation_id:'completed'}}]})}}},storage:{from(bucket){assert.equal(bucket,'chat-attachments');return {download:async path=>{assert.equal(path,'owner/prompt/file');return {data:new Blob(['%PDF-'])}}}}}};
  assert.deepEqual(await loadAttachments(db,'chat',['current','completed']),[{name:'scan.pdf',mimeType:'application/pdf',data:'JVBERi0=',scope:'history'}]);
  assert.deepEqual(calls,[['prompts.conversation_id','chat'],['prompts.compilation_id',['current','completed']]]);
  db.storage.from=()=>({download:async()=>({error:{message:'offline'}})});
  await assert.rejects(loadAttachments(db,'chat',['current']),error=>error.retryable===true);
});
