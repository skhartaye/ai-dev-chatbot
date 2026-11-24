# AI Dev Chatbot

## AI provider

The server uses `gemini-3.5-flash-lite` through the Gemini Developer API.
There are no fallback models or paid tools configured.

Set `GEMINI_API_KEY` in the Render server/worker environment, using a Google
project that remains on the Free tier. Never commit the key or place it in
frontend build variables. The same model can be billed on a paid Google project;
the model name alone does not guarantee free usage.

`server/gemini.mjs` accepts ordered prompts and returns one complete answer with
provider token usage. It rejects truncated or blocked answers and exposes
retryable HTTP failures for a future persistent worker to reschedule.
It makes one request per invocation, with a two-minute deadline.

## Current status

Provider code, Netlify headers, and a Node backend with a public `/health` endpoint
are present. Run `npm start` to start the backend and `npm test` for provider tests.
The dedicated Supabase project is `vkpvgpbdnlnngwzttciy`.
The foundation migration has been applied there: owner-scoped conversations,
immutable client prompts, queued compilations, and status audit history.
`supabase/tests/foundation.sql` passed against the live database with fixtures
rolled back, checking isolation, permissions, retry idempotency, and batch boundaries.
The SQL was applied through the dashboard; it has not been registered in the
Supabase CLI migration ledger. Reconcile the ledger before using CLI migrations.
Authentication UI, chat API, queue worker, and frontend are not built yet.
The existing `multiprint` database must not be used.
Render's Free web service sleeps when idle and is not an always-on queue worker.

## Verification

Run `node --test server/gemini.test.mjs`. Tests use mocked requests and incur no API usage.
