const el = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (className) n.className = className;
  return n;
};
export async function mountVisualReview(
  container,
  original,
  result,
  { signal } = {},
) {
  const resources = [];
  let stopped = false;
  const destroy = () => {
    if (stopped) return;
    stopped = true;
    for (const release of resources) release();
    signal?.removeEventListener("abort", destroy);
  };
  signal?.addEventListener("abort", destroy, { once: true });
  const comparison = el("section", null, "visual-comparison");
  comparison.append(el("h2", "Preview changes"));
  const grid = el("div", null, "visual-comparison-grid");
  comparison.append(grid);
  container.append(comparison);
  try {
    for (const [index, [title, blob]] of [
      ["Original", original],
      ["Edited copy", result.blob],
    ].entries()) {
      signal?.throwIfAborted();
      const figure = el("figure", null, "visual-comparison-pane");
      figure.append(el("figcaption", title));
      grid.append(figure);
      if (result.kind === "image") {
        const image = el("img");
        image.alt =
          index === 0 ? "Original attachment" : "Edited copy · " + result.name;
        image.decoding = "async";
        const url = URL.createObjectURL(blob);
        resources.push(() => URL.revokeObjectURL(url));
        image.src = url;
        await image.decode();
        signal?.throwIfAborted();
        image.width = image.naturalWidth;
        image.height = image.naturalHeight;
        figure.append(image);
      } else {
        const canvas = el("canvas");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", title + " PDF page preview");
        figure.append(canvas);
        const controls = el("div", null, "visual-page-controls"),
          previous = el("button", "Previous"),
          status = el("span"),
          next = el("button", "Next");
        previous.type = next.type = "button";
        previous.setAttribute("aria-label", title + ": previous PDF page");
        next.setAttribute("aria-label", title + ": next PDF page");
        status.setAttribute("role", "status");
        controls.append(previous, status, next);
        figure.append(controls);
        const { createPdfPreview } = await import("./pdf-preview.js");
        const pdf = await createPdfPreview(blob, canvas, { signal });
        resources.push(() => void pdf.destroy().catch(() => {}));
        let number = 1,
          busy = false;
        const render = async (page) => {
          if (stopped || busy) return;
          busy = true;
          previous.disabled = next.disabled = true;
          status.textContent = "Loading…";
          try {
            await pdf.render(page);
            if (stopped) return;
            number = page;
            status.textContent = `${page} / ${pdf.pages}`;
            canvas.setAttribute(
              "aria-label",
              `${title}: page ${page} of ${pdf.pages}`,
            );
          } catch (error) {
            if (!stopped) status.textContent = "Preview unavailable";
            throw error;
          } finally {
            busy = false;
            if (!stopped) {
              previous.disabled = number <= 1;
              next.disabled = number >= pdf.pages;
            }
          }
        };
        previous.addEventListener(
          "click",
          () => void render(number - 1).catch(() => {}),
        );
        next.addEventListener(
          "click",
          () => void render(number + 1).catch(() => {}),
        );
        await render(Math.min(result.previewPages?.[index] || 1, pdf.pages));
      }
    }
    signal?.throwIfAborted();
    return destroy;
  } catch (error) {
    destroy();
    comparison.remove();
    throw error;
  }
}
