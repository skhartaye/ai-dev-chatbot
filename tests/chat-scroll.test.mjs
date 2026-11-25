import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createChatScroll } from "../public/chat-scroll.js";
test("chat preserves the visible message across rerenders, and only follows at the end or on request", () => {
  const dom = new JSDOM(
      '<div id="chat"><ol><li data-message-id="one"></li><li data-message-id="two"></li></ol></div><button></button>',
    ),
    doc = dom.window.document,
    chat = doc.querySelector("#chat"),
    list = doc.querySelector("ol"),
    button = doc.querySelector("button");
  let height = 1000,
    second = 500;
  Object.defineProperties(chat, {
    clientHeight: { value: 300 },
    scrollHeight: { get: () => height },
  });
  chat.getBoundingClientRect = () => ({ top: 0 });
  list.children[0].getBoundingClientRect = () => ({
    top: -chat.scrollTop,
    bottom: second - chat.scrollTop,
  });
  list.children[1].getBoundingClientRect = () => ({
    top: second - chat.scrollTop,
    bottom: height - chat.scrollTop,
  });
  const scroll = createChatScroll(chat, list, button);
  scroll.beforeRender("a");
  scroll.afterRender();
  assert.equal(chat.scrollTop, 1000);
  chat.scrollTop = 540;
  chat.dispatchEvent(new dom.window.Event("scroll"));
  assert.equal(button.hidden, false);
  scroll.beforeRender("a");
  second = 600;
  height = 1100;
  scroll.afterRender();
  assert.equal(
    chat.scrollTop,
    640,
    "same message offset after an earlier item grows",
  );
  button.click();
  assert.equal(chat.scrollTop, 1100);
  scroll.beforeRender("b");
  height = 1400;
  scroll.afterRender();
  assert.equal(chat.scrollTop, 1400);
  dom.window.close();
});
