import { reveal } from "./motion.js";
import {
  supabase,
  rpc,
  listConversations,
  loadConversation,
  wakeWorker,
} from "./cloud.js";

const STORAGE_KEY = "kahuron.preview.v1";
const $ = (selector) => document.querySelector(selector);
const formatTime = (value) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
let storageError = "";
let state = load();
let saveTimer;
let toastTimer;
let user = null;
let outbox = [];
let drafts = {};
let flushing = false;
let refreshing = false;
let lastWake = 0;
let cloudGeneration = 0;
let deliveryError = "";
let staleTab = false;
let sessionLoading = false;
const sidebar = $(".sidebar");
const mobileLayout = matchMedia("(max-width: 860px)");

function syncSidebar() {
  const drawer = $("#nav-dialog");
  const hadFocus = sidebar.contains(document.activeElement);
  drawer.close();
  if (mobileLayout.matches) drawer.append(sidebar);
  else $(".app-shell").prepend(sidebar);
  if (hadFocus)
    (mobileLayout.matches ? $("#open-nav") : $("#new-conversation")).focus();
}
mobileLayout.addEventListener("change", syncSidebar);
syncSidebar();
function fitViewport() {
  if (window.visualViewport?.scale === 1)
    document.documentElement.style.setProperty(
      "--app-height",
      `${Math.round(visualViewport.height)}px`,
    );
}
window.visualViewport?.addEventListener("resize", fitViewport);
fitViewport();
for (const [buttonId, dialogId] of [
  ["open-nav", "nav-dialog"],
  ["open-compilation", "compilation-dialog"],
]) {
  const button = document.getElementById(buttonId);
  const dialog = document.getElementById(dialogId);
  button.addEventListener("click", () => {
    dialog.showModal();
    button.setAttribute("aria-expanded", "true");
  });
  dialog.addEventListener("close", () =>
    button.setAttribute("aria-expanded", "false"),
  );
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}
$("#mobile-new").addEventListener("click", () => makeConversation());

