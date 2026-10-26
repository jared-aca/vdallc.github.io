import { readFile } from "node:fs/promises";
const routes = JSON.parse(await readFile("data/article-routes.json", "utf8"));
const config = JSON.parse(await readFile("cms.config.json", "utf8"));
const origin = process.env.REDIRECT_CHECK_ORIGIN || config.siteUrl;
const failures = [];
await Promise.all(
  Object.entries(routes).map(async ([from, to]) => {
    const source = new URL(from, origin);
    source.searchParams.set("vda_redirect_check", "1");
    const expected = new URL(to, origin);
    expected.search = source.search;
    try {
      const response = await fetch(source, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: { "Cache-Control": "no-cache" },
      });
      if (
        response.status !== 301 ||
        response.headers.get("location") !== expected.href
      )
        failures.push(
          `${from}: expected a direct 301 to ${expected.href}; got ${response.status} ${response.headers.get("location") || ""}`,
        );
    } catch (error) {
      failures.push(`${from}: ${error.message}`);
    }
  }),
);
if (failures.length) {
  console.error(
    "Legacy article redirects are not active. Static deployment is blocked to avoid replacing working legacy URLs with 404s. Activate the approved redirect layer first.",
  );
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else
  console.log(
    `PASS: all ${Object.keys(routes).length} legacy article URLs return direct HTTP 301 redirects.`,
  );
