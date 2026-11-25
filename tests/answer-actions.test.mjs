import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  appendAnswerActions,
  answerPlainText,
  copyTarget,
} from "../public/answer-actions.js";
test("answer copy preserves readable content and excludes file operations and action labels", async () => {
  const dom = new JSDOM(
      '<article data-message-id="job"><div class="answer"><h2>Queue guide</h2><p>Save every prompt.</p><ol><li>Store it</li><li>Process it</li></ol><pre><code>const x = 1;\nconsole.log(x);</code></pre><section class="edit-proposal"><button>Review edits</button>private file operations</section></div></article>',
    ),
    doc = dom.window.document,
    card = doc.querySelector("article"),
    answer = doc.querySelector(".answer");
  let copied = [];
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: { writeText: async (text) => copied.push(text) },
  });
  appendAnswerActions(card, answer, { number: 1, title: "Queue guide" });
  assert.equal(doc.querySelectorAll(".answer-actions").length, 1);
  assert.equal(doc.querySelectorAll(".code-actions").length, 1);
  const text = answerPlainText(answer);
  assert.match(text, /1\. Store it/);
  assert.match(text, /console.log/);
  assert.doesNotMatch(text, /Review edits|private file operations|Copy code/);
  const button = card.querySelector(".answer-actions button");
  button.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(copied, [text]);
  assert.match(button.nextElementSibling.textContent, /Copied/);
  const code = answer.querySelector("code"),
    codeButton = answer.querySelector(".code-actions button");
  await copyTarget(codeButton, code);
  assert.equal(copied[1], "const x = 1;\nconsole.log(x);");
  dom.window.navigator.clipboard.writeText = async () => {
    throw new Error("Denied");
  };
  await copyTarget(button, answer);
  assert.match(button.nextElementSibling.textContent, /Copy failed/);
  assert.equal(button.disabled, false);
  dom.window.close();
});
