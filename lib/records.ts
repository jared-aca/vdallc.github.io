import { CmsError, type Content, type RecordEntry } from "./model";
import { contentIdentity, legacyArticleRoutes } from "./content-urls";
import { validateContent } from "./validation";
export type Records = Record<string, RecordEntry>;
export function recordFor(
  path: string,
  records: Records,
  published: Content[],
): RecordEntry | null {
  path = legacyArticleRoutes[path] || path;
  if (records[path]) return records[path];
  const content = published.find((page) => page.path === path);
  return content
    ? {
        draft: content,
        published: content,
        revision: 0,
        updatedAt: "",
        versions: [],
      }
    : null;
}
export function allRecords(records: Records, published: Content[]) {
  const merged = new Map(
    published
      .filter((page) => !legacyArticleRoutes[page.path])
      .map((page) => [page.path, recordFor(page.path, records, published)!]),
  );
  for (const [path, record] of Object.entries(records))
    if (!legacyArticleRoutes[path]) merged.set(path, record);
  return [...merged.values()];
}
export function applyEdit(
  records: Records,
  published: Content[],
  data: {
    content: unknown;
    action: unknown;
    revision: unknown;
    create?: boolean;
  },
) {
  if (!["draft", "publish", "unpublish"].includes(String(data.action)))
    throw new CmsError("Invalid publishing action.");
  let content = validateContent(data.content);
  const current = recordFor(content.path, records, published);
  if (data.create && current)
    throw new CmsError(
      "This URL already exists. Choose a different slug.",
      409,
    );
  if (!data.create && !current) throw new CmsError("Content not found.", 404);
  if (
    typeof data.revision !== "number" ||
    !Number.isInteger(data.revision) ||
    data.revision < 0 ||
    (current?.revision ?? 0) !== data.revision
  )
    throw new CmsError(
      "This page changed in another session. Reopen it before saving.",
      409,
    );
  if (current && current.draft.type !== content.type)
    throw new CmsError("Content type cannot be changed.");
  if (content.type === "page") {
    if (!current)
      throw new CmsError(
        "Only existing pages support metadata editing. Create a post or service instead.",
      );
    content = { ...current.draft, seo: content.seo };
  }
  const at = new Date().toISOString();
  const versions = [
    { id: crypto.randomUUID(), at, action: String(data.action), content },
    ...(current?.versions ?? []),
  ];
  if (current && !current.versions.length)
    versions.push({
      id: crypto.randomUUID(),
      at,
      action: "original",
      content: current.draft,
    });
  const record: RecordEntry = {
    draft: content,
    published:
      data.action === "publish"
        ? content
        : data.action === "unpublish"
          ? null
          : (current?.published ?? null),
    revision: data.revision + 1,
    updatedAt: at,
    versions: versions.slice(0, 10),
  };
  const nextPublished = published.filter((page) => page.path !== content.path);
  if (record.published) nextPublished.push(record.published);
  return {
    record,
    records: { ...records, [content.path]: record },
    published: nextPublished,
  };
}
