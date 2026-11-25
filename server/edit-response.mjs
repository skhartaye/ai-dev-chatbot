export function editResponseSchema(files) {
  // Keep the provider grammar shallow; local validation owns the richer edit schema.
  return {
    type: "object",
    required: ["answer", "edits"],
    properties: {
      answer: { type: "string" },
      edits: {
        type: "array",
        items: {
          type: "object",
          required: ["fileId", "changesJson"],
          properties: {
            fileId: { type: "string", enum: files.map((f) => f.id) },
            changesJson: {
              type: "string",
              description:
                "JSON-encoded array of edit operation objects, following FILE EDITING instructions.",
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
    let changes;
    try {
      changes = JSON.parse(edit.changesJson);
    } catch {
      throw new Error("The AI returned invalid edit operations.");
    }
    if (
      !file ||
      !Array.isArray(changes) ||
      !changes.length ||
      changes.length > 50
    )
      throw new Error("The AI returned an invalid file edit proposal.");
    return { fileId: file.id, name: file.name, changes };
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
