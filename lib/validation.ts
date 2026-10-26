import sanitizeHtml from "sanitize-html";
import { CmsError, type Content, type ContentType, type Seo } from "./model";
import {
  articlePath,
  articleSlug,
  canonicalUrl,
  legacyArticleRoutes,
} from "./content-urls";
export function safeUrl(value: string, absoluteOnly = false) {
  if (!value) return true;
  if (value.trim() !== value || /[\x00-\x20\\]/.test(value)) return false;
  if (!absoluteOnly && /^\/(?!\/)/.test(value)) return true;
  try {
    return (
      /^https?:\/\//i.test(value) &&
      ["http:", "https:"].includes(new URL(value).protocol)
    );
  } catch {
    return false;
  }
}
export function cleanBody(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "h2",
      "h3",
      "h4",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "figure",
      "figcaption",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "hr",
      "div",
      "span",
      "code",
      "pre",
      "sup",
      "sub",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "width", "height", "loading", "decoding"],
      "*": ["class", "id"],
      th: ["scope", "colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      ol: ["start"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    transformTags: {
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: "lazy", decoding: "async" },
      }),
    },
  });
}
const text = (
  obj: Record<string, unknown>,
  key: string,
  max: number,
  required = false,
) => {
  const value = obj[key];
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new CmsError(
      `Invalid ${key}: ${required ? "required, " : ""}maximum ${max} characters.`,
    );
  return value;
};
export function validateContent(input: unknown): Content {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CmsError("Content must be an object.");
  const obj = input as Record<string, unknown>;
  const path = text(obj, "path", 200, true);
  const type = obj.type as ContentType;
  if (legacyArticleRoutes[path])
    throw new CmsError(
      `This legacy article URL is reserved. Edit ${legacyArticleRoutes[path]} instead.`,
    );
  if (!["page", "blog", "service"].includes(type))
    throw new CmsError("Invalid content type.");
  if (
    type !== "page" &&
    !new RegExp(
      `^/${type === "blog" ? "blog" : "services"}/[a-z0-9]+(?:-[a-z0-9]+)*\\.html$`,
    ).test(path)
  )
    throw new CmsError(
      "Use a lowercase URL slug containing letters, numbers and hyphens.",
    );
  if (type === "page" && path !== "/" && !/^\/[a-z0-9-]+\.html$/.test(path))
    throw new CmsError("Invalid page URL.");
  if (!obj.seo || typeof obj.seo !== "object" || Array.isArray(obj.seo))
    throw new CmsError("SEO settings are required.");
  const rawSeo = obj.seo as Record<string, unknown>;
  const seo: Seo = {
    title: text(rawSeo, "title", 250, true),
    description: text(rawSeo, "description", 1000),
    canonical: text(rawSeo, "canonical", 2000),
    socialTitle: text(rawSeo, "socialTitle", 250),
    socialDescription: text(rawSeo, "socialDescription", 1000),
    socialImage: text(rawSeo, "socialImage", 2000),
    socialImageAlt: text(rawSeo, "socialImageAlt", 500),
    noindex: false,
    nofollow: false,
    excludeFromSitemap: false,
  };
  for (const key of ["noindex", "nofollow", "excludeFromSitemap"] as const) {
    if (typeof rawSeo[key] !== "boolean")
      throw new CmsError(`Invalid ${key} setting.`);
    seo[key] = rawSeo[key];
  }
  if (!safeUrl(seo.canonical) || !safeUrl(seo.socialImage))
    throw new CmsError(
      "Canonical and social image URLs must be site paths or HTTP(S) URLs.",
    );
  const image = text(obj, "image", 2000);
  if (!safeUrl(image))
    throw new CmsError("Use a site path or HTTP(S) image URL.");
  const date = text(obj, "date", 10);
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    throw new CmsError("Use a valid publish date.");
  if (type === "blog") {
    articlePath(articleSlug(path));
    const self = canonicalUrl({ path, type } as Content);
    if (seo.canonical && new URL(seo.canonical, self).href !== self)
      throw new CmsError(
        "Articles must use their self-referencing /blog/ canonical URL.",
      );
    seo.canonical = self;
  }
  const structuredData = obj.structuredData;
  if (
    structuredData !== undefined &&
    (!Array.isArray(structuredData) ||
      structuredData.length > 20 ||
      structuredData.some(
        (value) => !value || typeof value !== "object" || Array.isArray(value),
      ) ||
      JSON.stringify(structuredData).length > 64000)
  )
    throw new CmsError("Invalid article structured data.");
  return {
    path,
    type,
    title: text(obj, "title", 500, true),
    excerpt: text(obj, "excerpt", 3000),
    body: cleanBody(text(obj, "body", 80000)),
    image,
    imageAlt: text(obj, "imageAlt", 500),
    category: text(obj, "category", 150),
    date,
    seo,
    ...(structuredData !== undefined
      ? { structuredData: structuredData as Record<string, unknown>[] }
      : {}),
  };
}
