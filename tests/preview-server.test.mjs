import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/preview-server.mjs";

test("Preview Server: serves static UI and modules", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  await t.test("serves root as public/index.html", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    const text = await res.text();
    assert.ok(text.includes("OpenCode Delegation Bridge & Observability"));
  });

  await t.test("serves src/dashboard-engine.mjs as javascript", async () => {
    const res = await fetch(`${baseUrl}/src/dashboard-engine.mjs`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /javascript/);
    const text = await res.text();
    assert.ok(text.includes("computeSummaryStats"));
  });

  await t.test("returns 404 for nonexistent routes", async () => {
    const res = await fetch(`${baseUrl}/non-existent-file.xyz`);
    assert.equal(res.status, 404);
  });

  await t.test("startServer automatically binds and resolves available port", async () => {
    const { server: liveServer, port: livePort } = await (await import("../src/preview-server.mjs")).startServer(0);
    assert.ok(livePort > 0);
    liveServer.close();
  });
});

