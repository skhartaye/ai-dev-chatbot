import { getFile, putFile } from "./attachment-store.js";
import { downloadAttachment } from "./cloud.js";
import { editFile, validateFileEdit } from "./edit-file.js";
import { isVisualFile } from "./media-edit-plan.js";
import { extractFile, validateFile } from "./extract-file.js";

const el = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (className) n.className = className;
  return n;
};
let dialog,
  url,
  generation = 0;
let editController;
let destroyVisual;
export function closeEditReview() {
  editController?.abort();
  destroyVisual?.();
  destroyVisual = null;
  generation++;
  if (dialog?.open) dialog.close();
  if (url) URL.revokeObjectURL(url);
  url = null;
}
window.addEventListener("pagehide", closeEditReview);
window.addEventListener("kahuron-close-edits", closeEditReview);

export function appendEditReviews(node, plans, files) {
  for (const plan of plans.slice(0, 3)) {
    const card = el("section", null, "edit-proposal");
    try {
      const file = validateFileEdit(plan, files);
      card.append(
        el("strong", file.name),
        el(
          "p",
          `${plan.changes.length} proposed change${plan.changes.length === 1 ? "" : "s"} · Original preserved`,
        ),
      );
      const button = el("button", "Review edits", "primary-button");
      button.type = "button";
      button.addEventListener("click", () => void openReview(plan, file));
      card.append(button);
    } catch (error) {
      card.append(el("p", error.message));
    }
    node.append(card);
  }
}
async function openReview(plan, file) {
  closeEditReview();
  dialog?.remove();
  dialog = el("dialog", null, "edit-review");
  dialog.id = "edit-review-dialog";
  dialog.setAttribute("aria-labelledby", "edit-review-title");
  const header = el("header"),
    heading = el("h1", "Review file edits");
  heading.id = "edit-review-title";
  const close = el("button", "Close", "text-button");
  close.type = "button";
  close.autofocus = true;
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);
  const filename = el("p", file.name, "edit-filename"),
    status = el("p", "Checking the original on this device…");
  status.setAttribute("role", "status");
  const body = el("div", null, "edit-changes"),
    footer = el("footer");
  const input = el("input");
  input.type = "file";
  input.accept = /\.docx$/i.test(file.name) ? ".docx" : ".xlsx";
  input.hidden = true;
  input.setAttribute("aria-label", "Choose original file");
  const choose = el("button", "Choose original file", "primary-button");
  choose.type = "button";
  choose.hidden = true;
  choose.addEventListener("click", () =>
    isVisualFile(file.name) ? void loadVisualOriginal() : input.click(),
  );
  const download = el("a", "Download edited copy", "file-download");
  download.hidden = true;
  footer.append(choose, download);
  dialog.append(header, filename, status, body, input, footer);
  document.body.append(dialog);
  const own = ++generation,
    activeDialog = dialog;
  activeDialog.addEventListener("close", () => {
    if (activeDialog !== dialog || activeDialog.open) return;
    generation++;
    editController?.abort();
    destroyVisual?.();
    destroyVisual = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
  });
  activeDialog.showModal();
  const build = async (original) => {
    status.textContent = "Preparing a separate copy…";
    choose.disabled = true;
    download.hidden = true;
    try {
      editController?.abort();
      editController = new AbortController();
      const result = await editFile(original, plan, {
        signal: editController.signal,
        onProgress: (message) => {
          if (own === generation && activeDialog.open)
            status.textContent = message;
        },
      });
      if (own !== generation || !activeDialog.open) return;
      body.replaceChildren();
      if (result.kind) {
        status.textContent = "Rendering the original and edited copy…";
        const { mountVisualReview } = await import("./visual-edit-review.js");
        destroyVisual = await mountVisualReview(body, original, result, {
          signal: editController.signal,
        });
        if (own !== generation || !activeDialog.open) {
          destroyVisual();
          return;
        }
      }
      for (const change of result.log) {
        const row = el("section", null, "edit-change");
        if (change.description)
          row.append(el("h2", change.location), el("p", change.description));
        else
          row.append(
            el("h2", change.location),
            el("span", "Before", "edit-label"),
            el("del", change.find),
            el("span", "After", "edit-label"),
            el("ins", String(change.replace ?? "(empty)")),
          );
        if (change.formatLabel)
          row.append(
            el("p", `Formatting · ${change.formatLabel}`, "edit-format-label"),
          );
        if (change.result !== undefined)
          row.append(
            el("p", `Calculated result · ${change.result}`, "edit-result"),
          );
        body.append(row);
      }
      for (const note of result.notes || [])
        body.append(el("p", note, "edit-format-label"));
      if (result.calculations?.length) {
        const details = el("details", null, "formula-results");
        details.append(
          el(
            "summary",
            `${result.calculations.length} formula${result.calculations.length === 1 ? "" : "s"} recalculated and checked`,
          ),
        );
        const list = el("ul");
        for (const calculation of result.calculations.slice(0, 50))
          list.append(
            el(
              "li",
              `${calculation.sheet}!${calculation.address} = ${calculation.type === "b" ? (calculation.value === "1" ? "TRUE" : "FALSE") : calculation.value}`,
            ),
          );
        details.append(list);
        if (result.calculations.length > 50)
          details.append(
            el(
              "p",
              "Showing the first 50 results. All formula results are included in the download.",
            ),
          );
        body.append(details);
      }
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(result.blob);
      download.href = url;
      download.download = result.name;
      download.hidden = false;
      choose.hidden = true;
      status.textContent =
        "Review the changes, then download the copy. The original is unchanged. To ask about this version, attach the downloaded file.";
    } catch (error) {
      if (own !== generation) return;
      status.textContent = error.message;
      choose.hidden = false;
      choose.textContent = isVisualFile(file.name)
        ? "Try again"
        : "Choose original again";
    } finally {
      choose.disabled = false;
    }
  };
  const loadVisualOriginal = async () => {
    choose.hidden = true;
    status.textContent = "Loading the original attachment…";
    try {
      const original =
        (await getFile(file.id).catch(() => null)) ||
        (await downloadAttachment(file.id));
      if (own === generation) await build(original);
    } catch (error) {
      if (own === generation) {
        status.textContent = error.message;
        choose.textContent = "Try again";
        choose.hidden = false;
      }
    }
  };
  input.addEventListener("change", async () => {
    const original = input.files?.[0];
    if (!original) return;
    choose.disabled = true;
    status.textContent = "Checking that this matches the attached document…";
    try {
      validateFile(original);
      if (original.name !== file.name)
        throw new Error(`Choose the original named “${file.name}”.`);
      const source =
        (await getFile(file.id).catch(() => null)) ||
        (await downloadAttachment(file.id));
      const text = await extractFile(original, {
        signal: AbortSignal.timeout(120000),
        includeCellMap: (await source.text()).includes("[KAHURON CELL MAP]"),
      });
      if (text !== (await source.text()))
        throw new Error(
          "This file does not match the attached document. Attach it as a new message and request edits again.",
        );
      if (own !== generation) return;
      await putFile(`${file.id}:original`, new Blob([original]));
      await build(original);
    } catch (error) {
      if (own === generation) status.textContent = error.message;
    } finally {
      choose.disabled = false;
      input.value = "";
    }
  });
  try {
    if (isVisualFile(file.name)) {
      await loadVisualOriginal();
      return;
    }
    const original = await getFile(`${file.id}:original`);
    if (own !== generation) return;
    if (original) await build(original);
    else {
      status.textContent =
        "Choose the original to keep its formatting. Older attachments and other devices only have the AI text copy. This file stays on your device.";
      choose.hidden = false;
    }
  } catch {
    if (own === generation) {
      status.textContent =
        "Could not access the original on this device. Choose the file to continue.";
      choose.hidden = false;
    }
  }
}
