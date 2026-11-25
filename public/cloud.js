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
          signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
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
    remote: true,
  }));
}
export async function loadConversation(id) {
  const [prompts, jobs, attachmentResult] = await Promise.all([
    rows("prompts", id),
    rows("compilations", id),
    supabase.from("attachments").select("*,prompts!inner(conversation_id)").eq("prompts.conversation_id",id),
  ]);
  if (attachmentResult.error) throw new Error("Could not load conversation attachments.");
  return {
    prompts: prompts.map((p) => ({
      id: p.id,
      content: p.content,
      revisionOf:p.revision_of,
      createdAt: Date.parse(p.created_at),
      attachments: attachmentResult.data.filter(a=>a.prompt_id===(p.revision_of||p.id)).map(a=>({id:a.id,name:a.name,mimeType:a.mime_type,size:a.size})),
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      promptIds: prompts
        .filter((p) => p.compilation_id === (j.regeneration_of || j.id))
        .map((p) => p.id),
      regenerationOf: j.regeneration_of,
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
export async function uploadAttachment(owner,promptId,attachment,blob) {
  const path=`${owner}/${promptId}/${attachment.id}`;
  if (!blob) {
    const existing=await supabase.storage.from("chat-attachments").download(path);
    if(existing.error||existing.data?.size!==attachment.size) throw new Error(`Attach ${attachment.name} again: this browser no longer has its file bytes.`);
  } else {
    const {error}=await supabase.storage.from("chat-attachments").upload(path,blob,{contentType:attachment.mimeType,upsert:false});
    if (error && String(error.statusCode)!=="409") throw new Error("File upload interrupted. Your prompt is saved and will retry.");
  }
  await rpc("register_attachment",{p_id:attachment.id,p_prompt_id:promptId,p_name:attachment.name,p_mime_type:attachment.mimeType,p_size:attachment.size});
}
export async function downloadAttachment(id) {
  const {data,error}=await supabase.from("attachments").select("storage_path").eq("id",id).single();
  if(error||!data) throw new Error("This file is unavailable in your workspace.");
  const result=await supabase.storage.from("chat-attachments").download(data.storage_path);
  if(result.error||!result.data) throw new Error("The file is still uploading or the connection was interrupted. Try again shortly.");
  return result.data;
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
