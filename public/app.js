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
  const url = new URL(location.href);
  url.searchParams.set("conversation", id);
  history[replace ? "replaceState" : "pushState"]({}, "", url);
  render();
}
function makeConversation(focus = true) {
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
  $("#breadcrumb-title").textContent = c.title;
  $("#prompt").value = c.draft;
  clearError();
  renderNav();
  $("#empty-state").hidden = c.prompts.length > 0;
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
        isPending ? "Next compilation" : "Included in compilation",
      ),
    );
    item.append(top, element("p", "prompt-content", p.content));
    list.append(item);
  }
  $("#pending-badge").textContent = unassigned.length;
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
      element("span", "job-status", "Waiting for connection"),
      element(
        "h4",
        "",
        `Compilation ${index + 1} · ${job.promptIds.length} prompt${job.promptIds.length === 1 ? "" : "s"}`,
      ),
      element(
        "p",
        "",
        "AI processing is not connected yet. These prompts are saved in this browser.",
      ),
    );
    const time = element("time", "", formatTime(job.createdAt));
    time.dateTime = new Date(job.createdAt).toISOString();
    card.append(time);
    $("#job-list").prepend(card);
  }
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
  const text = input.value.trim();
  if (!text) {
    $("#prompt-error").textContent = "Add some text before saving your prompt.";
    $("#prompt-error").hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }
  const c = current();
  c.prompts.push({
    id: crypto.randomUUID(),
    content: text,
    createdAt: Date.now(),
  });
  c.draft = "";
  if (c.prompts.length === 1) c.title = Array.from(text).slice(0, 48).join("");
  clearTimeout(saveTimer);
  const saved = persist();
  render();
  input.focus();
  if (saved) announce("Prompt saved in this browser.");
  $("#prompt-list").lastElementChild?.scrollIntoView({ block: "nearest" });
});
$("#compile").addEventListener("click", () => {
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
  const job = {
    id: crypto.randomUUID(),
    promptIds: prompts.map((p) => p.id),
    createdAt: Date.now(),
  };
  c.jobs.push(job);
  persist();
  render();
  announce("Compilation saved locally. AI processing will be connected next.");
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
    [JSON.stringify({ preview: true, conversation: c }, null, 2)],
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
$("#sign-in").addEventListener("click", () => $("#sign-in-dialog").showModal());
$("#sign-in-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("#sign-in-feedback").textContent =
    "Email sign-in is not connected yet. No email was sent. You can keep exploring the local preview.";
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
