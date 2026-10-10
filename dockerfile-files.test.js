import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// CI runs the tests from a full checkout, but the image only contains what the
// Dockerfile COPYs. A local module imported by server.js but not copied
// crashes the container on boot (ERR_MODULE_NOT_FOUND), as site-capture.js
// did on the first /screenshot-url deploy.
test("every local module server.js imports is copied into the image", async () => {
  const server = await readFile(new URL("./server.js", import.meta.url), "utf8");
  const dockerfile = await readFile(new URL("./Dockerfile", import.meta.url), "utf8");
  const copied = dockerfile
    .split("\n")
    .filter((l) => /^COPY\s/.test(l))
    .flatMap((l) => l.replace(/^COPY\s+/, "").split(/\s+/).slice(0, -1));
  const localImports = [...server.matchAll(/from\s+["']\.\/([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(localImports.length > 0);
  for (const file of localImports) {
    assert.ok(copied.includes(file), `${file} is imported by server.js but not COPY'd in the Dockerfile`);
  }
});
