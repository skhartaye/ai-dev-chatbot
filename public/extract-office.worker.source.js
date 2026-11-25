import mammoth from "mammoth";
import readWorkbook from "read-excel-file/universal";
import { excelCellMap } from "./excel-cell-map.js";

self.onmessage = async ({
  data: { buffer, extension, includeCellMap = true },
}) => {
  try {
    let text;
    if (extension === "docx") {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      text = result.value;
    } else {
      const sheets = await readWorkbook(buffer);
      text = sheets
        .map(
          ({ sheet, data }) =>
            `[Sheet: ${sheet}]\n` +
            data
              .map((row) =>
                row
                  .map((value) =>
                    value instanceof Date
                      ? value.toISOString()
                      : String(value ?? ""),
                  )
                  .join("\t"),
              )
              .join("\n"),
        )
        .join("\n\n");
      if (includeCellMap)
        text +=
          "\n\n[KAHURON CELL MAP]\n" + JSON.stringify(excelCellMap(buffer));
    }
    self.postMessage({ text });
  } catch {
    self.postMessage({
      error:
        "Could not read this document. Save an unprotected DOCX or XLSX copy and try again.",
    });
  }
};
