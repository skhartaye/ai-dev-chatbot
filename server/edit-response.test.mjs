import test from "node:test";
import assert from "node:assert/strict";
import { generateAnswer } from "./gemini.mjs";
import { encodeEditResponse } from "./edit-response.mjs";
const files = [
  {
    id: "owned-file",
    name: "sample.xlsx",
    text: "[Sheet: Orders]\nQuantity\n3",
  },
];
test("Office answers request a schema and create review proposals instead of AI download claims", async () => {
  const result = await generateAnswer(["Change quantity to 7"], {
    apiKey: "test",
    attachments: files,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.deepEqual(
        body.generationConfig.responseJsonSchema.properties.edits.items
          .properties.fileId.enum,
        ["owned-file"],
      );
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    answer: "I already edited it. Download fake://file.",
                    edits: [
                      {
                        fileId: "owned-file",
                        name: "untrusted.xlsx",
                        changes: [
                          {
                            sheet: "Orders",
                            cell: "B2",
                            expected: 3,
                            replace: 7,
                          },
                        ],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      });
    },
  });
  assert.match(result.text, /ready to review/);
  assert.match(result.text, /sample.xlsx/);
  assert.doesNotMatch(result.text, /fake:|already edited|untrusted.xlsx/);
});
test("structured responses reject unknown file IDs and malformed output, while read-only answers remain ordinary text", () => {
  assert.throws(
    () => encodeEditResponse("not JSON", files),
    /valid structured/,
  );
  assert.throws(
    () =>
      encodeEditResponse(
        JSON.stringify({
          answer: "x",
          edits: [{ fileId: "someone-elses-file", changes: [{}] }],
        }),
        files,
      ),
    /invalid file edit/,
  );
  assert.equal(
    encodeEditResponse(
      JSON.stringify({ answer: "Quantity is 3.", edits: [] }),
      files,
    ),
    "Quantity is 3.",
  );
});
