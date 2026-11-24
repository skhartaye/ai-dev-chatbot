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
The Netlify frontend in `public/` is a local-only interface preview. It supports
conversations, drafts, saved prompts, compilation grouping, JSON export, and
workflow-state examples. Its sign-in form does not send email. Preview data stays
in browser storage and is not sent to Supabase or Gemini.
Live authentication, chat API, and the processing worker are not connected yet.
The existing `multiprint` database must not be used.
Render's Free web service sleeps when idle and is not an always-on queue worker.

## Verification

Run `node --test server/gemini.test.mjs`. Tests use mocked requests and incur no API usage.

Interface checks in Chrome covered prompt saving, reload persistence, fixed
compilation boundaries, empty-state validation, modal Escape/focus restoration,
and layouts at 320, 390, 768, 1024 pixels and the normal desktop viewport.

The interface uses a centered chat, a docked composer, on-demand compilation, and self-hosted
Manrope Variable (Fontsource package version 5.3.0). The font license is retained
in `public/fonts/OFL.txt`; loading the interface makes no external font requests.

Motion uses native CSS transitions and Web Animations for newly saved prompt and
compilation cards. Existing cards do not replay animations. Keyboard actions and
reduced-motion preferences skip spatial motion. Supporting browsers animate native
dialog entry/exit; other browsers retain immediate native open/close behavior.
`npm test` includes the motion accessibility guard. Chrome checks covered normal
and emulated reduced-motion dialog states, Escape focus recovery, and repeated
open/close. Physical touch-device testing and slowed DevTools playback were not
performed (the browser connection did not support Animation-domain commands).

Mobile navigation uses a native dialog drawer with the same conversation list as
desktop. Compilation opens as a bottom sheet on mobile and a side sheet on desktop.
Chrome checks confirmed no horizontal overflow at 320, 390, 768, and 1440 pixels,
visible save controls at a simulated 390x360 keyboard viewport, and draft persistence
when switching conversations. A physical mobile keyboard has not been tested.
