import {
  isVisualFile,
  mediaKind,
  validateVisualPlan,
} from "./media-edit-plan.js";
import { validateEditPlan } from "./edit-office.js";
export function validateFileEdit(plan, files) {
  return isVisualFile(plan?.name)
    ? validateVisualPlan(plan, files)
    : validateEditPlan(plan, files);
}
export async function editFile(blob, plan, { signal, onProgress } = {}) {
  validateFileEdit(plan, [{ id: plan.fileId, name: plan.name }]);
  if (!isVisualFile(plan.name)) {
    const { editOffice } = await import("./edit-office.js");
    return editOffice(blob, plan, { signal });
  }
  if (plan.changes.some((c) => c.op === "ocrReplaceText")) {
    const { editScannedPdf } = await import("./edit-scanned-pdf.js");
    return editScannedPdf(blob, plan, { signal, onProgress });
  }
  // Cross-browser fallback uses the same renderer when worker canvas APIs are absent.
  if (
    typeof Worker === "undefined" ||
    (mediaKind(plan.name) === "image" &&
      (typeof OffscreenCanvas === "undefined" ||
        typeof createImageBitmap === "undefined"))
  ) {
    const module =
      mediaKind(plan.name) === "pdf"
        ? await import("./edit-pdf.js")
        : await import("./edit-image.js");
    return (module.editPdf || module.editImage)(blob, plan, { signal });
  }
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker("/media-edit.worker.js", { type: "module" });
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new Error("Edit cancelled."));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "The edit took too long. Use a smaller file or fewer changes.",
          ),
        ),
      30000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () =>
      finish(new Error("The editor could not start. Reload and try again."));
    worker.onmessage = ({ data }) =>
      finish(data.error ? new Error(data.error) : null, data.result);
    worker.postMessage({ blob, plan });
  });
}
