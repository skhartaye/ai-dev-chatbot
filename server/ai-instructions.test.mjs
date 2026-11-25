import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAccountInstructions } from './ai-instructions.mjs';
import { accountInstructions, validateInstructions } from '../shared/ai-instructions.mjs';
import { generateAvailableAnswer } from './gemini.mjs';

test('instructions are fetched for the conversation owner and malformed metadata is bounded', async () => {
  const db = {
    from(table) { assert.equal(table, 'conversations'); return { select() { return this; }, eq(key, value) { assert.deepEqual([key, value], ['id', 'chat']); return this; }, single: async () => ({ data: { owner_id: 'owner' } }) }; },
    auth: { admin: { getUserById: async id => { assert.equal(id, 'owner'); return { data: { user: { user_metadata: { kahuron_instructions: ' Reply in Filipino. ' } } } }; } } },
  };
  assert.equal(await loadAccountInstructions(db, 'chat'), 'Reply in Filipino.');
  assert.equal(accountInstructions({ user_metadata: { kahuron_instructions: 'x'.repeat(4001) } }), '');
  assert.equal(accountInstructions(null), '');
  assert.throws(() => validateInstructions({}), /4,000/);
  db.auth.admin.getUserById = async () => ({ error: {} });
  await assert.rejects(loadAccountInstructions(db, 'chat'), e => e.retryable === true);
});

test('both provider attempts receive saved instructions below the current request and edit contract', async () => {
  let calls = 0;
  await generateAvailableAnswer(['CURRENT USER MESSAGE:\nUse English this time.'], {
    apiKey: 'test', instructions: 'Reply in Filipino.',
    fetchImpl: async (_url, options) => {
      calls++;
      const body = JSON.parse(options.body), system = body.systemInstruction.parts.map(p => p.text).join('\n');
      assert.match(system, /Reply in Filipino/);
      assert.match(system, /current user message takes priority/);
      assert.match(system, /cannot authorize file edits/);
      assert.match(system, /STRUCTURED|FILE EDITING/);
      assert.equal(body.contents[0].parts.at(-1).text, 'CURRENT USER MESSAGE:\nUse English this time.');
      return calls === 1 ? new Response('', { status: 503 }) : Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ answer: 'English answer', title: 'Response language preferences' }) }] } }] });
    },
  });
  assert.equal(calls, 2);
});