document.addEventListener(
  "keydown",
  () => document.documentElement.classList.add("keyboard-navigation"),
  true,
);
document.addEventListener(
  "pointerdown",
  () => document.documentElement.classList.remove("keyboard-navigation"),
  true,
);

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { conversations: [] };
    const value = JSON.parse(raw);
    if (
      !Array.isArray(value.conversations) ||
      value.conversations.some(
        (c) =>
          typeof c.id !== "string" ||
          typeof c.title !== "string" ||
          typeof c.draft !== "string" ||
          !Array.isArray(c.prompts) ||
          !Array.isArray(c.jobs) ||
          c.prompts.some(
            (p) =>
              typeof p.id !== "string" ||
              typeof p.content !== "string" ||
              !Number.isFinite(p.createdAt),
          ) ||
          c.jobs.some(
            (j) =>
              typeof j.id !== "string" ||
              !Array.isArray(j.promptIds) ||
              !Number.isFinite(j.createdAt),
          ),
      )
    ) {
      throw new Error("Invalid preview data");
    }
    return value;
  } catch {
    storageError =
      "This browser’s saved preview could not be opened. New changes will not replace it. Export your current conversation before leaving.";
    return { conversations: [] };
  }
}
function persist() {
  if (user) {
    if (staleTab) return false;
    try {
      for (const c of state.conversations) drafts[c.id] = c.draft;
      localStorage.setItem(
        `kahuron.delivery.${user.id}`,
        JSON.stringify(outbox),
      );
      localStorage.setItem(`kahuron.drafts.${user.id}`, JSON.stringify(drafts));
      return true;
    } catch {
      announce("Browser storage is full. Export your work before leaving.");
      return false;
    }
  }
  if (storageError) {
    announce(storageError);
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    announce(
      "Browser storage is unavailable or full. Export your conversation before leaving.",
    );
    return false;
  }
}
function announce(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  toastTimer = setTimeout(() => {
    $("#toast").textContent = "";
  }, 7000);
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function current() {
  return state.conversations.find(
    (c) => c.id === new URLSearchParams(location.search).get("conversation"),
  );
}
function pending(c) {
  const assigned = new Set(c.jobs.flatMap((j) => j.promptIds));
  return c.prompts.filter((p) => !assigned.has(p.id));
}
function navigate(id, replace = false) {
  $("#nav-dialog").close();
  const url = new URL(location.href);
  url.searchParams.set("conversation", id);
  history[replace ? "replaceState" : "pushState"]({}, "", url);
  render();
  if (user) void refreshCloud();
}
function makeConversation(focus = true) {
  if (sessionLoading) return;
  const c = {
    id: crypto.randomUUID(),
    title: "New conversation",
    createdAt: Date.now(),
    prompts: [],
    jobs: [],
    draft: "",
  };
  state.conversations.unshift(c);
  persist();
  navigate(c.id);
  if (focus) $("#prompt").focus();
}
function renderNav() {
  const nav = $("#conversation-nav");
  nav.replaceChildren();
  const query = $("#search").value.trim().toLocaleLowerCase();
  const matches = state.conversations.filter((c) =>
    c.title.toLocaleLowerCase().includes(query),
  );
  $("#conversation-count").textContent = state.conversations.length;
  for (const c of matches) {
    const url = new URL(location.href);
    url.searchParams.set("conversation", c.id);
    const link = element("a", "conversation-link", c.title);
    link.href = url.pathname + url.search;
    if (c.id === current()?.id) link.setAttribute("aria-current", "page");
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      navigate(c.id);
    });
    nav.append(link);
  }
  if (!matches.length)
    nav.append(element("p", "sidebar-empty", "No matching conversations."));
}
function render() {
  const c = current();
  if (!c) return;
  document.title = `${c.title} · Kahuron`;
  $("#conversation-title").textContent = c.title;
  if (document.activeElement !== $("#prompt") || $("#prompt").value !== c.draft)
    $("#prompt").value = c.draft;
  clearError();
  renderNav();
  $("#empty-state").hidden = c.prompts.length > 0;
  $(".conversation").classList.toggle("is-empty", c.prompts.length === 0);
  const list = $("#prompt-list");
  list.replaceChildren();
  const unassigned = pending(c);
  const pendingIds = new Set(unassigned.map((p) => p.id));
  for (const [index, p] of c.prompts.entries()) {
    const item = element("li");
    const top = element("div", "prompt-top");
    const meta = element("div", "prompt-meta");
    meta.append(
      element("span", "prompt-number", String(index + 1).padStart(2, "0")),
    );
    const time = element("time", "", formatTime(p.createdAt));
    time.dateTime = new Date(p.createdAt).toISOString();
    meta.append(time);
    const isPending = pendingIds.has(p.id);
    top.append(
      meta,
      element(
        "span",
        `prompt-tag${isPending ? "" : " assigned"}`,
        p.syncing
          ? "Saving…"
          : isPending
            ? "Next compilation"
            : "Included in compilation",
      ),
    );
    item.append(top, element("p", "prompt-content", p.content));
    list.append(item);
    for (const job of c.jobs.filter((j) => j.promptIds.at(-1) === p.id))
      list.append(answerCard(job, c.jobs.indexOf(job)));
  }
  $("#pending-badge").textContent = unassigned.length;
  $("#pending-open-count").textContent = unassigned.length;
  $("#compile-summary-title").textContent = unassigned.length
    ? `${unassigned.length} prompt${unassigned.length === 1 ? "" : "s"}. One answer.`
    : "Your prompts, together.";
  $("#compile-summary-text").textContent = unassigned.length
    ? "Keep adding context, or compile these prompts together."
    : "Save a prompt to start building the context for your answer.";
  $("#pending-list").replaceChildren();
  for (const p of unassigned) {
    const item = element("li");
    item.append(
      element(
        "span",
        "pending-number",
        String(c.prompts.indexOf(p) + 1).padStart(2, "0"),
      ),
      element("span", "pending-text", p.content),
    );
    $("#pending-list").append(item);
  }
  $("#job-count").textContent = c.jobs.length;
  $("#no-jobs").hidden = c.jobs.length > 0;
  $("#job-list").replaceChildren();
  for (const [index, job] of c.jobs.entries()) {
    const card = element("article", "job-card");
    card.append(
      element("span", "job-status", jobLabel(job)),
      element(
        "h4",
        "",
        `Compilation ${index + 1} · ${job.promptIds.length} prompt${job.promptIds.length === 1 ? "" : "s"}`,
      ),
      element("p", "", jobMessage(job)),
    );
    if (job.status === "failed") {
      const retry = element("button", "text-button", "Retry compilation");
      retry.type = "button";
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        try {
          await rpc("retry_compilation", { p_id: job.id });
          await refreshCloud();
          void wake();
        } catch (error) {
          announce(error.message);
        } finally {
          retry.disabled = false;
        }
      });
      card.append(retry);
    }
    if (job.status === "syncing" && deliveryError && !flushing) {
      const recover = element(
        "button",
        "text-button",
        "Keep prompts uncompiled",
      );
      recover.type = "button";
      recover.addEventListener("click", () => {
        outbox = outbox.filter((action) => action.job?.id !== job.id);
        c.jobs = c.jobs.filter((item) => item.id !== job.id);
        persist();
        deliveryError = "";
        render();
        connectionText();
        void flushOutbox();
      });
      card.append(recover);
    }
    const time = element("time", "", formatTime(job.createdAt));
    time.dateTime = new Date(job.createdAt).toISOString();
    card.append(time);
    $("#job-list").prepend(card);
  }
  connectionText();
}
function clearError() {
  $("#prompt-error").hidden = true;
  $("#prompt").removeAttribute("aria-invalid");
  $("#prompt").setCustomValidity("");
  $("#compile-error").hidden = true;
}
$("#new-conversation").addEventListener("click", makeConversation);
$("#search").addEventListener("input", renderNav);
$("#prompt").addEventListener("input", () => {
  clearError();
  const c = current();
  if (!c) return;
  c.draft = $("#prompt").value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 250);
});
$("#prompt").addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    $("#prompt-form").requestSubmit();
  }
});
$("#prompt-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#prompt");
  if (sessionLoading) {
    announce("Your workspace is loading. Please try again shortly.");
    return;
  }
  if (staleTab) {
    announce(
      "This tab has older pending work. Export it and reload before saving.",
    );
    return;
  }
  const text = input.value.trim();
  if (!text) {
    $("#prompt-error").textContent = "Add some text before saving your prompt.";
    $("#prompt-error").hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }
  const c = current();
  if (
    user &&
    (pending(c).length >= 100 ||
      pending(c).reduce((n, p) => n + Array.from(p.content).length, 0) +
        Array.from(text).length >
        60000)
  ) {
    $("#prompt-error").textContent =
      "Compile your saved prompts first. Each batch supports 100 prompts and 60,000 characters.";
    $("#prompt-error").hidden = false;
    input.setAttribute("aria-invalid", "true");
    return;
  }
  const prompt = {
    id: crypto.randomUUID(),
    content: text,
    createdAt: Date.now(),
    syncing: Boolean(user),
  };
  if (user)
    outbox.push({
      type: "prompt",
      conversationId: c.id,
      title:
        c.remote || c.prompts.length
          ? c.title
          : Array.from(text).slice(0, 48).join(""),
      prompt,
    });
  c.prompts.push(prompt);
  c.draft = "";
  if (c.prompts.length === 1 && !c.remote)
    c.title = Array.from(text).slice(0, 48).join("");
  clearTimeout(saveTimer);
  const saved = persist();
  if (!saved) {
    c.prompts.pop();
    c.draft = text;
    if (user) outbox.pop();
  }
  render();
  input.focus();
  if (saved)
    announce(
      user
        ? "Prompt saved. Syncing to your workspace…"
        : "Prompt saved in this browser.",
    );
  if (user && saved) void flushOutbox();
  $("#prompt-list").lastElementChild?.scrollIntoView({ block: "nearest" });
  reveal($("#prompt-list").lastElementChild);
});
$("#compile").addEventListener("click", () => {
  if (sessionLoading) return;
  if (staleTab) {
    announce("Reload this tab before compiling.");
    return;
  }
  const c = current();
  const prompts = pending(c);
  if (!prompts.length) {
    $("#compile-error").textContent =
      "Save a prompt first, then compile it here.";
    $("#compile-error").hidden = false;
    announce("Save a prompt first, then compile it here.");
    $("#prompt").focus();
    return;
  }
  if (!user) {
    $("#compilation-dialog").close();
    $("#sign-in-dialog").showModal();
    $("#sign-in-feedback").textContent =
      "Sign in to save your queue and generate answers. Your local prompts stay on this device.";
    return;
  }
  const job = {
    id: crypto.randomUUID(),
    promptIds: prompts.map((p) => p.id),
    createdAt: Date.now(),
    status: "syncing",
  };
  outbox.push({ type: "compile", conversationId: c.id, title: c.title, job });
  c.jobs.push(job);
  const saved = persist();
  if (!saved) {
    outbox.pop();
    c.jobs.pop();
  }
  render();
  reveal($("#job-list").firstElementChild);
  if (saved) {
    void flushOutbox();
    announce("Compilation queued. You can keep adding prompts.");
  }
});
for (const button of document.querySelectorAll("[data-starter]"))
  button.addEventListener("click", () => {
    const input = $("#prompt");
    input.value +=
      (input.value ? "\n\n" : "") +
      button.dataset.starter.replaceAll("\\n", "\n");
    input.dispatchEvent(new Event("input"));
    input.focus();
  });
