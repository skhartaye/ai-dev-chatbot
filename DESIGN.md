# Kahuron design system

This is the design reference for the whole application. Use it before changing a
screen or component. The implemented token values in `public/styles.css :root`
are the source of truth; this document explains their roles and the workflow.
Do not create competing theme files or per-feature palettes.

## Product and primary workflow

Kahuron is a conversation workspace for asking questions, collecting prompts and
working with attached files. The user types or attaches material, sends it, reads
the answer, reviews proposed edits, then downloads a separate edited copy.
The conversation and composer are primary. History and files support that task.
Queue details remain behind Queue. Do not turn the chat into a dashboard.

## Visual direction

A green navigation area beside an edge-to-edge, warm-white conversation workspace. Depth comes from
separating surfaces, deliberate borders, restrained shadows and unequal emphasis.
Keep the interface light without washing out controls. Avoid charcoal/grey themes,
oversaturated gradients, glass effects, extruded controls and decorative motion.
Keep the existing Kahuron wordmark and self-hosted Manrope font.

| Token | Current value | Role |
| --- | --- | --- |
| `--canvas` | `#e5eee7` | Outer workspace |
| `--workspace` | `#f4f6f0` | Conversation reading area |
| `--surface` | `#fffdf7` | Supporting paper surfaces |
| `--surface-raised` | `#ffffff` | Composer, file cards, dialog chrome |
| `--surface-soft` | `#edf2e9` | Preview wells and grouped information |
| `--sidebar` | `#cdded3` | Navigation backdrop |
| `--ink` | `#203b31` | Main text |
| `--muted` | `#52675a` | Readable secondary text |
| `--accent` | `#21644e` | Primary action and links |
| `--accent-hover` | `#174d3b` | Primary hover |
| `--accent-soft` | `#dcebdd` | User messages and selected states |
| `--line` | `#b6c8ba` | Quiet divisions |
| `--line-strong` | `#7c9c88` | Control edges and selection |
| `--scrollbar-thumb` | `#668372` | Visible native scrollbar thumb |

Status colours and file-type accents may differ when they communicate meaning.
Use text as well as colour. New general-purpose colours belong in semantic tokens,
not scattered hex values. Do not use subtle separator tokens as focus indicators.

## Hierarchy, typography and spacing

- One focal action per task: Send in chat, Review edits on a proposal, Download
  edited copy in a prepared review. Secondary actions use quieter surfaces.
- Manrope body 16px; normal text line height 1.7–1.85. Metadata 12px minimum.
  Keep headings compact and use weight/spacing rather than a second display font.
- Spacing follows 4/8/12/16/24/32px increments. Main reading column is at most
  880px, with 32px desktop and 16px mobile content padding.
- Controls use `--radius-control` (12px), cards `--radius-card` (18px), panels
  `--radius-panel` (24px). Message tails and pill buttons are purposeful exceptions.
- `--shadow-card` separates small cards, `--shadow-raised` lifts the composer and
  floating controls, `--shadow-dialog` is reserved for modal overlays.
  Do not give every text block a border, shadow or card.

## Component rules

- App shell: full-width with no outer gaps or rounded frame. The header and
  conversation share one continuous workspace. Keep depth on task surfaces.
- Sidebar: quiet navigation, a raised active conversation, reachable New
  conversation button. Search and history share the same existing state.
- Conversation: user messages use green-tinted bubbles. Answers are open reading
  content with an accent heading. Code and wide tables may scroll horizontally;
  prose wraps. Never place a vertical scroller inside an answer.
- Composer: white raised surface, always reachable outside the chat scroller.
  Preserve the accessible label, 16px input, Enter/Shift+Enter behavior and the
  attachment limits/provider disclosure. Pending attachments use one compact
  horizontal row so five files do not consume the entire screen.
- Files: file-type visual and colour, readable name/status, 44px remove targets.
  The desktop panel and mobile sheet share the same source data and components.
- Reviews: a native modal dialog, fixed header and footer, one scrolling changes
  body. Download stays unavailable until validation and both previews finish.
  Originals remain unchanged; cancellation releases workers and previews.

## Scrolling and responsive behavior

- The welcome content fits the available reading height before a scrollbar is
  needed; reduce its spacing on short viewports instead of hiding scrollbars.
- The application fits `--app-height`/`100dvh`; mobile browser and keyboard height
  are respected. Main header and composer occupy separate grid rows.
- Chat, history, files and modal bodies scroll independently. Use `minmax(0,1fr)`
  and `min-block-size:0` through the layout chain. Solve overflow at its source;
  `overflow:clip` is only for intentional rounded-panel boundaries.
- Native scrollbars stay visible, thin and themed. Retain native sizing in high
  contrast/forced-colour modes; use guarded WebKit fallbacks where needed.
