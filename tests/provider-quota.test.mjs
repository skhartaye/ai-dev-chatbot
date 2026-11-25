import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderProviderQuota } from '../public/provider-quota.js';

test('quota meter shows remaining daily capacity and rejects missing or expired readings', () => {
  const dom = new JSDOM('<div id="quota"></div>'), node = dom.window.document.getElementById('quota');
  const report = { status: 'available', used: 57, limit: 500, asOf: new Date(Date.now() - 60000).toISOString(), resetsAt: new Date(Date.now() + 3600000).toISOString() };
  renderProviderQuota(node, report);
  assert.match(node.textContent, /88.6% remaining/); assert.match(node.textContent, /11.4% used/);
  assert.equal(node.querySelector('meter').value, 57); assert.equal(node.querySelector('meter').max, 500);
  for (const data of [{ status: 'unavailable' }, { ...report, limit: 0 }, { ...report, resetsAt: new Date(Date.now() - 1).toISOString() }]) {
    renderProviderQuota(node, data); assert.equal(node.querySelector('meter'), null); assert.doesNotMatch(node.textContent, /% remaining/);
  }
  dom.window.close();
});
