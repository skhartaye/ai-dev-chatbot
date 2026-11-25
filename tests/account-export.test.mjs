import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { buildAccountExport } from '../public/account-export.js';

function fixture({ fail, change, missing = false } = {}) {
  const calls = [];
  let current = true;
  const saved = new Blob(['PDF bytes']), draft = new Blob(['draft bytes']), office = new Blob(['text']);
  const records = {
    conversations: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), title: `Chat ${i}` })),
    prompts: [{ id: 'p', content: 'Question', conversations: { owner_id: 'me' } }],
    compilations: [{ id: 'a', answer: 'Answer', usage: { totalTokenCount: 42 } }],
    attachments: [{ id: 'pdf', name: '../../invoice.pdf', size: saved.size, storage_path: 'me/p/pdf' }, { id: 'word', name: 'sample.docx', size: office.size, storage_path: 'me/p/word' }],
    compilation_events: [{ id: 1, status: 'complete' }],
  };
  const db = {
    from(table) {
      const call = { table }; calls.push(call);
      const q = {
        select(columns) { call.columns = columns; return q; }, eq(key, value) { call.owner = [key, value]; return q; },
        lte(key, value) { call.cutoff = [key, value]; return q; }, order() { return q; }, abortSignal() { return q; },
        async range(start, end) {
          call.start = start;
          if (change) current = false;
          return fail === table ? { error: {} } : { data: records[table].slice(start, end + 1) };
        },
      }; return q;
    },
    storage: { from(bucket) { assert.equal(bucket, 'chat-attachments'); return { download: async path => missing ? { error: {} } : { data: path.endsWith('word') ? office : saved } }; } },
  };
  return {
    calls,
    options: { db, user: { id: 'me', email: 'me@example.com', user_metadata: { kahuron_instructions: 'Be concise', secret: 'not exported' } },
      local: { drafts: { localchat: { text: 'Unsent', attachments: [{ id: 'draft', name: 'draft.txt', size: draft.size }] } }, pendingDelivery: [{ prompt: { content: 'Pending' } }] },
      isCurrent: () => current, getLocalFile: async id => id === 'draft' ? draft : undefined },
  };
}

test('full export paginates past sidebar and database limits, includes files and pending drafts, and excludes credentials', async () => {
  const { options, calls } = fixture();
  const result = await buildAccountExport(options);
  const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const data = JSON.parse(strFromU8(archive['account.json']));
  assert.equal(result.conversations, 1001);
  assert.deepEqual(calls.filter(c => c.table === 'conversations').map(c => c.start), [0, 1000]);
  for (const call of calls) { assert.equal(call.owner[1], 'me'); assert.ok(call.cutoff[1]); assert.doesNotMatch(call.columns, /lease_token|access_token/); }
  assert.equal(data.browser.drafts.localchat.text, 'Unsent');
  assert.equal(data.account.instructions, 'Be concise');
  assert.equal(data.account.user_metadata, undefined);
  assert.equal(data.prompts[0].conversations, undefined);
  assert.equal(data.attachments[0].storage_path, undefined);
  assert.equal(result.missingOriginals, 1);
  for (const file of data.files) { assert.ok(archive[file.path]); assert.ok(!file.path.includes('../')); }
  assert.match(data.files.find(f => f.id === 'word').path, /extracted.txt$/);
  assert.equal(data.files.find(f => f.id === 'word').originalAvailable, false);
});

test('export refuses partial reads, missing saved files, cancellation and account changes', async () => {
  await assert.rejects(buildAccountExport(fixture({ fail: 'compilations' }).options), /all account data/);
  await assert.rejects(buildAccountExport(fixture({ missing: true }).options), /every saved file/);
  await assert.rejects(buildAccountExport(fixture({ change: true }).options), /Account changed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(buildAccountExport({ ...fixture().options, signal: controller.signal }), { name: 'AbortError' });
});
