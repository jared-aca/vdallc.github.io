import { rewriteLegacyLink } from "./content-urls";
import { CmsError, type Content } from "./model";
export const searchIntents = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
] as const;
export type SearchIntent = (typeof searchIntents)[number];
export type SeoTarget = {
  primaryKeyword: string;
  secondaryKeywords: string[];
  targetKeywords: string[];
  searchIntent: SearchIntent | "";
  clusterId: string;
  clusterRole: "primary" | "supporting";
};
export type KeywordCluster = {
  id: string;
  name: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  intent: SearchIntent;
  supportingQuestions: string[];
  includedTopics: string[];
  excludedTerms: string[];
  notes: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};
export type SeoPlan = {
  revision: number;
  clusters: KeywordCluster[];
  targets: Record<string, SeoTarget>;
};
export function emptySeoPlan(): SeoPlan {
  return { revision: 0, clusters: [], targets: {} };
}
export function emptyTarget(): SeoTarget {
  return {
    primaryKeyword: "",
    secondaryKeywords: [],
    targetKeywords: [],
    searchIntent: "",
    clusterId: "",
    clusterRole: "supporting",
  };
}
export function keywordKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
export function keywordList(value: string | string[]): string[] {
  const seen = new Set<string>();
  return (typeof value === "string" ? value.split(/[,\n]/) : value)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => {
      const key = keywordKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CmsError("Invalid SEO planning data.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 250, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new CmsError(
      `${label} ${required ? "is required and " : ""}must be at most ${max} characters.`,
    );
  return value.trim();
}
function list(value: unknown, label: string) {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((item) => typeof item !== "string" || item.length > 250)
  )
    throw new CmsError(
      `${label} must contain at most 100 phrases of 250 characters each.`,
    );
  return keywordList(value);
}
export function validateTarget(value: unknown): SeoTarget {
  const raw = object(value);
  if (
    raw.searchIntent !== "" &&
    !searchIntents.includes(raw.searchIntent as SearchIntent)
  )
    throw new CmsError("Choose a valid search intent.");
  if (!["primary", "supporting"].includes(String(raw.clusterRole)))
    throw new CmsError("Choose a valid cluster role.");
  return {
    primaryKeyword: text(raw.primaryKeyword, "Primary keyword"),
    secondaryKeywords: list(raw.secondaryKeywords, "Secondary keywords"),
    targetKeywords: list(raw.targetKeywords, "Target keywords"),
    searchIntent: raw.searchIntent as SeoTarget["searchIntent"],
    clusterId: text(raw.clusterId, "Cluster ID", 100),
    clusterRole: raw.clusterRole as SeoTarget["clusterRole"],
  };
}
export function validateSeoPlan(value: unknown, knownPaths: string[]): SeoPlan {
  const raw = object(value);
  if (
    !Number.isInteger(raw.revision) ||
    (raw.revision as number) < 0 ||
    !Array.isArray(raw.clusters) ||
    raw.clusters.length > 200
  )
    throw new CmsError("Invalid SEO plan revision or cluster list.");
  const clusters: KeywordCluster[] = raw.clusters.map((value) => {
    const cluster = object(value);
    if (
      !searchIntents.includes(cluster.intent as SearchIntent) ||
      !["active", "archived"].includes(String(cluster.status))
    )
      throw new CmsError("Invalid cluster intent or status.");
    const id = text(cluster.id, "Cluster ID", 100, true);
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new CmsError("Invalid cluster ID.");
    return {
      id,
      name: text(cluster.name, "Cluster name", 250, true),
      primaryKeyword: text(
        cluster.primaryKeyword,
        "Cluster primary keyword",
        250,
        true,
      ),
      secondaryKeywords: list(cluster.secondaryKeywords, "Supporting keywords"),
      intent: cluster.intent as SearchIntent,
      supportingQuestions: list(
        cluster.supportingQuestions,
        "Supporting questions",
      ),
      includedTopics: list(cluster.includedTopics, "Included topics"),
      excludedTerms: list(cluster.excludedTerms, "Excluded terms"),
      notes: text(cluster.notes, "Notes", 10000),
      status: cluster.status as KeywordCluster["status"],
      createdAt: text(cluster.createdAt, "Created date", 40, true),
      updatedAt: text(cluster.updatedAt, "Updated date", 40, true),
    };
  });
  if (new Set(clusters.map((cluster) => cluster.id)).size !== clusters.length)
    throw new CmsError("Cluster IDs must be unique.");
  const targetData = object(raw.targets);
  const targets: SeoPlan["targets"] = {};
  for (const [path, value] of Object.entries(targetData)) {
    if (!knownPaths.includes(path))
      throw new CmsError(`The SEO plan references an unknown page: ${path}`);
    const target = validateTarget(value);
    if (
      target.clusterId &&
      !clusters.some((cluster) => cluster.id === target.clusterId)
    )
      throw new CmsError("A selected keyword cluster no longer exists.");
    targets[path] = target;
  }
  for (const cluster of clusters.filter(
    (cluster) => cluster.status === "active",
  )) {
    const owners = Object.entries(targets).filter(
      ([, target]) =>
        target.clusterId === cluster.id && target.clusterRole === "primary",
    );
    if (owners.length > 1)
      throw new CmsError(
        `“${cluster.name}” already has a primary page. Assign additional pages as supporting content.`,
        409,
      );
  }
  return { revision: raw.revision as number, clusters, targets };
}
export function targetFor(plan: SeoPlan, path: string): SeoTarget {
  return plan.targets[path] ?? emptyTarget();
}
export function updateTarget(
  plan: SeoPlan,
  path: string,
  input: unknown,
  expectedRevision: number,
  knownPaths: string[],
) {
  const target = validateTarget(input);
  if (JSON.stringify(targetFor(plan, path)) === JSON.stringify(target))
    return plan;
  if (plan.revision !== expectedRevision)
    throw new CmsError(
      "The SEO plan changed in another session. Reopen the page before saving.",
      409,
    );
  return validateSeoPlan(
    {
      ...plan,
      revision: plan.revision + 1,
      targets: { ...plan.targets, [path]: target },
    },
    knownPaths,
  );
}
export function effectiveTarget(target: SeoTarget, plan: SeoPlan): SeoTarget {
  const cluster = plan.clusters.find(
    (cluster) => cluster.id === target.clusterId,
  );
  return {
    ...target,
    primaryKeyword: target.primaryKeyword || cluster?.primaryKeyword || "",
    secondaryKeywords: target.secondaryKeywords.length
      ? target.secondaryKeywords
      : cluster?.secondaryKeywords || [],
    searchIntent: target.searchIntent || cluster?.intent || "",
  };
}
function plainText(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function targetChecks(content: Content, target: SeoTarget) {
  const phrase = keywordKey(target.primaryKeyword);
  const checks: string[] = [];
  if (!phrase) checks.push("Add a primary keyword to define the page’s topic.");
  if (!target.searchIntent) checks.push("Choose a search intent.");
  if (phrase && !keywordKey(content.seo.title).includes(phrase))
    checks.push(
      "Review whether the SEO title naturally reflects the primary keyword.",
    );
  if (phrase && !keywordKey(content.seo.description).includes(phrase))
    checks.push(
      "Review whether the description naturally reflects the primary keyword.",
    );
  if (
    phrase &&
    content.type !== "page" &&
    !keywordKey(plainText(content.body)).includes(phrase)
  )
    checks.push(
      "The primary phrase was not found in the article text. Review topic coverage without forcing repetition.",
    );
  return checks;
}
export function internalLinks(content: Content, origin: string): string[] {
  const links: string[] = [];
  for (const match of content.body.matchAll(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi,
  )) {
    try {
      const url = new URL(
        rewriteLegacyLink(
          match[1].replace(/&amp;/g, "&"),
          content.path,
          origin,
        ),
        new URL(content.path, origin),
      );
      if (url.origin === new URL(origin).origin && !match[1].startsWith("#"))
        links.push(url.pathname);
    } catch {}
  }
  return [...new Set(links)];
}
export function clusterHealth(
  cluster: KeywordCluster,
  plan: SeoPlan,
  documents: Content[],
  origin: string,
) {
  const members = documents.filter(
    (page) => plan.targets[page.path]?.clusterId === cluster.id,
  );
  const primary =
    members.find((page) => plan.targets[page.path].clusterRole === "primary") ??
    null;
  const supporting = members.filter(
    (page) => plan.targets[page.path].clusterRole === "supporting",
  );
  const gaps: string[] = [];
  if (!primary) gaps.push("Assign a primary page for this topic.");
  if (!supporting.length)
    gaps.push("Assign supporting content to build out the topic.");
  const missingLinks = primary
    ? supporting.filter(
        (page) =>
          page.type !== "page" &&
          !internalLinks(page, origin).includes(primary.path),
      )
    : [];
  if (missingLinks.length)
    gaps.push(
      `${missingLinks.length} supporting ${missingLinks.length === 1 ? "page has" : "pages have"} no body link to the primary page in the saved draft.`,
    );
  return { primary, supporting, gaps, missingLinks };
}
