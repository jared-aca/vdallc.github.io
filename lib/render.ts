import { load } from "cheerio";
import type { Content } from "./model";
import { seedMap } from "./seed";
import {
  canonicalUrl,
  contentIdentity,
  legacyArticleRoutes,
  rewriteLegacyLink,
} from "./content-urls";
import { articleSchemas } from "./structured-data";
export { canonicalUrl } from "./content-urls";
import { cleanBody } from "./validation";
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
function imageUrl(value: string, origin: string) {
  return value ? new URL(value, origin).href : "";
}
function readTime(body: string) {
  return Math.max(1, Math.ceil(load(body).text().split(/\s+/).length / 220));
}
function postCard(post: Content) {
  const date = post.date
    ? new Date(post.date + "T12:00:00Z").toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
  return `<a class="insight-card" href="${escapeHtml(contentIdentity(post).path)}">${post.image ? `<div class="insight-card-img"><img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.imageAlt)}" loading="lazy" decoding="async"></div>` : ""}<div class="insight-card-body"><div class="insight-meta"><span class="insight-tag">${escapeHtml(post.category)}</span><span class="insight-date">${escapeHtml(date)}${date ? " · " : ""}${readTime(post.body)} min read</span></div><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.excerpt)}</p><span class="insight-card-link">Read Article →</span></div></a>`;
}
export function renderPage(
  content: Content,
  publicPages: Content[],
  origin: string,
) {
  if (legacyArticleRoutes[content.path])
    throw new Error(
      `Legacy article routes are redirects, not renderable pages: ${content.path}`,
    );
  const source =
    seedMap.get(content.path) ??
    seedMap.get(
      content.type === "blog"
        ? "/blog/va-disability-ratings.html"
        : "/services/va-disability-claims.html",
    )!;
  const $ = load(source.html);
  const originalSchemas: Record<string, unknown>[] = [];
  if (seedMap.has(content.path))
    $('script[type="application/ld+json"]').each((_, node) => {
      try {
        originalSchemas.push(JSON.parse($(node).text()));
      } catch {}
    });
  const canonical = canonicalUrl(content, origin);
  const title = content.seo.title || `${content.title} | VDA LLC`;
  const description = content.seo.description || content.excerpt;
  const socialTitle = content.seo.socialTitle || title;
  const socialDescription = content.seo.socialDescription || description;
  const socialImage = imageUrl(
    content.seo.socialImage || content.image,
    origin,
  );
  $("title").text(title);
  $(
    'meta[name="description"], meta[name="robots"], link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"]',
  ).remove();
  const meta = (name: string, value: string, property = false) => {
    $("<meta>")
      .attr(property ? "property" : "name", name)
      .attr("content", value)
      .appendTo("head");
  };
  meta("description", description);
  meta(
    "robots",
    `${content.seo.noindex ? "noindex" : "index"}, ${content.seo.nofollow ? "nofollow" : "follow"}`,
  );
  $("<link>").attr("rel", "canonical").attr("href", canonical).appendTo("head");
  meta("og:type", content.type === "blog" ? "article" : "website", true);
  meta("og:site_name", "VDA LLC", true);
  meta("og:title", socialTitle, true);
  meta("og:description", socialDescription, true);
  meta("og:url", canonical, true);
  meta("twitter:card", socialImage ? "summary_large_image" : "summary");
  meta("twitter:title", socialTitle);
  meta("twitter:description", socialDescription);
  if (socialImage) {
    meta("og:image", socialImage, true);
    meta("og:image:alt", content.seo.socialImageAlt || content.imageAlt, true);
    meta("twitter:image", socialImage);
    meta("twitter:image:alt", content.seo.socialImageAlt || content.imageAlt);
  }
  if (content.type !== "page") {
    $(".page-hero h1").text(content.title);
    $(".page-hero-lead").text(content.excerpt);
    $('.breadcrumb [aria-current="page"]').text(content.title);
    $(".service-content").first().html(cleanBody(content.body));
    if (content.image) {
      if (!$(".page-hero-bg img").length)
        $(".page-hero").prepend(
          '<div class="page-hero-bg" aria-hidden="true"><img loading="eager" decoding="async"></div>',
        );
      $(".page-hero-bg img")
        .attr("src", content.image)
        .attr("alt", content.imageAlt);
    } else $(".page-hero-bg").remove();
    $(".page-hero .eyebrow").text(
      content.type === "blog"
        ? `${content.category} · ${readTime(content.body)} min read`
        : content.category || "Our Services",
    );
    $('input[name="_subject"]').attr(
      "value",
      `${content.title} Inquiry | VDA LLC`,
    );
    $('input[name="Claim Type"]').attr("value", content.title);
    // Regenerate article/service schema from the saved content so edits cannot leave stale structured data.
    $('script[type="application/ld+json"]').remove();
    if (content.type === "blog") {
      const related = publicPages
        .filter((page) => page.type === "blog" && page.path !== content.path)
        .slice(0, 3);
      $(".sidebar-related").html(
        related
          .map(
            (page) =>
              `<a class="sidebar-related-item" href="${escapeHtml(contentIdentity(page).path)}">${escapeHtml(page.title)} →</a>`,
          )
          .join(""),
      );
    }
  }
  const posts = publicPages
    .filter((page) => page.type === "blog")
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
    );
  $(".insights-grid-full").html(posts.map(postCard).join(""));
  $(".insights-grid").html(posts.slice(0, 3).map(postCard).join(""));
  const services = publicPages.filter((page) => page.type === "service");
  $(".services-grid").html(
    services
      .map(
        (service) =>
          `<li class="service-card">${service.image ? `<div class="service-card-img"><img src="${escapeHtml(service.image)}" alt="${escapeHtml(service.imageAlt)}" loading="lazy" decoding="async"></div>` : ""}<div class="service-card-body"><h3>${escapeHtml(service.title)}</h3><p>${escapeHtml(service.excerpt)}</p><a class="service-card-link" href="${escapeHtml(service.path)}">Learn More →</a></div></li>`,
      )
      .join(""),
  );
  $(".megamenu-grid").html(
    services
      .map(
        (service) =>
          `<a class="megamenu-item" href="${escapeHtml(service.path)}"><div><strong>${escapeHtml(service.title)}</strong><p>${escapeHtml(service.excerpt)}</p></div></a>`,
      )
      .join(""),
  );
  $(".mobile-nav-group").each((_, node) => {
    if (
      $(node).find(".mobile-nav-label").first().text().trim() === "Services"
    ) {
      $(node)
        .find(".mobile-nav-sub")
        .html(
          services
            .map(
              (service) =>
                `<li><a href="${escapeHtml(service.path)}">${escapeHtml(service.title)}</a></li>`,
            )
            .join(""),
        );
    }
  });
  $(".footer-nav-col").each((_, node) => {
    if ($(node).find("strong").first().text().trim() === "Services") {
      $(node)
        .find("ul")
        .html(
          services
            .map(
              (service) =>
                `<li><a href="${escapeHtml(service.path)}">${escapeHtml(service.title)}</a></li>`,
            )
            .join(""),
        );
    }
  });
  const schema = {
    "@context": "https://schema.org",
    "@type":
      content.type === "blog"
        ? "BlogPosting"
        : content.type === "service"
          ? "Service"
          : "WebPage",
    name: content.title,
    ...(content.type === "blog" ? { headline: content.title } : {}),
    description,
    url: canonical,
    mainEntityOfPage: canonical,
    ...(socialImage ? { image: socialImage } : {}),
    ...(content.type === "blog"
      ? {
          author: { "@type": "Organization", name: "VDA LLC" },
          publisher: { "@type": "Organization", name: "VDA LLC" },
          ...(content.date ? { datePublished: content.date } : {}),
        }
      : {}),
    ...(content.type === "service"
      ? { provider: { "@type": "Organization", name: "VDA LLC", url: origin } }
      : {}),
  };
  const schemas =
    content.type === "blog"
      ? articleSchemas(content, originalSchemas, schema, origin)
      : [schema];
  for (const value of schemas) {
    const json = JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");
    $("head").append(`<script type="application/ld+json">${json}</script>`);
  }
  $("a[href]").each((_, node) => {
    const value = $(node).attr("href")!;
    $(node).attr("href", rewriteLegacyLink(value, content.path, origin));
  });
  return $.html();
}
export function renderSitemap(pages: Content[], origin: string) {
  const entries = [
    ...new Map(
      pages
        .filter((page) => !legacyArticleRoutes[page.path])
        .map((page) => [contentIdentity(page).path, page]),
    ).values(),
  ].filter(
    (content) =>
      !content.seo.noindex &&
      !content.seo.excludeFromSitemap &&
      canonicalUrl(content, origin) === new URL(content.path, origin).href,
  );
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((content) => `<url><loc>${escapeHtml(new URL(content.path, origin).href)}</loc></url>`).join("")}</urlset>`;
}
