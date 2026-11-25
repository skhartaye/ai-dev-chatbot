import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { initSettings } from '../public/settings.js';

test('settings tabs support arrow navigation and browser preferences survive reopening', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://kahuron.netlify.app/chat' });
  const { document: doc, KeyboardEvent, Event } = dom.window;
  initSettings(doc);
  const account = doc.querySelector('[data-settings-tab="account"]');
  account.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(doc.activeElement.id, 'settings-general-tab');
  assert.equal(doc.querySelector('[data-settings-panel="account"]').hidden, true);
  assert.equal(doc.querySelector('[data-settings-panel="general"]').hidden, false);
  const control = doc.getElementById('settings-text-size');
  control.value = 'large'; control.dispatchEvent(new Event('change'));
  assert.equal(doc.documentElement.dataset.chatText, 'large');
  assert.equal(JSON.parse(dom.window.localStorage.getItem('kahuron:appearance')).chatText, 'large');
  doc.documentElement.dataset.chatText = 'standard';
  initSettings(doc);
  assert.equal(doc.documentElement.dataset.chatText, 'large');
  assert.match(doc.querySelector('.quota-status').textContent, /Not available/);
  dom.window.close();
});
