import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateFile, checkOfficeArchive, extractFile } from '../public/extract-file.js';

test('file validation rejects unsupported, empty and oversized input', () => {
  assert.equal(validateFile(new File(['hi'],'note.TXT')),'txt');
  assert.throws(()=>validateFile(new File(['hi'],'old.doc')),/DOCX\/XLSX/);
  assert.throws(()=>validateFile(new File([],'empty.pdf')),/empty/);
  assert.throws(()=>validateFile({name:'big.pdf',size:11*1024*1024}),/10 MB/);
});
test('Office archive checks accept real files and reject excessive expanded data', async () => {
  for (const name of ['sample.docx','sample.xlsx']) {
    const source=await readFile(`tests/fixtures/${name}`);
    const buffer=source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength);
    checkOfficeArchive(buffer);
    const view=new DataView(buffer);
    let central=0;
    while(view.getUint32(central,true)!==0x02014b50) central++;
    view.setUint32(central+24,60*1024*1024,true);
    assert.throws(()=>checkOfficeArchive(buffer),/50 MB/);
  }
});
test('plain text extraction returns literal content and respects cancellation', async () => {
  const file=new File(['<script>literal text</script>'],'note.txt');
  assert.equal(await extractFile(file,{signal:new AbortController().signal}),'<script>literal text</script>');
  const controller=new AbortController();controller.abort();
  await assert.rejects(extractFile(file,{signal:controller.signal}),{name:'AbortError'});
});
