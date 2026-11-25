import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const all = (doc, name) => Array.from(doc.getElementsByTagNameNS(S, name));
export function excelCellMap(buffer) {
  const zip = unzipSync(new Uint8Array(buffer));
  const parse = (path) => {
    const text = strFromU8(zip[path]);
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw new Error("Unsupported XML entities.");
    return new DOMParser().parseFromString(text, "application/xml");
  };
  const workbook = parse("xl/workbook.xml"),
    rels = parse("xl/_rels/workbook.xml.rels");
  const strings = zip["xl/sharedStrings.xml"]
    ? all(parse("xl/sharedStrings.xml"), "si").map((si) =>
        all(si, "t")
          .map((t) => t.textContent)
          .join(""),
      )
    : [];
  return all(workbook, "sheet").map((sheet) => {
    const id = sheet.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      ),
      rel = Array.from(rels.getElementsByTagName("Relationship")).find(
        (r) => r.getAttribute("Id") === id,
      ),
      target = rel?.getAttribute("Target") || "",
      path = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    if (
      target.includes("..") ||
      rel?.getAttribute("TargetMode") === "External" ||
      !zip[path]
    )
      throw new Error("Unsupported worksheet.");
    return {
      sheet: sheet.getAttribute("name"),
      cells: all(parse(path), "c").map((cell) => {
        const f = all(cell, "f")[0],
          v = all(cell, "v")[0]?.textContent,
          type = cell.getAttribute("t");
        const value =
          type === "s"
            ? strings[Number(v)]
            : type === "inlineStr"
              ? all(cell, "t")
                  .map((t) => t.textContent)
                  .join("")
              : type === "b"
                ? v === "1"
                : type === "str" || type === "e" || type === "d"
                  ? v
                  : v === undefined
                    ? null
                    : Number(v);
        return {
          cell: cell.getAttribute("r"),
          value,
          ...(f ? { formula: "=" + f.textContent } : {}),
        };
      }),
    };
  });
}
