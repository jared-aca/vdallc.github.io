import aliases from "../data/article-routes.json";
import config from "../cms.config.json";
import { CmsError, type Content } from "./model";
// Audited legacy identities, not a filename/slug inference rule.
export const legacyArticleRoutes: Readonly<Record<string, string>> = aliases;
export function articlePath(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new CmsError(
      "Use a lowercase article slug containing letters, numbers and hyphens.",
    );
  return `/blog/${slug}.html`;
}
export function articleSlug(path: string) {
  const canonical = legacyArticleRoutes[path] || path;
  const match = canonical.match(/^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\.html$/);
  if (!match) throw new CmsError("Articles must use /blog/{slug}.html.");
  return match[1];
}
export function contentIdentity(content: Pick<Content, "path" | "type">) {
  const legacy = legacyArticleRoutes[content.path];
  if (legacy) return { path: legacy, type: "blog" as const };
  if (content.type === "blog")
    return {
      path: articlePath(articleSlug(content.path)),
      type: "blog" as const,
    };
  return { path: content.path, type: content.type };
}
export function contentUrl(
  content: Pick<Content, "path" | "type">,
  origin = config.siteUrl,
) {
  return new URL(contentIdentity(content).path, origin).href;
}
export function canonicalUrl(content: Content, origin = config.siteUrl) {
  return contentIdentity(content).type === "blog"
    ? contentUrl(content, origin)
    : new URL(content.seo.canonical || content.path, origin).href;
}
export function rewriteLegacyLink(
  value: string,
  fromPath: string,
  origin = config.siteUrl,
) {
  if (
    !value ||
    value.startsWith("#") ||
    /^(?:mailto:|tel:|data:|javascript:)/i.test(value)
  )
    return value;
  try {
    const url = new URL(value, new URL(fromPath, origin));
    const site = new URL(origin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      ![site.hostname, "www." + site.hostname].includes(url.hostname) ||
      url.port !== site.port
    )
      return value;
    const target = legacyArticleRoutes[url.pathname];
    if (!target) return value;
    url.protocol = site.protocol;
    url.host = site.host;
    url.pathname = target;
    return /^https?:\/\//i.test(value) || value.startsWith("//")
      ? url.href
      : url.pathname + url.search + url.hash;
  } catch {
    return value;
  }
}
export function articleRedirect(requestUrl: string, origin?: string) {
  const url = new URL(requestUrl);
  const target = legacyArticleRoutes[url.pathname];
  if (!target) return null;
  const destination = new URL(target, origin || url.origin);
  destination.search = url.search;
  destination.hash = url.hash;
  return destination.href;
}
