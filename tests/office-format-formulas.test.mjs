import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { initSync } from "@ironcalc/wasm";
import {
  calculateWorkbook,
  validateFormula,
} from "../public/formula-engine.js";
import { editOffice, validateEditPlan } from "../public/edit-office.js";
import { excelCellMap } from "../public/excel-cell-map.js";
const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
initSync({
  module: await readFile("node_modules/@ironcalc/wasm/wasm_bg.wasm"),
});
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const parse = (b) =>
  new DOMParser().parseFromString(strFromU8(b), "application/xml");
const plan = (changes) => ({ fileId: "file", name: "sample.xlsx", changes });
const calculate = async (s, n) => calculateWorkbook(s, n);
const zip = unzipSync(await readFile("tests/fixtures/sample.xlsx"));
const fixture = () =>
  new Blob([
    zipSync({
      ...zip,
      "xl/worksheets/sheet1.xml": strToU8(
        `<worksheet xmlns="${S}"><dimension ref="A1:D3"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="inlineStr"><is><t>Quantity</t></is></c><c r="C1" t="inlineStr"><is><t>Price</t></is></c><c r="D1" t="inlineStr"><is><t>Total</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Mango</t></is></c><c r="B2" t="n"><v>3</v></c><c r="C2" t="n"><v>450</v></c><c r="D2"><f>B2*C2</f><v>1350</v></c></row><row r="3"><c r="D3"><f>SUM(D2,100)</f><v>1450</v></c></row></sheetData></worksheet>`,
      ),
    }),
  ]);

