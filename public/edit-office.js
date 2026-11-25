import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { checkOfficeArchive, MAX_FILE_BYTES } from "./extract-file.js";
import {
  validateFormat,
  formatWordParagraph,
  formatDescription,
} from "./office-format.js";
import { editExcel, addressParts, rangeAddresses } from "./edit-excel.js";
import { validateFormula } from "./formula-engine.js";

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
    if (c.format) validateFormat(c.format, /\.docx$/i.test(file.name));
    if (/\p{Cc}/u.test(String(c.replace ?? "").replace(/[\t\r\n]/g, "")))
      throw new Error(
        "The replacement contains unsupported control characters.",
      );
    if (/\.xlsx$/i.test(file.name) && (c.cell || c.range)) {
      if (typeof c.sheet !== "string" || !c.sheet)
        throw new Error("Excel edits must identify the worksheet.");
      if (c.range) {
        rangeAddresses(c.range);
        if (c.cell || !c.format || "replace" in c || "formula" in c)
          throw new Error(
            "Range edits support formatting only. Use individual cells for values and formulas.",
          );
      } else {
        addressParts(c.cell);
        if (!("expected" in c))
          throw new Error(
            "A cell edit must include its expected original value, or null for an empty cell.",
          );
        if (
          (!["string", "number", "boolean"].includes(typeof c.expected) &&
            c.expected !== null) ||
          (typeof c.expected === "number" && !Number.isFinite(c.expected))
        )
          throw new Error("Invalid expected cell value.");
      }
      if (c.formula !== undefined) {
        validateFormula(c.formula);
        if ("replace" in c)
          throw new Error(
            "Use either a formula or a literal cell replacement.",
          );
      }
      if (!c.format && !("formula" in c) && !("replace" in c))
        throw new Error("Specify a value, formula, or formatting change.");
      if (
        "replace" in c &&
        ((!["string", "number", "boolean"].includes(typeof c.replace) &&
          c.replace !== null) ||
          (typeof c.replace === "number" && !Number.isFinite(c.replace)) ||
          String(c.replace ?? "").length > 10000)
      )
        throw new Error("Invalid cell replacement.");
      continue;
    }
    if (
      /\.xlsx$/i.test(file.name) &&
      ("formula" in c || (!c.format && !("replace" in c)))
    )
      throw new Error(
        "Use an explicit cell address and expected original value for a formula edit.",
      );
    if (
      typeof c.find !== "string" ||
      !c.find.length ||
      c.find.length > 10000 ||
      ("replace" in c &&
        !["string", "number", "boolean"].includes(typeof c.replace) &&
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
      (("replace" in c && typeof c.replace !== "string") ||
        (!("replace" in c) && !c.format) ||
        /[\r\n\t]/.test(c.find + (c.replace ?? "")))
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
export async function editOffice(blob, plan, options = {}) {
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
  let calculations = [];
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
        (n, p) =>
          n +
          (change.format
            ? formatWordParagraph(p, change)
            : replaceParagraph(p, change)),
        0,
      );
      if (count !== change.count)
        throw new Error(
          `Expected ${change.count} match(es) for “${change.find.slice(0, 80)}”, found ${count}. No file was changed. Ask for a more specific edit.`,
        );
      log.push({
        ...change,
        replace: "replace" in change ? change.replace : change.find,
        formatLabel: formatDescription(change.format),
        location: `${count} Word match${count === 1 ? "" : "es"}`,
      });
    }
    archive["word/document.xml"] = serialize(doc);
  } else {
    const result = await editExcel(archive, plan, options);
    log.push(...result.log);
    calculations = result.calculations;
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
    calculations,
    name: plan.name.replace(/\.(docx|xlsx)$/i, "-edited.$1"),
  };
}
