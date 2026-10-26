import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import config from "../cms.config.json";
import published from "../data/published.json";
import { seedMap, seedPages } from "../lib/seed";
import { renderPage, renderSitemap } from "../lib/render";
import { validateContent } from "../lib/validation";
async function main() {
  const pages = published.map((content) => validateContent(content));
  if (new Set(pages.map((page) => page.path)).size !== pages.length)
    throw new Error("Published content contains duplicate URLs.");
  for (const content of pages) {
    const file = `out${content.path === "/" ? "/index.html" : content.path}`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, renderPage(content, pages, config.siteUrl));
  }
  await writeFile("out/sitemap.xml", renderSitemap(pages, config.siteUrl));
  await writeFile(
    "out/robots.txt",
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /cms/\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`,
  );
  await writeFile("out/.nojekyll", "");
  await writeFile("out/CNAME", new URL(config.siteUrl).hostname + "\n");
  await mkdir("out/cms/templates/pages", { recursive: true });
  await writeFile(
    "out/cms/templates/blog.html",
    seedMap.get("/blog/va-disability-ratings.html")!.html,
  );
  await writeFile(
    "out/cms/templates/service.html",
    seedMap.get("/services/va-disability-claims.html")!.html,
  );
  for (const page of seedPages.filter((page) => page.content.type === "page")) {
    await writeFile(
      `out/cms/templates/pages${page.content.path === "/" ? "/index.html" : page.content.path}`,
      page.html,
    );
  }
  // The admin is exported by Next.js; only published pages and public templates
  // enter this artifact. Draft records and OAuth secrets are never copied to it.
  console.log(
    `Exported ${pages.length} public pages and the GitHub-backed /admin to out/.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
