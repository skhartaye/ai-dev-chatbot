import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas, DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { createWorker } from "tesseract.js";
import { findOcrMatches, clearOcrPixels } from "../public/ocr-text-region.js";
Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
const plan = (changes) => ({ fileId: "scan", name: "scan.pdf", changes });
const change = {
  op: "ocrReplaceText",
  page: 1,
  find: "Invoice 4827",
  replace: "Invoice 4828",
  count: 1,
};
const word = (text, x, confidence = 98) => ({
  text,
  confidence,
  bbox: { x0: x, y0: 20, x1: x + 20, y1: 40 },
});
test("OCR guards reject uncertainty, wrong counts and coloured regions", () => {
  const blocks = [
    {
      paragraphs: [
        { lines: [{ words: [word("Invoice", 10), word("4827", 40, 40)] }] },
      ],
    },
  ];
  assert.throws(() => findOcrMatches(blocks, change), /unsure/);
  assert.throws(() => findOcrMatches([], change), /found 0/);
  const c = createCanvas(100, 60),
    ctx = c.getContext("2d");
  ctx.fillStyle = "blue";
  ctx.fillRect(0, 0, 100, 60);
  assert.throws(
    () =>
      clearOcrPixels(
        ctx,
        {
          box: { x0: 20, y0: 20, x1: 60, y1: 40 },
          words: [{ bbox: { x0: 20, y0: 20, x1: 60, y1: 40 } }],
          others: [],
        },
        100,
        60,
      ),
    /colour|white/,
  );
});
test("real OCR locates scanned text, changes visible pixels and exports selectable replacement without altering source", async () => {
  const { editScannedPdf } = await import("../public/edit-scanned-pdf.js"),
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"),
    source = await readFile(
      new URL("./fixtures/ocr-scan.pdf", import.meta.url),
    );
  let calls = 0;
  const result = await editScannedPdf(new Blob([source]), plan([change]), {
    canvasFactory: createCanvas,
    encodeCanvas: async (c) => new Blob([c.toBuffer("image/png")]),
    pdfjsModule: pdfjs,
    fontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
    createOcrWorker: async () => {
      calls++;
      return createWorker("eng", 1, {
        langPath: resolve("node_modules/@tesseract.js-data/eng/4.0.0"),
        cacheMethod: "none",
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.log.length, 1);
  assert.match(result.log[0].description, /4828/);
  const output = await PDFDocument.load(await result.blob.arrayBuffer());
  assert.equal(output.getPageCount(), 1);
  const loading = pdfjs.getDocument({
    data: new Uint8Array(await result.blob.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  try {
    const pdf = await loading.promise,
      text = (await (await pdf.getPage(1)).getTextContent()).items
        .map((x) => x.str)
        .join(" ");
    assert.match(text, /Invoice 4828/);
    assert.doesNotMatch(text, /4827/);
    const page = await pdf.getPage(1),
      canvas = createCanvas(600, 800),
      ctx = canvas.getContext("2d");
    await page.render({
      canvasContext: ctx,
      viewport: page.getViewport({ scale: 1 }),
    }).promise;
    const pixel = ctx.getImageData(60, 320, 1, 1).data;
    assert.deepEqual(
      Array.from(pixel),
      [34, 85, 170, 255],
      "unrelated blue square is preserved",
    );
    const oldLoading = pdfjs.getDocument({
      data: new Uint8Array(source),
      isEvalSupported: false,
    });
    try {
      const oldPage = await (await oldLoading.promise).getPage(1),
        oldCanvas = createCanvas(600, 800),
        oldCtx = oldCanvas.getContext("2d");
      await oldPage.render({
        canvasContext: oldCtx,
        viewport: oldPage.getViewport({ scale: 1 }),
      }).promise;
      assert.notDeepEqual(
        ctx.getImageData(45, 120, 165, 25).data,
        oldCtx.getImageData(45, 120, 165, 25).data,
        "rewritten phrase changes actual pixels",
      );
    } finally {
      await oldLoading.destroy();
    }
  } finally {
    await loading.destroy();
  }
  assert.deepEqual(
    source,
    await readFile(new URL("./fixtures/ocr-scan.pdf", import.meta.url)),
  );
});

test("closing an OCR edit rejects pending recognition and terminates its worker", async () => {
  const { editScannedPdf } = await import("../public/edit-scanned-pdf.js"),
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"),
    controller = new AbortController();
  let stopped = 0;
  await assert.rejects(
    editScannedPdf(
      new Blob([
        await readFile(new URL("./fixtures/ocr-scan.pdf", import.meta.url)),
      ]),
      plan([change]),
      {
        signal: controller.signal,
        pdfjsModule: pdfjs,
        fontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
        canvasFactory: createCanvas,
        encodeCanvas: async (c) => new Blob([c.toBuffer("image/png")]),
        createOcrWorker: async () => ({
          recognize: () => {
            controller.abort(new Error("Cancelled by test"));
            return new Promise(() => {});
          },
          terminate: async () => {
            stopped++;
          },
        }),
      },
    ),
    /Cancelled/,
  );
  assert.ok(stopped > 0);
});
