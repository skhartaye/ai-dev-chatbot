export const isVisualFile = (name) =>
  /\.(pdf|png|jpe?g|webp)$/i.test(name || "");
export const isEditableFile = (name) =>
  /\.(docx|xlsx|pdf|png|jpe?g|webp)$/i.test(name || "");
export const mediaKind = (name) => (/\.pdf$/i.test(name) ? "pdf" : "image");
const number = (value, min, max, label) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be between ${min} and ${max}.`);
};
export function hexColor(value = "#315B3E") {
  if (typeof value !== "string" || !/^#?[0-9a-f]{6}$/i.test(value))
    throw new Error("Use a six-digit hex color.");
  return "#" + value.replace("#", "").toUpperCase();
}
function rectangle(c) {
  for (const key of ["x", "y", "width", "height"]) number(c[key], 0, 1, key);
  if (
    c.width <= 0 ||
    c.height <= 0 ||
    c.x + c.width > 1.000001 ||
    c.y + c.height > 1.000001
  )
    throw new Error("The selection must fit inside the page or image.");
}
export function validateVisualPlan(plan, files) {
  const file = files.find((f) => f.id === plan?.fileId && f.name === plan.name);
  if (!file || !isVisualFile(file.name))
    throw new Error(
      "This edit must reference a PDF or image in this conversation.",
    );
  if (
    !Array.isArray(plan.changes) ||
    !plan.changes.length ||
    plan.changes.length > 20
  )
    throw new Error("Request between 1 and 20 visual edits per file.");
  const pdf = mediaKind(file.name) === "pdf";
  let pageSelection = false;
  const filledFields = new Set();
  for (const c of plan.changes) {
    if (!c || typeof c !== "object" || Array.isArray(c))
      throw new Error("The AI returned an invalid visual edit.");
    if (
      !(
        pdf
          ? [
              "rotate",
              "selectPages",
              "addText",
              "highlight",
              "replaceText",
              "ocrReplaceText",
              "fillField",
            ]
          : [
              "rotate",
              "crop",
              "resize",
              "flip",
              "adjust",
              "addText",
              "rectangle",
              "ellipse",
            ]
      ).includes(c.op)
    )
      throw new Error(
        `Unsupported ${pdf ? "PDF" : "image"} edit: ${String(c.op)}.`,
      );
    if (
      pdf &&
      !["selectPages", "fillField"].includes(c.op) &&
      (!Number.isInteger(c.page) || c.page < 1 || c.page > 50)
    )
      throw new Error("Specify an original PDF page number from 1 to 50.");
    if (["replaceText", "ocrReplaceText"].includes(c.op)) {
      if (
        typeof c.find !== "string" ||
        !c.find.length ||
        c.find.length > 500 ||
        typeof c.replace !== "string" ||
        !c.replace.length ||
        c.replace.length > 1000 ||
        /[\p{Cc}]/u.test(c.find + c.replace) ||
        !Number.isInteger(c.count) ||
        c.count < 1 ||
        c.count > 100
      )
        throw new Error(
          "Use exact single-line PDF text, a non-empty replacement and an expected match count (1–100).",
        );
    }
    if (c.op === "fillField") {
      const validValue = (v) =>
        v === null ||
        typeof v === "boolean" ||
        (typeof v === "string" && v.length <= 10000) ||
        (Array.isArray(v) &&
          v.length <= 50 &&
          v.every((i) => typeof i === "string" && i.length <= 500));
      if (!validValue(c.expected) || filledFields.has(c.field))
        throw new Error(
          "Use a valid expected value and edit each form field only once.",
        );
      filledFields.add(c.field);
      if (
        typeof c.field !== "string" ||
        !c.field.length ||
        c.field.length > 255 ||
        !("expected" in c) ||
        !("value" in c) ||
        (!["string", "boolean"].includes(typeof c.value) &&
          !Array.isArray(c.value)) ||
        (typeof c.value === "string" &&
          (c.value.length > 10000 ||
            /[\p{Cc}]/u.test(c.value.replace(/[\r\n]/g, "")))) ||
        (Array.isArray(c.value) &&
          (c.value.length > 50 ||
            c.value.some((v) => typeof v !== "string" || v.length > 500)))
      )
        throw new Error(
          "Form edits need an exact field name, expected original value and a valid text, checkbox or choice value.",
        );
    }
    if (c.op === "rotate") {
      if (![-270, -180, -90, 90, 180, 270].includes(c.degrees))
        throw new Error("Rotate by 90, 180 or 270 degrees.");
    }
    if (c.op === "selectPages") {
      if (
        pageSelection ||
        !Array.isArray(c.pages) ||
        !c.pages.length ||
        c.pages.length > 50 ||
        new Set(c.pages).size !== c.pages.length ||
        c.pages.some((p) => !Number.isInteger(p) || p < 1 || p > 50)
      )
        throw new Error(
          "Select a non-empty, unique list of original pages, once per file.",
        );
      pageSelection = true;
    }
    if (["crop", "rectangle", "ellipse", "highlight"].includes(c.op))
      rectangle(c);
    if (c.op === "resize") {
      for (const key of ["width", "height"])
        if (!Number.isInteger(c[key]) || c[key] < 1 || c[key] > 8192)
          throw new Error(
            "Resize dimensions must be whole pixels from 1 to 8,192.",
          );
      if (c.width * c.height > 16000000)
        throw new Error("Use an image smaller than 16 megapixels.");
    }
    if (c.op === "flip" && !["horizontal", "vertical"].includes(c.axis))
      throw new Error("Choose a horizontal or vertical flip.");
    if (c.op === "adjust") {
      if (
        !["brightness", "contrast", "saturation", "grayscale"].some(
          (k) => k in c,
        )
      )
        throw new Error("Specify a color adjustment.");
      for (const key of ["brightness", "contrast", "saturation"])
        if (key in c) number(c[key], -100, 100, key);
      if ("grayscale" in c && typeof c.grayscale !== "boolean")
        throw new Error("Grayscale must be true or false.");
    }
    if (c.op === "addText") {
      if (
        typeof c.text !== "string" ||
        !c.text.trim() ||
        c.text.length > 500 ||
        /[\p{Cc}]/u.test(c.text.replace(/\n/g, "")) ||
        c.text.split("\n").length > 5
      )
        throw new Error(
          "Use up to 500 characters and five lines of visible text.",
        );
      number(c.x, 0, 1, "x");
      number(c.y, 0, 1, "y");
      number(c.fontSize, 8, pdf ? 72 : 256, "Font size");
      if ("bold" in c && typeof c.bold !== "boolean")
        throw new Error("Bold must be true or false.");
    }
    if (["addText", "highlight", "rectangle", "ellipse"].includes(c.op)) {
      c.color = hexColor(c.color);
      if (c.opacity !== undefined)
        number(
          c.opacity,
          pdf && c.op === "highlight" ? 0.05 : 0.05,
          pdf && c.op === "highlight" ? 0.5 : 1,
          "Opacity",
        );
    }
  }
  return file;
}
