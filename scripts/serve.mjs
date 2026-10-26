import { articleRedirect } from "../lib/content-urls.ts";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("out");
const port = Number(process.env.PORT || 3101);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
http
  .createServer(async (req, res) => {
    try {
      const redirect = articleRedirect(
        new URL(req.url, `http://${req.headers.host || "localhost"}`).href,
      );
      if (redirect && ["GET", "HEAD"].includes(req.method)) {
        res.writeHead(301, {
          Location: redirect,
          "Cache-Control": "public, max-age=3600",
        });
        res.end();
        return;
      }
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      let file = resolve(root, "." + path);
      if (file !== root && !file.startsWith(root + "/")) {
        res.writeHead(404);
        res.end();
        return;
      }
      if ((await stat(file)).isDirectory()) file += "/index.html";
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, () =>
    console.log(`Static GitHub Pages preview: http://localhost:${port}/admin/`),
  );
