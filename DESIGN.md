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
Queue details remain behind Batch. Do not turn the chat into a dashboard.

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
multiple attachments, the file panel, Batch, and a completed edit review.
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
