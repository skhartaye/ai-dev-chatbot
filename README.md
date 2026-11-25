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

## Chat attachments

Attach files, type a question and Send. Chips stay separate from the message.
PDFs (including scans) and PNG/JPG/WebP are sent as binary inputs to Gemini.
DOCX, XLSX, CSV and TXT are converted to text behind the scenes. Embedded Office
images/charts are not included; spreadsheet formulas use saved results.
Legacy DOC/XLS must first be converted to DOCX/XLSX.

Limits: five files per prompt, 10 MB of attachment payloads per conversation,
100,000 characters per converted file and 200,000 text characters per AI request.
The typed question retains its 20,000-character limit. Split larger files or
start another conversation; text is never silently truncated.

Draft bytes are held in IndexedDB. Send atomically saves the prompt and its
file membership, uploads immutable files to private Supabase Storage, then queues
generation. The database blocks compilation until all files exist with the
expected size and MIME type. RLS restricts access to the owner. Stable file IDs
make retries idempotent. Acknowledged browser delivery copies are released.

The server reads files from the current batch and earlier completed batches in
the same conversation, so follow-up questions do not require reattaching.
Current and historical attachments are explicitly labeled for the model. When
new files are attached, ambiguous requests such as "what is this about" refer to
the new files; historical files are background unless explicitly revisited.
Files are transmitted to Google for AI processing when a message is sent.
Guest access stays tied to the browser identity; clearing browser data loses it.

