import { initSettings, initAccountSettings } from "./settings.js";
import {appendAnswerActions} from "./answer-actions.js";
import {requestEmailLink,verifyEmailCode,verifyEmailReturn,emailError} from "./email-auth.js";
import {summarizeUsage} from "./usage.js";
import {loadProviderQuota,renderProviderQuota} from './provider-quota.js';
import {requestQueue} from "./request-queue.js";
import {createChatScroll} from "./chat-scroll.js";
import { reveal } from "./motion.js";
import { renderAnswer } from "./render-answer.js";
import { prepareAttachment, getFile, removeFile } from "./attachment-store.js";
import { renderAttachmentUI, resetAttachmentUI, showConversationFiles } from "./attachment-ui.js";
import {
  supabase,
  rpc,
  listConversations,
  loadConversation,
  wakeWorker,
  uploadAttachment,
  loadUsage,
} from "./cloud.js";

const STORAGE_KEY = "kahuron.preview.v1";
const SEND_INTENT_KEY = "kahuron.send-after-sign-in";
const emailReturnURL=new URL(location.href);
if(emailReturnURL.searchParams.has('token_hash')) {
  const clean=new URL(emailReturnURL);clean.searchParams.delete('token_hash');clean.searchParams.delete('type');
  history.replaceState({},'',clean.pathname+clean.search+clean.hash);
}
const cloudStorageKey = (kind, owner = user.id) => `kahuron.${kind}.${owner}`;
let entryConversationId = new URLSearchParams(location.search).get(
  "conversation",
);
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
let accountSettings;
let startingGuest = false;
let emailMode='signin',emailBusy=false,emailSentAt=0;
let emailChallenge=null;
try {const saved=JSON.parse(sessionStorage.getItem('kahuron.email-challenge')||'null');if(saved&&typeof saved.email==='string'&&['email','email_change'].includes(saved.type)&&Date.now()-saved.sentAt<3600000){emailChallenge=saved;emailSentAt=saved.sentAt}}catch{}
let authReturnPending=emailReturnURL.searchParams.has('token_hash');
let openEmailOnLoad=new URLSearchParams(location.search).has('signin');
let extractionController;
const preparingAttachments=new Map();
const chatScroll=createChatScroll($("#message-area"),$("#prompt-list"),$("#jump-to-latest"));
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
      for (const c of state.conversations) drafts[c.id] = {text:c.draft,attachments:c.draftAttachments||[],
        ...(!c.remote?{draftOnly:true,title:c.title,createdAt:c.createdAt}:{})};
      localStorage.setItem(
        cloudStorageKey("delivery"),
        JSON.stringify(outbox),
      );
      localStorage.setItem(cloudStorageKey("drafts"), JSON.stringify(drafts));
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
  if (!extractionController) $("#file-feedback").hidden = true;
  $("#nav-dialog").close();
  const url = new URL(location.href);
  url.pathname='/chat';
  url.searchParams.delete('signin');
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
  const previousScroll=nav.scrollTop;
  const focusedHref=nav.contains(document.activeElement)?document.activeElement.getAttribute("href"):null;
  nav.replaceChildren();
  const query = $("#search").value.trim().toLocaleLowerCase();
  const matches = state.conversations.filter((c) =>
    c.title.toLocaleLowerCase().includes(query),
  );
  $("#conversation-count").textContent = state.conversations.length;
  for (const c of matches) {
    const url = new URL(location.href);
    url.searchParams.set("conversation", c.id);
    const link = element("a", "conversation-link");
    link.setAttribute("aria-label",c.title);
    link.title=c.title;
    const icon=element("span","conversation-icon");
    icon.setAttribute("aria-hidden","true");
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width","1.6");
    const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d","M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");svg.append(path);icon.append(svg);
    const copy=element("span","conversation-copy");
    copy.append(element("span","conversation-name",c.title));
    if(Number.isFinite(c.createdAt)){
      const date=element("time","conversation-date",new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(c.createdAt));
      date.dateTime=new Date(c.createdAt).toISOString();date.setAttribute("aria-hidden","true");copy.append(date);
    }
    link.append(icon,copy);
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
  nav.scrollTop=previousScroll;
  if(focusedHref)Array.from(nav.querySelectorAll("a")).find(a=>a.getAttribute("href")===focusedHref)?.focus({preventScroll:true});
}
function render() {
  const c = current();
  if (!c) return;
  chatScroll.beforeRender(c.id);
  document.title = `${c.title} · Kahuron`;
  $("#conversation-title").textContent = c.title;
  if (document.activeElement !== $("#prompt") || $("#prompt").value !== c.draft)
    $("#prompt").value = c.draft;
  clearError();
  renderAttachments(c);
  renderNav();
  $("#empty-state").hidden = c.prompts.length > 0;
  $(".conversation").classList.toggle("is-empty", c.prompts.length === 0);
  $("#rename-conversation").disabled=!(user&&c.remote);
  const queue=requestQueue(c.jobs);
  const list = $("#prompt-list");
  list.replaceChildren();
  const unassigned = pending(c);
  const pendingIds = new Set(unassigned.map((p) => p.id));
  for (const [index, p] of c.prompts.entries()) {
    const item = element("li");
    item.dataset.messageId=p.id;
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
            ? "Not sent"
            : ({complete:"Answered",processing:"Answering",failed:"Needs attention"}[c.jobs.find(j=>j.promptIds.includes(p.id))?.status]||"Queued"),
      ),
    );
    item.append(top, element("p", "prompt-content", p.content));
    if(p.revisionOf) item.append(element("span","prompt-tag","Edited question"));
    if(user&&c.remote&&!p.syncing&&!pendingIds.has(p.id)) {
      const edit=element("button","answer-action","Edit");edit.type="button";
      edit.setAttribute("aria-label",`Edit prompt ${index+1}`);edit.setAttribute("aria-haspopup","dialog");
      edit.addEventListener("click",()=>openPromptEdit(c,p));item.append(edit);
    }
    if (p.attachments?.length) {
      const files=element("button","message-files-link",`${p.attachments.length} attached file${p.attachments.length===1?"":"s"} · View files ↗`);
      files.type="button";files.addEventListener("click",showConversationFiles);item.append(files);
    }
    list.append(item);
    for (const job of c.jobs.filter((j) => j.promptIds.at(-1) === p.id))
      list.append(answerCard(job, c.jobs.indexOf(job),c));
  }
  $("#pending-badge").textContent=queue.waiting.length;
  $("#pending-open-count").textContent=queue.waiting.length;
  $("#compile").hidden=!unassigned.length;
  $("#compile-summary-title").textContent=unassigned.length?"Saved messages need sending":queue.processing?"AI is answering":queue.waiting.length?`${queue.waiting.length} message${queue.waiting.length===1?"":"s"} waiting`:"No messages waiting";
  $("#compile-summary-text").textContent=unassigned.length?"Send these previously saved messages to resume.":"Each Enter queues a separate request. Waiting messages run automatically, in order.";
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
  for (const job of queue.ordered) {
    const index=c.jobs.indexOf(job);
    const card = element("article", "job-card");
    card.append(
      element("span", "job-status", jobLabel(job)),
      element(
        "h4",
        "",
        `Request ${index + 1} · ${job.promptIds.length} prompt${job.promptIds.length === 1 ? "" : "s"}`,
      ),
      element("p", "", jobMessage(job)),
    );
    if (job.status === "failed") {
      const retry = element("button", "text-button", "Retry request");
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
        "Keep messages unsent",
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
    $("#job-list").append(card);
  }
  connectionText();
  chatScroll.afterRender();
}
function clearError() {
  $("#prompt-error").hidden = true;
  $("#prompt").removeAttribute("aria-invalid");
  $("#prompt").setCustomValidity("");
  $("#compile-error").hidden = true;
}
function restoreDraft(c) {
  const saved=drafts[c.id];
  c.draft=typeof saved==="string"?saved:saved?.text||"";
  c.draftAttachments=saved?.attachments||[];
}
function renderAttachments(c,animate=false) {
  renderAttachmentUI(c,Array.from(preparingAttachments.values()),file=>{
    const before=c.draftAttachments;
    c.draftAttachments=before.filter(a=>a.id!==file.id);
    if(persist()) {void removeFile(file.id).catch(()=>{});$("#file-feedback").hidden=true;renderAttachments(c);}
    else c.draftAttachments=before;
  },animate);
}
$("#new-conversation").addEventListener("click", makeConversation);
$("#search").addEventListener("input", renderNav);
window.addEventListener('kahuron-edit-file',({detail})=>{
  const input=$("#prompt");
  input.value+=(input.value?'\n':'')+`Edit the attached file “${detail.name}”: `;
  input.dispatchEvent(new Event('input'));input.focus();
});
$("#prompt").addEventListener("input", () => {
  clearError();
  const c = current();
  if (!c) return;
  c.draft = $("#prompt").value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 250);
});
$("#cancel-extraction").addEventListener("click", () => extractionController?.abort());
$("#attach-files").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length || extractionController) return;
  $("#file-feedback").hidden = false;
  $("#file-errors").hidden = true;
  if (files.length > 5) {
    $("#file-errors").textContent = "Choose up to 5 files at a time.";
    $("#file-errors").hidden = false;
    return;
  }
  const conversationId = current()?.id;
  const controller = new AbortController();
  extractionController = controller;
  $("#attach-files").disabled = true;
  $("#cancel-extraction").hidden = false;
  const errors = [];
  let added = 0;
  try {
    for (const [index, file] of files.entries()) {
      if (controller.signal.aborted) break;
      const progress = message => { $("#file-status").textContent = `${index + 1}/${files.length} · ${file.name} · ${message}`; };
      progress("Preparing attachment…");
      const fileId=crypto.randomUUID();
      preparingAttachments.set(fileId,{id:fileId,name:file.name,size:file.size,mimeType:file.type,conversationId,draft:true,status:"preparing",statusLabel:"Preparing…"});
      if(current()?.id===conversationId)renderAttachments(current(),true);
      try {
        const target = state.conversations.find(c => c.id === conversationId);
        if (!target) throw new Error("The original conversation is unavailable. Attach this file again.");
        if ((target.draftAttachments?.length||0)>=5) throw new Error("Send or remove an attachment first. Maximum 5 per message.");
        const attachment=await prepareAttachment(file,AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]),progress,fileId);
        const total=[...target.prompts.filter(p=>!p.revisionOf).flatMap(p=>p.attachments||[]),...(target.draftAttachments||[]),attachment].reduce((n,a)=>n+a.size,0);
        if (total>10485760) { await removeFile(attachment.id); throw new Error("Files exceed 10 MB for this conversation. Start a new conversation."); }
        target.draftAttachments??=[];
        target.draftAttachments.push(attachment);
        if (!persist()) { target.draftAttachments.pop(); await removeFile(attachment.id); throw new Error("Could not save this attachment. Free browser storage and try again."); }
        preparingAttachments.delete(fileId);
        if (current()?.id === conversationId) renderAttachments(target);
        added++;
      } catch (error) {
        if (controller.signal.aborted) break;
        console.warn("File extraction failed", error);
        errors.push(`${file.name}: ${error.name === "TimeoutError" ? "Extraction timed out. Try a smaller file." : error.message}`);
      } finally {
        preparingAttachments.delete(fileId);
        if(current()?.id===conversationId)renderAttachments(current());
      }
    }
  } finally {
    extractionController = null;
    $("#attach-files").disabled = false;
    $("#cancel-extraction").hidden = true;
    $("#file-status").textContent = `${controller.signal.aborted ? "Cancelled. " : ""}${added} file${added === 1 ? "" : "s"} attached. Ask a question and press Send.`;
    $("#file-errors").textContent = errors.join("\n");
    $("#file-errors").hidden = !errors.length;
  }
});
let lastCompositionEndAt=null;
$("#prompt").addEventListener("compositionend",event=>{lastCompositionEndAt=event.timeStamp;});
$("#prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (event.isComposing || event.keyCode === 229 || lastCompositionEndAt!==null&&Math.abs(event.timeStamp-lastCompositionEndAt)<50) return;
    $("#prompt-form").requestSubmit();
  }
});
$("#prompt-form").addEventListener("submit", (event) => {
  event.preventDefault();
  savePrompt(true);
});
function savePrompt(send) {
  const input = $("#prompt");
  if (extractionController) {
    announce("Wait for extraction to finish or cancel it before sending.");
    return;
  }
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
  const text = input.value.trim() || (current()?.draftAttachments?.length ? "Summarize the attached files." : "");
  if (!text) {
    if (send && pending(current()).length) { queueCompilation(); return; }
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
      "Send your saved messages first. A request supports 100 saved messages and 60,000 characters.";
    $("#prompt-error").hidden = false;
    input.setAttribute("aria-invalid", "true");
    return;
  }
  const prompt = {
    id: crypto.randomUUID(),
    content: text,
    createdAt: Date.now(),
    syncing: Boolean(user),
    attachments: (c.draftAttachments||[]).slice(),
  };
  if (user)
    outbox.push({
      type: "prompt",
      conversationId: c.id,
      title:c.title,
      prompt,
    });
  c.prompts.push(prompt);
  c.draft = "";
  c.draftAttachments = [];

  clearTimeout(saveTimer);
  const saved = persist();
  if (!saved) {
    c.prompts.pop();
    c.draft = text;
    c.draftAttachments = prompt.attachments;
    if (user) outbox.pop();
  }
  render();
  input.focus();
  if (saved) $("#file-feedback").hidden = true;
  if (saved)
    announce(
      user
        ? "Prompt saved. Syncing to your workspace…"
        : "Prompt saved in this browser.",
    );
  if (saved && send) queueCompilation();
  else if (user && saved) void flushOutbox();
  chatScroll.jumpToLatest();
  reveal($("#prompt-list").lastElementChild);
}
$("#compile").addEventListener("click", () => queueCompilation());
async function queueCompilation() {
  if (startingGuest) return;
  if (sessionLoading) return;
  if (staleTab) {
    announce("Reload this tab before sending.");
    return;
  }
  const c = current();
  const prompts = pending(c);
  if (!prompts.length) {
    $("#compile-error").textContent =
      "Type a message and press Enter.";
    $("#compile-error").hidden = false;
    announce("Type a message and press Enter.");
    $("#prompt").focus();
    return;
  }
  if (!user) {
    try {
      sessionStorage.setItem(SEND_INTENT_KEY, JSON.stringify({conversationId:c.id,promptIds:prompts.map(p=>p.id),jobId:crypto.randomUUID()}));
      startingGuest = true;
      $("#prompt-form").inert = true;
      $("#connection-note").textContent = "Connecting to AI… Your prompt is saved.";
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.session) throw error || new Error("No guest session");
      await setSession(data.session);
    } catch {
      const message = "Could not connect to AI. Your prompt is saved. Press Send to retry.";
      $("#connection-note").textContent = message;
      $("#prompt-error").textContent = message;
      $("#prompt-error").hidden = false;
      announce(message);
    } finally {
      startingGuest = false;
      $("#prompt-form").inert = false;
    }
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
    announce("Message queued. It will run automatically in order.");
  }
}
for (const button of document.querySelectorAll("[data-starter]"))
  button.addEventListener("click", () => {
    const input = $("#prompt");
    input.value +=
      (input.value ? "\n\n" : "") +
      button.dataset.starter.replaceAll("\\n", "\n");
    input.dispatchEvent(new Event("input"));
    input.focus();
  });
