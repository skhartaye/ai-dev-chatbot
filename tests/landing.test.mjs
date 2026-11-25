import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext,runInContext} from 'node:vm';
import {JSDOM} from 'jsdom';

test('legacy conversation and authentication URLs reach chat without dropping state',async()=>{
  const source=await readFile('public/welcome.js','utf8');
  for(const path of ['/?conversation=chat','/?code=test-code','/#error=access_denied&error_description=Expired','/#access_token=test']) {
    let target;runInNewContext(source,{URL,location:{href:'https://kahuron.netlify.app'+path,replace:value=>{target=value}},document:{querySelectorAll:()=>[]}});
    assert.equal(target,'/chat'+path.slice(1));
  }
});
test('landing file examples switch accessibly and chat links work without JavaScript',async()=>{
  const dom=new JSDOM(await readFile('public/welcome.html','utf8'),{url:'https://kahuron.netlify.app/',runScripts:'outside-only'});
  try{
    const d=dom.window.document;runInContext(await readFile('public/welcome.js','utf8'),dom.getInternalVMContext());
    assert.equal(d.querySelector('.start-link').getAttribute('href'),'/chat');
    d.querySelector('[data-file-demo="excel"]').click();
    assert.equal(d.querySelectorAll('[aria-pressed=true]').length,1);assert.equal(d.querySelector('#demo-filename').textContent,'Project budget.xlsx');
    assert.match(d.querySelector('#demo-question').textContent,/formula/);
  }finally{dom.window.close();}
});