- Preserve the visible message and offset during sync. Follow updates only while
  the user is at the end. Show Latest messages when they scroll away. Sending a
  prompt intentionally returns to the latest message. Never use page-level
  `scrollIntoView()` to move a message inside the app shell.
- Reserve scrollbar space to avoid sideways shifts. Use `overflow:auto`, not
  forced scrollbars. Do not intercept wheel/touch events or implement scroll-jacking.
- At 860px and below the history becomes the existing drawer and the workspace stays edge-to-edge. At 600px comparisons stack in task order. Mobile uses the
  full viewport, safe-area padding and the same visual hierarchy.

## Motion, accessibility and states

- Keep existing short transform/opacity feedback and reduced-motion behavior.
  No automatic scroll animations are required for reading-position restoration.
- Interactive targets are at least 44px; all actions are keyboard reachable and
  have visible focus. Icon-only actions require an accessible name.
- Normal text needs 4.5:1 contrast; meaningful control/focus edges and scroll
  thumbs need 3:1. Never rely on colour alone or remove browser zoom.
- Preserve loading/status announcements, specific recoverable errors, empty
  states, source ownership checks and the durable prompt queue.
- Omit repeated subtitles/helper copy. Retain prerequisites and consequences at
  the control where the user needs them. Use sentence case and concrete verbs.

## Before shipping a design change

Check empty and populated conversations, a long answer, code/table overflow,
multiple attachments, the file panel, Queue, and a completed edit review.
Verify desktop, 390px mobile, short viewport/keyboard, keyboard focus, reduced
motion and contrast preferences. Confirm no outer-page overflow, composer remains
reachable, syncing does not move a reader's position, and review header/footer
stay reachable while the body scrolls. Save representative screenshots.


### Keyboard-visible layout

The main workspace is a size query container. Compact styles respond to its actual
height below 560px, including when only the Visual Viewport shrinks. Do not rely
on viewport-height media queries alone for mobile keyboards. Keep the 48px input,
44px Send action, attachment disclosure and safe-area padding. While typing in a
compact workspace, visually hide the conversation heading and collapse pending
file cards so the chat still has room. Keep the composer outside the chat scroller.
Desktop responsive emulation checks geometry but does not prove real iOS/Android
keyboard behavior; distinguish those checks from physical-device validation.

At 400px available height or less while typing, hide the pending-file strip;
files remain available through the header's Files count/button. Restore the strip
when space returns. Do not let its min-content width widen the conversation grid:
use an explicit `minmax(0,1fr)` column and zero minimum width on composer wrappers.


### Conversation list rows

Use a small decorative conversation icon, a two-line title and a quiet creation
date from `createdAt`. Keep the whole saved title in the DOM and accessible name.
Show the complete title on hover/keyboard focus; tapping opens its full heading.
Do not shorten the saved title as a styling fix. The current row uses a paper
surface and green leading edge. Preserve history scroll position and link focus
when sync rerenders the list. Keep scrollbar padding outside each row.


### Automatic title rules

Titles summarize the user's main goal as a complete topic phrase, usually 3–7
words and at most 60 characters. They are generated with the answer, not by
clipping the first message. Follow-ups such as "yes, do it" inherit the established
topic. Prefer the user's language; avoid greetings, generic labels, personal
identifiers and reference numbers. Invalid titles are skipped rather than sliced.
`conversations.title` remains the source of truth. The server saves a valid title
atomically with a leased completion; no additional title API call is made.
New chats retain "New conversation" until their first completed answer. Older
chats acquire semantic titles on their next completed answer; do not spend extra
provider calls to rename inactive history automatically.


### Manual names and sequential messages

Rename is in the saved conversation header. Its native dialog has a labelled
120-character field, Cancel and Save title, inline errors and a pending state.
Save only after the ownership-scoped RPC succeeds; connection failures leave the
existing name intact. `conversations.title_is_manual` records the user's choice;
automatic completion must never overwrite a manual name. No client-only flag
may decide whether the server can rename a conversation.

Each Enter or Send creates a distinct durable request immediately, including
while an earlier answer is running. Queue displays waiting requests in FIFO
order after the current answer. It never requires a separate compile action.
Preserve Shift+Enter and IME-confirmation handling. A recovery-only Send saved
messages action may appear for legacy unsent drafts. Do not expose batching or
compilation terminology in the ordinary chat flow.


### Answer actions

Place Copy and Save .txt below each completed answer. Keep 44px touch targets,
text labels, contextual accessible names, and visible/live success and failure
feedback. Code blocks get a separate Copy code action in their header. Copy only
rendered answer content or literal code; never include file-edit instructions,
review controls or hidden metadata. Use Async Clipboard with guarded invoker
commands/fallback; clipboard denial must show a recoverable error.

