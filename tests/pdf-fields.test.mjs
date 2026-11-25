import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";
import { editPdf } from "../public/edit-pdf.js";
import { pdfDetails } from "../server/pdf-details.mjs";
const plan = (changes) => ({
  fileId: "file",
  name: "application.pdf",
  changes,
});
const fixture = () =>
  readFile(new URL("./fixtures/application.pdf", import.meta.url));
const fill = (field, expected, value) => ({
  op: "fillField",
  field,
  expected,
  value,
});
test("form manifest derives actual types, options, pages and values; filling preserves fields and original", async () => {
  const original = await fixture(),
    details = await pdfDetails(original);
  assert.equal(
    details.fields.find((f) => f.name === "full_name").value,
    "Luna",
  );
  assert.deepEqual(details.fields.find((f) => f.name === "plan").options, [
    "Basic",
    "Premium",
  ]);
  assert.deepEqual(details.fields.find((f) => f.name === "agree").pages, [1]);
  const result = await editPdf(
    new Blob([original]),
    plan([
      fill("full_name", "Luna", "Mira"),
      fill("agree", false, true),
      fill("plan", ["Basic"], ["Premium"]),
      fill("contact", "Phone", "Email"),
    ]),
  );
  const doc = await PDFDocument.load(await result.blob.arrayBuffer()),
    form = doc.getForm();
  assert.equal(form.getTextField("full_name").getText(), "Mira");
  assert.equal(form.getCheckBox("agree").isChecked(), true);
  assert.deepEqual(form.getDropdown("plan").getSelected(), ["Premium"]);
  assert.equal(form.getRadioGroup("contact").getSelected(), "Email");
  assert.equal(form.getTextField("reference").isReadOnly(), true);
  assert.equal(form.getFields().length, 5);
  assert.equal(
    (await PDFDocument.load(original))
      .getForm()
      .getTextField("full_name")
      .getText(),
    "Luna",
  );
});
test("form filling rejects stale values, unknown fields/options, read-only fields and duplicate operations", async () => {
  for (const change of [
    fill("full_name", "Wrong", "Mira"),
    fill("missing", "", "Mira"),
    fill("plan", ["Basic"], ["Unknown"]),
    fill("reference", "APP-4827", "Wrong"),
  ])
    await assert.rejects(editPdf(new Blob([await fixture()]), plan([change])));
  await assert.rejects(
    editPdf(
      new Blob([await fixture()]),
      plan([fill("agree", false, true), fill("agree", false, true)]),
    ),
    /once/,
  );
  const doc = await PDFDocument.load(await fixture());
  doc.catalog.set(PDFName.of("Perms"), doc.context.obj({}));
  await assert.rejects(
    editPdf(new Blob([await doc.save()]), plan([fill("agree", false, true)])),
    /Signed/,
  );
  await assert.rejects(
    editPdf(
      new Blob([await fixture()]),
      plan([{ op: "selectPages", pages: [1] }]),
    ),
    /preserve/,
  );
});
test("PDF rewrites change searchable text, preserve source, reject overflow and missing matches", async () => {
  const original = await readFile(
      new URL("./fixtures/text.pdf", import.meta.url),
    ),
    wasmBinary = await readFile(
      new URL(
        "../node_modules/@embedpdf/pdfium/dist/pdfium.wasm",
        import.meta.url,
      ),
    );
  const rewrite = (replace) => ({
    op: "replaceText",
    page: 1,
    find: "7392",
    replace,
    count: 1,
  });
  const result = await editPdf(new Blob([original]), plan([rewrite("7393")]), {
    wasmBinary,
  });
  Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(await result.blob.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  try {
    const pdf = await loading.promise,
      text = (await (await pdf.getPage(1)).getTextContent()).items
        .map((i) => i.str)
        .join(" ");
    assert.match(text, /7393/);
    assert.doesNotMatch(text, /7392/);
  } finally {
    await loading.destroy();
  }
  assert.deepEqual(
    original,
    await readFile(new URL("./fixtures/text.pdf", import.meta.url)),
  );
  await assert.rejects(
    editPdf(
      new Blob([original]),
      plan([rewrite("A VERY LONG REPLACEMENT THAT DOES NOT FIT")]),
      { wasmBinary },
    ),
    /exceeds/,
  );
  await assert.rejects(
    editPdf(new Blob([original]), plan([{ ...rewrite("7393"), count: 2 }]), {
      wasmBinary,
    }),
    /expected 2/,
  );
});
