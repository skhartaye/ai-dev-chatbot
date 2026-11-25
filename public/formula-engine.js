import { Model } from "@ironcalc/wasm";

export function validateFormula(formula) {
  if (
    typeof formula !== "string" ||
    !formula.startsWith("=") ||
    formula.length > 2048 ||
    /[\u0000-\u001f\[\]{}|]/.test(formula) ||
    /\b(WEBSERVICE|FILTERXML|HYPERLINK|IMAGE|RTD|CALL|REGISTER\.?ID|RAND|RANDBETWEEN|RANDARRAY)\s*\(/i.test(
      formula,
    )
  )
    throw new Error(
      "Use a scalar, local Excel formula without external links, web functions, arrays, or random values.",
    );
  return formula;
}
// Pure calculation adapter. Browser calls run in a terminable worker; tests use the same engine.
export function calculateWorkbook(sheets, names = []) {
  if (
    sheets.length > 50 ||
    sheets.reduce((n, s) => n + s.cells.length, 0) > 20000
  )
    throw new Error(
      "Formula verification supports up to 50 sheets and 20,000 populated cells.",
    );
  const formulas = sheets.flatMap((s, index) =>
    s.cells
      .filter((c) => c.formula)
      .map((c) => ({ ...c, sheet: index, name: s.name })),
  );
  if (formulas.length > 2000)
    throw new Error("Verify at most 2,000 formulas at a time.");
  for (const c of formulas) validateFormula(c.input);
  const model = new Model("Kahuron verification", "en", "UTC", "en");
  try {
    model.pauseEvaluation();
    while (model.getWorksheetsProperties().length > sheets.length)
      model.deleteSheet(model.getWorksheetsProperties().length - 1);
    while (model.getWorksheetsProperties().length < sheets.length)
      model.newSheet();
    const prefix = "__kahuron_" + Math.random().toString(36).slice(2) + "_";
    sheets.forEach((s, i) => model.renameSheet(i, prefix + i));
    sheets.forEach((s, i) => model.renameSheet(i, s.name));
    for (const name of names) {
      validateFormula("=" + name.formula);
      model.newDefinedName(name.name, name.scope, name.formula);
    }
    sheets.forEach((s, i) =>
      s.cells.forEach((c) => model.setUserInput(i, c.row, c.column, c.input)),
    );
    model.resumeEvaluation();
    model.evaluate();
    return formulas.map((c) => {
      const type = model.getCellType(c.sheet, c.row, c.column);
      if (type === 16)
        throw new Error(
          `${c.name}!${c.address}: ${model.getFormattedCellValue(c.sheet, c.row, c.column)}. Fix this formula before downloading.`,
        );
      if (
        model.getCellArrayStructure(c.sheet, c.row, c.column) !== "SingleCell"
      )
        throw new Error(
          `${c.name}!${c.address}: array and spilling formulas are not supported yet.`,
        );
      if (type === 1)
        model.updateRangeStyle(
          { sheet: c.sheet, row: c.row, column: c.column, width: 1, height: 1 },
          "num_fmt",
          "0.000000000000000E+00",
        );
      const value = model.getFormattedCellValue(c.sheet, c.row, c.column);
      if (type === 1 && !Number.isFinite(Number(value)))
        throw new Error(
          `${c.name}!${c.address}: result could not be verified.`,
        );
      return {
        sheet: c.name,
        address: c.address,
        type: type === 1 ? "n" : type === 4 ? "b" : "str",
        value:
          type === 1
            ? String(Number(value))
            : type === 4
              ? value === "TRUE"
                ? "1"
                : "0"
              : value,
      };
    });
  } finally {
    model.free();
  }
}
