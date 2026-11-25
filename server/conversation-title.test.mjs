import test from "node:test";
import assert from "node:assert/strict";
import { conversationTitle } from "./conversation-title.mjs";
import { generateAnswer } from "./gemini.mjs";
test("titles are complete topic labels; invalid labels are skipped rather than clipped", () => {
  assert.equal(
    conversationTitle("  Reliable AI prompt queue  "),
    "Reliable AI prompt queue",
  );
  for (const title of [
    "New conversation",
    "yes do it",
    "This is a cut off thought…",
    "x".repeat(70),
    "one two three four five six seven eight nine",
    null,
  ])
    assert.equal(conversationTitle(title), null);
});
test("title generation shares the answer call and rejects a bad title without losing the answer", async () => {
  let calls = 0;
  const result = await generateAnswer(
    [
      "Earlier context: build a durable prompt queue.",
      "CURRENT USER MESSAGE: yes, do it",
    ],
    {
      apiKey: "test",
      fetchImpl: async (url, options) => {
        calls++;
        const body = JSON.parse(options.body);
        assert.ok(
          body.generationConfig.responseJsonSchema.required.includes("title"),
        );
        assert.match(
          body.systemInstruction.parts.map((p) => p.text).join(" "),
          /Do not copy or cut off/,
        );
        return Response.json({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "Your queue plan",
                      title: "x".repeat(90),
                    }),
                  },
                ],
              },
            },
          ],
        });
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.text, "Your queue plan");
  assert.equal(result.title, null);
});
