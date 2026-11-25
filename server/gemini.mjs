// Server-only provider. The worker owns durable retries.
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_BACKUP_MODEL = "gemini-3.1-flash-lite";

export async function generateAnswer(
  prompts,
  {
    apiKey = process.env.GEMINI_API_KEY,
    fetchImpl = fetch,
    model = GEMINI_MODEL,
    timeoutMs = 120_000,
    attachments = [],
  } = {},
) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is required on the server.");
  if (![GEMINI_MODEL, GEMINI_BACKUP_MODEL].includes(model))
    throw new Error("Unsupported Gemini model.");
  if (
    !Array.isArray(prompts) ||
    prompts.length === 0 ||
    prompts.some((prompt) => typeof prompt !== "string" || !prompt.trim())
  ) {
    throw new Error("Provide at least one non-empty text prompt.");
  }

  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "Respond to the following ordered user messages with one coherent answer. Address all requested points.",
            },
          ],
        },
        contents: [{ role: "user", parts: [
          ...attachments.flatMap(file=>[{text:`Attached file: ${file.name}`},file.text!==undefined?{text:file.text}:{inlineData:{mimeType:file.mimeType,data:file.data}}]),
          ...prompts.map((text) => ({ text })),
        ] }],
        generationConfig: { maxOutputTokens: 8192 },
      }),
    },
  );

  if (!response.ok) {
    // Do not propagate provider response bodies, which can contain sensitive details.
    const error = new Error(`Gemini request failed (HTTP ${response.status}).`);
    error.status = response.status;
    error.retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }

  const result = await response.json();
  const candidate = result.candidates?.[0];
  if (candidate?.finishReason !== "STOP") {
    const error = new Error("Gemini did not return a complete answer.");
    error.code =
      candidate?.finishReason === "MAX_TOKENS"
        ? "output_limit"
        : "provider_rejected";
    throw error;
  }
  const text = candidate.content?.parts
    ?.filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("");
  if (!text?.trim()) throw new Error("Gemini returned no text answer.");
  return { text, model, usage: result.usageMetadata ?? null };
}

export async function generateAvailableAnswer(prompts, options = {}) {
  try {
    return await generateAnswer(prompts, {
      ...options,
      model: GEMINI_MODEL,
      timeoutMs: 45_000,
    });
  } catch (error) {
    // Availability backup only. Never switch models to evade quota or safety failures.
    if (error.status !== 503) throw error;
    return generateAnswer(prompts, {
      ...options,
      model: GEMINI_BACKUP_MODEL,
      timeoutMs: 120_000,
    });
  }
}
