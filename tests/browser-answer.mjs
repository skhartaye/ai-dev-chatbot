// Bundle this browser fixture with esbuild and open it in Chrome.
import { renderAnswer } from "../public/render-answer.js";

const result = document.getElementById("result");
const fixture =
  '## Answer\n\n- **First** point\n- Second point\n\n```js\nconst value = 1;\n```\n\n<script>window.fixtureAttack=true</script><img src=x onerror="window.fixtureAttack=true"><a href="javascript:alert(1)">Unsafe link</a><a href="https://example.com">Safe link</a>';
async function check(label) {
  const node = document.createElement("div");
  document.body.append(node);
  await renderAnswer(node, fixture);
  if (
    node.querySelector("script,img,[onerror]") ||
    node.querySelector('a[href^="javascript:"]') ||
    window.fixtureAttack
  )
    throw new Error(`${label}: unsafe markup survived`);
  if (
    node.querySelectorAll("li").length !== 2 ||
    !node.querySelector("strong") ||
    !node.querySelector("pre code")
  )
    throw new Error(`${label}: formatting missing`);
  if (
    node.querySelector('a[href="https://example.com"]').rel !==
    "noopener noreferrer"
  )
    throw new Error(`${label}: unsafe link relation`);
  return label;
}
try {
  const checks = [];
  const native = Object.getOwnPropertyDescriptor(Element.prototype, "setHTML");
  if (native) checks.push(await check("native sanitizer"));
  try {
    delete Element.prototype.setHTML;
    checks.push(await check("DOMPurify fallback"));
  } finally {
    if (native) Object.defineProperty(Element.prototype, "setHTML", native);
  }
  result.textContent = `PASS: ${checks.join(" + ")}; headings, lists, code, XSS removal, safe links`;
} catch (error) {
  result.textContent = `FAIL: ${error.message}`;
}
