# Kahuron: product comparison

Reviewed 24 November 2026. This is a feature comparison and positioning hypothesis,
not a market-share estimate or a model-quality benchmark.

Kahuron's workflow is to capture multiple prompts, deliberately freeze a compilation,
and return one coherent answer. Additional prompts remain available for the next
compilation. Supabase owns accepted prompts and job status; browser storage holds
drafts and delivery intentions that have not reached the database yet.

| Alternative | Documented strength | What Kahuron should focus on |
| --- | --- | --- |
| ChatGPT | Scheduled and event-triggered background tasks, with notifications | A simple batch inbox for collecting context before asking for one answer |
| Claude Code | Messages can be queued during work and delivered during or after a turn | Explicit compilation membership and a task flow accessible without a terminal |
| Gemini | Can import a GitHub repository, answer code questions, and suggest/debug code | Collecting incremental requirements with a visible, recoverable compilation queue |

Sources: [ChatGPT scheduled tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt),
[Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works),
[Gemini GitHub import](https://support.google.com/gemini/answer/16176929).
Availability varies by account, plan, platform and region; these are examples of
capabilities, not a claim that alternatives lack other queueing or batching features.

## Positioning hypothesis

An inbox for unfinished thoughts that turns a chosen batch into one usable answer.

The initial audience to test is solo builders collecting requirements, code fragments
and constraints in quick succession. The benefit to validate is fewer interruptions
and less repeated context, rather than better underlying model intelligence.

Queueing is not unique. Kahuron currently lacks the breadth of established assistants:
no browsing tools, repository integration, file understanding, native mobile apps,
or measured advantage in answer quality. It uses Gemini rather than its own model.
There is no defensible moat yet. Reliability and a particularly clear batching workflow
could become a useful product advantage if users repeatedly choose it.

## Practical limits

- One provider call at a time, paced through a database-owned cooldown.
- Up to 100 prompts / 60,000 characters per compilation and 20 active compilations per owner.
- Gemini quotas still apply; cooldown and bounded retries absorb temporary failures.
- Render Free sleeps after idle time, so jobs resume when the service wakes. No always-on guarantee.
- Resend SMTP is connected for sign-in email from the verified sender domain; Resend quotas still apply.
- Browser-only drafts and unsynced work are not yet durable cloud records. The UI distinguishes syncing from saved online.

Sources: [Gemini quotas](https://aistudio.google.com/docs/rate-limits),
[Render Free limitations](https://render.com/docs/free),
[Supabase default email service](https://supabase.com/docs/guides/auth/auth-smtp).

## What to validate next

Run a small task comparison with intended users: give each person the same set of
fragmented requirements in Kahuron and their usual assistant, varying task order.
Measure accepted requirements covered in the final answer, context re-entry,
time spent actively interacting, failed/lost prompts, and whether they return for
another real task. These are proposed measurements; no results are claimed.
