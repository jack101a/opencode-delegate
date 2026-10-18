#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

export function createServer(customRootDir = ROOT_DIR) {
  return http.createServer((req, res) => {
    let reqPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (reqPath === "/" || reqPath === "") {
      reqPath = "/public/index.html";
    }

    const safePath = path.normalize(path.join(customRootDir, reqPath));
    if (!safePath.startsWith(customRootDir)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found: " + reqPath);
        return;
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*"
      });
      fs.createReadStream(safePath).pipe(res);
    });
  });
}

export function startServer(preferredPort = 3000, customRootDir = ROOT_DIR) {
  return new Promise((resolve, reject) => {
    const server = createServer(customRootDir);
    let currentPort = preferredPort;

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && currentPort < preferredPort + 20) {
        currentPort += 1;
        server.listen(currentPort, "127.0.0.1");
      } else {
        reject(err);
      }
    });

    server.listen(currentPort, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const PORT = parseInt(process.env.PORT || "3000", 10);
  startServer(PORT)
    .then(({ port }) => {
      console.log(`⚡ OpenCode Delegation UI live at http://127.0.0.1:${port}`);
    })
    .catch((err) => {
      console.error(`Failed to start preview server:`, err.message);
      process.exit(1);
    });
}
