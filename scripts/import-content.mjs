import { readFile, writeFile, readdir, mkdir, cp } from "node:fs/promises";
import { load } from "cheerio";
const origin = "https://vdallc.com";
const pages = [];
for (const dir of [".", "blog", "services"]) {
  for (const name of (await readdir(dir))
    .filter((name) => name.endsWith(".html"))
    .sort()) {
    const file = dir === "." ? name : `${dir}/${name}`;
    const path = file === "index.html" ? "/" : `/${file}`;
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
    const type =
      dir === "blog" ? "blog" : dir === "services" ? "service" : "page";
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
