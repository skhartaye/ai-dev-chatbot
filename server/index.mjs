import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { createWorker } from "./worker.mjs";

const configured = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.GEMINI_API_KEY,
);
const db = configured
  ? createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (url, options) =>
            fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
        },
      },
    )
  : null;
const worker = db ? createWorker(db) : null;
const origins = new Set([
  "https://kahuron.netlify.app",
  ...(process.env.NODE_ENV === "development" ? ["http://127.0.0.1:4173"] : []),
]);

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Origin");
  const origin = request.headers.origin;
  if (origins.has(origin))
    response.setHeader("Access-Control-Allow-Origin", origin);
  if (request.method === "OPTIONS" && origins.has(origin)) {
    response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization,Content-Type",
    );
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200);
    response.end(
      JSON.stringify({
        status: "ok",
        queue: configured ? "ready" : "not_configured",
        revision: process.env.RENDER_GIT_COMMIT?.slice(0,7),
      }),
    );
    return;
  }
  if (request.method === "POST" && request.url === "/wake") {
    if (!db) {
      response.writeHead(503);
      response.end(JSON.stringify({ error: "Queue is not configured yet." }));
      return;
    }
    if (!origins.has(origin)) {
      response.writeHead(403);
      response.end("{}");
      return;
    }
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token || token.length > 8192) {
      response.writeHead(401);
      response.end("{}");
      return;
    }
    try {
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user) {
        response.writeHead(401);
        response.end("{}");
        return;
      }
      void worker.tick();
      response.writeHead(202);
      response.end(JSON.stringify({ status: "awake" }));
    } catch {
      response.writeHead(503);
      response.end(JSON.stringify({ error: "Please try again shortly." }));
    }
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: "Not found" }));
});

server.requestTimeout = 30_000;
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => {
  console.log("Chatbot backend listening");
  void worker?.tick();
});

process.on("SIGTERM", () => {
  worker?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
