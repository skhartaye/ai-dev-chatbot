import { mediaKind } from "./media-edit-plan.js";
self.onmessage = async ({ data: { blob, plan } }) => {
  try {
    const module =
      mediaKind(plan.name) === "pdf"
        ? await import("./edit-pdf.js")
        : await import("./edit-image.js");
    const result = await (module.editPdf || module.editImage)(blob, plan);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error.message || "This edit could not be prepared.",
    });
  }
};
