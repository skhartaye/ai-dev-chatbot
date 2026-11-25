export function requestQueue(jobs) {
  const waiting = jobs.filter((j) => ["syncing", "queued"].includes(j.status));
  const processing = jobs.find((j) => j.status === "processing");
  const rank = (j) =>
    j.status === "processing"
      ? 0
      : ["syncing", "queued"].includes(j.status)
        ? 1
        : j.status === "failed"
          ? 2
          : 3;
  const ordered = [...jobs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) < 2 ? a.createdAt - b.createdAt : b.createdAt - a.createdAt),
  );
  return { waiting, processing, ordered };
}
