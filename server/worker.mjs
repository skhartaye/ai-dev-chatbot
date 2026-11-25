import { generateAvailableAnswer } from "./gemini.mjs";
import { loadAttachments } from "./attachments.mjs";

export function retryPlan(
  error,
  attempts,
  now = Date.now(),
  random = Math.random,
) {
  const retryable =
    error.retryable ||
    ["TypeError", "TimeoutError", "AbortError"].includes(error.name);
  const code =
    error.status === 429
      ? "rate_limit"
      : retryable
        ? "provider_unavailable"
        : ["context_limit", "output_limit"].includes(error.code)
          ? error.code
          : "provider_rejected";
  let retryAfter = Number(error.retryAfter);
  if (!Number.isFinite(retryAfter))
    retryAfter = (Date.parse(error.retryAfter) - now) / 1000;
  const quota = error.status === 429;
  const cap = quota ? 3600 : 60;
  const backoff = Math.min(
    cap,
    (quota ? 60 : 5) * 2 ** Math.min(Math.max(attempts - 1, 0), 8),
  );
  const jitter = Math.floor(random() * Math.min(5, backoff * 0.2));
  const delay = Math.min(
    86400,
    Math.max(retryAfter || 0, Math.min(cap, backoff + jitter)),
  );
  return { code, delay: Math.ceil(delay), retryable: Boolean(retryable) };
}

export function createWorker(db, { generate = generateAvailableAnswer } = {}) {
  let running = false;
  let stopped = false;
  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error("Queue database operation failed.");
    return data;
  }
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const [job] = await rpc("claim_compilation");
      if (!job) return;
      try {
        let turn=job;
        if(job.regeneration_of) {
          const {data,error}=await db.from("compilations").select("id,created_at").eq("id",job.regeneration_of).eq("conversation_id",job.conversation_id).single();
          if(error||!data) throw new Error("Original request unavailable.");
          turn=data;
        }
        const { data: prompts, error } = await db
          .from("prompts")
          .select("content,created_at,id")
          .eq("compilation_id", turn.id)
          .order("created_at")
          .order("id");
        if (error || !prompts?.length) {
          const unavailable = new Error("Compilation prompts unavailable.");
          unavailable.retryable = true;
          throw unavailable;
        }
        const { data: history, error: historyError } = await db
          .from("compilations")
          .select("answer,created_at,id")
          .eq("conversation_id", job.conversation_id)
          .eq("status", "complete")
          .lt("created_at", turn.created_at)
          .order("created_at")
          .order("id");
        if (historyError) {
          const unavailable = new Error("Conversation history unavailable.");
          unavailable.retryable = true;
          throw unavailable;
        }
        const context = history?.length
          ? [
              `Previous completed answers for context (new prompts below take priority):\n${history.map((j) => j.answer).join("\n\n")}`,
            ]
          : [];
        const input = [...context, ...prompts.map((p) => `CURRENT USER MESSAGE:\n${p.content}`)];
        const attachments=await loadAttachments(db,job.conversation_id,[turn.id,...(history||[]).map(j=>j.id)]);
        if (input.reduce((size, text) => size + text.length, 0) + attachments.reduce((n,a)=>n+(a.text?.length||0)+(a.details?JSON.stringify(a.details).length:0),0) > 200000) {
          const error = new Error(
            "Start a new conversation to reduce context.",
          );
          error.code = "context_limit";
          throw error;
        }
        const answer = await generate(input,{attachments});
        await rpc("finish_compilation", {
          p_id: job.id,
          p_lease: job.lease_token,
          p_answer: answer.text,
          p_model: answer.model,
          p_usage: answer.usage,
          p_title: answer.title??null,
        });
      } catch (error) {
        const plan = retryPlan(error, job.attempts);
        console.warn("Compilation attempt deferred", {
          id: job.id,
          code: plan.code,
          httpStatus: error.status ?? null,
          failure: error.name,
        });
        await rpc("defer_compilation", {
          p_id: job.id,
          p_lease: job.lease_token,
          p_code: plan.code,
          p_delay: plan.delay,
          p_retry: plan.retryable,
        });
      }
    } catch {
      // No prompt contents, credentials, or provider bodies in operational logs.
      console.error(
        "Queue check failed; leased work will recover automatically.",
      );
    } finally {
      running = false;
    }
  }
  const timer = setInterval(tick, 5000);
  timer.unref();
  return {
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
