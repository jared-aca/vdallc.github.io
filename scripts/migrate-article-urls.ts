import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { legacyArticleRoutes } from "../lib/content-urls";
import { reconcileContentData } from "../lib/content-reconciliation";
import type { Content, SeedPage } from "../lib/model";
import type { Records } from "../lib/records";
import type { SeoPlan } from "../lib/seo-plan";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function main() {
  const write = process.argv.includes("--write");
  const names = ["seed", "published", "cms", "seo-plan"];
  const raw = await Promise.all(
    names.map((name) => readFile(`data/${name}.json`, "utf8")),
  );
  const [originalSeed, originalPublished, records, plan] = raw.map((value) =>
    JSON.parse(value),
  ) as [SeedPage[], Content[], Records, SeoPlan];
  const seed = structuredClone(originalSeed),
    published = structuredClone(originalPublished);
  // Capture original article authors, publication/modification dates and schema
  // extensions before canonicalizing. No prose or keyword strategy is rewritten.
  for (const page of seed.filter((page) => page.content.type === "blog")) {
    const $ = load(page.html);
    const schemas = $('script[type="application/ld+json"]')
      .map((_, node) => {
        try {
          return JSON.parse($(node).text());
        } catch {
          return null;
        }
      })
      .get();
    if (schemas.length && !page.content.structuredData)
      page.content.structuredData = schemas;
    const live = published.find(
      (content) => content.path === page.content.path,
    );
    if (live && schemas.length && !live.structuredData)
      live.structuredData = schemas;
  }
  const result = reconcileContentData(seed, published, records, plan);
  const affected = Object.entries(legacyArticleRoutes).map(([from, to]) => {
    const root = originalSeed.find((page) => page.content.path === from);
    const peer = originalSeed.find((page) => page.content.path === to);
    const rootHtml = root?.html || "";
    const rootBody = load(rootHtml)(".service-content").first().html() || "";
    const bodyText = (value: string) =>
      load(value).text().replace(/\s+/g, " ").trim();
    if (root && peer && bodyText(rootBody) !== bodyText(peer.content.body))
      throw new Error(
        `Unique source article text at ${from}; review it before migration.`,
      );
    return {
      from,
      to,
      evidence:
        "Explicit BlogPosting schema, canonical /blog/ link, matching article text",
      rootEdited: Boolean(records[from]),
      canonicalEdited: Boolean(records[to]),
      bodyTextMatches:
        root && peer
          ? bodyText(rootBody) === bodyText(peer.content.body)
          : null,
      rootTemplateSha256: root ? hash(root.html) : null,
    };
  });
  const report = {
    migration: "article-urls-v1",
    mode: write ? "applied locally; not deployed" : "audit only",
    source: {
      seed: originalSeed.length,
      published: originalPublished.length,
      cmsRecords: Object.keys(records).length,
      draftArticles: Object.values(records).filter(
        (record) => record.draft.type === "blog" && !record.published,
      ).length,
    },
    result: {
      seed: result.seed.length,
      published: result.published.length,
      articles: result.published.filter((page) => page.type === "blog").length,
      pages: result.published.filter((page) => page.type === "page").length,
      cmsRecords: Object.keys(result.records).length,
    },
    affectedCount: affected.length,
    affected,
    inputHashes: Object.fromEntries(
      names.map((name, index) => [name, hash(raw[index])]),
    ),
    conflicts: [],
    productionChanges: false,
  };
  if (write) {
    const currentValues = [
      result.seed,
      result.published,
      result.records,
      result.plan,
    ];
    let legacySourceExists = false;
    for (const path of Object.keys(legacyArticleRoutes)) {
      try {
        await access(path.slice(1));
        legacySourceExists = true;
      } catch {}
    }
    if (
      !legacySourceExists &&
      currentValues.every(
        (value, index) =>
          JSON.stringify(value) === JSON.stringify(JSON.parse(raw[index])),
      )
    ) {
      console.log(
        JSON.stringify({
          migration: "article-urls-v1",
          mode: "already applied locally; no files changed",
          affectedCount: affected.length,
          productionChanges: false,
        }),
      );
      return;
    }
    // All conflict and archive checks finish before modifying any local file.
    for (let index = 0; index < names.length; index++)
      if (
        hash(await readFile(`data/${names[index]}.json`, "utf8")) !==
        report.inputHashes[names[index]]
      )
        throw new Error(
          "Local content changed during migration. Rerun the audit before writing.",
        );
    for (const from of Object.keys(legacyArticleRoutes)) {
      let sourceExists = true;
      try {
        await access(from.slice(1));
      } catch {
        sourceExists = false;
      }
      if (sourceExists) {
        let archiveExists = true;
        try {
          await access("legacy/articles/" + from.slice(1));
        } catch {
          archiveExists = false;
        }
        if (archiveExists)
          throw new Error(
            `Archive already exists for ${from}; review both copies before writing.`,
          );
      }
    }
    await mkdir("migrations/backups", { recursive: true });
    const backup = "migrations/backups/article-urls-v1.json";
    try {
      await access(backup);
    } catch {
      await writeFile(
        backup,
        JSON.stringify({
          inputHashes: report.inputHashes,
          originals: Object.fromEntries(
            names.map((name, index) => [name, JSON.parse(raw[index])]),
          ),
        }),
      );
    }
    const values = [result.seed, result.published, result.records, result.plan];
    for (let index = 0; index < names.length; index++)
      if (
        JSON.stringify(values[index]) !== JSON.stringify(JSON.parse(raw[index]))
      ) {
        const file = `data/${names[index]}.json`;
        const temp = file + ".migration.tmp";
        await writeFile(temp, JSON.stringify(values[index]));
        await rename(temp, file);
      }
    await mkdir("legacy/articles", { recursive: true });
    for (const from of Object.keys(legacyArticleRoutes)) {
      const source = from.slice(1);
      const destination = "legacy/articles/" + source;
      try {
        await access(source);
        await access(destination).then(
          () => {
            throw new Error(`Archive already exists: ${destination}`);
          },
          () => undefined,
        );
        await rename(source, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await mkdir("docs", { recursive: true });
    await writeFile(
      "docs/article-url-audit.json",
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
