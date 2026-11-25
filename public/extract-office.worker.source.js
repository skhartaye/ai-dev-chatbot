import mammoth from "mammoth";
import readWorkbook from "read-excel-file/universal";

self.onmessage = async ({ data: { buffer, extension } }) => {
  try {
    let text;
    if (extension === "docx") {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      text = result.value;
    } else {
      const sheets = await readWorkbook(buffer);
      text = sheets.map(({ sheet, data }) => `[Sheet: ${sheet}]\n` +
        data.map(row => row.map(value => value instanceof Date ? value.toISOString() : String(value ?? "")).join("\t")).join("\n")
      ).join("\n\n");
    }
    self.postMessage({ text });
  } catch {
    self.postMessage({ error: "Could not read this document. Save an unprotected DOCX or XLSX copy and try again." });
  }
};
