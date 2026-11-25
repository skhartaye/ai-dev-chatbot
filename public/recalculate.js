export function recalculate(sheets, names, { signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker("/calculate.worker.js", { type: "module" });
    let finished = false;
    const finish = (error, results) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      error ? reject(error) : resolve(results);
    };
    const abort = () => finish(new Error("Formula verification cancelled."));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Formula verification took too long. Reduce the workbook or simplify its formulas.",
          ),
        ),
      15000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () =>
      finish(
        new Error(
          "The formula verifier could not start. Reload and try again.",
        ),
      );
    worker.onmessage = ({ data }) =>
      finish(data.error ? new Error(data.error) : null, data.results);
    worker.postMessage({ sheets, names });
  });
}
