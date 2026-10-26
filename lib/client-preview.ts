import type { Content } from "./model";
import config from "../cms.config.json";
import { articleSchemas } from "./structured-data";
import { canonicalUrl, rewriteLegacyLink } from "./content-urls";
import { validateContent } from "./validation";
export async function previewContent(input: Content) {
  const content = validateContent(input);
  const key =
    content.type === "page"
      ? `pages${content.path === "/" ? "/index.html" : content.path}`
      : `${content.type}.html`;
  const response = await fetch(`/cms/templates/${key}`);
  if (!response.ok)
    throw new Error(
      "The preview template is unavailable. Build the static site first.",
    );
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  doc.title = content.seo.title;
  let canonical = doc.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = doc.createElement("link");
    canonical.setAttribute("rel", "canonical");
    doc.head.append(canonical);
  }
  canonical.setAttribute("href", canonicalUrl(content));
  if (content.type === "blog") {
    const url = canonicalUrl(content);
    const description = content.seo.description || content.excerpt;
    const title = content.seo.socialTitle || content.seo.title;
    const socialDescription = content.seo.socialDescription || description;
    const image = content.seo.socialImage || content.image;
    for (const node of doc.querySelectorAll(
      'meta[name="description"],meta[name="robots"],meta[property^="og:"],meta[name^="twitter:"],script[type="application/ld+json"]',
    ))
      node.remove();
    const meta = (key: string, value: string, property = false) => {
      const element = doc.createElement("meta");
      element.setAttribute(property ? "property" : "name", key);
      element.setAttribute("content", value);
      doc.head.append(element);
    };
    meta("description", description);
    meta("robots", "noindex, nofollow");
    for (const [key, value] of Object.entries({
      "og:type": "article",
      "og:title": title,
      "og:description": socialDescription,
      "og:url": url,
    }))
      meta(key, value, true);
    meta("twitter:card", image ? "summary_large_image" : "summary");
    meta("twitter:title", title);
    meta("twitter:description", socialDescription);
    if (image) {
      meta("og:image", new URL(image, config.siteUrl).href, true);
      meta("twitter:image", new URL(image, config.siteUrl).href);
    }
    const generated = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: content.title,
      description,
      url,
      mainEntityOfPage: url,
      author: { "@type": "Organization", name: "VDA LLC" },
      publisher: { "@type": "Organization", name: "VDA LLC" },
      ...(content.date ? { datePublished: content.date } : {}),
    };
    for (const schema of articleSchemas(
      content,
      [],
      generated,
      config.siteUrl,
    )) {
      const element = doc.createElement("script");
      element.type = "application/ld+json";
      element.textContent = JSON.stringify(schema).replace(/</g, "\\u003c");
      doc.head.append(element);
    }
  }
  const canonicalLinks = doc.querySelectorAll('link[rel="canonical"]');
  for (const duplicate of [...canonicalLinks].slice(1)) duplicate.remove();
  if (content.type !== "page") {
    const setText = (selector: string, text: string) => {
      const node = doc.querySelector(selector);
      if (node) node.textContent = text;
    };
    setText(".page-hero h1", content.title);
    setText(".page-hero-lead", content.excerpt);
    setText('.breadcrumb [aria-current="page"]', content.title);
    const body = doc.querySelector(".service-content");
    if (body) body.innerHTML = content.body;
    const image = doc.querySelector(".page-hero-bg img");
    if (image && content.image) {
      image.setAttribute("src", content.image);
      image.setAttribute("alt", content.imageAlt);
    }
    if (!content.image) doc.querySelector(".page-hero-bg")?.remove();
  }
  for (const script of doc.querySelectorAll("script:not([src])"))
    if (script.textContent?.includes("localStorage")) script.remove();
  for (const node of doc.querySelectorAll("form, #theme-toggle")) node.remove();
  doc.documentElement.setAttribute("data-theme", "light");
  const banner = doc.createElement("div");
  banner.textContent = "Draft preview · These changes have not been published.";
  banner.setAttribute(
    "style",
    "position:sticky;top:0;z-index:10000;padding:12px;background:#17273f;color:white;text-align:center;font:14px system-ui",
  );
  doc.body.prepend(banner);
  for (const link of doc.querySelectorAll("a[href]"))
    link.setAttribute(
      "href",
      rewriteLegacyLink(link.getAttribute("href")!, content.path),
    );
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
