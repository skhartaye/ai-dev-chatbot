import test from "node:test";
import assert from "node:assert/strict";
import {
  createCanvas,
  loadImage,
  DOMMatrix,
  Path2D,
  ImageData,
} from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { validateVisualPlan } from "../public/media-edit-plan.js";
import { editImage } from "../public/edit-image.js";
import { editPdf } from "../public/edit-pdf.js";

const plan = (name, changes) => ({ fileId: "file", name, changes });
const imageOptions = {
  canvasFactory: createCanvas,
  decodeImage: async (blob) => loadImage(Buffer.from(await blob.arrayBuffer())),
  encodeCanvas: async (canvas) =>
    new Blob([canvas.toBuffer("image/png")], { type: "image/png" }),
};
async function imageFixture() {
  const c = createCanvas(10, 6),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#FF0000";
  ctx.fillRect(0, 0, 5, 6);
  ctx.fillStyle = "#0000FF";
  ctx.fillRect(5, 0, 5, 6);
  return new Blob([c.toBuffer("image/png")], { type: "image/png" });
}
async function pixels(blob) {
  const img = await loadImage(Buffer.from(await blob.arrayBuffer())),
    c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return {
    width: img.width,
    height: img.height,
    pixel: (x, y) =>
      Array.from(c.getContext("2d").getImageData(x, y, 1, 1).data),
  };
}
test("image operations crop and rotate actual pixels, resize output, and preserve the original", async () => {
  const original = await imageFixture(),
    before = new Uint8Array(await original.arrayBuffer());
  const result = await editImage(
    original,
    plan("photo.jpg", [
      { op: "crop", x: 0.5, y: 0, width: 0.5, height: 1 },
      { op: "rotate", degrees: 90 },
      { op: "resize", width: 12, height: 10 },
    ]),
    imageOptions,
  );
  const output = await pixels(result.blob);
  assert.equal(output.width, 12);
  assert.equal(output.height, 10);
  assert.deepEqual(output.pixel(6, 5), [0, 0, 255, 255]);
  assert.equal(result.name, "photo-edited.png");
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), before);
});
test("image adjustments, flips and shapes change pixels without CSS filter support", async () => {
  const original = await imageFixture();
  const gray = await editImage(
    original,
    plan("a.png", [{ op: "adjust", grayscale: true }]),
    imageOptions,
  );
  const value = (await pixels(gray.blob)).pixel(2, 2);
  assert.equal(value[0], value[1]);
  assert.equal(value[1], value[2]);
  assert.equal(value[3], 255);
  const flip = await editImage(
    original,
    plan("a.png", [
      { op: "flip", axis: "horizontal" },
      {
        op: "rectangle",
        x: 0,
        y: 0,
        width: 0.2,
        height: 0.5,
        color: "#00FF00",
      },
    ]),
    imageOptions,
  );
  const p = await pixels(flip.blob);
  assert.deepEqual(p.pixel(0, 0), [0, 255, 0, 255]);
  assert.deepEqual(p.pixel(3, 3), [0, 0, 255, 255]);
});
test("visual plans reject wrong owners, unsupported edits, oversized selections and invalid geometry", async () => {
  assert.throws(
    () =>
      validateVisualPlan(plan("a.png", [{ op: "rotate", degrees: 90 }]), [
        { id: "other", name: "a.png" },
      ]),
    /conversation/,
  );
  for (const change of [
    { op: "eraseBackground" },
    { op: "crop", x: 0.9, y: 0, width: 0.5, height: 1 },
    { op: "resize", width: 8192, height: 8192 },
    { op: "addText", text: "x", x: 0, y: 0, fontSize: NaN },
  ])
    assert.throws(() =>
      validateVisualPlan(plan("a.png", [change]), [
        { id: "file", name: "a.png" },
      ]),
    );
  assert.throws(
    () =>
      validateVisualPlan(
        plan("a.pdf", [{ op: "selectPages", pages: [1, 1] }]),
        [{ id: "file", name: "a.pdf" }],
      ),
    /unique/,
  );
  assert.throws(
    () =>
      validateVisualPlan(
        plan("a.pdf", [
          {
            op: "highlight",
            page: 1,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            opacity: 1,
          },
        ]),
        [{ id: "file", name: "a.pdf" }],
      ),
    /Opacity/,
  );
  await assert.rejects(
    editImage(
      new Blob(["not an image"]),
      plan("a.png", [{ op: "rotate", degrees: 90 }]),
      imageOptions,
    ),
  );
});
async function pdfFixture() {
  const doc = await PDFDocument.create();
  doc.setTitle("Original PDF");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ["FIRST ORIGINAL", "SECOND ORIGINAL"])
    doc.addPage([400, 500]).drawText(text, { x: 40, y: 400, font, size: 18 });
  return new Blob([await doc.save()], { type: "application/pdf" });
}
test("PDF edits add readable Unicode annotations, retain source text, reorder and rotate original pages", async () => {
  const original = await pdfFixture(),
    before = new Uint8Array(await original.arrayBuffer());
  const result = await editPdf(
    original,
    plan("sample.pdf", [
      {
        op: "addText",
        page: 2,
        text: "RÉVISÉ",
        x: 0.1,
        y: 0.1,
        fontSize: 20,
        color: "#315B3E",
        bold: true,
      },
      {
        op: "highlight",
        page: 2,
        x: 0.1,
        y: 0.3,
        width: 0.5,
        height: 0.05,
        color: "#FFFF00",
      },
      { op: "rotate", page: 1, degrees: 90 },
      { op: "selectPages", pages: [2, 1] },
    ]),
  );
  const pdf = await PDFDocument.load(await result.blob.arrayBuffer());
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getPages()[1].getRotation().angle, 90);
  assert.equal(pdf.getTitle(), "Original PDF");
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), before);
  Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(await result.blob.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  try {
    const output = await loading.promise,
      content = await (await output.getPage(1)).getTextContent();
    const text = content.items.map((i) => i.str).join(" ");
    assert.match(text, /SECOND ORIGINAL/);
    assert.match(text, /RÉVISÉ/);
  } finally {
    await loading.destroy();
  }
});
test("PDF page removal works while forms, impossible pages and removed-page edits fail safely", async () => {
  const original = await pdfFixture();
  const removed = await editPdf(
    original,
    plan("a.pdf", [{ op: "selectPages", pages: [2] }]),
  );
  assert.equal(
    (await PDFDocument.load(await removed.blob.arrayBuffer())).getPageCount(),
    1,
  );
  await assert.rejects(
    editPdf(original, plan("a.pdf", [{ op: "rotate", page: 3, degrees: 90 }])),
    /does not exist/,
  );
  await assert.rejects(
    editPdf(
      original,
      plan("a.pdf", [
        { op: "rotate", page: 1, degrees: 90 },
        { op: "selectPages", pages: [2] },
      ]),
    ),
    /also removes/,
  );
  const form = await PDFDocument.create();
  form.addPage();
  form.getForm().createTextField("name");
  await assert.rejects(
    editPdf(
      new Blob([await form.save()]),
      plan("a.pdf", [{ op: "rotate", page: 1, degrees: 90 }]),
    ),
    /forms and signed/,
  );
});
