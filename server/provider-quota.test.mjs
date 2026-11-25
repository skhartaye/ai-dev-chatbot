import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { quotaDay, dailyQuota, createQuotaReader } from './provider-quota.mjs';
const name = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
const model = 'gemini-3.5-flash-lite';
const now = Date.parse('2026-11-25T06:46:00Z');
const point = (value, start = '2026-11-25T06:44:00Z', end = '2026-11-25T06:45:00Z') => ({ value: { int64Value: String(value) }, interval: { startTime: start, endTime: end } });
const series = points => [{ metric: { labels: { model, limit_name: name } }, points }];

test('daily quota uses provider counts and a current real limit, never account totals or absent reports', () => {
  const result = dailyQuota(series([point(3), point(2)]), series([point(500)]), now);
  assert.equal(result.used, 5); assert.equal(result.limit, 500);
  assert.equal(result.resetsAt, '2026-11-25T08:00:00.000Z');
  assert.equal(dailyQuota([], series([point(500)]), now).status, 'unavailable');
  assert.equal(dailyQuota(series([point(3)]), [], now).status, 'unavailable');
  assert.equal(dailyQuota(series([point(3, '2026-11-25T05:00:00Z', '2026-11-25T05:01:00Z')]), series([point(500)]), now).status, 'available');
  assert.equal(dailyQuota(series([point(3)]), series([point(500, '2026-11-25T05:00:00Z', '2026-11-25T05:01:00Z')]), now).status, 'unavailable');
  const previousDay = point(80, '2026-11-24T07:58:00Z', '2026-11-24T07:59:00Z');
  assert.equal(dailyQuota(series([point(3), previousDay]), series([point(500)]), now).used, 3);
  assert.equal(dailyQuota(series([point(-1)]), series([point(500)]), now).status, 'unavailable');
});

test('quota reset uses Pacific midnight through 23-hour and 25-hour DST days', () => {
  for (const [date, hours] of [['2026-03-08T20:00:00Z', 23], ['2026-11-01T20:00:00Z', 25], ['2026-11-25T06:00:00Z', 24]]) {
    const day = quotaDay(Date.parse(date)); assert.equal((day.reset - day.start) / 3600000, hours);
  }
});

test('quota reader uses monitoring-read OAuth, pages complete data, and shares cached refreshes', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const credentials = () => JSON.stringify({ project_id: 'gen-lang-client-0931115958', client_email: 'kahuron-quota-reader@gen-lang-client-0931115958.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const calls = [];
  const reader = createQuotaReader({ credentials, now: () => now, fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.includes('oauth2')) {
      const jwt = new URLSearchParams(options.body).get('assertion');
      const body = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
      assert.equal(body.scope, 'https://www.googleapis.com/auth/monitoring.read');
      return Response.json({ access_token: 'test-token', expires_in: 3600 });
    }
    const query = new URL(url).searchParams;
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.match(query.get('filter'), /GenerateRequestsPerDayPerProjectPerModel-FreeTier/);
    if (query.get('filter').includes('/limit')) return Response.json({ timeSeries: series([point(500)]) });
    return Response.json(query.has('pageToken') ? { timeSeries: series([point(2)]) } : { timeSeries: series([point(3)]), nextPageToken: 'next' });
  } });
  const results = await Promise.all([reader(), reader()]);
  assert.equal(results[0].used, 5); assert.deepEqual(results[0], results[1]);
  assert.equal(calls.length, 4); await reader(); assert.equal(calls.length, 4);
  assert.deepEqual(await createQuotaReader({ credentials: () => undefined })(), { status: 'not_connected' });
  const failed = createQuotaReader({ credentials, now: () => now, fetchImpl: async () => new Response('sensitive provider error', { status: 403 }) });
  assert.deepEqual(await failed(), { status: 'unavailable' });
  let billingCalls = 0;
  const billingReader = createQuotaReader({ credentials, now: () => now, fetchImpl: async url => {
    billingCalls++;
    return url.includes('oauth2') ? Response.json({ access_token: 'test', expires_in: 3600 }) : Response.json({ error: { message: 'This API method requires billing to be enabled.' } }, { status: 403 });
  } });
  assert.deepEqual(await billingReader(), {status:'unavailable',reason:'BILLING_REQUIRED'});
  const callsAfterBlock = billingCalls;
  await billingReader();
  assert.equal(billingCalls, callsAfterBlock, 'billing-gated reads must not keep retrying');
});
