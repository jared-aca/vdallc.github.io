import baselines from "../migrations/article-url-baselines.json";
import type { Content, RecordEntry, SeedPage } from "./model";
import type { Records } from "./records";
import type { SeoPlan } from "./seo-plan";
import {
  canonicalUrl,
  contentIdentity,
  legacyArticleRoutes,
} from "./content-urls";
export class ReconciliationConflict extends Error {}
function equal(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function mergeFields<T extends object>(
  a: T,
  b: T,
  baseA: T,
  baseB: T,
  label: string,
): T {
  const output = { ...a } as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = (a as Record<string, unknown>)[key],
      bv = (b as Record<string, unknown>)[key];
    const ab = (baseA as Record<string, unknown>)[key],
      bb = (baseB as Record<string, unknown>)[key];
    if (equal(av, bv) || equal(bv, bb)) continue;
    if (equal(av, ab)) {
      output[key] = bv;
      continue;
    }
    if (key === "seo" && av && bv) {
      output[key] = mergeFields(
        av as object,
        bv as object,
        ab as object,
        bb as object,
        `${label}.seo`,
      );
      continue;
    }
    throw new ReconciliationConflict(
      `Conflicting saved edits at ${label}.${key}; originals are retained. Resolve this field explicitly before migration.`,
    );
  }
  return output as T;
}
export function canonicalContent(content: Content): Content {
  const identity = contentIdentity(content);
  const next = { ...content, ...identity, seo: { ...content.seo } };
  if (identity.type === "blog") next.seo.canonical = canonicalUrl(next);
  return next;
}
export function reconcileContentData(
  seed: SeedPage[],
  published: Content[],
  records: Records,
  plan: SeoPlan,
) {
  const seenPublished = new Map<string, Content>();
  for (const page of published) {
    const existing = seenPublished.get(page.path);
    if (existing && !equal(existing, page))
      throw new ReconciliationConflict(
        `Conflicting published records share URL ${page.path}; resolve them without overwriting either version.`,
      );
    seenPublished.set(page.path, page);
  }
  const seeds = new Map(seed.map((page) => [page.content.path, page]));
  const archive: Record<string, unknown> = {};
  const nextRecords: Records = structuredClone(records);
  const nextPlan = structuredClone(plan);
  const pages = new Map(
    published
      .filter((page) => !legacyArticleRoutes[page.path])
      .map((page) => [page.path, canonicalContent(page)]),
  );
  for (const [from, to] of Object.entries(legacyArticleRoutes)) {
    const baseline = (
      baselines as Record<string, { root: Content; canonical: Content }>
    )[from];
    const rootSeed =
        seeds.get(from) ??
        (baseline ? { content: baseline.root, html: "" } : undefined),
      canonicalSeed =
        seeds.get(to) ??
        (baseline ? { content: baseline.canonical, html: "" } : undefined);
    if (!canonicalSeed)
      throw new ReconciliationConflict(`Canonical template missing: ${to}`);
    const rootPublished = published.find((page) => page.path === from);
    const peerPublished = published.find((page) => page.path === to);
    const rootRecord = records[from],
      peerRecord = records[to];
    const canonicalBase = canonicalContent(canonicalSeed.content);
    // Root aliases were imported as SEO-only Pages. Expand their unchanged
    // fields from the canonical template before comparing actual editor edits.
    const expand = (content: Content): Content => {
      const base = rootSeed?.content;
      const merged = {
        ...canonicalBase,
        ...content,
        path: to,
        type: "blog" as const,
        seo: { ...content.seo },
      };
      for (const key of [
        "title",
        "excerpt",
        "body",
        "image",
        "imageAlt",
        "category",
        "date",
      ] as const) {
        if (base && equal(content[key], base[key]))
          merged[key] = canonicalBase[key];
      }
      merged.seo.canonical = canonicalUrl(merged);
      return merged;
    };
    if (rootSeed || rootPublished || rootRecord || nextPlan.targets[from])
      archive[from] = {
        seed: rootSeed,
        published: rootPublished,
        record: rootRecord,
        target: nextPlan.targets[from],
      };
    if (rootPublished) {
      const expanded = expand(rootPublished);
      if (peerPublished) {
        const merged = mergeFields(
          canonicalContent(peerPublished),
          expanded,
          canonicalBase,
          canonicalBase,
          `${to}.published`,
        );
        pages.set(to, merged);
        if (
          peerRecord &&
          !rootRecord &&
          !equal(merged, canonicalContent(peerPublished))
        ) {
          nextRecords[to] = {
            ...peerRecord,
            draft: mergeFields(
              canonicalContent(peerRecord.draft),
              expanded,
              canonicalBase,
              canonicalBase,
              `${to}.draft`,
            ),
            published: merged,
            revision: peerRecord.revision + 1,
          };
        }
      } else if (!peerRecord || peerRecord.published) pages.set(to, expanded);
      else if (!equal(expanded, canonicalBase))
        throw new ReconciliationConflict(
          `An edited legacy page conflicts with an unpublished canonical article: ${to}`,
        );
    }
    if (rootRecord) {
      const draft = expand(rootRecord.draft);
      const publicValue = rootRecord.published
        ? expand(rootRecord.published)
        : null;
      if (
        peerRecord &&
        Boolean(peerRecord.published) !== Boolean(rootRecord.published)
      )
        throw new ReconciliationConflict(
          `Conflicting publication states for ${from} and ${to}; choose the intended state before migration.`,
        );
      if (!peerRecord && peerPublished && !publicValue)
        throw new ReconciliationConflict(
          `A legacy unpublish conflicts with a published canonical article: ${to}`,
        );
      const peerDraft = peerRecord?.draft || peerPublished;
      const mergedDraft = peerDraft
        ? mergeFields(
            canonicalContent(peerDraft),
            draft,
            canonicalBase,
            canonicalBase,
            `${to}.draft`,
          )
        : draft;
      const peerPublic = peerRecord?.published || peerPublished;
      const mergedPublic =
        peerPublic && publicValue
          ? mergeFields(
              canonicalContent(peerPublic),
              publicValue,
              canonicalBase,
              canonicalBase,
              `${to}.published`,
            )
          : publicValue;
      const versions = [
        ...(peerRecord?.versions || []),
        ...rootRecord.versions.map((version) => ({
          ...version,
          content: expand(version.content),
        })),
      ];
      const versionMap = new Map<string, (typeof versions)[number]>();
      for (const version of versions) {
        const existing = versionMap.get(version.id);
        if (existing && !equal(existing, version))
          throw new ReconciliationConflict(
            `Conflicting history entries share version ID ${version.id} for ${to}.`,
          );
        versionMap.set(version.id, version);
      }
      const uniqueVersions = [...versionMap.values()].sort((a, b) =>
        b.at.localeCompare(a.at),
      );
      nextRecords[to] = {
        draft: mergedDraft,
        published: mergedPublic,
        revision: Math.max(peerRecord?.revision || 0, rootRecord.revision) + 1,
        updatedAt: [peerRecord?.updatedAt || "", rootRecord.updatedAt]
          .sort()
          .at(-1)!,
        versions: uniqueVersions,
      };
      delete nextRecords[from];
      if (mergedPublic) pages.set(to, mergedPublic);
      else pages.delete(to);
    }
    if (nextPlan.targets[from]) {
      if (
        nextPlan.targets[to] &&
        !equal(nextPlan.targets[to], nextPlan.targets[from])
      )
        throw new ReconciliationConflict(
          `Conflicting keyword targets for ${from} and ${to}; both originals are retained for review.`,
        );
      nextPlan.targets[to] = nextPlan.targets[from];
      delete nextPlan.targets[from];
    }
  }
  for (const [path, record] of Object.entries(nextRecords))
    nextRecords[path] = {
      ...record,
      draft: canonicalContent(record.draft),
      published: record.published ? canonicalContent(record.published) : null,
      versions: record.versions.map((version) => ({
        ...version,
        content: canonicalContent(version.content),
      })),
    };
  if (!equal(nextPlan.targets, plan.targets)) nextPlan.revision++;
  return {
    seed: seed
      .filter((page) => !legacyArticleRoutes[page.content.path])
      .map((page) => ({ ...page, content: canonicalContent(page.content) })),
    published: [...pages.values()],
    records: nextRecords,
    plan: nextPlan,
    archive,
  };
}
