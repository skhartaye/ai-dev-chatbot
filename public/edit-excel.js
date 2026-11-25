import { xml, elements, serialize, SHEET as S } from "./office-xml.js";
import { formatExcelCell, formatDescription } from "./office-format.js";
import { recalculate } from "./recalculate.js";
import { validateFormula } from "./formula-engine.js";

export function addressParts(address) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address || "");
  if (!match) throw new Error("Use an Excel cell address such as B2.");
  const column = Array.from(match[1]).reduce(
      (n, c) => n * 26 + c.charCodeAt(0) - 64,
      0,
    ),
    row = Number(match[2]);
  if (column > 16384 || row > 1048576)
    throw new Error("The cell address exceeds Excel limits.");
  return { address, row, column };
}
const colName = (n) => {
  let s = "";
  while (n) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
};
export function rangeAddresses(range) {
  const [from, to = from, ...extra] = range.split(":");
  if (extra.length) throw new Error("Use one rectangular Excel range.");
  const a = addressParts(from),
    b = addressParts(to);
  if (
    b.row < a.row ||
    b.column < a.column ||
    (b.row - a.row + 1) * (b.column - a.column + 1) > 1000
  )
    throw new Error("Format a forward range of at most 1,000 cells.");
  const addresses = [];
  for (let r = a.row; r <= b.row; r++)
    for (let c = a.column; c <= b.column; c++) addresses.push(colName(c) + r);
  return addresses;
}
const direct = (n, name) =>
  Array.from(n.children).find((c) => c.localName === name);
