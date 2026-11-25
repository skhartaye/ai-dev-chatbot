import {
  PDFDocument,
  PDFName,
  PDFDict,
  StandardFonts,
  rgb,
  degrees,
} from "pdf-lib";
import { validateVisualPlan } from "./media-edit-plan.js";
import { MAX_FILE_BYTES } from "./extract-file.js";
import { pdfFormFields, fillPdfFields } from "./pdf-form-fields.js";
const color = (value) => {
  const hex = value.slice(1);
  return rgb(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );
};
export async function editPdf(blob, plan, { signal, wasmBinary } = {}) {
  validateVisualPlan(plan, [{ id: plan.fileId, name: plan.name }]);
  signal?.throwIfAborted();
  if (blob.size > MAX_FILE_BYTES)
    throw new Error("Choose a PDF smaller than 10 MB.");
  let doc;
  try {
    doc = await PDFDocument.load(await blob.arrayBuffer(), {
      updateMetadata: false,
    });
  } catch {
    throw new Error(
      "This PDF is damaged or password protected. Export an unlocked copy first.",
    );
  }
  const fields = pdfFormFields(doc);
  if (
    fields.some((f) => f.type === "signature") ||
    doc.catalog.has(PDFName.of("Perms"))
  )
    throw new Error("Signed or signature-bearing PDFs cannot be edited.");
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (
    doc.catalog.has(PDFName.of("AA")) ||
    doc.catalog.has(PDFName.of("OpenAction")) ||
    names?.has(PDFName.of("JavaScript"))
  )
    throw new Error(
      "PDFs containing active actions cannot be edited here. Export a plain PDF copy.",
    );
  const pages = doc.getPages();
  if (!pages.length || pages.length > 50)
    throw new Error("Edit PDFs with between 1 and 50 pages.");
  const selected =
    plan.changes.find((c) => c.op === "selectPages")?.pages ||
    pages.map((_, i) => i + 1);
  if (
    selected.some((p) => p > pages.length) ||
    plan.changes.some((c) => c.page > pages.length)
  )
    throw new Error("A requested page does not exist in this PDF.");
  if (plan.changes.some((c) => c.page && !selected.includes(c.page)))
    throw new Error(
      "The proposal edits a page it also removes. Ask for a consistent set of changes.",
    );
  if (fields.length && plan.changes.some((c) => c.op === "selectPages"))
    throw new Error(
      "Page selection is unavailable for forms to preserve their field widgets.",
    );
  const rewrites = plan.changes.filter((c) => c.op === "replaceText");
  if (rewrites.length) {
    const { rewritePdfText } = await import("./rewrite-pdf-text.js");
    const result = await rewritePdfText(
      new Uint8Array(await blob.arrayBuffer()),
      rewrites,
      { signal, wasmBinary },
    );
    const remainder = plan.changes.filter((c) => c.op !== "replaceText");
    if (remainder.length) {
      const edited = await editPdf(
        new Blob([result.bytes], { type: "application/pdf" }),
        { ...plan, changes: remainder },
        { signal, wasmBinary },
      );
      edited.log.unshift(...result.log);
      edited.notes.push(
        "Text objects were rewritten without an overlay. This is not secure redaction.",
      );
      return edited;
    }
    return {
      kind: "pdf",
      blob: new Blob([result.bytes], { type: "application/pdf" }),
      name: plan.name.replace(/\.pdf$/i, "-edited.pdf"),
      log: result.log,
      previewPages: [rewrites[0].page, rewrites[0].page],
      notes: [
        "Rewrites editable text objects within their original bounds. Paragraph reflow, scans and secure redaction are not supported.",
      ],
    };
  }
  const fonts = new Map();
  if (plan.changes.some((c) => c.op === "addText")) {
    for (const weight of new Set(
      plan.changes
        .filter((c) => c.op === "addText")
        .map((c) => (c.bold ? 700 : 400)),
    )) {
      fonts.set(
        weight,
        await doc.embedFont(
          weight === 700
            ? StandardFonts.HelveticaBold
            : StandardFonts.Helvetica,
        ),
      );
    }
  }
  const log = [],
    rotations = new Map();
  const formChanges = plan.changes.filter((c) => c.op === "fillField");
  if (formChanges.length) {
    if (plan.changes.some((c) => c.op === "selectPages"))
      throw new Error(
        "Fill form fields and change the page order in separate edits to preserve form widgets.",
      );
    const formLog = fillPdfFields(doc, formChanges);
    log.push(...formLog);
  }
  for (const c of plan.changes) {
    signal?.throwIfAborted();
    if (c.op === "fillField") continue;
    if (c.op === "selectPages") {
      log.push({
        location: "PDF pages",
        description: `Keep original pages ${c.pages.join(", ")} in this order (${pages.length} → ${c.pages.length} pages).`,
      });
      continue;
    }
    const page = pages[c.page - 1];
    if (c.op === "rotate") {
      rotations.set(c.page, (rotations.get(c.page) || 0) + c.degrees);
      log.push({
        location: `Original page ${c.page}`,
        description: `Rotate ${c.degrees}° clockwise.`,
      });
      continue;
    }
    if (((page.getRotation().angle % 360) + 360) % 360 !== 0)
      throw new Error(
        "Annotations currently require an unrotated original page. Export a flattened, upright PDF first.",
      );
    const box = page.getCropBox(),
      x = box.x + c.x * box.width;
    if (c.op === "highlight") {
      page.drawRectangle({
        x,
        y: box.y + (1 - c.y - c.height) * box.height,
        width: c.width * box.width,
        height: c.height * box.height,
        color: color(c.color),
        opacity: c.opacity ?? 0.25,
      });
      log.push({
        location: `Original page ${c.page}`,
        description: `Add a translucent ${c.color} highlight.`,
      });
    } else {
      const font = fonts.get(c.bold ? 700 : 400);
      const lines = c.text.split("\n"),
        lineHeight = c.fontSize * 1.25,
        charset = new Set(font.getCharacterSet());
      if (
        Array.from(c.text.replace(/\n/g, "")).some(
          (char) => !charset.has(char.codePointAt(0)),
        )
      )
        throw new Error(
          "The annotation font does not support one of these characters. Use supported Latin text or symbols.",
        );
      if (
        c.y * box.height + lines.length * lineHeight > box.height ||
        lines.some(
          (line) =>
            c.x * box.width + font.widthOfTextAtSize(line, c.fontSize) >
            box.width,
        )
      )
        throw new Error(
          "The annotation does not fit on the page. Use smaller text or move it.",
        );
      page.drawText(c.text, {
        x,
        y: box.y + (1 - c.y) * box.height - c.fontSize,
        size: c.fontSize,
        lineHeight,
        font,
        color: color(c.color),
        opacity: c.opacity ?? 1,
      });
      log.push({
        location: `Original page ${c.page}`,
        description: `Add text “${c.text}” at ${Math.round(c.x * 100)}%, ${Math.round(c.y * 100)}%.`,
      });
    }
  }
  for (const [number, rotation] of rotations) {
    const page = pages[number - 1];
    page.setRotation(
      degrees((((page.getRotation().angle + rotation) % 360) + 360) % 360),
    );
  }
  if (plan.changes.some((c) => c.op === "selectPages")) {
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
    selected.forEach((number, i) => doc.insertPage(i, pages[number - 1]));
  }
  const bytes = await doc.save();
  signal?.throwIfAborted();
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error(
      "The edited PDF exceeds 10 MB. Use a smaller source or fewer annotations.",
    );
  const firstPage =
    plan.changes.find((c) => c.page)?.page ||
    log.find((c) => c.page)?.page ||
    selected[0];
  return {
    kind: "pdf",
    blob: new Blob([bytes], { type: "application/pdf" }),
    name: plan.name.replace(/\.pdf$/i, "-edited.pdf"),
    log,
    previewPages: [firstPage, selected.indexOf(firstPage) + 1],
    notes: [
      ...(formChanges.length
        ? ["Filled form fields remain editable in the downloaded copy."]
        : []),
      "PDF annotations and page selection are not secure redaction.",
    ],
  };
}
