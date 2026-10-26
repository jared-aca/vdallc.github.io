import type { Content } from "./model";
import { rewriteLegacyLink } from "./content-urls";
function articleType(value: unknown) {
  return (Array.isArray(value) ? value : [value]).some((type) =>
    ["BlogPosting", "Article", "NewsArticle"].includes(String(type)),
  );
}
export function rewriteSchemaLinks(
  value: unknown,
  path: string,
  origin: string,
): unknown {
  if (typeof value === "string")
    return /^(?:https?:\/\/|\/)/.test(value)
      ? rewriteLegacyLink(value, path, origin)
      : value;
  if (Array.isArray(value))
    return value.map((item) => rewriteSchemaLinks(item, path, origin));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewriteSchemaLinks(item, path, origin),
      ]),
    );
  return value;
}
export function articleSchemas(
  content: Content,
  fallback: Record<string, unknown>[],
  generated: Record<string, unknown>,
  origin: string,
) {
  const original = content.structuredData ?? fallback;
  const nodes = original.flatMap((node) =>
    Array.isArray(node["@graph"])
      ? (node["@graph"] as Record<string, unknown>[]).map((child) => ({
          "@context": node["@context"] || "https://schema.org",
          ...child,
        }))
      : [node],
  );
  const article = nodes.find((node) => articleType(node["@type"])) ?? {};
  const schema = {
    ...article,
    ...generated,
    ...(article.mainEntityOfPage &&
    typeof article.mainEntityOfPage === "object" &&
    !Array.isArray(article.mainEntityOfPage)
      ? {
          mainEntityOfPage: {
            ...(article.mainEntityOfPage as Record<string, unknown>),
            "@id": generated.mainEntityOfPage,
          },
        }
      : {}),
    author: article.author ?? generated.author,
    publisher: article.publisher ?? generated.publisher,
    ...(article.dateModified ? { dateModified: article.dateModified } : {}),
  };
  return [schema, ...nodes.filter((node) => !articleType(node["@type"]))].map(
    (node) => rewriteSchemaLinks(node, content.path, origin),
  );
}
