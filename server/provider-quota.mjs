import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GEMINI_MODEL } from './gemini.mjs';

const metric = 'generativelanguage.googleapis.com/quota/generate_content_free_tier_requests';
const daily = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
const zone = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function parts(time) { return Object.fromEntries(zone.formatToParts(time).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)])); }
function midnight(utcDate) {
  let time = utcDate;
  for (let i = 0; i < 3; i++) {
    const p = parts(time), offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - time;
    time = utcDate - offset;
  }
  return time;
}
export function quotaDay(now) {
  const p = parts(now), date = Date.UTC(p.year, p.month - 1, p.day);
  return { start: midnight(date), reset: midnight(date + 86400000) };
}

export function dailyQuota(usage, limits, now = Date.now()) {
  const day = quotaDay(now);
  const matches = series => series.metric?.labels?.model === GEMINI_MODEL && series.metric?.labels?.limit_name === daily;
  const readings = limits.filter(matches).flatMap(s => s.points || []).filter(p => Date.parse(p.interval?.endTime) > now - 600000 && Date.parse(p.interval?.endTime) <= now);
  readings.sort((a, b) => Date.parse(b.interval.endTime) - Date.parse(a.interval.endTime));
  const limit = Number(readings[0]?.value?.int64Value);
  const points = usage.filter(matches).flatMap(s => s.points || []).filter(p => Date.parse(p.interval?.startTime) >= day.start && Date.parse(p.interval?.endTime) <= now);
  const counts = points.map(p => Number(p.value?.int64Value));
  if (!Number.isSafeInteger(limit) || limit <= 0 || !points.length || counts.some(n => !Number.isSafeInteger(n) || n < 0)) return { status: 'unavailable' };
  // DELTA usage is sparse: an idle account has old activity, not an expired daily total.
  // A fresh limit sample and successful complete query establish the read time.
  const used = counts.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(used)) return {status:'unavailable'};
  return { status: 'available', model: GEMINI_MODEL, used, limit, asOf: new Date(now).toISOString(), resetsAt: new Date(day.reset).toISOString() };
}

export function createQuotaReader({ credentials = () => readFileSync('/etc/secrets/kahuron-quota-reader.json','utf8'), fetchImpl = fetch, now = Date.now } = {}) {
  let token, tokenUntil = 0, cached, cacheUntil = 0, pending;
  const request = async (url, options) => {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const error = new Error('Provider quota unavailable.');
      error.httpStatus = response.status;
      error.stage = url.includes('oauth2.googleapis.com') ? 'authentication' : 'metrics';
      try {
        const details = (await response.json()).error?.details || [];
        const reason = details.find(d => d['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo')?.reason;
        if (['BILLING_DISABLED','SERVICE_DISABLED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','IAM_PERMISSION_DENIED'].includes(reason)) error.reason = reason;
      } catch {}
      throw error;
    }
    return response.json();
  };
  async function read() {
    const raw = credentials();
    if (!raw) return { status: 'not_connected' };
    const key = JSON.parse(raw), time = now();
    if (key.project_id !== 'gen-lang-client-0931115958' || key.client_email !== 'kahuron-quota-reader@gen-lang-client-0931115958.iam.gserviceaccount.com' || typeof key.private_key !== 'string') throw new Error('Quota reader configuration invalid.');
    if (!token || tokenUntil <= time) {
      const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
      const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/monitoring.read', aud: 'https://oauth2.googleapis.com/token', iat: Math.floor(time / 1000), exp: Math.floor(time / 1000) + 3600 })}`;
      const assertion = `${payload}.${sign('RSA-SHA256', Buffer.from(payload), key.private_key).toString('base64url')}`;
      const auth = await request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
      if (!auth.access_token || !Number.isFinite(auth.expires_in)) throw new Error('Quota authentication unavailable.');
      token = auth.access_token; tokenUntil = time + Math.max(0, auth.expires_in - 60) * 1000;
    }
    async function series(kind) {
      const rows = []; let page;
      do {
        const query = new URLSearchParams({ filter: `metric.type="${metric}/${kind}" AND metric.labels.model="${GEMINI_MODEL}" AND metric.labels.limit_name="${daily}"`, 'interval.startTime': new Date(kind === 'usage' ? quotaDay(time).start : time - 600000).toISOString(), 'interval.endTime': new Date(time).toISOString(), pageSize: '10000' });
        if (page) query.set('pageToken', page);
        const result = await request(`https://monitoring.googleapis.com/v3/projects/${key.project_id}/timeSeries?${query}`, { headers: { Authorization: `Bearer ${token}` } });
        rows.push(...(result.timeSeries || [])); page = result.nextPageToken;
      } while (page);
      return rows;
    }
    const [usage, limits] = await Promise.all([series('usage'), series('limit')]);
    return dailyQuota(usage, limits, time);
  }
  return async () => {
    if (cached && cacheUntil > now()) return cached;
    if (!pending) pending = read().catch(error => {
      console.warn('Provider quota read unavailable', { stage: error.stage || 'configuration', httpStatus: error.httpStatus || null, reason: error.reason || (error.code === 'ENOENT' ? 'SECRET_FILE_MISSING' : 'UNAVAILABLE') });
      return { status: 'unavailable' };
    }).then(result => { cached = result; cacheUntil = now() + 60000; return result; }).finally(() => { pending = null; });
    return pending;
  };
}
