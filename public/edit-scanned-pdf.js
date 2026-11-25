import { PDFDocument, PDFName, PDFDict, StandardFonts, rgb } from "pdf-lib";
import { validateVisualPlan } from "./media-edit-plan.js";
import { findOcrMatches, clearOcrPixels } from "./ocr-text-region.js";
const encode = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error("The edited scan could not be exported.")),
      "image/png",
    ),
  );
export async function editScannedPdf(
  blob,
  plan,
  {
    signal,
    onProgress = () => {},
    canvasFactory = (w, h) =>
      Object.assign(document.createElement("canvas"), { width: w, height: h }),
    encodeCanvas = encode,
    createOcrWorker,
    pdfjsModule,
  } = {},
) {
  validateVisualPlan(plan, [{ id: plan.fileId, name: plan.name }]);
  if (blob.size > 10485760) throw new Error("Choose a PDF smaller than 10 MB.");
  if (plan.changes.some((c) => c.op !== "ocrReplaceText"))
    throw new Error(
      "Request scanned text rewriting separately from other PDF edits.",
    );
  const pageNumbers = [...new Set(plan.changes.map((c) => c.page))];
  if (pageNumbers.length > 3 || plan.changes.length > 10)
    throw new Error(
      "Rewrite up to 10 phrases across 3 scanned pages per copy.",
    );
  const controller = new AbortController(),
    abort = () =>
      controller.abort(signal?.reason || new Error("OCR edit cancelled."));
  signal?.throwIfAborted();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error("OCR took too long. Try one page or a clearer scan."),
      ),
    120000,
  );
  let loading, worker, canvas;
  const cancellable = (promise) =>
    new Promise((resolve, reject) => {
      const cancelled = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", cancelled, { once: true });
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() =>
          controller.signal.removeEventListener("abort", cancelled),
        );
      if (controller.signal.aborted) cancelled();
    });
  const stop = () => {
    void worker?.terminate();
    void loading?.destroy().catch(() => {});
  };
  controller.signal.addEventListener("abort", stop, { once: true });
  try {
    onProgress("Opening the scanned PDF…");
    let doc;
    try {
      doc = await PDFDocument.load(await blob.arrayBuffer(), {
        updateMetadata: false,
      });
    } catch {
      throw new Error("Export an unlocked, readable PDF first.");
    }
    if (
      doc.getPageCount() > 50 ||
      pageNumbers.some((p) => p > doc.getPageCount())
    )
      throw new Error("Choose existing pages in a PDF with at most 50 pages.");
    const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    if (
      ["AcroForm", "Perms", "AA", "OpenAction"].some((n) =>
        doc.catalog.has(PDFName.of(n)),
      ) ||
      names?.has(PDFName.of("JavaScript"))
    )
      throw new Error(
        "OCR rewriting is unavailable for forms, signed or active PDFs. Export a plain scanned copy.",
      );
    if (
      pageNumbers.some((p) =>
        doc
          .getPage(p - 1)
          .node.Annots()
          ?.size(),
      )
    )
      throw new Error(
        "A target page contains annotations or links. Export a plain scanned copy to preserve those separately.",
      );
    const pdfjs = pdfjsModule || (await import("pdfjs-dist/build/pdf.mjs"));
    if (!pdfjsModule)
      pdfjs.GlobalWorkerOptions.workerSrc = "/extraction-assets/pdf.worker.mjs";
    controller.signal.throwIfAborted();
    loading = pdfjs.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      isEvalSupported: false,
      cMapUrl: "/extraction-assets/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/extraction-assets/standard_fonts/",
      wasmUrl: "/extraction-assets/pdf-wasm/",
    });
    const pdf = await loading.promise,
      font = await doc.embedFont(StandardFonts.Helvetica),
      log = [];
    onProgress("Loading the on-device OCR engine…");
    const create =
      createOcrWorker || (await import("tesseract.js")).default.createWorker;
    const startingWorker = create("eng", 1, {
      workerPath: "/extraction-assets/ocr-worker.js",
      corePath: "/extraction-assets/ocr",
      langPath: "/extraction-assets/ocr",
      workerBlobURL: false,
      cacheMethod: "none",
      logger: (m) => {
        if (!controller.signal.aborted && m.status === "recognizing text")
          onProgress(`Reading scanned text… ${Math.round(m.progress * 100)}%`);
      },
    });
    startingWorker.then(
      (w) => {
        if (controller.signal.aborted) void w.terminate();
      },
      () => {},
    );
    worker = await cancellable(startingWorker);
    controller.signal.throwIfAborted();
    for (const number of pageNumbers) {
      controller.signal.throwIfAborted();
      onProgress(`Reading scanned page ${number}…`);
      const page = await pdf.getPage(number),
        base = page.getViewport({ scale: 1 }),
        scale = Math.min(
          200 / 72,
          2400 / Math.max(base.width, base.height),
          Math.sqrt(4000000 / (base.width * base.height)),
        ),
        viewport = page.getViewport({ scale });
      canvas = canvasFactory(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const render = page.render({
        canvasContext: ctx,
        viewport,
        background: "rgb(255,255,255)",
      });
      await render.promise;
      const png = await encodeCanvas(canvas),
        { data } = await cancellable(
          worker.recognize(
            new Uint8Array(await png.arrayBuffer()),
            {},
            { blocks: true, text: true },
          ),
        );
      controller.signal.throwIfAborted();
      const replacements = [];
      for (const change of plan.changes.filter((c) => c.page === number))
        for (const match of findOcrMatches(data.blocks, change)) {
          if (
            replacements.some(
              (r) =>
                r.box.x0 < match.box.x1 &&
                r.box.x1 > match.box.x0 &&
                r.box.y0 < match.box.y1 &&
                r.box.y1 > match.box.y0,
            )
          )
            throw new Error(
              "The OCR proposal edits overlapping text. Request each phrase once.",
            );
          clearOcrPixels(ctx, match, canvas.width, canvas.height);
          if (
            Array.from(change.replace).some(
              (c) => !font.getCharacterSet().includes(c.codePointAt(0)),
            )
          )
            throw new Error(
              "The OCR replacement font supports Latin characters only. Use supported text.",
            );
          const b = match.box,
            maxHeight = (b.y1 - b.y0) / scale,
            size = Math.min(
              maxHeight / 0.9,
              (b.x1 - b.x0) / scale / font.widthOfTextAtSize(change.replace, 1),
            );
          if (!Number.isFinite(size) || size < 6 || size < maxHeight * 0.65)
            throw new Error(
              "The new text is too long for the scanned region. Shorten the replacement.",
            );
          replacements.push({ box: b, text: change.replace, size });
          log.push({
            location: `Scanned page ${number}`,
            description: `OCR: “${change.find}” → “${change.replace}”.`,
          });
        }
      onProgress(`Preparing edited page ${number}…`);
      const image = await doc.embedPng(
        await (await encodeCanvas(canvas)).arrayBuffer(),
      );
      doc.removePage(number - 1);
      const edited = doc.insertPage(number - 1, [
        viewport.width / scale,
        viewport.height / scale,
      ]);
      edited.drawImage(image, {
        x: 0,
        y: 0,
        width: edited.getWidth(),
        height: edited.getHeight(),
      });
      for (const r of replacements)
        edited.drawText(r.text, {
          x: r.box.x0 / scale,
          y: edited.getHeight() - r.box.y1 / scale,
          size: r.size,
          font,
          color: rgb(0, 0, 0),
        });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    controller.signal.throwIfAborted();
    const bytes = await doc.save();
    controller.signal.throwIfAborted();
    if (bytes.length > 10485760)
      throw new Error("The edited scan exceeds 10 MB. Try fewer pages.");
    return {
      kind: "pdf",
      blob: new Blob([bytes], { type: "application/pdf" }),
      name: plan.name.replace(/\.pdf$/i, "-edited.pdf"),
      log,
      previewPages: [pageNumbers[0], pageNumbers[0]],
      notes: [
        "OCR matched printed English text. Check every replacement in the preview.",
        "Edited pages are rebuilt as scans with selectable replacement text in Helvetica; other content on those pages stays an image. Original fonts and exact scan texture are not preserved.",
        "The original is unchanged. This is not secure redaction.",
      ],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", stop);
    await worker?.terminate();
    await loading?.destroy();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