$("#export").addEventListener("click", () => {
  const c = current();
  const blob = new Blob(
    [JSON.stringify({ localOnly: !user, conversation: c }, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kahuron-conversation.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce("Conversation exported.");
});
$("#sign-in").addEventListener("click", () => {
  $("#nav-dialog").close();
  if (user) {
    if (outbox.length) {
      announce("Wait for pending work to sync before signing out.");
      return;
    }
    void supabase.auth.signOut().then(({ error }) => {
      if (error) announce("Could not sign out. Please try again.");
    });
  } else $("#sign-in-dialog").showModal();
});
$("#sign-in-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("[type=submit]");
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: $("#email").value.trim(),
      options: { emailRedirectTo: "https://kahuron.netlify.app/" },
    });
    if (error) throw error;
    $("#sign-in-feedback").textContent =
      "Check your email for a sign-in link. Open it in this browser to continue.";
  } catch (error) {
    $("#sign-in-feedback").textContent =
      error.message || "Could not send the link. Please try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Send sign-in link";
  }
});
for (const button of document.querySelectorAll("[data-close]"))
  button.addEventListener("click", () =>
    document.getElementById(button.dataset.close).close(),
  );
const examples = {
  queued: [
    "Queued",
    "Your prompts are saved.",
    "Your compilation will start when capacity is available.",
  ],
  processing: [
    "Processing",
    "An answer is taking shape.",
    "You can keep adding prompts. New prompts will go into the next compilation.",
  ],
  complete: [
    "Complete",
    "Your compiled answer",
    "Example: Start with a small feature, define its acceptance criteria, and implement the smallest complete workflow.",
  ],
  error: [
    "Needs attention",
    "The AI service is temporarily unavailable.",
    "Your prompts are still saved. Temporary errors will be retried automatically; other errors will show a next step.",
  ],
};
function showExample(stage) {
  const [status, title, body] = examples[stage];
  const output = $("#example-output");
  output.replaceChildren(
    element("span", "example-status", status),
    element("h3", "", title),
    element("p", "", body),
  );
  for (const button of document.querySelectorAll("[data-stage]"))
    button.setAttribute("aria-pressed", String(button.dataset.stage === stage));
}
$("#open-example").addEventListener("click", () => {
  $("#nav-dialog").close();
  showExample("queued");
  $("#example-dialog").showModal();
});
for (const button of document.querySelectorAll("[data-stage]"))
  button.addEventListener("click", () => showExample(button.dataset.stage));
