export async function loadProviderQuota(client) {
  const { data: { session } } = await client.auth.getSession();
  if (!session) return { status: 'not_connected' };
  const response = await fetch('https://ai-dev-chatbot.onrender.com/quota', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error('Quota unavailable.');
  return response.json();
}

export function renderProviderQuota(container, report) {
  const doc = container.ownerDocument;
  container.replaceChildren();
  const add = (tag, text, cls) => { const node = doc.createElement(tag); node.textContent = text; if (cls) node.className = cls; container.append(node); return node; };
  if (['BILLING_REQUIRED','BILLING_DISABLED'].includes(report.reason)) {
    add('h3', 'Daily requests remaining');
    add('strong', 'Unavailable');
    add('p', 'Google requires billing for quota reporting. Billing remains off.', 'quota-note');
    return;
  }
  if (report.status !== 'available' || !Number.isSafeInteger(report.used) || report.used < 0 || !Number.isSafeInteger(report.limit) || report.limit <= 0 || !Number.isFinite(Date.parse(report.asOf)) || !Number.isFinite(Date.parse(report.resetsAt)) || Date.parse(report.resetsAt) <= Date.now()) {
    add('span', 'Provider quota'); add('strong', 'Not available');
    add('p', report.status === 'loading' ? 'Loading provider quota…' : 'Remaining percentage needs a current provider report. Refresh to retry.', 'quota-note');
    return;
  }
  const percent = Math.min(100, report.used / report.limit * 100), number = new Intl.NumberFormat(), pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const heading = add('h3', 'Daily requests · shared'); heading.id = 'quota-meter-label';
  add('strong', `${number.format(Math.max(0, report.limit - report.used))} requests left`, 'quota-remaining');
  add('p', `${pct.format(100 - percent)}% remaining`, 'quota-count');
  const meter = add('meter', `${pct.format(percent)}% used`); meter.min = 0; meter.max = report.limit; meter.value = Math.min(report.used, report.limit); meter.setAttribute('aria-labelledby', heading.id);
  add('p', `${pct.format(percent)}% used · ${number.format(report.used)} / ${number.format(report.limit)} requests`, 'quota-count');
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  add('p', `Checked ${date.format(new Date(report.asOf))} · resets ${date.format(new Date(report.resetsAt))}. Google reports may lag.`, 'quota-note');
}
