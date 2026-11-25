import { PDFDocument, PDFName } from "pdf-lib";
import { formManifest } from "../public/pdf-form-fields.js";
export async function pdfDetails(bytes) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false }),
      fields = formManifest(doc);
    if (fields.length > 100)
      return {
        pageCount: doc.getPageCount(),
        formEditingUnavailable: "More than 100 fields. Use a smaller form.",
      };
    const details = {
      pageCount: doc.getPageCount(),
      fields,
      signed:
        doc.catalog.has(PDFName.of("Perms")) ||
        fields.some((f) => f.type === "signature"),
    };
    if (JSON.stringify(details).length > 20000)
      return {
        pageCount: doc.getPageCount(),
        formEditingUnavailable:
          "Form metadata exceeds 20,000 characters. Use a smaller form.",
      };
    return details;
  } catch {
    return undefined;
  }
}