window.addEventListener("popstate", () => {
  if (current()) render();
  else if (state.conversations[0]) navigate(state.conversations[0].id, true);
});
window.addEventListener("pagehide", () => {
  clearTimeout(saveTimer);
  persist();
});
window.addEventListener("beforeunload", (event) => {
  if (!persist()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("storage", (event) => {
  if (user) {
    if (event.key === `kahuron.delivery.${user.id}`) {
      staleTab = true;
      deliveryError =
        "Another tab changed your pending work. Reload before saving more prompts.";
      announce(deliveryError);
    }
    return;
  }
  if (event.key !== STORAGE_KEY) return;
  // Prevent a stale tab from silently overwriting a newer tab's data.
  storageError =
    "This preview changed in another tab. Export this conversation, then reload to use the latest saved version.";
  announce(storageError);
});
if (state.conversations.length === 0) makeConversation(false);
else if (!current()) navigate(state.conversations[0].id, true);
else render();
if (storageError) announce(storageError);

function jobLabel(job) {
  return (
    {
      syncing: "Saving compilation…",
      queued:
        job.errorCode === "rate_limit"
          ? "Waiting for AI quota"
          : job.errorCode
            ? "Retry scheduled"
            : "Queued",
      processing: "Generating answer…",
      complete: "Complete",
      failed: "Needs attention",
    }[job.status] || "Local compilation"
  );
}
function jobMessage(job) {
  if (job.status === "complete") return "Answer saved in your workspace.";
  if (job.status === "processing")
    return "Keep adding prompts. They will go into the next compilation.";
  if (job.status === "failed")
    return job.errorCode === "context_limit"
      ? "This conversation is too long. Start a new conversation with the context you need."
      : job.errorCode === "output_limit"
        ? "The answer exceeded the output limit. Start a new conversation with a smaller task. Your prompts are still saved here."
        : "Your prompts are safe. Retry this compilation when the service is available.";
  if (job.status === "queued")
    return job.errorCode
      ? `Your prompts are saved. Next attempt after ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(job.availableAt))}.`
      : "Saved in your workspace. Processing starts when capacity is available.";
  return "Waiting to sync. Keep this browser open until the compilation is saved online.";
}
function answerCard(job, index) {
  const item = element("li", "answer-card");
  item.append(
    element("strong", "answer-heading", `Kahuron · Compilation ${index + 1}`),
    element("span", "job-status", jobLabel(job)),
  );
  if (job.answer) item.append(element("div", "answer-content", job.answer));
  else item.append(element("p", "", jobMessage(job)));
  return item;
}
function connectionText() {
  $("#connection-status").textContent = user
    ? "Cloud workspace"
    : "Local preview";
  $("#workspace-name").textContent = user
    ? "Your workspace"
    : "Local workspace";
  $("#workspace-status").textContent = user
    ? "Saved across devices"
    : "Saved on this device";
  $("#sign-in").textContent = user ? "Sign out" : "Sign in";
  $("#connection-note").textContent = !user
    ? "Sign in to queue prompts and generate AI answers."
    : deliveryError ||
      (outbox.length
        ? "Syncing saved prompts… Keep this tab open."
        : "Prompts saved online. Keep adding context while AI works.");
}
function mergeOutbox() {
  for (const action of outbox) {
    let c = state.conversations.find((c) => c.id === action.conversationId);
    if (!c) {
      c = {
        id: action.conversationId,
        title: action.title,
        createdAt: action.prompt?.createdAt || action.job.createdAt,
        prompts: [],
        jobs: [],
        draft: drafts[action.conversationId] || "",
      };
      state.conversations.unshift(c);
    }
    const list = action.type === "prompt" ? c.prompts : c.jobs;
    const item = action.prompt || action.job;
    if (!list.some((p) => p.id === item.id)) list.push(item);
  }
}
async function wake() {
  if (Date.now() - lastWake < 60000) return;
  lastWake = Date.now();
  const awake = await wakeWorker();
  if (!awake && user)
    announce(
      "The worker is waking or unavailable. Your online queue is saved; it will resume when the worker reconnects.",
    );
}
async function flushOutbox() {
  if (flushing || staleTab || !user || !navigator.onLine) return;
  flushing = true;
  const owner = user.id;
  try {
    while (outbox.length && user?.id === owner && !staleTab) {
      const action = outbox[0];
      if (action.type === "prompt") {
        await rpc("create_conversation", {
          p_id: action.conversationId,
          p_title: action.title,
        });
        const conversation = state.conversations.find(
          (c) => c.id === action.conversationId,
        );
        if (conversation) conversation.remote = true;
        await rpc("save_prompt", {
          p_id: action.prompt.id,
          p_conversation_id: action.conversationId,
          p_content: action.prompt.content,
        });
      } else
        await rpc("compile_prompts", {
          p_id: action.job.id,
          p_conversation_id: action.conversationId,
          p_prompt_ids: action.job.promptIds,
        });
      if (user?.id !== owner || staleTab) break;
      outbox.shift();
      persist();
      deliveryError = "";
    }
  } catch (error) {
    deliveryError = `Not synced: ${error.message} Reconnect or reload to retry. Your pending work remains on this device.`;
    announce(deliveryError);
  } finally {
    flushing = false;
    connectionText();
    if (user?.id === owner) {
      await refreshCloud();
      if (deliveryError && current()) render();
      if (
        state.conversations.some((c) =>
          c.jobs.some((j) => ["queued", "processing"].includes(j.status)),
        )
      )
        void wake();
    }
  }
}
async function refreshCloud() {
  if (!user || refreshing) return;
  refreshing = true;
  const generation = cloudGeneration;
  const selected = current();
  try {
    const conversations = await listConversations();
    if (generation !== cloudGeneration) return;
    for (const remote of conversations) {
      const existing = state.conversations.find((c) => c.id === remote.id);
      if (existing) {
        existing.title = remote.title;
        existing.remote = true;
      } else {
        remote.draft = drafts[remote.id] || "";
        state.conversations.push(remote);
      }
    }
    if (selected) {
      const remote = await loadConversation(selected.id);
      if (generation !== cloudGeneration) return;
      const signature = JSON.stringify([selected.prompts, selected.jobs]);
      selected.prompts = remote.prompts;
      selected.jobs = remote.jobs;
      mergeOutbox();
      if (
        current()?.id === selected.id &&
        signature !== JSON.stringify([selected.prompts, selected.jobs])
      )
        render();
    }
    renderNav();
    connectionText();
  } catch {
    if (generation === cloudGeneration) {
      deliveryError =
        "Connection lost. New prompts stay on this device until sync resumes.";
      connectionText();
    }
  } finally {
    refreshing = false;
  }
}
async function setSession(session) {
  const next = session?.user || null;
  if (next?.id === user?.id) return;
  sessionLoading = true;
  $("#prompt-form").inert = true;
  $("#connection-note").textContent = "Loading your workspace…";
  cloudGeneration++;
  user = next;
  outbox = [];
  drafts = {};
  deliveryError = "";
  if (user) {
    state = { conversations: [] };
    try {
      drafts = JSON.parse(
        localStorage.getItem(`kahuron.drafts.${user.id}`) || "{}",
      );
      outbox = JSON.parse(
        localStorage.getItem(`kahuron.delivery.${user.id}`) || "[]",
      );
      state.conversations = await listConversations();
      for (const c of state.conversations) c.draft = drafts[c.id] || "";
      mergeOutbox();
    } catch {
      deliveryError =
        "Could not load your workspace. Reconnect and reload to try again.";
    }
    mergeOutbox();
    $("#sign-in-dialog").close();
  } else state = load();
  sessionLoading = false;
  $("#prompt-form").inert = false;
  if (!state.conversations.length) makeConversation(false);
  else navigate(state.conversations[0].id, true);
  connectionText();
  if (user) {
    void flushOutbox();
    void wake();
  }
}
supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => void setSession(session), 0);
});
connectionText();
window.addEventListener("online", () => void flushOutbox());
setInterval(() => {
  if (user && !document.hidden) {
    if (outbox.length) void flushOutbox();
    else void refreshCloud();
    if (
      current()?.jobs.some((j) => ["queued", "processing"].includes(j.status))
    )
      void wake();
  }
}, 5000);
