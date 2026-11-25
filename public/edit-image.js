import { imageSize } from "image-size";
import { validateVisualPlan } from "./media-edit-plan.js";
import { MAX_FILE_BYTES } from "./extract-file.js";
const makeCanvas = (width, height) => {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};
async function decode(blob) {
  if (typeof createImageBitmap === "function")
    return createImageBitmap(blob, { imageOrientation: "from-image" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function encode(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not export the image.")),
      "image/png",
    ),
  );
}
function animated(bytes, type) {
  if (type === "webp")
    return (
      String.fromCharCode(...bytes.slice(12, 16)) === "VP8X" &&
      !!(bytes[20] & 2)
    );
  if (type === "png") {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let p = 8; p + 12 < bytes.length;) {
      const size = v.getUint32(p),
        kind = String.fromCharCode(...bytes.slice(p + 4, p + 8));
      if (kind === "acTL") return true;
      if (kind === "IDAT") return false;
      p += size + 12;
    }
  }
  return false;
}
export async function editImage(
  blob,
  plan,
  {
    signal,
    canvasFactory = makeCanvas,
    decodeImage = decode,
    encodeCanvas = encode,
  } = {},
) {
  validateVisualPlan(plan, [{ id: plan.fileId, name: plan.name }]);
  signal?.throwIfAborted();
  if (blob.size > MAX_FILE_BYTES)
    throw new Error("Choose an image smaller than 10 MB.");
  const bytes = new Uint8Array(await blob.arrayBuffer()),
    size = imageSize(bytes);
  if (
    !["png", "jpg", "webp"].includes(size.type) ||
    !size.width ||
    !size.height ||
    size.width > 8192 ||
    size.height > 8192 ||
    size.width * size.height > 16000000
  )
    throw new Error(
      "Use a PNG, JPEG or WebP image of at most 16 megapixels and 8,192 pixels per side.",
    );
  if (animated(bytes, size.type))
    throw new Error(
      "Animated images are not supported. Export a still image first.",
    );
  let source = await decodeImage(blob);
  let canvas;
  const log = [];
  try {
    canvas = canvasFactory(
      source.width || source.naturalWidth,
      source.height || source.naturalHeight,
    );
    canvas.getContext("2d").drawImage(source, 0, 0);
    source.close?.();
    source = null;
    for (const [index, c] of plan.changes.entries()) {
      signal?.throwIfAborted();
      const w = canvas.width,
        h = canvas.height;
      let next, ctx, description;
      if (c.op === "crop") {
        const x = Math.floor(c.x * w),
          y = Math.floor(c.y * h),
          cw = Math.min(w - x, Math.max(1, Math.round(c.width * w))),
          ch = Math.min(h - y, Math.max(1, Math.round(c.height * h)));
        next = canvasFactory(cw, ch);
        next.getContext("2d").drawImage(canvas, x, y, cw, ch, 0, 0, cw, ch);
        description = `Crop to ${cw} × ${ch} pixels.`;
      }
      if (c.op === "resize") {
        next = canvasFactory(c.width, c.height);
        ctx = next.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(canvas, 0, 0, c.width, c.height);
        description = `Resize to ${c.width} × ${c.height} pixels.`;
      }
      if (c.op === "rotate") {
        const degrees = ((c.degrees % 360) + 360) % 360,
          swap = degrees % 180 !== 0;
        next = canvasFactory(swap ? h : w, swap ? w : h);
        ctx = next.getContext("2d");
        ctx.save();
        ctx.translate(next.width / 2, next.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(canvas, -w / 2, -h / 2);
        ctx.restore();
        description = `Rotate ${c.degrees}° clockwise.`;
      }
      if (c.op === "flip") {
        next = canvasFactory(w, h);
        ctx = next.getContext("2d");
        ctx.save();
        ctx.translate(
          c.axis === "horizontal" ? w : 0,
          c.axis === "vertical" ? h : 0,
        );
        ctx.scale(
          c.axis === "horizontal" ? -1 : 1,
          c.axis === "vertical" ? -1 : 1,
        );
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
        description = `Flip ${c.axis}.`;
      }
      if (c.op === "adjust") {
        ctx = canvas.getContext("2d");
        const image = ctx.getImageData(0, 0, w, h),
          pixels = image.data,
          contrast = 1 + (c.contrast || 0) / 100,
          saturation = 1 + (c.saturation || 0) / 100,
          brightness = (c.brightness || 0) * 2.55;
        for (let i = 0; i < pixels.length; i += 4) {
          let r = (pixels[i] - 127.5) * contrast + 127.5 + brightness,
            g = (pixels[i + 1] - 127.5) * contrast + 127.5 + brightness,
            b = (pixels[i + 2] - 127.5) * contrast + 127.5 + brightness;
          const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          pixels[i] = c.grayscale ? gray : gray + (r - gray) * saturation;
          pixels[i + 1] = c.grayscale ? gray : gray + (g - gray) * saturation;
          pixels[i + 2] = c.grayscale ? gray : gray + (b - gray) * saturation;
        }
        ctx.putImageData(image, 0, 0);
        description = ["brightness", "contrast", "saturation"]
          .filter((k) => k in c)
          .map((k) => `${k} ${c[k] >= 0 ? "+" : ""}${c[k]}%`)
          .concat(c.grayscale ? ["grayscale"] : [])
          .join(" · ");
      }
      if (["addText", "rectangle", "ellipse"].includes(c.op)) {
        ctx = canvas.getContext("2d");
        ctx.save();
        ctx.globalAlpha = c.opacity ?? 1;
        ctx.fillStyle = c.color;
        if (c.op === "addText") {
          ctx.font = `${c.bold ? "bold" : "normal"} ${c.fontSize}px sans-serif`;
          ctx.textBaseline = "top";
          const lines = c.text.split("\n");
          if (
            c.y * h + lines.length * c.fontSize * 1.25 > h ||
            lines.some((line) => c.x * w + ctx.measureText(line).width > w)
          )
            throw new Error(
              "The text does not fit inside the image. Use smaller text or move it.",
            );
          lines.forEach((line, i) =>
            ctx.fillText(line, c.x * w, c.y * h + i * c.fontSize * 1.25),
          );
          description = `Add text “${c.text}”.`;
        } else if (c.op === "rectangle") {
          ctx.fillRect(c.x * w, c.y * h, c.width * w, c.height * h);
          description = `Add a ${c.color} rectangle.`;
        } else {
          ctx.beginPath();
          ctx.ellipse(
            (c.x + c.width / 2) * w,
            (c.y + c.height / 2) * h,
            (c.width * w) / 2,
            (c.height * h) / 2,
            0,
            0,
            2 * Math.PI,
          );
          ctx.fill();
          description = `Add a ${c.color} ellipse.`;
        }
        ctx.restore();
      }
      if (next) {
        canvas.width = canvas.height = 0;
        canvas = next;
      }
      log.push({ location: `Image · Change ${index + 1}`, description });
    }
    signal?.throwIfAborted();
    const output = await encodeCanvas(canvas);
    if (!output || output.size > MAX_FILE_BYTES)
      throw new Error(
        "The PNG copy exceeds 10 MB. Resize it smaller before downloading.",
      );
    return {
      kind: "image",
      blob: output,
      name: plan.name.replace(/\.[^.]+$/, "-edited.png"),
      log,
      notes: [
        "Exports a still PNG copy. Original photo metadata is not included.",
      ],
    };
  } finally {
    source?.close?.();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
