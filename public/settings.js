import { accountInstructions, validateInstructions } from '../shared/ai-instructions.mjs';
// Appearance preferences belong to this browser, independently of account identity.
export function initSettings(doc) {
  const tabs = [...doc.querySelectorAll('[data-settings-tab]')];
  const select = tab => {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    }
    for (const panel of doc.querySelectorAll('[data-settings-panel]')) {
      panel.hidden = panel.dataset.settingsPanel !== tab.dataset.settingsTab;
    }
    tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest', container: 'nearest' });
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      let index = tabs.indexOf(tab);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault(); select(tabs[index]); tabs[index].focus();
    });
  }
  let preferences = {};
  try { preferences = JSON.parse(doc.defaultView.localStorage.getItem('kahuron:appearance') || '{}') || {}; } catch {}
  for (const [id, key, values, fallback] of [
    ['settings-text-size', 'chatText', ['standard', 'large'], 'standard'],
    ['settings-motion', 'motion', ['system', 'reduce'], 'system'],
  ]) {
    const control = doc.getElementById(id);
    control.value = values.includes(preferences[key]) ? preferences[key] : fallback;
    doc.documentElement.dataset[key] = control.value;
    control.addEventListener('change', () => {
      preferences[key] = control.value;
      doc.documentElement.dataset[key] = control.value;
      try {
        doc.defaultView.localStorage.setItem('kahuron:appearance', JSON.stringify(preferences));
        doc.getElementById('preferences-feedback').textContent = '';
      } catch {
        doc.getElementById('preferences-feedback').textContent = 'Applied for this visit. Enable browser storage to keep this preference.';
      }
    });
  }
}

export function initAccountSettings(doc, { getUser, saveInstructions, exportAccount, isReady }) {
  const form = doc.getElementById('instructions-form');
  const field = doc.getElementById('ai-instructions');
  const save = doc.getElementById('save-instructions');
  const feedback = doc.getElementById('instructions-feedback');
  const exportButton = doc.getElementById('export-account');
  const cancel = doc.getElementById('cancel-account-export');
  const exportFeedback = doc.getElementById('account-export-feedback');
  let owner, saved = '', saving = false, controller;
  const count = () => { doc.getElementById('instructions-limit').textContent = `${new Intl.NumberFormat().format(field.value.length)} / 4,000`; };
  const error = message => {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', 'instructions-scope instructions-limit instructions-feedback');
    feedback.textContent = message;
  };
  const sync = () => {
    const user = getUser(), next = accountInstructions(user);
    if (owner !== user?.id) {
      controller?.abort(); owner = user?.id; saved = next; field.value = next;
      saving = false; feedback.textContent = ''; exportFeedback.textContent = '';
      field.setAttribute('aria-invalid', 'false');
      field.setAttribute('aria-describedby', 'instructions-scope instructions-limit');
    } else if (next !== saved) {
      if (field.value === saved) field.value = next;
      saved = next;
    }
    const ready = Boolean(user) && isReady();
    field.disabled = !ready || saving; save.disabled = !ready || saving;
    exportButton.disabled = !ready || Boolean(controller);
    if (!user) exportFeedback.textContent = 'Sign in or send your first message to create an account workspace.';
    doc.getElementById('instructions-scope').textContent = user ? 'Saved to your account. Applies when an AI request starts.' : 'Sign in or send your first message to save account instructions.';
    count();
  };
  field.addEventListener('input', () => {
    count(); feedback.textContent = ''; field.setAttribute('aria-invalid', 'false');
    field.setAttribute('aria-describedby', 'instructions-scope instructions-limit');
    field.setCustomValidity('');
  });
  field.addEventListener('invalid', () => error('Use up to 4,000 characters.'));
  field.addEventListener('blur', () => { if (field.value.length > 4000) error('Use up to 4,000 characters.'); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving || !getUser() || !isReady()) return;
    let value;
    try { value = validateInstructions(field.value); } catch (e) { error(e.message); field.focus(); return; }
    const currentOwner = owner;
    saving = true; sync(); save.textContent = 'Saving…'; feedback.textContent = '';
    try {
      await saveInstructions(value);
      if (getUser()?.id !== currentOwner) return;
      saved = value; field.value = value; feedback.textContent = value ? 'Instructions saved.' : 'Instructions cleared.';
    } catch {
      if (getUser()?.id === currentOwner) feedback.textContent = 'Could not save instructions. Reconnect and try again.';
    } finally {
      saving = false; save.textContent = 'Save instructions'; sync();
    }
  });
  exportButton.addEventListener('click', async () => {
    if (controller || !getUser() || !isReady()) return;
    const currentOwner = owner, task = new AbortController(); controller = task;
    cancel.hidden = false; sync(); exportFeedback.textContent = 'Preparing account export…';
    try {
      const result = await exportAccount(task.signal, message => {
        if (getUser()?.id === currentOwner && !task.signal.aborted) exportFeedback.textContent = message;
      });
      if (getUser()?.id === currentOwner && !task.signal.aborted)
        exportFeedback.textContent = `Export downloaded · ${result.conversations} ${result.conversations === 1 ? 'chat' : 'chats'}${result.missingOriginals ? ` · ${result.missingOriginals} Office originals unavailable on this browser (listed in archive)` : ''}.`;
    } catch (e) {
      if (getUser()?.id === currentOwner) exportFeedback.textContent = task.signal.aborted ? 'Export cancelled.' : e.message || 'Export failed. Reconnect and try again.';
    } finally {
      if (controller === task) { controller = null; cancel.hidden = true; sync(); }
    }
  });
  cancel.addEventListener('click', () => controller?.abort());
  sync();
  return { sync };
}
