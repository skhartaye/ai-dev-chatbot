const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const children = (n, name) =>
  Array.from(n.children).filter((e) => e.localName === name);
const get = (n, name) => children(n, name)[0];
const make = (doc, ns, name) =>
  doc.createElementNS(ns, ns === W ? "w:" + name : name);
export function validateFormat(format, word = false) {
  if (
    !format ||
    typeof format !== "object" ||
    Array.isArray(format) ||
    !Object.keys(format).length
  )
    throw new Error("Provide at least one supported formatting change.");
  const allowed = word
    ? [
        "bold",
        "italic",
        "underline",
        "fontSize",
        "fontFamily",
        "color",
        "fill",
        "alignment",
      ]
    : [
        "bold",
        "italic",
        "underline",
        "fontSize",
        "fontFamily",
        "color",
        "fill",
        "horizontal",
        "wrapText",
        "numberFormat",
      ];
  for (const [key, value] of Object.entries(format)) {
    if (!allowed.includes(key))
      throw new Error(`Unsupported formatting: ${key}.`);
    if (
      ["bold", "italic", "underline", "wrapText"].includes(key) &&
      typeof value !== "boolean"
    )
      throw new Error(`${key} must be true or false.`);
    if (["color", "fill"].includes(key) && !/^#[\da-f]{6}$/i.test(value))
      throw new Error("Use a six-digit hex color such as #315B3E.");
    if (
      key === "fontSize" &&
      (!Number.isFinite(value) ||
        value < 8 ||
        value > 72 ||
        value * 2 !== Math.round(value * 2))
    )
      throw new Error(
        "Use a font size from 8 to 72 points in half-point steps.",
      );
    if (
      key === "fontFamily" &&
      (typeof value !== "string" || !/^[\p{L}\p{N} ,_-]{1,60}$/u.test(value))
    )
      throw new Error("Use a font family name up to 60 characters.");
    if (
      ["alignment", "horizontal"].includes(key) &&
      !["left", "center", "right", ...(word ? ["justify"] : [])].includes(value)
    )
      throw new Error("Use left, center, right, or Word justify alignment.");
    if (
      key === "numberFormat" &&
      (typeof value !== "string" ||
        !value.length ||
        value.length > 128 ||
        /[\p{Cc}]/u.test(value))
    )
      throw new Error("Use an Excel number format of 1–128 characters.");
  }
}
const rOrder = [
  "rStyle",
  "rFonts",
  "b",
  "bCs",
  "i",
  "iCs",
  "caps",
  "smallCaps",
  "strike",
  "dstrike",
  "outline",
  "shadow",
  "emboss",
  "imprint",
  "noProof",
  "snapToGrid",
  "vanish",
  "webHidden",
  "color",
  "spacing",
  "w",
  "kern",
  "position",
  "sz",
  "szCs",
  "highlight",
  "u",
  "effect",
  "bdr",
  "shd",
  "fitText",
  "vertAlign",
  "rtl",
  "cs",
  "em",
  "lang",
  "eastAsianLayout",
  "specVanish",
  "oMath",
];
function ordered(parent, child, order) {
  const index = order.indexOf(child.localName);
  const next = Array.from(parent.children).find(
    (n) => order.indexOf(n.localName) > index,
  );
  parent.insertBefore(child, next || null);
}
function wordProperties(run, format) {
  const doc = run.ownerDocument;
  let props = get(run, "rPr");
  if (!props) {
    props = make(doc, W, "rPr");
    run.insertBefore(props, run.firstChild);
  }
  const set = (name, attrs) => {
    get(props, name)?.remove();
    const n = make(doc, W, name);
    for (const [k, v] of Object.entries(attrs))
      n.setAttributeNS(W, "w:" + k, String(v));
    ordered(props, n, rOrder);
  };
  for (const [key, name] of [
    ["bold", "b"],
    ["italic", "i"],
    ["underline", "u"],
  ])
    if (key in format)
      set(name, {
        val: format[key]
          ? key === "underline"
            ? "single"
            : "1"
          : key === "underline"
            ? "none"
            : "0",
      });
  if (format.fontSize !== undefined) set("sz", { val: format.fontSize * 2 });
  if (format.fontFamily)
    set("rFonts", {
      ascii: format.fontFamily,
      hAnsi: format.fontFamily,
      eastAsia: format.fontFamily,
      cs: format.fontFamily,
    });
  if (format.color) set("color", { val: format.color.slice(1).toUpperCase() });
  if (format.fill)
    set("shd", { val: "clear", fill: format.fill.slice(1).toUpperCase() });
}
export function formatWordParagraph(p, change) {
  const starts = [];
  const all = () => Array.from(p.getElementsByTagNameNS(W, "t"));
  const text = all()
    .map((t) => t.textContent)
    .join("");
  for (
    let at = 0;
    (at = text.indexOf(change.find, at)) !== -1;
    at += change.find.length
  )
    starts.push(at);
  for (const start of starts.reverse()) {
    let offset = 0;
    const spans = all().map((t) => {
      const span = { t, start: offset, end: offset + t.textContent.length };
      offset = span.end;
      return span;
    });
    const touched = spans.filter(
      (s) => s.end > start && s.start < start + change.find.length,
    );
    if (
      touched.some(
        (s) =>
          s.t.parentElement.localName !== "r" ||
          children(s.t.parentElement, "t").length !== 1 ||
          Array.from(s.t.parentElement.children).some(
            (n) => !["t", "rPr"].includes(n.localName),
          ),
      )
    )
      throw new Error(
        "This text contains a complex Word run. Choose a simpler text selection.",
      );
    touched.forEach((s, i) => {
      const run = s.t.parentElement,
        before = s.t.textContent.slice(0, Math.max(0, start - s.start)),
        after = s.t.textContent.slice(
          Math.min(
            s.t.textContent.length,
            start + change.find.length - s.start,
          ),
        );
      const selected =
        "replace" in change
          ? i === 0
            ? change.replace
            : ""
          : s.t.textContent.slice(
              Math.max(0, start - s.start),
              Math.min(
                s.t.textContent.length,
                start + change.find.length - s.start,
              ),
            );
      for (const [value, styled] of [
        [before, false],
        [selected, true],
        [after, false],
      ])
        if (value) {
          const copy = run.cloneNode(true),
            t = get(copy, "t");
          t.textContent = value;
          t.setAttributeNS(
            "http://www.w3.org/XML/1998/namespace",
            "xml:space",
            "preserve",
          );
          if (styled) wordProperties(copy, change.format);
          run.before(copy);
        }
      run.remove();
    });
  }
  if (starts.length && change.format.alignment) {
    let props = get(p, "pPr");
    if (!props) {
      props = make(p.ownerDocument, W, "pPr");
      p.insertBefore(props, p.firstChild);
    }
    get(props, "jc")?.remove();
    const jc = make(p.ownerDocument, W, "jc");
    jc.setAttributeNS(
      W,
      "w:val",
      change.format.alignment === "justify" ? "both" : change.format.alignment,
    );
    ordered(props, jc, [
      "pStyle",
      "keepNext",
      "keepLines",
      "pageBreakBefore",
      "framePr",
      "widowControl",
      "numPr",
      "suppressLineNumbers",
      "pBdr",
      "shd",
      "tabs",
      "suppressAutoHyphens",
      "kinsoku",
      "wordWrap",
      "overflowPunct",
      "topLinePunct",
      "autoSpaceDE",
      "autoSpaceDN",
      "bidi",
      "adjustRightInd",
      "snapToGrid",
      "spacing",
      "ind",
      "contextualSpacing",
      "mirrorIndents",
      "suppressOverlap",
      "jc",
      "textDirection",
      "textAlignment",
      "textboxTightWrap",
      "outlineLvl",
      "divId",
      "cnfStyle",
      "rPr",
      "sectPr",
      "pPrChange",
    ]);
  }
  return starts.length;
}
export function formatExcelCell(cell, format, styles) {
  const key = (cell.getAttribute("s") || "0") + "|" + JSON.stringify(format);
  styles.kahuronStyleCache ??= new Map();
  if (styles.kahuronStyleCache.has(key)) {
    cell.setAttribute("s", styles.kahuronStyleCache.get(key));
    return;
  }
  const doc = styles,
    root = doc.documentElement,
    fonts = get(root, "fonts"),
    fills = get(root, "fills"),
    xfs = get(root, "cellXfs");
  if (!fonts || !fills || !xfs)
    throw new Error("This workbook has no supported styles table.");
  const source = children(xfs, "xf")[Number(cell.getAttribute("s") || 0)];
  if (!source) throw new Error("A cell references a missing style.");
  const xf = source.cloneNode(true);
  const append = (parent, node) => {
    const id = parent.children.length;
    parent.append(node);
    parent.setAttribute("count", parent.children.length);
    return id;
  };
  const set = (parent, name, attrs) => {
    get(parent, name)?.remove();
    const n = make(doc, S, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    parent.append(n);
  };
  if (
    ["bold", "italic", "underline", "fontFamily", "fontSize", "color"].some(
      (k) => k in format,
    )
  ) {
    const font = children(fonts, "font")[
      Number(xf.getAttribute("fontId") || 0)
    ]?.cloneNode(true);
    if (!font) throw new Error("A font style is missing.");
    for (const [key, name] of [
      ["bold", "b"],
      ["italic", "i"],
      ["underline", "u"],
    ])
      if (key in format)
        set(font, name, {
          val: format[key]
            ? key === "underline"
              ? "single"
              : "1"
            : key === "underline"
              ? "none"
              : "0",
        });
    if (format.fontFamily) {
      set(font, "name", { val: format.fontFamily });
      get(font, "scheme")?.remove();
    }
    if (format.fontSize !== undefined)
      set(font, "sz", { val: format.fontSize });
    if (format.color)
      set(font, "color", { rgb: "FF" + format.color.slice(1).toUpperCase() });
    xf.setAttribute("fontId", append(fonts, font));
    xf.setAttribute("applyFont", "1");
  }
  if (format.fill) {
    const fill = make(doc, S, "fill"),
      pattern = make(doc, S, "patternFill");
    pattern.setAttribute("patternType", "solid");
    set(pattern, "fgColor", { rgb: "FF" + format.fill.slice(1).toUpperCase() });
    set(pattern, "bgColor", { indexed: 64 });
    fill.append(pattern);
    xf.setAttribute("fillId", append(fills, fill));
    xf.setAttribute("applyFill", "1");
  }
  if (format.numberFormat) {
    let formats = get(root, "numFmts");
    if (!formats) {
      formats = make(doc, S, "numFmts");
      root.insertBefore(formats, root.firstChild);
    }
    const existing = children(formats, "numFmt").find(
      (f) => f.getAttribute("formatCode") === format.numberFormat,
    );
    let id = existing?.getAttribute("numFmtId");
    if (!id) {
      id =
        Math.max(
          163,
          ...children(formats, "numFmt").map((n) =>
            Number(n.getAttribute("numFmtId")),
          ),
        ) + 1;
      const f = make(doc, S, "numFmt");
      f.setAttribute("numFmtId", id);
      f.setAttribute("formatCode", format.numberFormat);
      append(formats, f);
    }
    xf.setAttribute("numFmtId", id);
    xf.setAttribute("applyNumberFormat", "1");
  }
  if (format.horizontal || "wrapText" in format) {
    let a = get(xf, "alignment");
    if (!a) {
      a = make(doc, S, "alignment");
      xf.insertBefore(a, get(xf, "protection") || get(xf, "extLst") || null);
    }
    if (format.horizontal) a.setAttribute("horizontal", format.horizontal);
    if ("wrapText" in format)
      a.setAttribute("wrapText", format.wrapText ? "1" : "0");
    xf.setAttribute("applyAlignment", "1");
  }
  const id = append(xfs, xf);
  styles.kahuronStyleCache.set(key, id);
  cell.setAttribute("s", id);
}
export const formatDescription = (format) =>
  Object.entries(format || {})
    .map(
      ([key, value]) =>
        `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${typeof value === "boolean" ? (value ? "on" : "off") : value}`,
    )
    .join(" · ");
