import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
test("deployment preflight rejects a static host serving legacy articles with HTTP 200", async () => {
  const server = createServer((_, response) => {
    response.writeHead(200);
    response.end("Unredirected static article");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const child = spawn(
      process.execPath,
      ["scripts/check-article-redirects.mjs"],
      {
        env: {
          ...process.env,
          REDIRECT_CHECK_ORIGIN: `http://127.0.0.1:${address.port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(code, 1);
    assert.match(output, /Static deployment is blocked/);
    assert.match(output, /va-hearing-loss-rating.html/);
    assert.match(output, /got 200/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