export function workbookParts(archive) {
  if (!archive["xl/workbook.xml"] || !archive["xl/_rels/workbook.xml.rels"])
    throw new Error("Choose the original XLSX workbook.");
  const workbook = xml(archive["xl/workbook.xml"]),
    rels = xml(archive["xl/_rels/workbook.xml.rels"]);
  const strings = archive["xl/sharedStrings.xml"]
    ? elements(xml(archive["xl/sharedStrings.xml"]), S, "si").map((si) =>
        elements(si, S, "t")
          .map((t) => t.textContent)
          .join(""),
      )
    : [];
  const sheets = new Map();
  for (const sheet of elements(workbook, S, "sheet")) {
    const id = sheet.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      ),
      rel = Array.from(rels.documentElement.children).find(
        (r) => r.getAttribute("Id") === id,
      ),
      target = rel?.getAttribute("Target") || "",
      path = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    if (
      !archive[path] ||
      target.includes("..") ||
      rel?.getAttribute("TargetMode") === "External"
    )
      throw new Error(
        "This workbook uses an unsupported worksheet relationship.",
      );
    const doc = xml(archive[path]);
    const cells = new Map(
      elements(doc, S, "c").map((cell) => [cell.getAttribute("r"), cell]),
    );
    sheets.set(sheet.getAttribute("name"), { doc, path, cells });
  }
  return { workbook, sheets, strings };
}
export function cellValue(cell, strings) {
  if (!cell) return null;
  const formula = direct(cell, "f");
  if (formula) return "=" + formula.textContent;
  const type = cell.getAttribute("t"),
    v = direct(cell, "v")?.textContent;
  if (type === "s") return strings[Number(v)] ?? "";
  if (type === "inlineStr")
    return elements(cell, S, "t")
      .map((t) => t.textContent)
      .join("");
  if (type === "b") return v === "1";
  if (type === "str" || type === "e" || type === "d") return v ?? "";
  return v === undefined ? null : Number(v);
}
function cellAt(sheet, address, create = false) {
  const existing = sheet.cells.get(address);
  if (existing || !create) return existing;
  const { row, column } = addressParts(address),
    doc = sheet.doc,
    root = doc.documentElement;
  let data = direct(root, "sheetData");
  if (!data) throw new Error("The worksheet is missing its cell data.");
  let r = Array.from(data.children).find(
    (r) => Number(r.getAttribute("r")) === row,
  );
  if (!r) {
    r = doc.createElementNS(S, "row");
    r.setAttribute("r", row);
    data.insertBefore(
      r,
      Array.from(data.children).find(
        (r) => Number(r.getAttribute("r")) > row,
      ) || null,
    );
  }
  const cell = doc.createElementNS(S, "c");
  cell.setAttribute("r", address);
  sheet.cells.set(address, cell);
  r.insertBefore(
    cell,
    Array.from(r.children).find(
      (c) =>
        c.localName === "c" &&
        addressParts(c.getAttribute("r")).column > column,
    ) || null,
  );
  const dim = direct(root, "dimension");
  if (dim) {
    const [start, end = start] = dim.getAttribute("ref").split(":");
    const a = addressParts(start),
      b = addressParts(end);
    dim.setAttribute(
      "ref",
      `${colName(Math.min(a.column, column))}${Math.min(a.row, row)}:${colName(Math.max(b.column, column))}${Math.max(b.row, row)}`,
    );
  }
  return cell;
}
function writeCell(cell, value, formula = false) {
  const doc = cell.ownerDocument;
  if (direct(cell, "extLst"))
    throw new Error("This cell contains unsupported extended data.");
  for (const child of Array.from(cell.children))
    if (["v", "is", "f"].includes(child.localName)) child.remove();
  if (formula) {
    cell.removeAttribute("t");
    const f = doc.createElementNS(S, "f");
    f.textContent = value.slice(1);
    cell.append(f);
  } else if (typeof value === "string") {
    cell.setAttribute("t", "inlineStr");
    const i = doc.createElementNS(S, "is"),
      t = doc.createElementNS(S, "t");
    t.textContent = value;
    t.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve",
    );
    i.append(t);
    cell.append(i);
  } else if (value === null) cell.removeAttribute("t");
  else {
    cell.setAttribute("t", typeof value === "boolean" ? "b" : "n");
    const v = doc.createElementNS(S, "v");
    v.textContent =
      typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    cell.append(v);
  }
}
export async function editExcel(
  archive,
  plan,
  { calculate = recalculate, signal } = {},
) {
  const { workbook, sheets, strings } = workbookParts(archive),
    log = [];
  if (
    elements(workbook, S, "workbookProtection").some((p) =>
      Array.from(p.attributes).some(
        (a) =>
          /password|hash/i.test(a.name) ||
          (/^lock/.test(a.name) && /^(1|true)$/i.test(a.value)),
      ),
    )
  )
    throw new Error("This workbook is protected.");
  let styles,
    formatsChanged = false;
  for (const change of plan.changes) {
    const sheet = sheets.get(change.sheet);
    if (!sheet) throw new Error(`Worksheet “${change.sheet}” was not found.`);
    if (elements(sheet.doc, S, "sheetProtection").length)
      throw new Error("This worksheet is protected.");
    let matches;
    if (change.cell || change.range) {
      const addresses = change.range
        ? rangeAddresses(change.range)
        : [change.cell];
      // Reject non-anchor merged cells rather than writing invisible or corrupt values.
      for (const merged of elements(sheet.doc, S, "mergeCell")) {
        const [a, b = a] = merged.getAttribute("ref").split(":"),
          start = addressParts(a),
          end = addressParts(b);
        if (
          addresses.some((ref) => {
            const p = addressParts(ref);
            return (
              ref !== a &&
              p.row >= start.row &&
              p.row <= end.row &&
              p.column >= start.column &&
              p.column <= end.column
            );
          })
        )
          throw new Error("Target the top-left cell of a merged range.");
      }
      if (change.cell && "expected" in change) {
        const actual = cellValue(cellAt(sheet, change.cell), strings);
        if (actual !== change.expected)
          throw new Error(
            `${change.sheet}!${change.cell} no longer matches the proposed original value. Request the edit again.`,
          );
      }
      matches = addresses.map((a) => cellAt(sheet, a, true));
    } else {
      matches = elements(sheet.doc, S, "c").filter(
        (c) => String(cellValue(c, strings) ?? "") === change.find,
      );
      if (matches.length !== change.count)
        throw new Error(
          `Expected ${change.count} cell(s) matching “${change.find.slice(0, 80)}” in ${change.sheet}, found ${matches.length}. No file was changed.`,
        );
    }
    const before = matches.map((c) => cellValue(c, strings));
    for (const cell of matches) {
      if (change.formula)
        writeCell(cell, validateFormula(change.formula), true);
      else if ("replace" in change) writeCell(cell, change.replace);
      if (change.format) {
        if (!archive["xl/styles.xml"])
          throw new Error("This workbook has no supported styles table.");
        styles ??= xml(archive["xl/styles.xml"]);
        formatExcelCell(cell, change.format, styles);
        formatsChanged = true;
      }
    }
    log.push({
      ...change,
      find: before.map((v) => (v === null ? "(empty)" : String(v))).join(", "),
      replace:
        change.formula ??
        ("replace" in change
          ? change.replace
          : before.map((v) => (v === null ? "(empty)" : String(v))).join(", ")),
      formatLabel: formatDescription(change.format),
      location: `${change.sheet} · ${change.range || matches.map((c) => c.getAttribute("r")).join(", ")}`,
    });
  }
  const hasFormulas = Array.from(sheets.values()).some(
    (s) => elements(s.doc, S, "f").length,
  );
  let calculations = [];
  if (hasFormulas) {
    if (
      elements(workbook, S, "workbookPr").some((p) =>
        /^(1|true)$/i.test(p.getAttribute("date1904")),
      )
    )
      throw new Error(
        "Formula verification does not support workbooks using the 1904 date system.",
      );
    if (Object.keys(archive).some((n) => /^xl\/externalLinks\//.test(n)))
      throw new Error("External workbook links cannot be verified locally.");
    const modelSheets = Array.from(sheets, ([name, sheet]) => ({
      name,
      cells: elements(sheet.doc, S, "c")
        .map((cell) => {
          const f = direct(cell, "f");
          if (f && Array.from(f.attributes).length)
            throw new Error(
              "Shared, array, and data-table formulas are not supported yet. Save a copy with ordinary cell formulas.",
            );
          if (cell.getAttribute("t") === "e")
            throw new Error(
              `${name}!${cell.getAttribute("r")} contains an Excel error. Fix it before downloading.`,
            );
          const value = cellValue(cell, strings);
          if (value === null) return null;
          if (cell.getAttribute("t") === "d")
            throw new Error(
              "Convert ISO date cells to Excel date serials before recalculating this workbook.",
            );
          return {
            ...addressParts(cell.getAttribute("r")),
            formula: !!f,
            input: f
              ? String(value)
              : typeof value === "string"
                ? "'" + value
                : typeof value === "boolean"
                  ? value
                    ? "TRUE"
                    : "FALSE"
                  : String(value),
          };
        })
        .filter(Boolean),
    }));
    const names = elements(workbook, S, "definedName")
      .filter((n) => !n.getAttribute("name").startsWith("_xlnm."))
      .map((n) => ({
        name: n.getAttribute("name"),
        scope: n.hasAttribute("localSheetId")
          ? Number(n.getAttribute("localSheetId"))
          : null,
        formula: n.textContent,
      }));
    calculations = await calculate(modelSheets, names, { signal });
    for (const result of calculations) {
      const cell = cellAt(sheets.get(result.sheet), result.address);
      cell.setAttribute("t", result.type);
      direct(cell, "v")?.remove();
      const v = cell.ownerDocument.createElementNS(S, "v");
      v.textContent = result.value;
      cell.append(v);
    }
    for (const change of log)
      if (change.cell && change.formula) {
        const value = calculations.find(
          (r) => r.sheet === change.sheet && r.address === change.cell,
        );
        change.result =
          value?.type === "b"
            ? value.value === "1"
              ? "TRUE"
              : "FALSE"
            : value?.value;
      }
    // Cached results were just verified; Excel can still refresh its own implementation on open.
    let calc = direct(workbook.documentElement, "calcPr");
    if (!calc) {
      calc = workbook.createElementNS(S, "calcPr");
      workbook.documentElement.append(calc);
    }
    calc.setAttribute("calcMode", "auto");
    calc.setAttribute("fullCalcOnLoad", "1");
    archive["xl/workbook.xml"] = serialize(workbook);
    delete archive["xl/calcChain.xml"];
    for (const path of ["xl/_rels/workbook.xml.rels", "[Content_Types].xml"]) {
      const doc = xml(archive[path]);
      for (const child of Array.from(doc.documentElement.children))
        if (
          (child.getAttribute("Type") || "").endsWith("/calcChain") ||
          child.getAttribute("PartName") === "/xl/calcChain.xml"
        )
          child.remove();
      archive[path] = serialize(doc);
    }
  }
  if (formatsChanged) archive["xl/styles.xml"] = serialize(styles);
  for (const { doc, path } of sheets.values()) archive[path] = serialize(doc);
  return { log, calculations };
}
