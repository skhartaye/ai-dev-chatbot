import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("Markdown fallback renders useful formatting and removes unsafe model markup", async () => {
  const dom = new JSDOM('<!doctype html><body><div id="answer"></div></body>');
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
  });
  try {
    const { renderAnswer } = await import("../public/render-answer.js");
    const node = document.getElementById("answer");
    await renderAnswer(
      node,
      '## Answer\n\n- **First** point\n- Second point\n\n```js\nconst value = 1;\n```\n\n<script>alert(1)</script><img src=x onerror="alert(1)"><form><input name=answer></form><a href="javascript:alert(1)">Bad</a><a href="https://example.com">Good</a>',
    );
    assert.equal(node.querySelectorAll("li").length, 2);
    assert.equal(node.querySelector("strong").textContent, "First");
    assert.match(node.querySelector("pre code").textContent, /const value = 1/);
    assert.equal(
      node.querySelector(
        'script,img,form,input,[onerror],a[href^="javascript:"]',
      ),
      null,
    );
    const link = node.querySelector('a[href="https://example.com"]');
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.target, "_blank");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});
