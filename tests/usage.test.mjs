import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeUsage} from '../public/usage.js';
import {emails,renderEmail} from '../supabase/templates/build.mjs';

test('usage reports only stored successful provider counts, with missing coverage visible',()=>{
  const result=summarizeUsage([{status:'complete',model:'gemini',usage:{promptTokenCount:10,candidatesTokenCount:20,totalTokenCount:35}},{status:'complete',usage:null},{status:'processing'},{status:'queued'},{status:'failed',usage:{totalTokenCount:500}}]);
  assert.equal(result.requests,5);assert.equal(result.complete,2);assert.equal(result.active,2);assert.equal(result.failed,1);
  assert.equal(result.total,35);assert.equal(result.input,10);assert.equal(result.output,20);assert.equal(result.reported,1);
  assert.equal(result.models.get('gemini'),1);assert.equal(summarizeUsage([]).reported,0);
});
test('branded email templates include code and direct verified callback, with no external assets',()=>{
  for(const message of Object.values(emails)){
    const html=renderEmail(message);
    assert.match(html,/\{\{ \.Token \}\}/);assert.match(html,/token_hash=\{\{ \.TokenHash \}\}/);
    assert.ok(html.includes(`type=${message.type}`));assert.doesNotMatch(html,/ConfirmationURL|<script|<img|@import/);
    assert.match(html,/role="presentation"/);assert.match(html,/kahuron/);
  }
});
