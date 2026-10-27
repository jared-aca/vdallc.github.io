import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import config from "../cms.config.json";
import cms from "../data/cms.json";
import seoPlan from "../data/seo-plan.json";
import published from "../data/published.json";
import { canonicalUrl, legacyArticleRoutes } from "../lib/content-urls";
import { reconcileContentData } from "../lib/content-reconciliation";
import type { Content } from "../lib/model";
import type { Records } from "../lib/records";
import { seedPages } from "../lib/seed";
import type { SeoPlan } from "../lib/seo-plan";
import { validateContent } from "../lib/validation";

function assertEqual(
  actual: string | undefined,
  expected: string,
  label: string,
) {
  if (actual !== expected)
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function main() {
  const marker = JSON.parse(await readFile("out/vda-build.json", "utf8"));
  const expectedStage =
    process.env.VDA_ARTICLE_REDIRECT_STAGE === "final" ? "final" : "staged";
  if (
    marker.generator !== "vda-next-static-export" ||
    marker.articleRedirectStage !== expectedStage
  )
    throw new Error("The out/ directory is missing its Next.js export marker.");

  const reconciled = reconcileContentData(
    seedPages,
    published as Content[],
    cms as Records,
    seoPlan as SeoPlan,
  );
  const pages = reconciled.published.map((content) =>
    validateContent(content),
  );
  const sitemap = load(await readFile("out/sitemap.xml", "utf8"), {
    xmlMode: true,
  });
  const sitemapUrls = new Set(
    sitemap("loc")
      .map((_, element) => sitemap(element).text())
      .get(),
  );

  for (const content of pages) {
    const output = `out${content.path === "/" ? "/index.html" : content.path}`;
    let html: string;
    try {
      html = await readFile(output, "utf8");
    } catch {
      throw new Error(
        `Published CMS page is missing from the export: ${content.path}`,
      );
    }
    const $ = load(html);
    const expectedTitle = content.seo.title || `${content.title} | VDA LLC`;
    const expectedDescription = content.seo.description || content.excerpt;
    const expectedCanonical = canonicalUrl(content, config.siteUrl);
    const expectedRobots = [
      content.seo.noindex ? "noindex" : "index",
      content.seo.nofollow ? "nofollow" : "follow",
    ].join(", ");

    assertEqual($("title").text(), expectedTitle, `${content.path} title`);
    assertEqual(
      $('meta[name="description"]').attr("content"),
      expectedDescription,
      `${content.path} description`,
    );
    assertEqual(
      $('link[rel="canonical"]').attr("href"),
      expectedCanonical,
      `${content.path} canonical`,
    );
    assertEqual(
      $('meta[name="robots"]').attr("content"),
      expectedRobots,
      `${content.path} robots directive`,
    );

    const shouldBeInSitemap =
      !content.seo.noindex &&
      !content.seo.excludeFromSitemap &&
      expectedCanonical === new URL(content.path, config.siteUrl).href;
    if (sitemapUrls.has(expectedCanonical) !== shouldBeInSitemap)
      throw new Error(
        `${content.path} sitemap inclusion should be ${shouldBeInSitemap}`,
      );
  }

  const finalRedirectStage = expectedStage === "final";
  for (const [alias, canonical] of Object.entries(legacyArticleRoutes)) {
    const aliasFile = `out${alias}`;
    const aliasUrl = new URL(alias, config.siteUrl).href;
    if (finalRedirectStage) {
      try {
        await readFile(aliasFile, "utf8");
        throw new Error(
          `Legacy alias must be removed after 301 activation: ${alias}`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      continue;
    }

    const canonicalHtml = await readFile(`out${canonical}`, "utf8");
    let aliasHtml: string;
    try {
      aliasHtml = await readFile(aliasFile, "utf8");
    } catch {
      throw new Error(`Staged compatibility alias is missing: ${alias}`);
    }
    if (aliasHtml !== canonicalHtml)
      throw new Error(
        `Staged alias must preserve the canonical article and its /blog/ metadata: ${alias}`,
      );
    if (sitemapUrls.has(aliasUrl))
      throw new Error(`Legacy alias must not appear in the sitemap: ${alias}`);
  }

  console.log(
    finalRedirectStage
      ? `PASS: ${pages.length} exported pages match published CMS SEO metadata and no legacy aliases remain after the redirect check.`
      : `PASS: ${pages.length} exported pages match published CMS SEO metadata; all ${Object.keys(legacyArticleRoutes).length} staged aliases preserve canonical /blog/ metadata and stay out of the sitemap.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
