export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const formats = new Set(["pdf", "docx", "xlsx", "csv", "txt", "png", "jpg", "jpeg", "webp"]);

export function validateFile(file) {
  if(file.name.length>255) throw new Error("Rename this file to 255 characters or fewer.");
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

function readOffice(buffer, extension, signal,includeCellMap) {
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
    worker.postMessage({ buffer, extension,includeCellMap }, [buffer]);
  });
}

export async function extractFile(file, { signal,includeCellMap=true }) {
  const extension = validateFile(file);
  signal.throwIfAborted();
  let text;
  if (extension === "txt" || extension === "csv") text = await file.text();
  else if (extension === "docx" || extension === "xlsx") {
    const buffer = await file.arrayBuffer();
    checkOfficeArchive(buffer);
    signal.throwIfAborted();
    text = await readOffice(buffer, extension, signal,includeCellMap);
  } else throw new Error("PDFs and images are read directly by AI.");
  signal.throwIfAborted();
  if (!text?.trim()) throw new Error("No readable document text found.");
  return text.trim();
}
