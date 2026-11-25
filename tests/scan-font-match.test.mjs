import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createCanvas, DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { matchScanFont } from "../public/scan-font-match.js";
Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
test("scan matching distinguishes serif bold, sans italic and monospace and recovers size and baseline", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  for (const name of [
    StandardFonts.TimesRomanBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.Courier,
  ]) {
    const doc = await PDFDocument.create(),
      page = doc.addPage([320, 160]),
      font = await doc.embedFont(name);
    page.drawText("Invoice", { x: 40, y: 60, size: 24, font });
    const loading = pdfjs.getDocument({
      data: await doc.save(),
      standardFontDataUrl:
        resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
      useSystemFonts: false,
      isEvalSupported: false,
    });
    try {
      const source = await loading.promise,
        c = createCanvas(320, 160);
      await (
        await source.getPage(1)
      ).render({
        canvasContext: c.getContext("2d"),
        viewport: (await source.getPage(1)).getViewport({ scale: 1 }),
      }).promise;
      const matched = await matchScanFont(
        c.getContext("2d"),
        {
          words: [
            { text: "Invoice", bbox: { x0: 35, y0: 65, x1: 200, y1: 112 } },
          ],
        },
        {
          pdfjs,
          canvasFactory: createCanvas,
          fontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
        },
      );
      assert.equal(matched.name, name);
      assert.ok(
        Math.abs(matched.sizePixels - 24) < 2,
        `${name} size: ${matched.sizePixels}`,
      );
      assert.ok(
        Math.abs(matched.baseline - 100) < 2,
        `${name} baseline: ${matched.baseline}`,
      );
    } finally {
      await loading.destroy();
    }
  }
});
