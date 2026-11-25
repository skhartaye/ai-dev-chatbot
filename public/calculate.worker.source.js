import init from "@ironcalc/wasm";
import { calculateWorkbook } from "./formula-engine.js";
self.onmessage = async ({ data }) => {
  try {
    await init({ module_or_path: "/extraction-assets/ironcalc.wasm" });
    self.postMessage({ results: calculateWorkbook(data.sheets, data.names) });
  } catch (error) {
    self.postMessage({
      error:
        typeof error === "string"
          ? error
          : error.message || "The formulas could not be verified.",
    });
  }
};
