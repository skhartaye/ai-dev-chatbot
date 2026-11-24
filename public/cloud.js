import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://vkpvgpbdnlnngwzttciy.supabase.co",
  "sb_publishable_YQXcdbCiQQg7KFdABqsNBw_px6r07_r",
  {
    auth: { flowType: "pkce", detectSessionInUrl: true },
    global: {
      fetch: (url, options) =>
        fetch(url, {
          ...options,
          signal: options?.signal || AbortSignal.timeout(20000),
        }),
    },
  },
);

export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
async function rows(table, conversationId) {
  const result = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at")
      .order("id")
      .range(offset, offset + 999);
    if (error)
      throw new Error(
        "Could not load your conversation. Reconnect and try again.",
      );
    result.push(...data);
    if (data.length < 1000) return result;
  }
}
export async function listConversations() {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error)
    throw new Error("Could not load conversations. Reconnect and try again.");
  return data.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: Date.parse(c.created_at),
    prompts: [],
    jobs: [],
    draft: "",
  }));
}
export async function loadConversation(id) {
  const [prompts, jobs] = await Promise.all([
    rows("prompts", id),
    rows("compilations", id),
  ]);
  return {
    prompts: prompts.map((p) => ({
      id: p.id,
      content: p.content,
      createdAt: Date.parse(p.created_at),
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      promptIds: prompts
        .filter((p) => p.compilation_id === j.id)
        .map((p) => p.id),
      createdAt: Date.parse(j.created_at),
      status: j.status,
      answer: j.answer,
      errorCode: j.error_code,
      availableAt: Date.parse(j.available_at),
      attempts: j.attempts,
      model: j.model,
      usage: j.usage,
    })),
  };
}
export async function wakeWorker() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return false;
  try {
    const response = await fetch("https://ai-dev-chatbot.onrender.com/wake", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: AbortSignal.timeout(90000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
