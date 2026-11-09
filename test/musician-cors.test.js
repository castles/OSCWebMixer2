"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { once } = require("node:events");
const { musicianCors } = require("../lib/musician-cors");

test("musician CORS permits public reads and preflights without exposing admin or writes", async t => {
  const app = express();
  app.use(musicianCors);
  app.use((_req, res) => res.status(404).json({ error: "not found" }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: "http://localhost:8081" };
  const id = "a".repeat(64);
  for (const route of ["/api/connection", "/api/templates", `/api/templates/${id}`]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(base + route, { method, headers });
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("access-control-allow-credentials"), null);
    }
    const response = await fetch(base + route, { method: "OPTIONS", headers: {
      ...headers, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "accept, content-type"
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
    assert.equal(response.headers.get("access-control-allow-headers"), "Accept, Content-Type");
    for (const method of ["POST", "PUT", "DELETE"]) {
      const write = await fetch(base + route, { method, headers });
      assert.equal(write.headers.get("access-control-allow-origin"), null);
      const preflight = await fetch(base + route, { method: "OPTIONS", headers: { ...headers, "Access-Control-Request-Method": method } });
      assert.equal(preflight.headers.get("access-control-allow-origin"), null);
    }
  }
  for (const route of ["/api/admin/status", "/api/admin/templates", "/api/admin/login", "/config", "/admin", "/api/connection/extra", "/api/templates/invalid"]) {
    for (const method of ["GET", "OPTIONS"]) {
      const response = await fetch(base + route, { method, headers });
      assert.equal(response.headers.get("access-control-allow-origin"), null, route);
    }
  }
});
