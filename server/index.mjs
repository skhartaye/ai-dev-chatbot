import { createServer } from 'node:http';

// Only health checks are public until authentication and durable jobs are ready.
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200);
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.requestTimeout = 30_000;
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log('Chatbot backend listening');
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