Run npm test for automated checks. tests/check-attachments.mjs is an explicit live
integration check for ownership, immutability, readiness and retry behavior. It
creates isolated guest test records and a small AI job, and never runs in deploy
builds. Samples live in tests/fixtures. For a local CSP-matched preview:
npm run build, then node tests/preview-server.mjs (http://127.0.0.1:4173).
Run node tests/check-file-scope.mjs for an isolated live regression that attaches
an old invoice, then a new supplier catalog, and verifies that an ambiguous new
question focuses on the catalog while follow-ups still work. An optional commit
prefix argument waits for that backend revision before testing.

## Editing Office attachments

Ask the AI to change text in an attached DOCX or literal values in an XLSX.
The answer offers Review edits, validates exact match counts against the original,
shows before/after changes, then provides a separate -edited download. Originals
and messages are immutable. A downloaded edit is not automatically AI context;
attach it to ask follow-up questions about that version.

Original Office bytes for new uploads are retained in IndexedDB on the upload
device, separately from the bounded extracted-text payload in private Storage.
For older attachments, cleared browser data, or another device, Choose original
file checks that its extracted text matches the saved attachment before editing.
Original bytes and edited copies are not uploaded by the review/download flow.

Supported: Word paragraph text replacements plus bold, italic, underline, font,
size, text color, shading and paragraph alignment. Formatting affects the selected
text only; surrounding runs and unrequested properties stay intact. Excel supports
cell values, explicit cell formulas, font/fill/alignment/wrapping, and number formats.
Format-only ranges are limited to 1,000 cells. Plans contain expected source values
or exact match counts; mismatches block download. Review shows formatting settings,
formulas and verified results. This is a change preview, not a full Office layout preview.

Excel formulas and dependencies recalculate with self-hosted IronCalc 0.9.1 in a
terminable browser worker (15-second deadline). Typed cached results are written
without rebuilding workbook styles/charts. Errors and unsupported formulas block
the download. Limits: 50 sheets, 20,000 populated cells, 2,000 formulas. External links,
web/DDE/random functions, shared/array/spill/table formulas, ISO date cells and the
1904 date system are unsupported. Ordinary scalar arithmetic, SUM/AVERAGE/IF and
cross-sheet references are tested. Compatibility is not identical to Microsoft Excel.
The CSP permits self-hosted WebAssembly through wasm-unsafe-eval; JavaScript eval
and inline scripts remain blocked. IronCalc MIT and bundled third-party notices ship
with the self-hosted assets. No paid formula service or extra upload is used.

New Excel attachments include a cell/formula map in their AI text payload. For older
attachments, re-upload to supply coordinates before requesting formula edits. The
original-file chooser still accepts older extracted-text payloads. Structural edits,
protected/signed files, active embedded content and Word fields/tracked changes
remain unsupported. PDF/image editing is described below. AI output is validated
data, never JavaScript. ZIP expansion limits apply before decompression.


## Reviewing PDF and image edits

PDF and still-image attachments use the same structured edit response, original
file IDs, and Review edits/download workflow as Office documents. Original bytes
come from the existing IndexedDB buffer or owner-only private Storage; no duplicate
original or new upload is needed. The original is immutable. Review displays real
original/edited images or independently navigable PDF pages. Download stays hidden
until both previews load. Closing/switching chats cancels work and releases previews.

PDF: add Latin text annotations/watermarks and translucent highlights, rotate
pages, or keep/reorder a selected list of original page numbers. Supports scanned
PDFs too. Exact text rewriting changes searchable text objects within their original bounds
using the original font (no paragraph reflow or OCR rewriting). Standard AcroForm
text, checkbox, dropdown, list and radio fields can be filled using real field
names, existing values and allowed options derived from the uploaded PDF. Fields
remain editable. Read-only/password fields and XFA, signed/encrypted or active
PDFs are rejected; annotations require an upright original page. At most
50 pages and 20 operations. Page selection/annotations are not secure removal of
sensitive source data. Rewriting is not secure redaction. Other PDF operations preserve original content unless pages
are explicitly excluded from the output page tree.

Images: crop, resize, rotate, flip, brightness/contrast/saturation/grayscale, text,
rectangles and ellipses. Edits are applied sequentially to pixels and exported as
PNG, preserving transparency but discarding original photo metadata. No generative
editing, inpainting, object/background removal or selective recoloring. Animated
images are rejected. Limits: 16 megapixels, 8192 pixels per side, 20 operations.

Both input/output remain limited to 10 MB. Heavy edits run in a cancellable worker
with a 30-second deadline. Browsers without worker canvas APIs use the same canvas
renderer on the main thread. Assets/libraries are self-hosted and editing adds no
paid provider. Core tests inspect actual image pixels, PDF text and page structure;
the review integration test verifies preview gating and cleanup.


### Scanned PDF text rewriting

Ask to replace exact printed words in a scanned PDF. Review edits runs self-hosted,
on-device English Tesseract OCR, checks confidence (85+), exact occurrence counts,
background and nearby words, then replaces those pixels and adds selectable black
text in the closest measured standard PDF font. The browser compares source-letter
shapes against 12 serif/sans/monospace regular, bold and italic candidates using
the same PDF renderer as the review. It estimates size and baseline from the scan;
the review labels the approximate match. Long replacements are rejected instead
of shrinking more than 15%. Originals stay untouched; download appears after both previews
render. Closing the review cancels processing; a two-minute deadline prevents
unbounded OCR work. Up to 10 phrases on 3 pages, 50-page/10 MB source/output caps,
rendering bounded to 4 megapixels per page. OCR assets load only for this operation.

Clear horizontal black print on white is supported. Handwriting, uncertain matches,
coloured/busy backgrounds, annotations/links on edited pages, forms, signed/active
or encrypted PDFs are rejected. Edited pages are rasterized at up to 200 DPI;
existing text layers/interactivity on those pages are discarded. Other pages are
preserved. Exact custom-font matching, paragraph reflow and secure redaction are not supported.
No extra OCR API, account or provider charge is introduced.


## Interface design

Use [DESIGN.md](DESIGN.md) before changing UI. Semantic tokens live in
`public/styles.css`; attachments and review components reuse those tokens.


## Automatic conversation titles

The answer response includes a short semantic topic title (normally 3–7 words,
max 60 characters). The worker saves it to `conversations.title` in the same
transaction as a valid answer completion. No extra provider call is needed.
New chats use a neutral placeholder until completion; legacy chats update on their
next completed answer. Invalid labels never get clipped or block a valid answer.
Apply `202611250006_conversation_titles.sql` before deploying this worker; the
five-argument completion RPC remains available for rolling deployments.


Manual renaming uses `rename_conversation` and sets `title_is_manual`; apply
`202611250007_manual_titles.sql` first. Later automatic titles respect that choice.
Enter/Send queues each request separately while the AI is busy. The Queue view
shows current/waiting/recent requests; the old batch-combine workflow is removed
from the normal UI. Legacy unassigned prompts retain a recovery send action.

### Regenerate

Apply migration `202611250008_regenerate.sql` and deploy the updated worker before exposing the new frontend. Regenerate retains every answer and references immutable original input via `compilations.regeneration_of`; client writes use the ownership-checked, idempotent `regenerate_answer` RPC.

### Editing sent prompts

Apply `202611250009_edit_prompts.sql` and deploy the updated worker before releasing the frontend. `revise_prompt` atomically saves the revised question and queues its answer with ownership, size, replay and queue-limit validation. `prompts.revision_of` references the original question; its files and context boundary are reused without copying attachment records or storage objects.

## Landing page and email access

Netlify rewrites `/` to `welcome.html` and `/chat` to `index.html`. Old `/?conversation=…` bookmarks and pre-landing email callbacks are forwarded to `/chat` with their query/hash intact. The local preview server mirrors these routes.

Supabase Site URL and the exact allowed callback are `https://kahuron.netlify.app/chat`. Manual identity linking is enabled with owner approval, and Confirm email remains enabled. Guest email upgrades use `updateUser({email})` to retain ownership; ordinary email access uses `signInWithOtp`. Both return to `/chat`. Open PKCE links in the requesting browser. Existing-account sign-in does not merge guest conversations.

## Authentication emails and verification

Email templates live in `supabase/templates/`. Edit `build.mjs` and run `node supabase/templates/build.mjs` to regenerate the three HTML templates. They use inline, table-based email layout, a code, and an application-owned token-hash link. Apply the generated HTML and subjects to the matching Supabase Auth templates after deploying the app callback handler. Preview with `node tests/email-preview.mjs` on port 4175.

New links verify with `verifyOtp({token_hash,type})`, then establish the returned authenticated session. Token hashes are removed from browser history before any asynchronous work. Existing PKCE links remain supported by the SDK, but users can now paste the emailed code as an alternative. Email-code challenges store only the address, verification type and request time in session storage; codes and tokens are never stored or logged. Account switches discard late requests from the previous auth generation.

## Settings and recorded usage

Settings displays the verified account email, guest-to-email saving or local sign-out, data handling, and the last 30 days of recorded request and token usage. Usage is derived from owner-scoped `compilations` rows through existing RLS and is paginated; no counters or separate usage table are written. Only stored successful provider reports are counted. Missing reports and unrecorded failed-attempt usage are disclosed; no remaining quota or cost is invented.

### Daily provider quota

The authenticated POST `/quota` endpoint reads the confirmed Gemini project's free-tier daily request usage and limit from Google Cloud Monitoring. Settings shows requests left, percent remaining and the Pacific-midnight reset, separately from per-account 30-day token activity. A dedicated `kahuron-quota-reader` service account has Monitoring Viewer only. Configure its JSON as Render secret file `kahuron-quota-reader.json`; do not commit it or expose it through browser code. No billing or paid plan was enabled for this setup. Provider reports can lag; RPM and TPM limits remain independent. Missing/stale data shows unavailable.