let editingPrompt;
function openPromptEdit(c,p) {
  editingPrompt={conversationId:c.id,source:p};
  $("#edited-prompt").value=p.content;$("#edit-prompt-error").hidden=true;$("#edited-prompt").removeAttribute("aria-invalid");
  $("#edit-prompt-note").textContent=p.attachments?.length?"Sends a new version with the same files. Your original question and answer stay saved.":"Sends a new version. Your original question and answer stay saved.";
  $("#edit-prompt-dialog").showModal();
}
$("#cancel-prompt-edit").addEventListener("click",()=>$("#edit-prompt-dialog").close());
$("#edited-prompt").addEventListener("input",()=>{$("#edit-prompt-error").hidden=true;$("#edited-prompt").removeAttribute("aria-invalid");});
$("#edit-prompt-form").addEventListener("submit",event=>{
  event.preventDefault();
  const text=$("#edited-prompt").value.trim(),c=state.conversations.find(c=>c.id===editingPrompt?.conversationId),source=editingPrompt?.source;
  let error=!text||Array.from(text).length>20000?"Use a question between 1 and 20,000 characters.":!user||staleTab||!c?"Reconnect and reload your workspace before editing.":text===source.content?"Change the question first, or use Regenerate for another answer.":"";
  if(!error) {
    const prompt={id:crypto.randomUUID(),content:text,revisionOf:source.revisionOf||source.id,createdAt:Date.now(),syncing:true,attachments:source.attachments||[]};
    const job={id:crypto.randomUUID(),promptIds:[prompt.id],createdAt:Date.now(),status:"syncing"};
    const action={type:"revise",conversationId:c.id,title:c.title,prompt,job};
    c.prompts.push(prompt);c.jobs.push(job);outbox.push(action);
    if(persist()) {
      $("#edit-prompt-dialog").close();editingPrompt=null;render();chatScroll.jumpToLatest();announce("Edited question queued. Your original stays saved.");void flushOutbox();return;
    }
    c.prompts.pop();c.jobs.pop();outbox.pop();error="Could not save the edit. Free browser storage and try again.";
  }
  $("#edit-prompt-error").textContent=error;$("#edit-prompt-error").hidden=false;$("#edited-prompt").setAttribute("aria-invalid","true");$("#edited-prompt").focus();
});
let renamingId;
$("#rename-conversation").addEventListener("click",()=>{
  const c=current();if(!user||!c?.remote)return;
  renamingId=c.id;$("#conversation-name").value=c.title;$("#rename-error").hidden=true;
  $("#rename-dialog").showModal();$("#conversation-name").select();
});
$("#rename-form").addEventListener("submit",async event=>{
  event.preventDefault();const name=$("#conversation-name").value.trim().replace(/\s+/g," ");
  if(!name||Array.from(name).length>120){$("#rename-error").textContent="Use a title between 1 and 120 characters.";$("#rename-error").hidden=false;$("#conversation-name").focus();return;}
  const id=renamingId,save=$("#save-conversation-name");save.disabled=true;save.textContent="Saving…";
  try{
    const savedTitle=await rpc("rename_conversation",{p_id:id,p_title:name});
    const c=state.conversations.find(c=>c.id===id);if(c)c.title=savedTitle;
    persist();render();$("#rename-dialog").close();announce("Conversation renamed. Automatic naming will keep your title.");
  }catch{$("#rename-error").textContent="Could not save the title. Reconnect and try again.";$("#rename-error").hidden=false;}
  finally{save.disabled=false;save.textContent="Save title";}
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
  $("#settings-dialog").close();
  if (user&&!user.is_anonymous) {
    if (outbox.length) {
      announce("Wait for pending work to sync before signing out.");
      return;
    }
    void supabase.auth.signOut({scope:'local'}).then(({ error }) => {
      if (error) announce("Could not sign out. Please try again.");
    });
  } else openEmailDialog(user?.is_anonymous?'save':'signin');
});
function openEmailDialog(mode='signin') {
  emailMode=mode;
  $("#sign-in-title").textContent=mode==='save'?'Save your workspace with email':'Sign in with email';
  $("#sign-in-description").textContent=mode==='save'?'Confirm your email to keep these chats across devices.':user?.is_anonymous&&state.conversations.some(c=>c.remote)?'This opens your email account’s workspace. Guest chats won’t move to it; export any chats you want to keep first.':'We’ll email you a code and a sign-in link. No password needed.';
  $("#sign-in-feedback").textContent='';$("#sign-in-feedback").className='';
  $("#email-mode").hidden=!user?.is_anonymous;
  $("#email-mode").textContent=mode==='save'?'Sign in to an existing account':'Save this guest workspace instead';
  const resume=emailChallenge&&((mode==='save')===(emailChallenge.type==='email_change'))&&(!emailChallenge.ownerId||emailChallenge.ownerId===user?.id);
  showEmailCode(Boolean(resume));
  $("#sign-in-dialog").showModal();
}
function showEmailCode(show) {
  $("#sign-in-form").hidden=show;$("#verify-email-form").hidden=!show;
  if(show){$("#email-code-destination").textContent=`Code sent to ${emailChallenge.email}`;$("#email-code").value='';$("#email-code-feedback").textContent='Paste the code from the newest email.';$("#email-mode").hidden=true;}
}
function saveEmailChallenge(value) {
  emailChallenge=value;
  try{if(value)sessionStorage.setItem('kahuron.email-challenge',JSON.stringify(value));else sessionStorage.removeItem('kahuron.email-challenge')}catch{}
}
async function acceptEmailSession(data) {
  let session=data?.session;
  if(!session){const result=await supabase.auth.refreshSession();if(result.error)throw result.error;session=result.data.session;}
  if(!session?.user?.email_confirmed_at||session.user.is_anonymous)throw {code:'confirmation_pending'};
  saveEmailChallenge(null);authReturnPending=false;
  await setSession(session);$("#sign-in-dialog").close();
  announce(`Signed in as ${session.user.email}.`);
}
$("#email-mode").addEventListener('click',()=>{if(!emailBusy)openEmailDialog(emailMode==='save'?'signin':'save');});
$("#sign-in-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if(emailBusy)return;
  if(Date.now()-emailSentAt<60000){$("#sign-in-feedback").textContent='A link was just sent. Check your inbox and spam folder, or wait a minute to resend.';return;}
  if(outbox.length||sessionLoading){$("#sign-in-feedback").textContent='Wait for your saved messages to sync, then try again.';return;}
  const email=$("#email").value.trim(),upgrade=emailMode==='save'&&Boolean(user?.is_anonymous),ownerId=user?.id;
  emailBusy=true;
  const button = event.currentTarget.querySelector("[type=submit]");
  button.disabled = true;
  button.textContent = "Sending…";
  if(!$("#verify-email-form").hidden)$("#email-code-feedback").textContent='Sending a fresh code…';
  try {
    await requestEmailLink(supabase.auth,email,{upgrade});
    if(upgrade&&ownerId!==user?.id)throw {code:'session_changed'};
    emailSentAt=Date.now();saveEmailChallenge({email,type:upgrade?'email_change':'email',sentAt:emailSentAt,...(upgrade?{ownerId}:{})});showEmailCode(true);$("#email-code").focus();$("#sign-in-feedback").className='';
    $("#sign-in-feedback").textContent =
      emailMode==='save'?"Check your inbox and spam folder for the confirmation link. Open it in this browser to save this workspace.":"Check your inbox and spam folder. Open the sign-in link in this browser to continue.";
  } catch (error) {
    $("#sign-in-feedback").className='field-error';
    $("#sign-in-feedback").textContent =
      emailError(error);
    if(!$("#verify-email-form").hidden)$("#email-code-feedback").textContent=emailError(error);
  } finally {
    emailBusy=false;
    button.disabled = false;
    button.textContent = "Send code";
  }
});
$("#verify-email-form").addEventListener('submit',async event=>{
  event.preventDefault();if(emailBusy||!emailChallenge)return;
  const field=$("#email-code"),button=event.currentTarget.querySelector('[type=submit]');
  if(outbox.length||sessionLoading){$("#email-code-feedback").textContent='Wait for pending messages to sync, then verify.';return;}
  if(emailChallenge.ownerId&&emailChallenge.ownerId!==user?.id){$("#email-code-feedback").textContent='This guest session changed. Use Change email to request a fresh code.';return;}
  emailBusy=true;button.disabled=true;button.textContent='Verifying…';field.removeAttribute('aria-invalid');
  try {await acceptEmailSession(await verifyEmailCode(supabase.auth,{...emailChallenge,token:field.value}));}
  catch(error){$("#email-code-feedback").textContent=error.code==='confirmation_pending'?'Confirm the email change using both confirmation emails, then try signing in.':emailError(error);field.setAttribute('aria-invalid','true');field.focus();}
  finally{emailBusy=false;button.disabled=false;button.textContent='Verify & sign in';}
});
$("#resend-email-code").addEventListener('click',()=>{
  if(emailBusy||!emailChallenge)return;
  if(Date.now()-emailSentAt<60000){$("#email-code-feedback").textContent='Check your inbox and spam folder. Wait a minute before resending.';return;}
  $("#email").value=emailChallenge.email;$("#sign-in-form").requestSubmit();
});
$("#change-email").addEventListener('click',()=>{if(!emailBusy){saveEmailChallenge(null);showEmailCode(false);$("#email-mode").hidden=!user?.is_anonymous;$("#email").focus();}});
for (const button of document.querySelectorAll("[data-close]"))
  button.addEventListener("click", () =>
    document.getElementById(button.dataset.close).close(),
  );
