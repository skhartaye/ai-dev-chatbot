import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAnswer } from './gemini.mjs';

test('preserves prompt order and returns completed answer', async () => {
  const result = await generateAnswer(['First', 'Second'], {
    apiKey: 'test',
    fetchImpl: async (url, options) => {
      assert.ok(url.includes('/gemini-3.5-flash-lite:generateContent'));
      assert.deepEqual(JSON.parse(options.body).contents[0].parts, [{text:'First'}, {text:'Second'}]);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{text:'Answer'}] } }] });
    },
  });
  assert.equal(result.text, 'Answer');
});

test('returns throttling to the worker without retrying or switching models', async () => {
  let calls = 0;
  await assert.rejects(generateAnswer(['Hello'], {
    apiKey: 'test', fetchImpl: async () => {
      calls++;
      return new Response('', {status:429, headers:{'retry-after':'60'}});
    },
  }), error => error.retryable && error.retryAfter === '60');
  assert.equal(calls, 1);
});

test('does not treat truncated output as complete', async () => {
  await assert.rejects(generateAnswer(['Hello'], {
    apiKey:'test', fetchImpl:async () => Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'Partial'}]}}]}),
  }), /complete answer/);
});
