import { init } from "@embedpdf/pdfium";
let engine;
async function getEngine(wasmBinary) {
  engine ??= (async () => {
    if (!wasmBinary) {
      const response = await fetch("/extraction-assets/pdfium.wasm");
      if (!response.ok)
        throw new Error("The PDF text editor could not load. Try again.");
      wasmBinary = await response.arrayBuffer();
    }
    const m = await init({ wasmBinary });
    m.PDFiumExt_Init();
    return m;
  })();
  try {
    return await engine;
  } catch (error) {
    engine = null;
    throw error;
  }
}
export async function rewritePdfText(
  bytes,
  changes,
  { signal, wasmBinary } = {},
) {
  const m = await getEngine(wasmBinary),
    memory = m.pdfium,
    alloc = (size) => memory.wasmExports.malloc(size),
    free = (ptr) => memory.wasmExports.free(ptr);
  const input = alloc(bytes.length);
  memory.HEAPU8.set(bytes, input);
  const doc = m.FPDF_LoadMemDocument(input, bytes.length, "");
  if (!doc) {
    free(input);
    throw new Error("This PDF could not be opened for text rewriting.");
  }
  const log = [];
  const read = (object, textPage) => {
    const size = m.FPDFTextObj_GetText(object, textPage, 0, 0);
    if (size <= 2) return "";
    if (size > 200000)
      throw new Error("This text object is too large. Edit a smaller PDF.");
    const ptr = alloc(Math.max(2, size));
    try {
      m.FPDFTextObj_GetText(object, textPage, ptr, size);
      return memory.UTF16ToString(ptr);
    } finally {
      free(ptr);
    }
  };
  const bounds = (object) => {
    const ptr = alloc(16);
    try {
      if (!m.FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12))
        throw new Error("The text bounds could not be checked.");
      return Array.from({ length: 4 }, (_, i) =>
        memory.getValue(ptr + i * 4, "float"),
      );
    } finally {
      free(ptr);
    }
  };
  try {
    for (const change of changes) {
      signal?.throwIfAborted();
      const page = m.FPDF_LoadPage(doc, change.page - 1);
      if (!page) throw new Error("A rewrite page could not be opened.");
      let textPage = m.FPDFText_LoadPage(page);
      try {
        const matches = [];
        let count = 0;
        for (let i = 0; i < m.FPDFPage_CountObjects(page); i++) {
          const object = m.FPDFPage_GetObject(page, i);
          if (m.FPDFPageObj_GetType(object) !== 1) continue;
          const text = read(object, textPage),
            occurrences = text.split(change.find).length - 1;
          if (occurrences) {
            count += occurrences;
            matches.push({
              object,
              text,
              before: bounds(object),
              after: text.split(change.find).join(change.replace),
            });
          }
        }
        if (count !== change.count)
          throw new Error(
            `Page ${change.page}: expected ${change.count} exact match(es), found ${count}. Scanned or fragmented PDF text may require editing the source document.`,
          );
        m.FPDFText_ClosePage(textPage);
        textPage = 0;
        for (const match of matches) {
          const size = (match.after.length + 1) * 2,
            ptr = alloc(size);
          try {
            memory.stringToUTF16(match.after, ptr, size);
            if (!m.FPDFText_SetText(match.object, ptr))
              throw new Error(
                "The original PDF font cannot encode this replacement.",
              );
          } finally {
            free(ptr);
          }
          const after = bounds(match.object),
            before = match.before;
          if (
            after.some((v) => !Number.isFinite(v)) ||
            after[0] < before[0] - 1 ||
            after[1] < before[1] - 1 ||
            after[2] > before[2] + 1 ||
            after[3] > before[3] + 1
          )
            throw new Error(
              "The rewritten text exceeds its original text box. Shorten the replacement or edit the source document.",
            );
        }
        if (!m.FPDFPage_GenerateContent(page))
          throw new Error("The rewritten page could not be saved.");
        textPage = m.FPDFText_LoadPage(page);
        for (const match of matches)
          if (read(match.object, textPage) !== match.after)
            throw new Error(
              "The PDF font could not preserve the replacement text. No download was created.",
            );
        log.push({
          location: `Original page ${change.page}`,
          description: `Replace “${change.find}” with “${change.replace}” (${count} match${count === 1 ? "" : "es"}).`,
        });
      } finally {
        if (textPage) m.FPDFText_ClosePage(textPage);
        m.FPDF_ClosePage(page);
      }
    }
    const writer = m.PDFiumExt_OpenFileWriter();
    try {
      if (!m.FPDF_SaveAsCopy(doc, writer, 2))
        throw new Error("The rewritten PDF could not be exported.");
      const size = m.PDFiumExt_GetFileWriterSize(writer);
      if (size > 10485760) throw new Error("The rewritten PDF exceeds 10 MB.");
      const ptr = alloc(size);
      try {
        m.PDFiumExt_GetFileWriterData(writer, ptr, size);
        return { bytes: memory.HEAPU8.slice(ptr, ptr + size), log };
      } finally {
        free(ptr);
      }
    } finally {
      m.PDFiumExt_CloseFileWriter(writer);
    }
  } finally {
    m.FPDF_CloseDocument(doc);
    free(input);
  }
}
