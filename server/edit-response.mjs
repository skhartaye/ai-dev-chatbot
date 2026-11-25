const scalar = { type: ["string", "number", "boolean", "null"] };
export function editResponseSchema(files) {
  return {
    type: "object",
    required: ["answer", "edits"],
    properties: {
      answer: { type: "string" },
      edits: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          required: ["fileId", "changes"],
          properties: {
            fileId: { type: "string", enum: files.map((f) => f.id) },
            changes: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: {
                type: "object",
                properties: {
                  find: { type: ["string", "number", "boolean"] },
                  count: { type: "integer" },
                  replace: scalar,
                  sheet: { type: "string" },
                  cell: { type: "string" },
                  range: { type: "string" },
                  expected: scalar,
                  formula: { type: "string" },
                  format: {
                    type: "object",
                    properties: {
                      bold: { type: "boolean" },
                      italic: { type: "boolean" },
                      underline: { type: "boolean" },
                      fontSize: { type: "number" },
                      fontFamily: { type: "string" },
                      color: { type: "string" },
                      fill: { type: "string" },
                      alignment: { type: "string" },
                      horizontal: { type: "string" },
                      wrapText: { type: "boolean" },
                      numberFormat: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
export function encodeEditResponse(text, files) {
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("The AI did not return a valid structured answer.");
  }
  if (
    typeof result.answer !== "string" ||
    !Array.isArray(result.edits) ||
    result.edits.length > 3
  )
    throw new Error("The AI returned an invalid structured answer.");
  const plans = result.edits.map((edit) => {
    const file = files.find((f) => f.id === edit.fileId);
    if (
      !file ||
      !Array.isArray(edit.changes) ||
      !edit.changes.length ||
      edit.changes.length > 50
    )
      throw new Error("The AI returned an invalid file edit proposal.");
    return { fileId: file.id, name: file.name, changes: edit.changes };
  });
  const answer = plans.length
    ? "Proposed changes are ready to review. Your original files are unchanged."
    : result.answer;
  return (
    answer +
    plans
      .map((plan) => "\n\n```kahuron-edit\n" + JSON.stringify(plan) + "\n```")
      .join("")
  );
}
