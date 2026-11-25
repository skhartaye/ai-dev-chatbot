import { PDFDocument, StandardFonts } from "pdf-lib";
const candidates = [
  ["Helvetica", "Sans serif"],
  ["HelveticaBold", "Sans serif · bold"],
  ["HelveticaOblique", "Sans serif · italic"],
  ["HelveticaBoldOblique", "Sans serif · bold italic"],
  ["TimesRoman", "Serif"],
  ["TimesRomanBold", "Serif · bold"],
  ["TimesRomanItalic", "Serif · italic"],
  ["TimesRomanBoldItalic", "Serif · bold italic"],
  ["Courier", "Monospace"],
  ["CourierBold", "Monospace · bold"],
  ["CourierOblique", "Monospace · italic"],
  ["CourierBoldOblique", "Monospace · bold italic"],
];
function inkBounds(ctx, x, y, w, h) {
  const { data } = ctx.getImageData(x, y, w, h);
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const i = (yy * w + xx) * 4;
      if (
        data[i + 3] > 128 &&
        data[i] < 200 &&
        data[i + 1] < 200 &&
        data[i + 2] < 200
      ) {
        x0 = Math.min(x0, xx);
        y0 = Math.min(y0, yy);
        x1 = Math.max(x1, xx);
        y1 = Math.max(y1, yy);
      }
    }
  return x1 < 0
    ? null
    : { x0: x + x0, y0: y + y0, x1: x + x1 + 1, y1: y + y1 + 1 };
}
function mask(canvas, box, canvasFactory) {
  const c = canvasFactory(240, 48),
    ctx = c.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 240, 48);
  ctx.drawImage(
    canvas,
    box.x0,
    box.y0,
    box.x1 - box.x0,
    box.y1 - box.y0,
    0,
    0,
    240,
    48,
  );
  const { data } = ctx.getImageData(0, 0, 240, 48),
    values = new Float32Array(240 * 48);
  for (let i = 0; i < values.length; i++) values[i] = 1 - data[i * 4] / 255;
  c.width = c.height = 0;
  return values;
}
const yieldToBrowser = () =>
  globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise((r) => setTimeout(r, 0));
export async function matchScanFont(
  ctx,
  match,
  {
    pdfjs,
    canvasFactory,
    signal,
    fontDataUrl = "/extraction-assets/standard_fonts/",
  } = {},
) {
  signal?.throwIfAborted();
  // Bound the atlas and compare one complete word when the requested phrase is long.
  const sample =
    match.words.find((w) => w.text.length >= 4 && w.text.length <= 24) ||
    match.words[0];
  const text = sample.text,
    source = sample.bbox;
  const doc = await PDFDocument.create(),
    height = candidates.length * 72,
    width = 1000,
    page = doc.addPage([width, height]);
  for (let i = 0; i < candidates.length; i++) {
    const font = await doc.embedFont(StandardFonts[candidates[i][0]]);
    try {
      page.drawText(text, { x: 12, y: height - i * 72 - 50, size: 32, font });
    } catch {
      throw new Error(
        "The replacement font supports Latin characters only. Use supported text.",
      );
    }
  }
  const loading = pdfjs.getDocument({
    data: await doc.save(),
    isEvalSupported: false,
    standardFontDataUrl: fontDataUrl,
    useSystemFonts: false,
  });
  const abort = () => void loading.destroy().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  let atlas;
  try {
    const pdf = await loading.promise,
      p = await pdf.getPage(1);
    atlas = canvasFactory(width, height);
    const atlasCtx = atlas.getContext("2d", { willReadFrequently: true });
    await p.render({
      canvasContext: atlasCtx,
      viewport: p.getViewport({ scale: 1 }),
      background: "rgb(255,255,255)",
    }).promise;
    const actual = inkBounds(
      ctx,
      Math.floor(source.x0),
      Math.floor(source.y0),
      Math.ceil(source.x1 - source.x0),
      Math.ceil(source.y1 - source.y0),
    );
    if (!actual)
      throw new Error(
        "The scanned letters could not be measured. Use a clearer scan.",
      );
    const original = mask(ctx.canvas, actual, canvasFactory),
      scores = [];
    let deadline = performance.now() + 40;
    for (let i = 0; i < candidates.length; i++) {
      signal?.throwIfAborted();
      const bounds = inkBounds(atlasCtx, 0, i * 72, width, 72);
      if (!bounds) continue;
      const rendered = mask(atlas, bounds, canvasFactory);
      let difference = 0,
        ink = 0;
      for (let k = 0; k < original.length; k++) {
        difference += Math.abs(original[k] - rendered[k]);
        ink += Math.max(original[k], rendered[k]);
      }
      const ratio =
        (actual.x1 - actual.x0) /
        (actual.y1 - actual.y0) /
        ((bounds.x1 - bounds.x0) / (bounds.y1 - bounds.y0));
      scores.push({
        name: StandardFonts[candidates[i][0]],
        label: candidates[i][1],
        score: difference / Math.max(1, ink) + Math.abs(Math.log(ratio)) * 0.2,
        sizePixels: (32 * (actual.y1 - actual.y0)) / (bounds.y1 - bounds.y0),
        baseline:
          actual.y1 +
          ((i * 72 + 50 - bounds.y1) * (actual.y1 - actual.y0)) /
            (bounds.y1 - bounds.y0),
      });
      if (performance.now() >= deadline) {
        await yieldToBrowser();
        deadline = performance.now() + 40;
      }
    }
    scores.sort((a, b) => a.score - b.score);
    if (!scores.length)
      throw new Error("No compatible replacement font could be measured.");
    return { ...scores[0], approximate: true };
  } finally {
    signal?.removeEventListener("abort", abort);
    await loading.destroy();
    if (atlas) atlas.width = atlas.height = 0;
  }
}
