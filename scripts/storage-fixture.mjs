import { createServer } from "node:http";

// Local byte store for browser tests. Exercises real presigning, XHR and SDK
// HEAD/GET/DELETE requests; it deliberately does not implement AWS signatures.
export async function storageFixture(origin) {
  const objects = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "PUT, GET, HEAD, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", request.headers["access-control-request-headers"] ?? "content-type");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    const url = new URL(request.url, "http://127.0.0.1");
    const key = url.pathname;
    if (request.method === "PUT") {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        objects.set(key, { bytes: Buffer.concat(chunks), type: request.headers["content-type"] });
        response.writeHead(200).end();
      } catch { response.writeHead(500).end(); }
      return;
    }
    if (request.method === "DELETE") { objects.delete(key); response.writeHead(204).end(); return; }
    const object = objects.get(key);
    if (!object) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Length", object.bytes.length);
    response.setHeader("Content-Type", url.searchParams.get("response-content-type") ?? object.type ?? "application/octet-stream");
    response.writeHead(200).end(request.method === "HEAD" ? undefined : object.bytes);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
