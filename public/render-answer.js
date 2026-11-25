import { marked } from "marked";

const elements = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
  "hr",
];
const attributes = ["href", "title"];
let purifier;

export async function renderAnswer(node, text) {
  const html = marked.parse(text, { async: false });
  if ("setHTML" in Element.prototype) {
    node.setHTML(html, { sanitizer: { elements, attributes } });
  } else {
    purifier ??= import("dompurify").then((module) => module.default);
    node.innerHTML = (await purifier).sanitize(html, {
      ALLOWED_TAGS: [...elements, "#text"],
      ALLOWED_ATTR: attributes,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: false,
    });
  }
  for (const link of node.querySelectorAll("a")) {
    link.rel = "noopener noreferrer";
    link.target = "_blank";
  }
}
