// Local-only server: serves the built app and stores each canvas as a
// .excalidraw file in a folder on this machine. No dependencies.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 3333;
const CANVAS_DIR =
  process.env.EXCALIDRAW_DIR ||
  path.join(os.homedir(), "Documents", "Excalidraw");
const BUILD_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../excalidraw-app/build",
);
const MAX_BODY_BYTES = 200 * 1024 * 1024;
const ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const EXT = ".excalidraw";
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

const canvasPath = (id) => path.join(CANVAS_DIR, id + EXT);

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body),
  );
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const listCanvases = async () => {
  const entries = await fs.readdir(CANVAS_DIR, { withFileTypes: true });
  const canvases = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(EXT))
      .map(async (e) => {
        const id = e.name.slice(0, -EXT.length);
        if (!ID_RE.test(id)) {
          return null;
        }
        const stat = await fs.stat(canvasPath(id));
        return { id, updatedAt: stat.mtimeMs };
      }),
  );
  return canvases.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
};

const handleApi = async (req, res, pathname) => {
  if (pathname === "/api/canvases" && req.method === "GET") {
    return send(res, 200, await listCanvases());
  }
  const match = pathname.match(/^\/api\/canvases\/([^/]+)$/);
  if (!match) {
    return send(res, 404, { error: "Not found" });
  }
  const id = decodeURIComponent(match[1]);
  if (!ID_RE.test(id)) {
    return send(res, 400, { error: "Invalid canvas id" });
  }
  if (req.method === "GET") {
    try {
      return send(res, 200, await fs.readFile(canvasPath(id)));
    } catch (error) {
      if (error.code === "ENOENT") {
        return send(res, 404, { error: "Canvas not found" });
      }
      throw error;
    }
  }
  if (req.method === "PUT") {
    const body = await readBody(req);
    try {
      JSON.parse(body.toString("utf8"));
    } catch {
      return send(res, 400, { error: "Body must be JSON" });
    }
    // write-then-rename so a crash never leaves a half-written canvas
    const tmp = `${canvasPath(id)}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, canvasPath(id));
    return send(res, 204, "");
  }
  return send(res, 405, { error: "Method not allowed" });
};

const serveStatic = async (res, pathname) => {
  const resolved = path.resolve(BUILD_DIR, "." + decodeURIComponent(pathname));
  let file = resolved.startsWith(BUILD_DIR + path.sep)
    ? resolved
    : path.join(BUILD_DIR, "index.html");
  try {
    if ((await fs.stat(file)).isDirectory()) {
      file = path.join(file, "index.html");
    }
    await fs.access(file);
  } catch {
    file = path.join(BUILD_DIR, "index.html");
  }
  const type =
    MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(await fs.readFile(file));
};

const server = http.createServer(async (req, res) => {
  // blocks DNS-rebinding: a web page re-pointing its own domain at 127.0.0.1
  if (!ALLOWED_HOSTS.has(req.headers.host)) {
    return send(res, 403, { error: "Forbidden host" });
  }
  try {
    const { pathname } = new URL(req.url, `http://${HOST}`);
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
    } else {
      await serveStatic(res, pathname);
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      send(res, error.status || 500, { error: error.message });
    } else {
      res.end();
    }
  }
});

await fs.mkdir(CANVAS_DIR, { recursive: true });
server.listen(PORT, HOST, () => {
  console.log(`Excalidraw: http://127.0.0.1:${PORT}`);
  console.log(`Canvases saved to: ${CANVAS_DIR}`);
});
