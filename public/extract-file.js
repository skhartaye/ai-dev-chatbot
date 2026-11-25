export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PROMPT_CHARS = 20000;
const formats = new Set(["pdf", "docx", "xlsx", "csv", "txt", "png", "jpg", "jpeg", "webp"]);

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export function validateFile(file) {
  const extension = file.name.split(".").at(-1).toLowerCase();
  if (!formats.has(extension)) throw new Error("Use PDF, DOCX, XLSX, CSV, TXT, PNG, JPG, or WebP. Save older DOC/XLS files as DOCX/XLSX first.");
  if (!file.size) throw new Error("This file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("This file exceeds 10 MB. Choose a smaller file.");
  return extension;
}

// Reject oversized expanded Office archives before a parser allocates their contents.
export function checkOfficeArchive(buffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("This is not a readable Office document.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true), total = 0;
  if (count > 2000 || offset === 0xffffffff) throw new Error("This document is too complex. Export a smaller copy.");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("This document is damaged.");
    total += view.getUint32(offset + 24, true);
    if (total > 50 * 1024 * 1024) throw new Error("This document expands beyond 50 MB. Export a smaller copy.");
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

export function appendExtractedText(draft, name, text) {
  const value = `${draft}${draft ? "\n\n" : ""}[File: ${name}]\n${text.trim()}\n[End file]`;
  if (value.length > MAX_PROMPT_CHARS) throw new Error("The extracted text plus your draft exceeds 20,000 characters. Send a smaller section or split the file; nothing was cut off.");
  return value;
}

function readOffice(buffer, extension, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/extract-office.worker.js", { type: "module" });
    const finish = (error, text) => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(text);
    };
    const abort = () => finish(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new Error("The document reader could not start. Reload and try again."));
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.text);
    worker.postMessage({ buffer, extension }, [buffer]);
  });
}

export async function extractFile(file, { signal, onProgress = () => {} }) {
  const extension = validateFile(file);
  signal.throwIfAborted();
  let ocr, loading;
  const abort = () => { void ocr?.terminate(); void loading?.destroy(); };
  signal.addEventListener("abort", abort, { once: true });
  const recognize = async (image) => {
    signal.throwIfAborted();
    if (!ocr) {
      const module = await import("tesseract.js");
      const { createWorker } = module.default || module;
      ocr = await abortable(createWorker("eng", 1, {
        workerPath: `${location.origin}/extraction-assets/ocr-worker.js`,
        corePath: `${location.origin}/extraction-assets/core`,
        langPath: `${location.origin}/extraction-assets/lang`,
        workerBlobURL: false,
        errorHandler: () => {},
        logger: ({ status, progress }) => onProgress(`OCR: ${status}${Number.isFinite(progress) ? ` ${Math.round(progress * 100)}%` : ""}`),
      }).then(worker => { if (signal.aborted) void worker.terminate(); return worker; }), signal);
      signal.throwIfAborted();
    }
    const { data } = await abortable(ocr.recognize(image), signal);
    return data.text;
  };
  try {
    let text;
    if (extension === "txt" || extension === "csv") text = await file.text();
    else if (extension === "docx" || extension === "xlsx") {
      const buffer = await file.arrayBuffer();
      checkOfficeArchive(buffer);
      signal.throwIfAborted();
      text = await readOffice(buffer, extension, signal);
    } else if (extension === "pdf") {
      const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/extraction-assets/pdf.worker.mjs";
      loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false,
        cMapUrl: "/extraction-assets/cmaps/", cMapPacked: true, standardFontDataUrl: "/extraction-assets/standard_fonts/", wasmUrl: "/extraction-assets/pdf-wasm/" });
      const pdf = await loading.promise;
      if (pdf.numPages > 30) throw new Error("Choose a PDF with 30 pages or fewer, or split this document first.");
      const pages = [];
      let scans = 0;
      let hasReadableText = false;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        signal.throwIfAborted();
        onProgress(`Reading PDF page ${pageNumber} of ${pdf.numPages}…`);
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        let pageText = content.items.map(item => (item.str || "") + (item.hasEOL ? "\n" : " ")).join("").trim();
        if (pageText.length < 40) {
          if (++scans > 10) throw new Error("This PDF needs OCR on more than 10 pages. Split it into smaller files.");
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(base.width, base.height)) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
          const recognized = await recognize(canvas);
          if (recognized.trim().length > pageText.length) pageText = recognized.trim();
          canvas.width = canvas.height = 0;
        }
        if (pageText.trim()) hasReadableText = true;
        pages.push(`[Page ${pageNumber}]\n${pageText || "[No readable text on this page]"}`);
        page.cleanup();
        if (pages.join("\n\n").length > MAX_PROMPT_CHARS) throw new Error("This PDF exceeds the 20,000-character prompt limit. Split it into smaller files.");
      }
      text = hasReadableText ? pages.join("\n\n") : "";
    } else {
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 30_000_000) throw new Error("This image exceeds 30 megapixels. Resize it and try again.");
        const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(bitmap.width * scale); canvas.height = Math.ceil(bitmap.height * scale);
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        text = await recognize(canvas);
        canvas.width = canvas.height = 0;
      } finally { bitmap.close(); }
    }
    signal.throwIfAborted();
    if (!text?.trim()) throw new Error("No readable text found. Try a clearer image or a text-based document.");
    return text.trim();
  } finally {
    signal.removeEventListener("abort", abort);
    await ocr?.terminate();
    await loading?.destroy();
  }
}
