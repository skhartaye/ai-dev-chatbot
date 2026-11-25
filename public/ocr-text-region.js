// OCR geometry is derived from the rendered source, never from model coordinates.
export function findOcrMatches(blocks, change) {
  const matches = [];
  const allWords = (blocks || []).flatMap((b) =>
    (b.paragraphs || []).flatMap((p) =>
      (p.lines || []).flatMap((l) => l.words || []),
    ),
  );
  for (const block of blocks || [])
    for (const paragraph of block.paragraphs || [])
      for (const line of paragraph.lines || []) {
        const words = line.words || [];
        for (let i = 0; i < words.length; i++) {
          let text = "";
          for (let j = i; j < words.length; j++) {
            text += (j === i ? "" : " ") + words[j].text;
            if (text === change.find) {
              const selected = words.slice(i, j + 1);
              if (
                selected.some(
                  (w) => !Number.isFinite(w.confidence) || w.confidence < 85,
                )
              )
                throw new Error(
                  "OCR is unsure about this text. Upload a clearer scan or use the source document.",
                );
              const box = {
                x0: Math.min(...selected.map((w) => w.bbox.x0)),
                y0: Math.min(...selected.map((w) => w.bbox.y0)),
                x1: Math.max(...selected.map((w) => w.bbox.x1)),
                y1: Math.max(...selected.map((w) => w.bbox.y1)),
              };
              if (
                !Object.values(box).every(Number.isFinite) ||
                box.x1 <= box.x0 ||
                box.y1 <= box.y0
              )
                throw new Error("OCR returned invalid text bounds.");
              const centers = selected.map((w) => (w.bbox.y0 + w.bbox.y1) / 2);
              if (
                Math.max(...centers) - Math.min(...centers) >
                (box.y1 - box.y0) * 0.35
              )
                throw new Error(
                  "OCR rewriting requires horizontal text. Straighten the scan first.",
                );
              matches.push({
                box,
                words: selected,
                others: allWords.filter((w) => !selected.includes(w)),
              });
              i = j;
              break;
            }
            if (text.length >= change.find.length) break;
          }
        }
      }
  if (matches.length !== change.count)
    throw new Error(
      `OCR expected ${change.count} exact match(es) on page ${change.page}, found ${matches.length}. Use exact printed words from one line or upload a clearer scan.`,
    );
  return matches;
}
export function clearOcrPixels(ctx, match, width, height) {
  const b = match.box,
    x = Math.floor(b.x0) - 4,
    y = Math.floor(b.y0) - 4,
    w = Math.ceil(b.x1) - x + 4,
    h = Math.ceil(b.y1) - y + 4;
  if (x < 0 || y < 0 || x + w > width || y + h > height)
    throw new Error("The OCR text is too close to the page edge.");
  if (
    match.others.some(
      ({ bbox: o }) => o.x0 < x + w && o.x1 > x && o.y0 < y + h && o.y1 > y,
    )
  )
    throw new Error(
      "The OCR text overlaps nearby words. Edit the source document.",
    );
  const { data } = ctx.getImageData(x, y, w, h);
  let border = 0,
    white = 0;
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const p = (yy * w + xx) * 4,
        r = data[p],
        g = data[p + 1],
        blue = data[p + 2];
      const light = r >= 240 && g >= 240 && blue >= 240;
      if (xx < 2 || yy < 2 || xx >= w - 2 || yy >= h - 2) {
        border++;
        if (light) white++;
      }
      // Reject coloured content and unexplained marks between recognized words.
      if (
        !light &&
        (Math.max(r, g, blue) - Math.min(r, g, blue) > 35 ||
          !match.words.some(
            ({ bbox: o }) =>
              xx + x >= o.x0 - 3 &&
              xx + x <= o.x1 + 3 &&
              yy + y >= o.y0 - 3 &&
              yy + y <= o.y1 + 3,
          ))
      )
        throw new Error(
          "OCR rewriting needs black printed text on a plain white background. This region contains other marks or colour.",
        );
    }
  if (white / border < 0.98)
    throw new Error(
      "The scan background is not plain white around this text. Use a cleaner scan or edit the source document.",
    );
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(x, y, w, h);
}
