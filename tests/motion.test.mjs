import test from "node:test";
import assert from "node:assert/strict";
import { reveal } from "../public/motion.js";

test("card feedback respects reduced motion, keyboard input, and API availability", () => {
  let reduced = false;
  let keyboard = false;
  let calls = 0;
  const previous = {
    document: globalThis.document,
    matchMedia: globalThis.matchMedia,
  };
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.document = {
    documentElement: { classList: { contains: () => keyboard } },
  };
  const node = {
    animate: (frames, options) => {
      calls++;
      assert.equal(frames.at(-1).opacity, 1);
      assert.equal(options.duration, 220);
    },
  };
  try {
    reveal(node);
    assert.equal(calls, 1);
    reduced = true;
    reveal(node);
    reduced = false;
    keyboard = true;
    reveal(node);
    keyboard = false;
    reveal(null);
    reveal({});
    assert.equal(calls, 1);
  } finally {
    globalThis.document = previous.document;
    globalThis.matchMedia = previous.matchMedia;
  }
});