const examples = {
  queued: [
    "Queued",
    "Your prompts are saved.",
    "Your message will run automatically when capacity is available.",
  ],
  processing: [
    "Processing",
    "An answer is taking shape.",
    "Press Enter while AI is answering to queue the next message.",
  ],
  complete: [
    "Complete",
    "Your answer",
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
    if (event.key === cloudStorageKey("delivery")) {
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
      syncing: "Saving message…",
      queued:
        job.errorCode === "rate_limit"
          ? "Waiting for AI quota"
          : job.errorCode
            ? "Retry scheduled"
            : "Queued",
      processing: "Generating answer…",
      complete: "Complete",
      failed: "Needs attention",
    }[job.status] || "Not synced"
  );
}
function jobMessage(job) {
  if (job.status === "complete") return "Answer saved in your workspace.";
  if (job.status === "processing")
    return "Keep typing. Press Enter to queue the next message.";
  if (job.status === "failed")
    return job.errorCode === "context_limit"
      ? "This conversation is too long. Start a new conversation with the context you need."
      : job.errorCode === "output_limit"
        ? "The answer exceeded the output limit. Start a new conversation with a smaller task. Your prompts are still saved here."
        : "Your prompts are safe. Retry this request when the service is available.";
  if (job.status === "queued")
    return job.errorCode
      ? `Your prompts are saved. Next attempt after ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(job.availableAt))}.`
      : "Saved in your workspace. Processing starts when capacity is available.";
  return "Waiting to sync. Keep this browser open until the request is saved online.";
}
function answerCard(job, index,c) {
  const item = element("li", "answer-card");
  item.dataset.messageId=job.id;
  item.append(
    element("strong", "answer-heading", `Kahuron · Answer ${index + 1}`),
    element("span", "job-status", jobLabel(job)),
  );
  if(job.regenerationOf) item.append(element("span","job-status",`New version of Answer ${c.jobs.findIndex(j=>j.id===job.regenerationOf)+1}`));
  if (job.answer) {
    const answer = element("div", "answer-content", job.answer);
    item.append(answer);
    void renderAnswer(answer, job.answer,{files:c.prompts.flatMap(p=>p.attachments||[])}).then(()=>appendAnswerActions(item,answer,{number:index+1,title:c.title,
      ...(user&&c.remote&&job.status==="complete"?{regenerate:()=>regenerateAnswer(c,job),regenerating:c.jobs.some(j=>j.regenerationOf===(job.regenerationOf||job.id)&&["syncing","queued","processing"].includes(j.status))}:{})
    })).catch(() => {
      answer.textContent = job.answer;
    });
  } else item.append(element("p", "", jobMessage(job)));
  return item;
}
function regenerateAnswer(c,source) {
  if(staleTab||!user) {announce("Reload your workspace to regenerate.");throw new Error("Workspace unavailable");}
  const root=source.regenerationOf||source.id;
  if(c.jobs.some(j=>j.regenerationOf===root&&["syncing","queued","processing"].includes(j.status))) return;
  const job={id:crypto.randomUUID(),promptIds:[...source.promptIds],regenerationOf:root,createdAt:Date.now(),status:"syncing"};
  const action={type:"regenerate",conversationId:c.id,title:c.title,job};
  c.jobs.push(job);outbox.push(action);
  if(!persist()) {c.jobs.pop();outbox.pop();throw new Error("Could not save request");}
  render();announce("Regeneration queued. Your original answer is kept.");void flushOutbox();
}
function connectionText() {
  accountSettings?.sync();
  $("#workspace-name").textContent = user?.is_anonymous ? "Guest workspace" : user?.email||"Your workspace";
  $("#workspace-status").textContent = user && !user.is_anonymous ? "Signed in · Saved across devices" : "Saved in this browser";
  $(".account-row .avatar").textContent=user?.email&&!user.is_anonymous?user.email[0].toUpperCase():'G';
  $("#sign-in").hidden = false;
  $("#sign-in").textContent = user?.is_anonymous?'Save with email':user?'Sign out':'Sign in';
  $("#sign-in").className=!user||user.is_anonymous?'primary-button':'text-button';
  $("#settings-email").textContent=user?.email&&!user.is_anonymous?user.email:user?.is_anonymous?'Guest workspace':'Not signed in';
  $("#settings-account-status").textContent=user&&!user.is_anonymous?'Verified':user?'Guest':'Sign in to save across devices';
  $("#connection-note").textContent = !user
    ? "Send a message to start chatting. No sign-in needed."
    : deliveryError ||
      (outbox.length
        ? "Syncing saved prompts… Keep this tab open."
        : "Prompts saved online. Keep adding context while AI works.");
}
initSettings(document);
accountSettings = initAccountSettings(document, {
  getUser: () => user,
  isReady: () => !sessionLoading && !staleTab,
  saveInstructions: async value => {
    const owner = user?.id;
    const { data, error } = await supabase.auth.updateUser({ data: { kahuron_instructions: value } });
    if (error || !data?.user || data.user.id !== owner) throw new Error('Could not save instructions.');
    if (user?.id === owner) { user = data.user; connectionText(); }
  },
  exportAccount: async (signal, onProgress) => {
    const owner = user?.id, generation = cloudGeneration;
    const account = structuredClone(user);
    if (!persist()) throw new Error('Could not preserve drafts. Free browser storage and try again.');
    const local = structuredClone({ drafts, pendingDelivery: outbox });
    // No auth storage is read or serialized. Appearance is a separate browser preference.
    try { local.appearance = JSON.parse(localStorage.getItem('kahuron:appearance') || '{}'); } catch { local.appearance = {}; }
    const { buildAccountExport, downloadAccountExport } = await import('./account-export.js');
    const isCurrent = () => user?.id === owner && cloudGeneration === generation && !staleTab;
    const result = await buildAccountExport({ db: supabase, user: account, local, isCurrent, getLocalFile: getFile, signal, onProgress });
    signal.throwIfAborted();
    if (!isCurrent()) throw new Error('Account changed. Export again from Settings.');
    downloadAccountExport(document, result.blob);
    return result;
  },
});
$("#open-settings").addEventListener('click',()=>{$("#nav-dialog").close();connectionText();$("#settings-dialog").showModal();void refreshUsage();});
$("#refresh-usage").addEventListener('click',()=>void refreshUsage());
async function refreshUsage() {
  const generation=cloudGeneration,button=$("#refresh-usage"),feedback=$("#usage-feedback"),summary=$("#usage-summary");
  if(button.disabled)return;
  if(!user){feedback.textContent='No recorded usage.';summary.hidden=true;return;}
  const quotaRequest = refreshProviderQuota(generation);
  button.disabled=true;feedback.textContent='Loading usage…';summary.hidden=true;
  try{
    const usage=summarizeUsage(await loadUsage());if(generation!==cloudGeneration)return;
    summary.replaceChildren();const number=new Intl.NumberFormat();
    const metrics=element('dl','usage-metrics');
    for(const [label,value]of[['Total reported tokens',usage.reported?number.format(usage.total):'—'],['Requests',number.format(usage.requests)],['Input tokens',usage.reported?number.format(usage.input):'—'],['Answer tokens',usage.reported?number.format(usage.output):'—']]){
      const group=element('div');group.append(element('dt','',label),element('dd','',value));metrics.append(group);
    }
    summary.append(metrics,element('p','settings-note',`${usage.complete} completed · ${usage.active} queued or answering · ${usage.failed} need${usage.failed===1?'s':''} attention`));
    if(usage.reported<usage.complete)summary.append(element('p','settings-note',`Token reports available for ${usage.reported} of ${usage.complete} completed requests. Total may include additional model tokens.`));
    if(usage.models.size)summary.append(element('p','settings-note',`Models used: ${Array.from(usage.models.keys()).join(', ')}`));
    feedback.textContent=usage.requests?'':'No requests in the last 30 days.';summary.hidden=false;
  }catch{if(generation===cloudGeneration)feedback.textContent='Could not load usage. Reconnect and select Refresh.';}
  finally{await quotaRequest;button.disabled=false;}
}
async function refreshProviderQuota(generation) {
  const container = $('#provider-quota');
  renderProviderQuota(container, {status:'loading'});
  try {
    const report = await loadProviderQuota(supabase);
    if (generation === cloudGeneration) renderProviderQuota(container, report);
  } catch {
    if (generation === cloudGeneration) renderProviderQuota(container, {status:'unavailable'});
  }
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
        draft: "",
      };
      state.conversations.unshift(c);
      restoreDraft(c);
    }
    if(action.prompt&&!c.prompts.some(p=>p.id===action.prompt.id)) c.prompts.push(action.prompt);
    if(action.job&&!c.jobs.some(j=>j.id===action.job.id)) c.jobs.push(action.job);
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
        await rpc(action.prompt.attachments?.length ? "save_prompt_with_attachments" : "save_prompt", {
          p_id: action.prompt.id,
          p_conversation_id: action.conversationId,
          p_content: action.prompt.content,
          ...(action.prompt.attachments?.length?{p_files:action.prompt.attachments}:{}),
        });
        for (const attachment of action.prompt.attachments||[]) {
          await uploadAttachment(owner,action.prompt.id,attachment,await getFile(attachment.id));
        }
      } else if(action.type==="revise")
        await rpc("revise_prompt",{p_id:action.job.id,p_prompt_id:action.prompt.id,p_source_id:action.prompt.revisionOf,p_content:action.prompt.content});
      else if(action.type==="regenerate")
        await rpc("regenerate_answer",{p_id:action.job.id,p_source_id:action.job.regenerationOf});
      else
        await rpc("compile_prompts", {
          p_id: action.job.id,
          p_conversation_id: action.conversationId,
          p_prompt_ids: action.job.promptIds,
        });
      if (user?.id !== owner || staleTab) break;
      outbox.shift();
      const persisted=persist();
      if (persisted && action.type==="prompt")
        for (const attachment of action.prompt.attachments||[]) void removeFile(attachment.id,true).catch(()=>{});
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
  const previousTitle=selected?.title;
  try {
    const conversations = await listConversations();
    if (generation !== cloudGeneration) return;
    for (const remote of conversations) {
      const existing = state.conversations.find((c) => c.id === remote.id);
      if (existing) {
        existing.title = remote.title;
        existing.remote = true;
      } else {
        restoreDraft(remote);
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
        (signature !== JSON.stringify([selected.prompts, selected.jobs])||selected.title!==previousTitle)
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
  if (next?.id === user?.id) {
    const upgraded=user?.is_anonymous&&!next?.is_anonymous&&Boolean(next?.email_confirmed_at);
    user=next;connectionText();
    if(upgraded){$("#sign-in-dialog").close();announce('Email confirmed. Your workspace is saved to your account.');}
    if(openEmailOnLoad&&!sessionLoading){openEmailOnLoad=false;openEmailDialog('signin');}
    return;
  }
  sessionLoading = true;
  $("#prompt-form").inert = true;
  $("#connection-note").textContent = "Loading your workspace…";
  const generation=++cloudGeneration;
  resetAttachmentUI();
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
      const conversations=await listConversations();
      if(generation!==cloudGeneration)return;
      state.conversations=conversations;
      for (const [id,draft] of Object.entries(drafts)) {
        if(draft?.draftOnly && (draft.text||draft.attachments?.length) && !state.conversations.some(c=>c.id===id))
          state.conversations.unshift({id,title:draft.title||"New conversation",createdAt:draft.createdAt||Date.now(),prompts:[],jobs:[],draft:""});
      }
      for (const c of state.conversations) restoreDraft(c);
      mergeOutbox();
    } catch {
      if(generation!==cloudGeneration)return;
      deliveryError =
        "Could not load your workspace. Reconnect and reload to try again.";
    }
    try {
      mergeOutbox();
      const intent = JSON.parse(sessionStorage.getItem(SEND_INTENT_KEY) || "null");
      const preview = intent && load().conversations.find(c => c.id === intent.conversationId);
      if (preview) {
        const prompts = preview.prompts.filter(p => intent.promptIds.includes(p.id));
        if (prompts.length !== intent.promptIds.length) throw new Error("Missing saved prompts");
        for (const prompt of prompts) {
          if (!outbox.some(a => a.prompt?.id === prompt.id))
            outbox.push({type:"prompt",conversationId:preview.id,title:preview.title,prompt});
        }
        if (!outbox.some(a => a.job?.id === intent.jobId))
          outbox.push({type:"compile",conversationId:preview.id,title:preview.title,job:{id:intent.jobId,promptIds:intent.promptIds,createdAt:Date.now(),status:"syncing"}});
        mergeOutbox();
        if (!persist()) throw new Error("Could not preserve delivery");
        entryConversationId = preview.id;
        sessionStorage.removeItem(SEND_INTENT_KEY);
      }
    } catch {
      deliveryError = "Your saved prompts could not be queued. Reload this tab to try again.";
    }
  } else state = load();
  sessionLoading = false;
  $("#prompt-form").inert = authReturnPending;
  if (!state.conversations.length) makeConversation(false);
  else {
    const entry = state.conversations.find((c) => c.id === entryConversationId);
    navigate(entry?.id || current()?.id || state.conversations[0].id, true);
  }
  entryConversationId = null;
  connectionText();
  if(openEmailOnLoad){openEmailOnLoad=false;openEmailDialog('signin');}
  if (user) {
    void flushOutbox();
    void wake();
  }
}
supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => void setSession(session), 0);
});
supabase.auth.initialize?.().then(({error})=>{
  if(!error)return;
  openEmailDialog('signin');
  $("#sign-in-feedback").className='field-error';
  $("#sign-in-feedback").textContent='This sign-in link could not be opened. Request a fresh link here and open it in this browser.';
  if(!$("#verify-email-form").hidden)$("#email-code-feedback").textContent='This link could not be opened. Paste the email code here, or request a new code.';
});
if(authReturnPending) {
  openEmailOnLoad=false;emailBusy=true;openEmailDialog('signin');
  $("#sign-in-feedback").textContent='Verifying your email…';$("#prompt-form").inert=true;
  const verification=verifyEmailReturn(supabase.auth,emailReturnURL);
  void verification.then(acceptEmailSession).catch(error=>{
    openEmailDialog('signin');$("#sign-in-feedback").className='field-error';$("#sign-in-feedback").textContent=emailError(error);
    if(!$("#verify-email-form").hidden)$("#email-code-feedback").textContent=emailError(error);
  }).finally(()=>{authReturnPending=false;emailBusy=false;$("#prompt-form").inert=sessionLoading;});
}
connectionText();
window.addEventListener("online", () => void flushOutbox());
window.addEventListener("pageshow",event=>{if(event.persisted)render();});
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
