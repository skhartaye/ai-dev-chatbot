import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { checkOfficeArchive, MAX_FILE_BYTES } from "./extract-file.js";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const XML = "http://www.w3.org/XML/1998/namespace";
function xml(bytes) {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Documents with XML entities are not supported.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("The original document contains damaged XML.");
  return doc;
}
const elements = (root, ns, name) =>
  Array.from(root.getElementsByTagNameNS(ns, name));
const serialize = (doc) => strToU8(new XMLSerializer().serializeToString(doc));
export function validateEditPlan(plan, files) {
  const file = files.find((f) => f.id === plan?.fileId && f.name === plan.name);
  if (!file || !/\.(docx|xlsx)$/i.test(file.name))
    throw new Error(
      "This edit does not reference a Word or Excel attachment in this conversation.",
    );
  if (
    !Array.isArray(plan.changes) ||
    !plan.changes.length ||
    plan.changes.length > 50
  )
    throw new Error("Ask for between 1 and 50 specific edits at a time.");
  for (const c of plan.changes) {
    // Models may use JSON primitives for numeric/boolean Excel search values.
    if (
      /\.xlsx$/i.test(file.name) &&
      (typeof c?.find === "boolean" ||
        (typeof c?.find === "number" && Number.isFinite(c.find)))
    )
      c.find = String(c.find);
    if (!c || typeof c !== "object")
      throw new Error(
        "The AI returned an invalid edit. Ask it to propose the changes again.",
      );
    if (
      typeof c.find !== "string" ||
      !c.find.length ||
      c.find.length > 10000 ||
      (!["string", "number", "boolean"].includes(typeof c.replace) &&
        c.replace !== null) ||
      (typeof c.replace === "number" && !Number.isFinite(c.replace)) ||
      String(c.replace ?? "").length > 10000 ||
      !Number.isInteger(c.count) ||
      c.count < 1 ||
      c.count > 1000
    )
      throw new Error(
        "The AI returned an invalid edit. Ask it to propose the changes again.",
      );
    if (
      /\.docx$/i.test(file.name) &&
      (typeof c.replace !== "string" || /[\r\n\t]/.test(c.find + c.replace))
    )
      throw new Error("Word edits must replace text within one paragraph.");
    if (/\.xlsx$/i.test(file.name) && (typeof c.sheet !== "string" || !c.sheet))
      throw new Error("Excel edits must identify the worksheet.");
    if (/\p{Cc}/u.test(String(c.replace ?? "").replace(/[\t\r\n]/g, "")))
      throw new Error(
        "The replacement contains unsupported control characters.",
      );
  }
  return file;
}
function replaceParagraph(p, change) {
  const nodes = elements(p, WORD, "t");
  const text = nodes.map((n) => n.textContent).join("");
  const starts = [];
  for (
    let at = 0;
    (at = text.indexOf(change.find, at)) !== -1;
    at += change.find.length
  )
    starts.push(at);
  // Work backwards so earlier offsets remain valid across formatted text runs.
  for (const start of starts.reverse()) {
    let offset = 0;
    const spans = nodes.map((n) => {
      const span = { n, start: offset, end: offset + n.textContent.length };
      offset = span.end;
      return span;
    });
    const touched = spans.filter(
      (s) => s.end > start && s.start < start + change.find.length,
    );
    for (let i = 0; i < touched.length; i++) {
      const s = touched[i],
        before = s.n.textContent.slice(0, Math.max(0, start - s.start)),
        after = s.n.textContent.slice(
          Math.min(
            s.n.textContent.length,
            start + change.find.length - s.start,
          ),
        );
      s.n.textContent = before + (i === 0 ? change.replace : "") + after;
      s.n.setAttributeNS(XML, "xml:space", "preserve");
    }
  }
  return starts.length;
}
export async function editOffice(blob, plan) {
  validateEditPlan(plan, [{ id: plan.fileId, name: plan.name }]);
  if (blob.size > MAX_FILE_BYTES)
    throw new Error("Choose an original smaller than 10 MB.");
  const buffer = await blob.arrayBuffer();
  checkOfficeArchive(buffer);
  const archive = unzipSync(new Uint8Array(buffer));
  if (
    Object.keys(archive).some((n) =>
      /vbaProject|_xmlsignatures|activeX|embeddings/i.test(n),
    )
  )
    throw new Error(
      "Signed documents, macros, and embedded active content cannot be edited here.",
    );
  const log = [];
  if (/\.docx$/i.test(plan.name)) {
    if (!archive["word/document.xml"])
      throw new Error("Choose the original DOCX document.");
    if (
      archive["word/settings.xml"] &&
      /documentProtection/.test(strFromU8(archive["word/settings.xml"]))
    )
      throw new Error("This Word document is protected.");
    const doc = xml(archive["word/document.xml"]);
    if (
      ["ins", "del", "fldChar", "fldSimple", "sdt"].some(
        (name) => elements(doc, WORD, name).length,
      )
    )
      throw new Error(
        "Accept tracked changes and remove fields or content controls in Word before editing this copy.",
      );
    for (const change of plan.changes) {
      const count = elements(doc, WORD, "p").reduce(
        (n, p) => n + replaceParagraph(p, change),
        0,
      );
      if (count !== change.count)
        throw new Error(
          `Expected ${change.count} match(es) for “${change.find.slice(0, 80)}”, found ${count}. No file was changed. Ask for a more specific edit.`,
        );
      log.push({
        ...change,
        location: `${count} Word match${count === 1 ? "" : "es"}`,
      });
    }
    archive["word/document.xml"] = serialize(doc);
  } else {
    if (!archive["xl/workbook.xml"] || !archive["xl/_rels/workbook.xml.rels"])
      throw new Error("Choose the original XLSX workbook.");
    const workbook = xml(archive["xl/workbook.xml"]);
    if (
      elements(workbook, SHEET, "workbookProtection").some((p) =>
        Array.from(p.attributes).some(
          (a) =>
            /password|hash/i.test(a.name) ||
            (/^lock/.test(a.name) && /^(1|true)$/i.test(a.value)),
        ),
      )
    )
      throw new Error("This workbook is protected.");
    const relationships = xml(archive["xl/_rels/workbook.xml.rels"]);
    const shared = archive["xl/sharedStrings.xml"]
      ? elements(xml(archive["xl/sharedStrings.xml"]), SHEET, "si").map((si) =>
          elements(si, SHEET, "t")
            .map((t) => t.textContent)
            .join(""),
        )
      : [];
    const sheets = new Map();
    for (const sheet of elements(workbook, SHEET, "sheet")) {
      const id = sheet.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      );
      const rel = Array.from(relationships.documentElement.children).find(
        (r) => r.getAttribute("Id") === id,
      );
      const target = rel?.getAttribute("Target") || "";
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      if (
        !archive[path] ||
        target.includes("..") ||
        rel.getAttribute("TargetMode") === "External"
      )
        throw new Error(
          "This workbook uses an unsupported worksheet relationship.",
        );
      const doc = xml(archive[path]);
      if (elements(doc, SHEET, "f").length)
        throw new Error(
          "This workbook contains formulas. Editing with verified formula recalculation is not available yet.",
        );
      sheets.set(sheet.getAttribute("name"), { doc, path });
    }
    for (const change of plan.changes) {
      const sheet = sheets.get(change.sheet);
      if (!sheet) throw new Error(`Worksheet “${change.sheet}” was not found.`);
      if (elements(sheet.doc, SHEET, "sheetProtection").length)
        throw new Error("This worksheet is protected.");
      const matches = elements(sheet.doc, SHEET, "c").filter((cell) => {
        const type = cell.getAttribute("t"),
          value = elements(cell, SHEET, "v")[0]?.textContent || "";
        return (
          (type === "s"
            ? shared[Number(value)]
            : type === "inlineStr"
              ? elements(cell, SHEET, "t")
                  .map((t) => t.textContent)
                  .join("")
              : type === "b"
                ? value === "1"
                  ? "true"
                  : "false"
                : value) === change.find
        );
      });
      if (matches.length !== change.count)
        throw new Error(
          `Expected ${change.count} cell(s) matching “${change.find.slice(0, 80)}” in ${change.sheet}, found ${matches.length}. No file was changed.`,
        );
      for (const cell of matches) {
        if (elements(cell, SHEET, "extLst").length)
          throw new Error("This cell contains unsupported extended data.");
        for (const child of Array.from(cell.children))
          if (["v", "is", "f"].includes(child.localName)) child.remove();
        const value = change.replace;
        if (typeof value === "string") {
          // Literal strings, including leading =, never become executable formulas.
          cell.setAttribute("t", "inlineStr");
          const inline = sheet.doc.createElementNS(SHEET, "is"),
            t = sheet.doc.createElementNS(SHEET, "t");
          t.setAttributeNS(XML, "xml:space", "preserve");
          t.textContent = value;
          inline.append(t);
          cell.append(inline);
        } else if (value === null) cell.removeAttribute("t");
        else {
          cell.setAttribute("t", typeof value === "boolean" ? "b" : "n");
          const v = sheet.doc.createElementNS(SHEET, "v");
          v.textContent =
            typeof value === "boolean" ? (value ? "1" : "0") : String(value);
          cell.append(v);
        }
      }
      log.push({
        ...change,
        location: `${change.sheet} · ${matches.map((c) => c.getAttribute("r")).join(", ")}`,
      });
    }
    for (const { doc, path } of sheets.values()) archive[path] = serialize(doc);
  }
  const bytes = zipSync(archive, { level: 6 });
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error("The edited copy exceeds 10 MB. Ask for a smaller change.");
  return {
    blob: new Blob([bytes], {
      type: /\.docx$/i.test(plan.name)
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    log,
    name: plan.name.replace(/\.(docx|xlsx)$/i, "-edited.$1"),
  };
}
