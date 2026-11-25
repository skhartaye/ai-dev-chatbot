import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { editOffice, validateEditPlan } from "../public/edit-office.js";

const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const word = (text) =>
  new Blob([
    zipSync({
      "word/document.xml": strToU8(
        `<w:document xmlns:w="${W}"><w:body>${text}</w:body></w:document>`,
      ),
      "word/styles.xml": strToU8("<untouched/>"),
    }),
  ]);
const plan = (name, changes) => ({ fileId: "file", name, changes });

test("Word replacement crosses formatted runs, escapes XML, and leaves original/other parts intact", async () => {
  const original = word(
    "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Lu</w:t></w:r><w:r><w:t>na</w:t></w:r></w:p>",
  );
  const result = await editOffice(
    original,
    plan("sample.docx", [{ find: "Luna", replace: "Mira & <team>", count: 1 }]),
  );
  const zip = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const doc = new DOMParser().parseFromString(
    strFromU8(zip["word/document.xml"]),
    "application/xml",
  );
  assert.equal(doc.documentElement.textContent, "Mira & <team>");
  assert.equal(doc.getElementsByTagNameNS(W, "b").length, 1);
  assert.equal(strFromU8(zip["word/styles.xml"]), "<untouched/>");
  assert.equal(
    unzipSync(new Uint8Array(await original.arrayBuffer()))["word/document.xml"]
      .length > 0,
    true,
  );
  assert.equal(result.name, "sample-edited.docx");
  await assert.rejects(
    editOffice(
      original,
      plan("sample.docx", [{ find: "missing", replace: "x", count: 1 }]),
    ),
    /found 0/,
  );
});

test("Word repeated matches are exact, invalid requests and protected/active files fail closed", async () => {
  const original = word("<w:p><w:r><w:t>Luna Luna</w:t></w:r></w:p>");
  const result = await editOffice(
    original,
    plan("a.docx", [{ find: "Luna", replace: "M", count: 2 }]),
  );
  assert.match(
    strFromU8(
      unzipSync(new Uint8Array(await result.blob.arrayBuffer()))[
        "word/document.xml"
      ],
    ),
    /M M/,
  );
  await assert.rejects(
    editOffice(
      original,
      plan("a.docx", [{ find: "Luna", replace: "M", count: 1 }]),
    ),
    /found 2/,
  );
  assert.throws(
    () =>
      validateEditPlan(
        plan("a.docx", [{ find: "Luna", replace: "x", count: 1 }]),
        [{ id: "another", name: "a.docx" }],
      ),
    /conversation/,
  );
  assert.throws(
    () =>
      validateEditPlan(
        plan("a.docx", [{ find: "Luna", replace: "x\u0000", count: 1 }]),
        [{ id: "file", name: "a.docx" }],
      ),
    /control characters/,
  );
  await assert.rejects(
    editOffice(
      word("<w:p><w:ins><w:r><w:t>Luna</w:t></w:r></w:ins></w:p>"),
      plan("a.docx", [{ find: "Luna", replace: "x", count: 1 }]),
    ),
    /tracked changes/,
  );
});

test("Excel edits preserve numeric types and styles, use literal strings, and validate exact cells", async () => {
  const original = new Blob([await readFile("tests/fixtures/sample.xlsx")]);
  const input = unzipSync(new Uint8Array(await original.arrayBuffer()));
  const result = await editOffice(
    original,
    plan("sample.xlsx", [
      {
        sheet: "Orders",
        find: "Mango",
        replace: '=HYPERLINK("https://evil.invalid")',
        count: 1,
      },
      { sheet: "Orders", find: 3, replace: 7, count: 1 },
    ]),
  );
  const output = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const sheet = new DOMParser().parseFromString(
    strFromU8(output["xl/worksheets/sheet1.xml"]),
    "application/xml",
  );
  assert.equal(sheet.getElementsByTagNameNS(S, "f").length, 0);
  assert.match(sheet.documentElement.textContent, /HYPERLINK/);
  assert.ok(
    Array.from(sheet.getElementsByTagNameNS(S, "c")).some(
      (c) => c.getAttribute("t") === "n" && c.textContent === "7",
    ),
  );
  assert.deepEqual(output["xl/styles.xml"], input["xl/styles.xml"]);
  assert.deepEqual(output["xl/workbook.xml"], input["xl/workbook.xml"]);
  await assert.rejects(
    editOffice(
      original,
      plan("sample.xlsx", [
        { sheet: "Missing", find: "Mango", replace: "Banana", count: 1 },
      ]),
    ),
    /not found/,
  );
  const formulaArchive = {
    ...input,
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1"><f>SUM(B1:B3)</f><v>0</v></c></row></sheetData></worksheet>`,
    ),
  };
  await assert.rejects(
    editOffice(
      new Blob([zipSync(formulaArchive)]),
      plan("sample.xlsx", [
        { sheet: "Orders", find: "0", replace: 1, count: 1 },
      ]),
    ),
    /found 0/,
  );
});

test("real Word fixture remains readable after editing and all unedited ZIP parts match", async () => {
  const mammoth = await import("mammoth");
  const original = new Blob([await readFile("tests/fixtures/sample.docx")]);
  const output = await editOffice(
    original,
    plan("sample.docx", [{ find: "Luna", replace: "Mira", count: 1 }]),
  );
  const text = await mammoth.extractRawText({
    buffer: Buffer.from(await output.blob.arrayBuffer()),
  });
  assert.match(text.value, /Mira/);
  assert.doesNotMatch(text.value, /Luna/);
  const a = unzipSync(new Uint8Array(await original.arrayBuffer())),
    b = unzipSync(new Uint8Array(await output.blob.arrayBuffer()));
  for (const key of Object.keys(a))
    if (key !== "word/document.xml") assert.deepEqual(b[key], a[key], key);
});
