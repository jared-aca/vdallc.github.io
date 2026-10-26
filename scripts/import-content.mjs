import { readFile, writeFile, readdir, mkdir, cp } from "node:fs/promises";
import { articlePath } from "../lib/content-urls.ts";
import { load } from "cheerio";
const origin = "https://vdallc.com";
const pages = [];
const aliases = JSON.parse(await readFile("data/article-routes.json", "utf8"));
for (const dir of [".", "blog", "services"]) {
  for (const name of (await readdir(dir))
    .filter((name) => name.endsWith(".html"))
    .sort()) {
    const file = dir === "." ? name : `${dir}/${name}`;
    const path =
      dir === "blog"
        ? articlePath(name.slice(0, -5))
        : file === "index.html"
          ? "/"
          : `/${file}`;
    if (aliases[path]) continue;
    const $ = load(await readFile(file, "utf8"));
    // Root-relative assets and links also work inside authenticated draft previews.
    $("[href], [src], [action]").each((_, node) => {
      for (const attr of ["href", "src", "action"]) {
        const value = $(node).attr(attr);
        if (!value || /^(?:[a-z]+:|\/\/|#)/i.test(value)) continue;
        const url = new URL(value, origin + path);
        $(node).attr(attr, url.pathname + url.search + url.hash);
      }
    });
    const articleSchema = $('script[type="application/ld+json"]')
      .toArray()
      .some((node) => {
        try {
          const types = JSON.parse($(node).text())["@type"];
          return (Array.isArray(types) ? types : [types]).some((type) =>
            ["BlogPosting", "Article", "NewsArticle"].includes(type),
          );
        } catch {
          return false;
        }
      });
    if (dir === "." && articleSchema)
      throw new Error(
        `Unregistered root-level article: ${path}. Review its canonical identity instead of importing it as a Page.`,
      );
    const type =
      dir === "blog" || articleSchema
        ? "blog"
        : dir === "services"
          ? "service"
          : "page";
    if (type === "blog" && !path.startsWith("/blog/"))
      throw new Error(`Articles must be registered under /blog/: ${path}`);
    const meta = (name) => $(`meta[name="${name}"]`).attr("content") || "";
    const property = (name) =>
      $(`meta[property="${name}"]`).attr("content") || "";
    let schema = {};
    $('script[type="application/ld+json"]').each((_, node) => {
      try {
        const value = JSON.parse($(node).text());
        if (value.datePublished) schema = value;
      } catch {}
    });
    const title =
      $("h1").first().text().replace(/\s+/g, " ").trim() || $("title").text();
    const robots = meta("robots");
    const body =
      type !== "page" ? $(".service-content").first().html() || "" : "";
    if (type !== "page" && !body)
      throw new Error(`Missing editable body in ${file}`);
    pages.push({
      html: $.html(),
      content: {
        path,
        type,
        title,
        excerpt: $(".page-hero-lead").first().text().trim(),
        body,
        image: $(".page-hero-bg img").first().attr("src") || "",
        imageAlt: $(".page-hero-bg img").first().attr("alt") || "",
        category:
          type === "blog"
            ? $(".page-hero .eyebrow").text().split(/[·•]/)[0].trim() ||
              "VA Claims"
            : "Our Services",
        date:
          schema.datePublished?.slice(0, 10) ||
          {
            "va-disability-ratings.html": "2025-06-01",
            "tdiu-guide.html": "2025-06-05",
            "va-claim-denied.html": "2025-06-10",
            "discharge-upgrade-guide.html": "2025-06-15",
          }[name] ||
          "",
        ...(type === "blog"
          ? {
              structuredData: $('script[type="application/ld+json"]')
                .map((_, node) => {
                  try {
                    return JSON.parse($(node).text());
                  } catch {
                    return null;
                  }
                })
                .get(),
            }
          : {}),
        seo: {
          title: $("title").text().trim(),
          description: meta("description"),
          canonical: $('link[rel="canonical"]').attr("href") || origin + path,
          socialTitle: property("og:title"),
          socialDescription: property("og:description"),
          socialImage: property("og:image"),
          socialImageAlt: property("og:image:alt"),
          noindex: /noindex/.test(robots) || name === "thankyou.html",
          nofollow: /nofollow/.test(robots),
          excludeFromSitemap: name === "thankyou.html",
        },
      },
    });
  }
}
await mkdir("data", { recursive: true });
await writeFile("data/seed.json", JSON.stringify(pages));
for (const dir of ["css", "js", "img"])
  await cp(dir, `public/${dir}`, { recursive: true });
console.log(
  `Imported ${pages.length} pages (${pages.filter((p) => p.content.type === "blog").length} posts, ${pages.filter((p) => p.content.type === "service").length} services).`,
);
