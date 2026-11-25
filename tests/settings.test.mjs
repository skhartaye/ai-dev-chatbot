import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { initSettings, initAccountSettings } from '../public/settings.js';

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

test('account instructions save, clear, preserve failed edits and reset on account change', async () => {
  const dom = new JSDOM(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'https://kahuron.netlify.app/chat' });
  const doc = dom.window.document;
  let user = { id: 'a', user_metadata: { kahuron_instructions: 'Original' } }, fail = false;
  const settings = initAccountSettings(doc, {
    getUser: () => user, isReady: () => true,
    saveInstructions: async value => { if (fail) throw Error(); user.user_metadata.kahuron_instructions = value; },
    exportAccount: async () => ({}),
  });
  const field = doc.getElementById('ai-instructions'), form = doc.getElementById('instructions-form');
  const submit = async () => { form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await new Promise(r => setTimeout(r, 0)); };
  assert.equal(field.value, 'Original');
  field.value = 'Reply in Filipino'; await submit();
  assert.equal(user.user_metadata.kahuron_instructions, 'Reply in Filipino');
  field.value = ''; await submit();
  assert.equal(user.user_metadata.kahuron_instructions, '');
  assert.match(doc.getElementById('instructions-feedback').textContent, /cleared/);
  fail = true; field.value = 'Keep this unsaved edit'; await submit();
  assert.equal(field.value, 'Keep this unsaved edit');
  assert.match(doc.getElementById('instructions-feedback').textContent, /Reconnect/);
  field.value = 'x'.repeat(4001); await submit();
  assert.equal(field.getAttribute('aria-invalid'), 'true');
  user = { id: 'b', user_metadata: { kahuron_instructions: 'Other account' } }; settings.sync();
  assert.equal(field.value, 'Other account');
  user = null; settings.sync();
  assert.equal(field.value, ''); assert.equal(field.disabled, true);
  dom.window.close();
});

test('account export UI cancels and rejects a completion after account change', async () => {
  const dom = new JSDOM(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'https://kahuron.netlify.app/chat' });
  const doc = dom.window.document;
  let user = { id: 'a' }, finish, signal;
  const settings = initAccountSettings(doc, { getUser: () => user, isReady: () => true, saveInstructions: async () => {}, exportAccount: (s) => { signal = s; return new Promise(resolve => { finish = resolve; }); } });
  doc.getElementById('export-account').click();
  assert.equal(doc.getElementById('export-account').disabled, true);
  doc.getElementById('cancel-account-export').click();
  assert.equal(signal.aborted, true);
  finish({ conversations: 2, missingOriginals: 0 }); await new Promise(r => setTimeout(r, 0));
  assert.doesNotMatch(doc.getElementById('account-export-feedback').textContent, /downloaded/);
  doc.getElementById('export-account').click();
  user = { id: 'b' }; settings.sync();
  assert.equal(signal.aborted, true);
  finish({ conversations: 2 }); await new Promise(r => setTimeout(r, 0));
  assert.equal(doc.getElementById('account-export-feedback').textContent, '');
  dom.window.close();
});
