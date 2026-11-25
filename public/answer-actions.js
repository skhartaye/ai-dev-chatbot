const installed = new WeakSet(),
  timers = new WeakMap();
let lastMessage = "";
// Read only the rendered answer. File-edit plans and controls are never clipboard content.
export function answerPlainText(node) {
  const read = (n) => {
    if (n.nodeType === 3) return n.textContent;
    if (n.nodeType !== 1) return "";
    if (
      n.matches("button,.answer-actions,.code-actions,.edit-proposal,[hidden]")
    )
      return "";
    if (n.tagName === "BR") return "\n";
    if (n.tagName === "PRE")
      return (n.querySelector("code")?.textContent || n.textContent) + "\n\n";
    if (n.tagName === "TR")
      return Array.from(n.children, (c) => read(c).trim()).join("\t") + "\n";
    const text = Array.from(n.childNodes, read).join("");
    if (n.tagName === "LI") {
      const prefix =
        n.parentElement?.tagName === "OL"
          ? `${Array.from(n.parentElement.children).indexOf(n) + 1}. `
          : "• ";
      return prefix + text.trim() + "\n";
    }
    return /^(P|H[1-6]|BLOCKQUOTE|UL|OL|TABLE)$/.test(n.tagName)
      ? text.trim() + "\n\n"
      : text;
  };
  return read(node)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function icon(doc) {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("aria-hidden", "true");
  const p = doc.createElementNS(svg.namespaceURI, "path");
  p.setAttribute("d", "M9 9h11v11H9zM15 5V3H3v12h2");
  svg.append(p);
  return svg;
}
function report(button, ok) {
  const status = button.nextElementSibling;
  clearTimeout(timers.get(button));
  button
    .querySelector("svg path")
    ?.setAttribute("d", ok ? "M5 12l4 4L20 5" : "M9 9h11v11H9zM15 5V3H3v12h2");
  button.toggleAttribute("data-copied", ok);
  button.toggleAttribute("data-failed", !ok);
  let message = ok ? "Copied" : "Copy failed. Select the text to copy.";
  if (message === lastMessage) message += "\u00A0";
  lastMessage = message;
  status.textContent = message;
  const timer = setTimeout(
    () => {
      button.removeAttribute("data-copied");
      button.removeAttribute("data-failed");
      button
        .querySelector("svg path")
        ?.setAttribute("d", "M9 9h11v11H9zM15 5V3H3v12h2");
      status.textContent = "";
    },
    ok ? 2200 : 5000,
  );
  timer.unref?.();
  timers.set(button, timer);
}
export async function copyTarget(button, target) {
  try {
    const text =
      target.tagName === "CODE" ? target.textContent : answerPlainText(target);
    if (!text) throw new Error("Empty answer");
    await target.ownerDocument.defaultView.navigator.clipboard.writeText(text);
    report(button, true);
  } catch {
    report(button, false);
  }
}
function install(doc) {
  if (installed.has(doc)) return;
  installed.add(doc);
  if ("CommandEvent" in doc.defaultView)
    doc.addEventListener(
      "command",
      (event) => {
        if (event.command === "--copy-answer")
          void copyTarget(event.source, event.target);
      },
      true,
    );
  else
    doc.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      const button = event.target.closest?.('button[command="--copy-answer"]');
      if (button) {
        const target = doc.getElementById(button.getAttribute("commandfor"));
        if (target) void copyTarget(button, target);
      }
    });
}
function copyControl(doc, target, label, context) {
  const wrap = doc.createElement("span");
  wrap.className = "copy-control";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "answer-action";
  button.setAttribute("command", "--copy-answer");
  button.setAttribute("commandfor", target.id);
  button.append(icon(doc), doc.createTextNode(label));
  const detail = doc.createElement("span");
  detail.className = "sr-only";
  detail.textContent = " " + context;
  button.append(detail);
  const status = doc.createElement("span");
  status.className = "copy-feedback";
  status.setAttribute("role", "status");
  status.setAttribute("aria-atomic", "true");
  wrap.append(button, status);
  return wrap;
}
export function appendAnswerActions(
  card,
  answer,
  { number, title = "Conversation", regenerate, regenerating = false } = {},
) {
  const doc = answer.ownerDocument;
  install(doc);
  answer.id = `answer-${card.dataset.messageId}`;
  for (const [i, code] of Array.from(
    answer.querySelectorAll("pre>code"),
  ).entries()) {
    code.id = `${answer.id}-code-${i + 1}`;
    const pre = code.parentElement,
      wrap = doc.createElement("div"),
      bar = doc.createElement("div"),
      caption = doc.createElement("span");
    wrap.className = "code-sample";
    bar.className = "code-actions";
    caption.textContent = "Code";
    bar.append(
      caption,
      copyControl(doc, code, "Copy code", `block ${i + 1} in answer ${number}`),
    );
    pre.replaceWith(wrap);
    wrap.append(bar, pre);
  }
  const row = doc.createElement("div");
  row.className = "answer-actions";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", `Actions for answer ${number}`);
  row.append(copyControl(doc, answer, "Copy", `answer ${number}`));
  const save = doc.createElement("button");
  save.type = "button";
  save.className = "answer-action";
  save.textContent = "Save .txt";
  save.addEventListener("click", () => {
    const text = answerPlainText(answer),
      url = URL.createObjectURL(
        new Blob([text], { type: "text/plain;charset=utf-8" }),
      ),
      link = doc.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "Conversation"}-answer-${number}.txt`;
    doc.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  row.append(save);
  if (regenerate) {
    const retry=doc.createElement("button");
    retry.type="button";
    retry.className="answer-action";
    retry.textContent=regenerating?"Regeneration queued…":"Regenerate";
    retry.setAttribute("aria-label",`${retry.textContent} answer ${number}`);
    retry.setAttribute("aria-disabled",String(regenerating));
    retry.addEventListener("click",()=>{
      if(retry.getAttribute("aria-disabled")==="true") return;
      retry.setAttribute("aria-disabled","true");
      try { regenerate(); } catch {
        retry.setAttribute("aria-disabled","false");
      }
    });
    row.append(retry);
  }
  card.append(row);
}
