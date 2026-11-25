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

export async function renderAnswer(node, text,{files=[]}={}) {
  const plans=[];
  const visible=text.replace(/```kahuron-edit\s*\n([\s\S]*?)```/g,(_,json)=>{
    try{plans.push(JSON.parse(json));return '';}
    catch{return '\nThe proposed file edit could not be read. Ask the AI to propose it again.\n';}
  });
  const html = marked.parse(visible, { async: false });
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
    if(!/^https?:\/\//i.test(link.getAttribute('href')||'')){link.replaceWith(document.createTextNode(link.textContent));continue;}
    link.rel = "noopener noreferrer";
    link.target = "_blank";
  }
  if(plans.length) {
    const {appendEditReviews}=await import('./edit-review.js');
    appendEditReviews(node,plans,files);
  }
}
