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
