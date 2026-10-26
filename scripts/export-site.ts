import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import config from "../cms.config.json";
import cms from "../data/cms.json";
import seoPlan from "../data/seo-plan.json";
import { reconcileContentData } from "../lib/content-reconciliation";
import { legacyArticleRoutes } from "../lib/content-urls";
import type { Content } from "../lib/model";
import type { Records } from "../lib/records";
import type { SeoPlan } from "../lib/seo-plan";
import published from "../data/published.json";
import { seedMap, seedPages } from "../lib/seed";
import { renderPage, renderSitemap } from "../lib/render";
import { validateContent } from "../lib/validation";
async function main() {
  const reconciled = reconcileContentData(
    seedPages,
    published as Content[],
    cms as Records,
    seoPlan as SeoPlan,
  );
  const pages = reconciled.published.map((content) => validateContent(content));
  for (const path of Object.keys(legacyArticleRoutes)) {
    await rm(`out${path}`, { force: true });
    await rm(`out/cms/templates/pages${path}`, { force: true });
  }
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
