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

Provider code and Netlify headers are present. Authentication, database migrations,
the persistent queue, API, worker, frontend, and Render deployment are not built yet.
No live model call has been verified. The existing `multiprint` database must not be used.

## Verification

Run `node --test server/gemini.test.mjs`. Tests use mocked requests and incur no API usage.
