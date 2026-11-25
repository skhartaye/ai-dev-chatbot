# AI Dev Chatbot

## AI provider

The server uses `gemini-3.5-flash-lite` through the Gemini Developer API.
Only HTTP 503 availability failures use one `gemini-3.1-flash-lite` backup call.
Both model IDs have a Free tier. Quota, safety, and validation failures do not switch models.
There are no paid tools configured; the actual successful model is saved with each answer.

Set `GEMINI_API_KEY` in the Render server/worker environment, using a Google
project that remains on the Free tier. Never commit the key or place it in
frontend build variables. The same model can be billed on a paid Google project;
the model name alone does not guarantee free usage.

`server/gemini.mjs` accepts ordered prompts and returns one complete answer with
provider token usage. It rejects truncated or blocked answers and exposes
retryable HTTP failures for the persistent queue worker to reschedule.
The low-level provider makes one request per invocation. A worker attempt permits
45 seconds for the primary call and up to 120 seconds for the availability backup,
remaining within the database's four-minute lease including database operations.

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
The Netlify frontend supports local exploration and a signed-in cloud workspace.
Email magic links use Supabase Auth with PKCE; SDK code is bundled locally with esbuild.
Supabase Auth now uses Resend SMTP from `Kahuron <kahuron@skhart.world>`.
The dedicated sending-only key is restricted to the verified `skhart.world` domain
and stored only in Supabase's encrypted SMTP settings. Resend confirmed delivery
of the owner confirmation email; the confirmation link opened the cloud workspace.
Provider email quotas still apply. No DNS changes or paid plan upgrades were needed.

Signed-in saves first enter an owner-scoped browser outbox with stable request IDs.
The outbox delivers writes in order and remains available after reload/offline periods.
Once acknowledged, prompts and job status are read from Supabase, the source of truth.
The browser keeps drafts and unacknowledged delivery intentions, not a second cloud database.
Local preview history remains separate and is never uploaded automatically.

Compiling freezes the selected prompt IDs, up to 100 prompts / 60,000 characters.
Up to 20 active compilations per user are allowed. Additional prompts go into the next batch.
A Render worker claims one job globally with a four-minute lease, six-second start pacing,
and bounded exponential backoff for temporary failures (eight attempts before manual retry).
Transient-service retries use 5–60 seconds with jitter; quota retries use 60–3600
seconds and always honor a longer provider Retry-After (up to 24 hours).
Expired leases recover on restart; lease tokens prevent stale workers overwriting results.
Prior completed answers provide conversation context, capped at 200,000 input characters;
this is an application bound, not a promise about provider token limits. Partial answers are rejected.

Both migrations have been applied to the dedicated project. `supabase/tests/queue.sql`
passed with fixtures rolled back: fixed membership, restricted claiming, single claim,
lease recovery, stale lease denial, quota cooldown, completion, and audit history.
Migrations were applied through the dashboard; reconcile the CLI ledger before CLI migrations.
The existing `multiprint` database must not be used.

Render server variables: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
The server credential never belongs in frontend variables. The frontend publishable key is
public by design and all data access is protected by RLS and ownership-checked RPC functions.
Render builds with `npm ci && npm test`, starts with `npm start`; Netlify builds with `npm run build`.
`POST /wake` requires a valid Supabase session and the configured application origin.
Render Free sleeps when idle; it does not guarantee unattended, always-on processing.
Queued records survive sleep and resume when the app wakes the service. Gemini Free quotas still apply.

A live database-to-Render-to-Gemini smoke test completed on the first attempt:
"Kahuron queue connected." The stored model was gemini-3.5-flash-lite and usage
was 32 total tokens. A clearly named AI connection test conversation is retained
in the owner workspace. The owner email sign-in link was sent successfully.
The Resend confirmation link successfully opened the signed-in cloud workspace.
Browser testing saved two prompts, queued their compilation, then saved and queued
a third prompt separately while the first compilation was generating. A short
browser-submitted compilation completed with "Browser queue verified." Larger batches
encountered temporary provider failures and remained in the durable retry queue.
Render build filters include `server/**`, `tests/**`, and `package*.json`, so UI-only
changes do not restart the worker.
See [market comparison](docs/market-positioning.md) for sourced positioning and limitations.

## Verification

Run `npm test` (eleven checks) and `npm run build`. Provider tests use mocked requests and incur no API usage.
Answer formatting uses Marked and the native Sanitizer API where supported. DOMPurify
is code-split and loaded only as a fallback. The DOM test verifies Markdown structure,
unsafe element/attribute removal, unsafe link removal, and safe external link attributes.
The browser fixture in `tests/browser-answer.mjs` can exercise both sanitizer paths.
Its Chrome check and the latest formatting visual review were blocked by the missing
Chrome extension connection; the DOM fallback test and production bundle passed.

A normal four-bullet question completed in the live browser on Gemini 3.5 Flash-Lite
on its first attempt (772 characters). Larger batches still encountered provider HTTP
503 responses. The availability backup is covered by unit tests; its successful live
recovery of that larger batch has not been verified.

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

## File text extraction

Attach up to five files, review the extracted text in the draft, then press Send.
PDF, DOCX, XLSX, CSV, TXT, PNG, JPG and WebP are supported. Legacy DOC/XLS files
must first be saved as DOCX/XLSX. Files are processed in the browser; only the
reviewed prompt text is sent through the existing private conversation queue.
Parsers, OCR workers, fonts and English OCR data are served from this site.

Limits: 10 MB per file, 30 pages per PDF, at most 10 PDF pages requiring OCR,
30 megapixels per image, two minutes per extraction and 20,000 characters per
combined draft. Oversized text is rejected rather than silently truncated.
OCR targets printed English; review recognition errors. Word/Excel extraction
reads document text and worksheet values, not embedded pictures or charts.
Spreadsheet formulas use stored results; the browser does not recalculate them.
Cancellation retains previously extracted files and the existing draft.

Browser checks covered DOCX body/table text, two XLSX sheets, a two-page text
PDF, a PNG invoice, an image-only PDF, cancellation, draft reload persistence,
and the 390-pixel mobile layout under the deployed Content Security Policy.
The source samples are in tests/fixtures. Run npm test for validation and
size-limit checks. For a local CSP-matched preview: npm run build, then
node tests/preview-server.mjs (http://127.0.0.1:4173).
