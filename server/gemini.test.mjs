import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAnswer,
  generateAvailableAnswer,
  GEMINI_BACKUP_MODEL,
} from "./gemini.mjs";

test("preserves prompt order and returns completed answer", async () => {
  const result = await generateAnswer(["First", "Second"], {
    apiKey: "test",
    fetchImpl: async (url, options) => {
      assert.ok(url.includes("/gemini-3.5-flash-lite:generateContent"));
      assert.deepEqual(JSON.parse(options.body).contents[0].parts, [
        { text: "First" },
        { text: "Second" },
      ]);
      return Response.json({
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: JSON.stringify({answer:"Answer",title:"Reliable prompt queue"}) }] } },
        ],
      });
    },
  });
  assert.equal(result.text, "Answer");
  assert.equal(result.title,"Reliable prompt queue");
});

test("returns throttling to the worker without retrying or switching models", async () => {
  let calls = 0;
  await assert.rejects(
    generateAnswer(["Hello"], {
      apiKey: "test",
      fetchImpl: async () => {
        calls++;
        return new Response("", {
          status: 429,
          headers: { "retry-after": "60" },
        });
      },
    }),
    (error) => error.retryable && error.retryAfter === "60",
  );
  assert.equal(calls, 1);
});

test("does not treat truncated output as complete", async () => {
  await assert.rejects(
    generateAnswer(["Hello"], {
      apiKey: "test",
      fetchImpl: async () =>
        Response.json({
          candidates: [
            {
              finishReason: "MAX_TOKENS",
              content: { parts: [{ text: "Partial" }] },
            },
          ],
        }),
    }),
    /complete answer/,
  );
});

test("an availability failure uses exactly one approved backup and records the actual model", async () => {
  const urls = [];
  const result = await generateAvailableAnswer(["First", "Second"], {
    apiKey: "test",
    fetchImpl: async (url, options) => {
      urls.push(url);
      assert.deepEqual(JSON.parse(options.body).contents[0].parts, [
        { text: "First" },
        { text: "Second" },
      ]);
      return urls.length === 1
        ? new Response("", { status: 503 })
        : Response.json({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: JSON.stringify({answer:"Backup answer",title:"Reliable prompt queue"}) }] },
              },
            ],
          });
    },
  });
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes(GEMINI_BACKUP_MODEL));
  assert.equal(result.model, GEMINI_BACKUP_MODEL);
});

test("availability backup never bypasses a quota error", async () => {
  let calls = 0;
  await assert.rejects(
    generateAvailableAnswer(["Prompt"], {
      apiKey: "test",
      fetchImpl: async () => {
        calls++;
        return new Response("", { status: 429 });
      },
    }),
    (error) => error.status === 429,
  );
  assert.equal(calls, 1);
});

test("unapproved models cannot be requested", async () => {
  await assert.rejects(
    generateAnswer(["Prompt"], { apiKey: "test", model: "other-model" }),
    /Unsupported/,
  );
});
