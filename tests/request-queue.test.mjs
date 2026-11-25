import test from "node:test";
import assert from "node:assert/strict";
import { requestQueue } from "../public/request-queue.js";
test("queue shows the active request followed by waiting requests in FIFO order", () => {
  const jobs = [
    { id: "done", status: "complete", createdAt: 1 },
    { id: "later", status: "queued", createdAt: 4 },
    { id: "active", status: "processing", createdAt: 2 },
    { id: "next", status: "syncing", createdAt: 3 },
  ];
  const result = requestQueue(jobs);
  assert.equal(result.processing.id, "active");
  assert.equal(result.waiting.length, 2);
  assert.deepEqual(
    result.ordered.map((j) => j.id),
    ["active", "next", "later", "done"],
  );
  assert.deepEqual(
    jobs.map((j) => j.id),
    ["done", "later", "active", "next"],
  );
});