test("Word formatting isolates the selected text, preserving surrounding styles and paragraph alignment", async () => {
  const original = new Blob([
    zipSync({
      "word/document.xml": strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Customer Luna here.</w:t></w:r></w:p></w:body></w:document>`,
      ),
    }),
  ]);
  const result = await editOffice(original, {
    fileId: "file",
    name: "a.docx",
    changes: [
      {
        find: "Luna",
        count: 1,
        format: {
          bold: true,
          fontSize: 18,
          color: "#315B3E",
          alignment: "center",
        },
      },
    ],
  });
  const doc = parse(
    unzipSync(new Uint8Array(await result.blob.arrayBuffer()))[
      "word/document.xml"
    ],
  );
  const runs = Array.from(doc.getElementsByTagNameNS(W, "r"));
  assert.deepEqual(
    runs.map((r) => r.textContent),
    ["Customer ", "Luna", " here."],
  );
  assert.equal(runs[0].getElementsByTagNameNS(W, "b").length, 0);
  assert.equal(
    runs[1].getElementsByTagNameNS(W, "b")[0].getAttributeNS(W, "val"),
    "1",
  );
  assert.equal(runs[1].getElementsByTagNameNS(W, "i").length, 1);
  assert.equal(
    runs[1].getElementsByTagNameNS(W, "sz")[0].getAttributeNS(W, "val"),
    "36",
  );
  assert.equal(
    doc.getElementsByTagNameNS(W, "jc")[0].getAttributeNS(W, "val"),
    "center",
  );
  assert.match(result.log[0].formatLabel, /bold: on/);
});

test("Excel value/formula/format edits recalculate dependencies and persist typed cached results", async () => {
  const original = fixture();
  const result = await editOffice(
    original,
    plan([
      { sheet: "Orders", cell: "B2", expected: 3, replace: 7 },
      {
        sheet: "Orders",
        cell: "E2",
        expected: null,
        formula: "=D2*12%",
        format: { numberFormat: "#,##0.00", color: "#315B3E" },
      },
      {
        sheet: "Orders",
        range: "A1:E1",
        format: {
          bold: true,
          fill: "#315B3E",
          color: "#FFFFFF",
          horizontal: "center",
          wrapText: true,
        },
      },
    ]),
    { calculate },
  );
  const output = unzipSync(new Uint8Array(await result.blob.arrayBuffer())),
    doc = parse(output["xl/worksheets/sheet1.xml"]);
  const cell = (a) =>
    Array.from(doc.getElementsByTagNameNS(S, "c")).find(
      (c) => c.getAttribute("r") === a,
    );
  const value = (a) => cell(a).getElementsByTagNameNS(S, "v")[0]?.textContent;
  assert.equal(value("D2"), "3150");
  assert.equal(value("D3"), "3250");
  assert.equal(value("E2"), "378");
  assert.equal(
    cell("E2").getElementsByTagNameNS(S, "f")[0].textContent,
    "D2*12%",
  );
  assert.equal(cell("E2").getAttribute("t"), "n");
  const styles = parse(output["xl/styles.xml"]),
    xf = styles.getElementsByTagNameNS(S, "cellXfs")[0].children[
      Number(cell("A1").getAttribute("s"))
    ];
  const font = styles.getElementsByTagNameNS(S, "fonts")[0].children[
    Number(xf.getAttribute("fontId"))
  ];
  assert.equal(font.getElementsByTagNameNS(S, "b")[0].getAttribute("val"), "1");
  assert.ok(styles.getElementsByTagNameNS(S, "numFmt").length);
  assert.equal(result.calculations.length, 3);
  assert.equal(result.log[1].result, "378");
  assert.deepEqual(
    output["xl/worksheets/sheet2.xml"],
    zip["xl/worksheets/sheet2.xml"],
  );
  const map = excelCellMap(await result.blob.arrayBuffer());
  assert.equal(map[0].cells.find((c) => c.cell === "E2").formula, "=D2*12%");
  assert.equal(
    excelCellMap(await original.arrayBuffer())[0].cells.find(
      (c) => c.cell === "B2",
    ).value,
    3,
  );
});

test("formula errors, invalid guards, external formulas and unsupported array/shared formulas block downloads", async () => {
  await assert.rejects(
    editOffice(
      fixture(),
      plan([{ sheet: "Orders", cell: "B2", expected: 8, replace: 7 }]),
      { calculate },
    ),
    /no longer matches/,
  );
  for (const formula of ["=1/0", "=D2", "=UNKNOWNFUNCTION(1)"])
    await assert.rejects(
      editOffice(
        fixture(),
        plan([{ sheet: "Orders", cell: "D2", expected: "=B2*C2", formula }]),
        { calculate },
      ),
      /Fix this formula/,
    );
  for (const formula of [
    '=WEBSERVICE("https://example.com")',
    "='[private.xlsx]Sheet1'!A1",
    "=RAND()",
  ])
    assert.throws(() => validateFormula(formula), /local Excel formula/);
  assert.throws(
    () =>
      validateEditPlan(
        plan([
          { sheet: "Orders", range: "A1:XFD1048576", format: { bold: true } },
        ]),
        [{ id: "file", name: "sample.xlsx" }],
      ),
    /1,000/,
  );
  assert.throws(
    () =>
      validateEditPlan(
        plan([
          {
            sheet: "Orders",
            cell: "B2",
            expected: 3,
            format: { fill: "url(x)" },
          },
        ]),
        [{ id: "file", name: "sample.xlsx" }],
      ),
    /hex/,
  );
});

test("calculation adapter verifies cross-sheet references, booleans, strings and Excel-level precision", () => {
  const results = calculateWorkbook([
    {
      name: "Orders",
      cells: [
        { address: "A1", row: 1, column: 1, input: "3" },
        {
          address: "B1",
          row: 1,
          column: 2,
          input: "=IF(Notes!A1>0,A1*Notes!A1,0)",
          formula: true,
        },
        { address: "C1", row: 1, column: 3, input: "=1/3", formula: true },
        { address: "D1", row: 1, column: 4, input: "=TRUE", formula: true },
        { address: "E1", row: 1, column: 5, input: '="done"', formula: true },
      ],
    },
    {
      name: "Notes",
      cells: [{ address: "A1", row: 1, column: 1, input: "4" }],
    },
  ]);
  assert.equal(results[0].value, "12");
  assert.ok(Math.abs(Number(results[1].value) - 1 / 3) < 1e-15);
  assert.equal(results[2].type, "b");
  assert.equal(results[2].value, "1");
  assert.equal(results[3].type, "str");
  assert.equal(results[3].value, "done");
});
