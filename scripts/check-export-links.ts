import { readFile, stat } from "node:fs/promises";
import { load } from "cheerio";
import pages from "../data/published.json";
import config from "../cms.config.json";
import { legacyArticleRoutes } from "../lib/content-urls";
async function main() {
  const failures = new Set<string>();
  let checked = 0;
  for (const page of pages) {
    const file = "out" + (page.path === "/" ? "/index.html" : page.path);
    const $ = load(await readFile(file, "utf8"));
    for (const node of $("a[href]").toArray()) {
      const href = $(node).attr("href")!;
      if (/^(?:mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      let url: URL;
      try {
        url = new URL(href, new URL(page.path, config.siteUrl));
      } catch {
        continue;
      }
      if (url.origin !== new URL(config.siteUrl).origin) continue;
      checked++;
      if (legacyArticleRoutes[url.pathname]) {
        failures.add(`${page.path}: link still targets legacy article ${href}`);
        continue;
      }
      const target = "out" + decodeURIComponent(url.pathname);
      try {
        const info = await stat(target);
        if (info.isDirectory()) await stat(target + "/index.html");
      } catch {
        failures.add(`${page.path}: missing exported link target ${href}`);
      }
    }
  }
  if (failures.size) {
    console.error([...failures].join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `PASS: ${checked} internal links across ${pages.length} exported pages resolve without legacy article aliases.`,
    );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
