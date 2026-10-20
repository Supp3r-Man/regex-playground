const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, resolveRequest } = require("../scripts/serve.js");

test("resolveRequest serves the app and refuses everything else", () => {
  assert.ok(resolveRequest("/").endsWith("index.html"));
  assert.ok(resolveRequest("/src/core.js").endsWith("core.js"));
  assert.ok(resolveRequest("/index.html?x=1#y").endsWith("index.html"));
  for (const bad of ["/package.json", "/test/core.test.js", "/.git/config", "/../package.json", "/src/../package.json", "/%2e%2e/package.json", "/src/%00.js", "/%E0%A4%A", "/README.md", "/scripts/serve.js", "/docs/screenshot.png", "/.github/workflows/ci.yml"]) {
    assert.equal(resolveRequest(bad), null, bad);
  }
});

test("the server returns the page and scripts with the right types, and 404 or 405 otherwise", async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /<title>Regex Playground<\/title>/);

    const js = await fetch(base + "/src/core.js");
    assert.match(js.headers.get("content-type"), /text\/javascript/);

    assert.equal((await fetch(base + "/package.json")).status, 404);
    assert.equal((await fetch(base + "/src/missing.js")).status, 404);
    assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
    assert.equal((await fetch(base + "/", { method: "HEAD" })).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