Competitor references: ChatGPT's code blocks keep reusable code separate and
copyable (https://help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt).
Gemini documents code copy/export and response refinement
(https://support.google.com/gemini/answer/13275745?hl=en,
https://support.google.com/gemini/answer/14262426?hl=en).
Claude documents response feedback
(https://support.claude.com/en/articles/8525154-claude-is-providing-incorrect-or-misleading-responses-what-s-going-on).
Do not add feedback votes without a real destination or public sharing controls
that bypass conversation ownership. Answer exports stay local and need no AI call.

## Regenerating an answer

Each completed cloud answer offers Regenerate beside Copy and Save .txt. It queues a new attempt against the original request's prompts, files, and earlier context; it never overwrites an existing answer or duplicates a file. Regenerated answers are labelled with their source answer. One regeneration per original request can be active at a time, with the same queue pacing, ownership checks, retries, and quota limits as ordinary messages. Pending delivery survives reload through the existing outbox.

## Editing sent prompts

Show Edit on saved sent prompts. Open a labelled native dialog with the full existing question. Cancel leaves both the sent prompt and unsent composer draft alone. Save & Send appends an edited question and a separate queued answer; it never mutates old questions or answers. Keep the same files by reference, preserve the context boundary of the original question, and label edited questions. Revisions use the existing durable outbox, so reloads and interrupted deliveries do not duplicate or lose edits.

## Landing and email entry

The home route `/` serves `welcome.html`; `/chat` serves the existing workspace. Keep old root conversation bookmarks and email callbacks working through the landing router. Landing content uses the existing Manrope face, green semantic tokens, paper surfaces and restrained shadows; examples are explicitly fictional and do not call AI. Keep Start chatting primary, with email sign-in optional. Use native links, pressed-state sample buttons, and reduced-motion-aware entrance animation.

The header shows Files without a Cloud workspace badge. Guests can Save with email, using the existing user identity rather than creating a separate workspace. Existing-account sign-in warns guest users that chats are not automatically merged. Same-ID auth updates refresh the account controls without resetting the outbox or conversation. Sign-out waits for pending delivery.

## Account settings and authentication

Settings is the single entry for account status, email saving, sign-out and recorded usage. Show the verified email in the sidebar so users can identify the active account. Usage uses one dominant total plus supporting request/input/answer counts, with last-30-days scope and report coverage. Do not present a guessed remaining allowance. Loading, no-data and retry states stay in the Usage section.

Email entry progresses from a labelled email field to one paste-friendly, numeric verification-code field. Keep a resend cooldown and a change-email action. Email templates reuse the green/paper palette with inline CSS and a readable code; they avoid external fonts/assets and retain a direct sign-in link. A verified session, not a successful email send or redirect alone, determines login success.

## Settings refinement

Use Account, General, and Usage tabs inside the native dialog. Keep labels concise and show concise privacy/reporting context directly in the relevant section. Selected tabs have an underline and keyboard navigation; initially inactive panels are hidden. General preferences apply to this browser and persist independently of account identity. Large text changes chat content; Reduced motion disables nonessential animation while Follow device preserves the operating-system preference.

Provider quota is unavailable until verified project usage, limits, model and measurement window are connected. Never turn 30-day account token totals into a provider percentage. Keep real account usage separate from project quota.

## Account export and AI instructions

Settings adds AI instructions and Data tabs. Instructions use a labelled native multiline form with a 4,000-character limit, explicit Save, count, inline validation and saved/error feedback. Blank saves clear preferences. Scope copy explains that the account setting applies when each AI request starts; editing it cannot alter an answer already running. Supabase user metadata owns this non-security preference. The worker resolves the conversation owner and reads preferences server-side for each generation attempt, including edited and regenerated turns. Current messages and file-edit safeguards take priority.

Data offers one Export account action and an in-progress Cancel action. Export paginates every owned conversation, prompt, answer, attachment and queue event under RLS plus explicit owner filters, rather than using the sidebar's 100-chat limit. A ZIP contains account.json, available cloud attachment payloads and local Office originals, and a README explaining scope. Account.json includes account instructions and this browser's drafts/outbox; it excludes sessions, credentials and worker lease tokens. Missing Office originals are explicitly listed; failed database/storage reads stop export. Account switches and cancellation prevent download. The archive is a read-only point-in-time collection, not a restore format or transactional backup; rows created after export begins are excluded.

Settings never uses accordion arrows or collapsed explanatory sections. Put privacy information under Data, export limitations beside the export action, and reporting caveats directly under Usage. Use sequential headings and ordinary text, not hidden disclosure triggers.
