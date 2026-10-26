import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
import backups from "../migrations/backups/article-urls-v1.json";
import { readFileSync } from "node:fs";
const routes = JSON.parse(
  readFileSync("redirect-worker/wrangler.jsonc", "utf8"),
) as { routes: { pattern: string }[] };
import {
  articlePath,
  contentIdentity,
  canonicalUrl,
  legacyArticleRoutes,
  articleRedirect,
  rewriteLegacyLink,
} from "../lib/content-urls";
import {
  reconcileContentData,
  ReconciliationConflict,
} from "../lib/content-reconciliation";
import { allRecords, applyEdit, type Records } from "../lib/records";
import { validateContent } from "../lib/validation";
import { seedPages, seedMap } from "../lib/seed";
import { renderPage, renderSitemap } from "../lib/render";
import { emptySeoPlan, emptyTarget, type SeoPlan } from "../lib/seo-plan";
import type { Content, RecordEntry, SeedPage } from "../lib/model";
import redirectWorker from "../redirect-worker/index";
const from = "/va-hearing-loss-rating.html",
  to = "/blog/va-hearing-loss-rating.html";
const originals = backups.originals;
const oldSeed = originals.seed as SeedPage[];
const oldPublished = originals.published as Content[];
const canonical = () =>
  structuredClone(oldPublished.find((page) => page.path === to)!);
const root = () =>
  structuredClone(oldPublished.find((page) => page.path === from)!);
const record = (content: Content, id: string): RecordEntry => ({
  draft: structuredClone(content),
  published: structuredClone(content),
  revision: 1,
  updatedAt: "2026-10-26T00:00:00Z",
  versions: [
    {
      id,
      at: "2026-10-26T00:00:00Z",
      action: "draft",
      content: structuredClone(content),
    },
  ],
});
test("all ten legacy identities are explicit; real pages and archive retain their routes", () => {
  assert.equal(Object.keys(legacyArticleRoutes).length, 10);
  assert.equal(articlePath("va-hearing-loss-rating"), to);
  assert.deepEqual(contentIdentity({ path: from, type: "page" }), {
    path: to,
    type: "blog",
  });
  for (const path of [
    "/",
    "/about.html",
    "/blog.html",
    "/calculators.html",
    "/va-back-pay-calculator.html",
  ])
    assert.deepEqual(contentIdentity({ path, type: "page" }), {
      path,
      type: "page",
    });
  assert.throws(() => articlePath("../about"));
  assert.throws(() => articlePath(""));
});
test("reconciliation removes duplicate records but preserves every canonical article and genuine page edit", () => {
  const result = reconcileContentData(
    oldSeed,
    oldPublished,
    originals.cms as Records,
    originals["seo-plan"] as SeoPlan,
  );
  assert.equal(result.published.length, 41);
  assert.equal(
    result.published.filter((page) => page.type === "blog").length,
    27,
  );
  assert.equal(
    result.published.filter((page) => page.type === "page").length,
    9,
  );
  assert.deepEqual(result.records, originals.cms);
  assert.deepEqual(result.plan, originals["seo-plan"]);
  for (const article of oldPublished.filter((page) => page.type === "blog"))
    assert.deepEqual(
      result.published.find((page) => page.path === article.path),
      article,
    );
  const admin = allRecords(result.records, result.published);
  assert.equal(admin.filter((record) => record.draft.path === to).length, 1);
  assert.ok(!admin.some((record) => record.draft.path === from));
  assert.equal(
    admin.find((record) => record.draft.path === to)!.draft.type,
    "blog",
  );
});
test("non-overlapping duplicate metadata edits and all saved history are reconciled without changing article prose", () => {
  const legacy = root(),
    peer = canonical();
  legacy.seo.description = "Unique root description";
  peer.seo.title = "Unique canonical title";
  const records = {
    [from]: record(legacy, "root-history"),
    [to]: record(peer, "canonical-history"),
  };
  const result = reconcileContentData(
    oldSeed,
    oldPublished,
    records,
    emptySeoPlan(),
  );
  const saved = result.records[to];
  assert.equal(saved.draft.seo.title, "Unique canonical title");
  assert.equal(saved.draft.seo.description, "Unique root description");
  assert.equal(saved.draft.body, canonical().body);
  assert.equal(saved.draft.category, canonical().category);
  assert.equal(saved.draft.date, canonical().date);
  assert.equal(saved.versions.length, 2);
  assert.ok(!result.records[from]);
  assert.equal(records[from].draft.path, from, "inputs are not mutated");
});
test("conflicting saved edits and publication states fail closed and retain the input records", () => {
  const legacy = root(),
    peer = canonical();
  legacy.seo.title = "Root-only edit";
  peer.seo.title = "Different canonical edit";
  const records = {
    [from]: record(legacy, "root"),
    [to]: record(peer, "peer"),
  };
  assert.throws(
    () => reconcileContentData(oldSeed, oldPublished, records, emptySeoPlan()),
    ReconciliationConflict,
  );
  assert.equal(records[from].draft.seo.title, "Root-only edit");
  assert.equal(records[to].draft.seo.title, "Different canonical edit");
  records[from] = { ...record(root(), "root"), published: null };
  assert.throws(
    () => reconcileContentData(oldSeed, oldPublished, records, emptySeoPlan()),
    /publication states/,
  );
});
test("draft-only articles stay available in the CMS without entering public output", () => {
  const article = {
    ...canonical(),
    path: articlePath("draft-only"),
    seo: { ...canonical().seo, canonical: "" },
  };
  const draft = { ...record(article, "draft"), published: null };
  const result = reconcileContentData(
    seedPages,
    seedPages.map((page) => page.content),
    { [article.path]: draft },
    emptySeoPlan(),
  );
  assert.ok(
    allRecords(result.records, result.published).some(
      (record) => record.draft.path === article.path,
    ),
  );
  assert.ok(!result.published.some((page) => page.path === article.path));
});
test("keyword strategy moves to the canonical record intact; differing strategies are never overwritten", () => {
  const target = {
    ...emptyTarget(),
    primaryKeyword: "VA hearing loss rating",
    secondaryKeywords: ["hearing test"],
    targetKeywords: ["VA hearing claims"],
  };
  const plan = { ...emptySeoPlan(), targets: { [from]: target } };
  const result = reconcileContentData(oldSeed, oldPublished, {}, plan);
  assert.deepEqual(result.plan.targets[to], target);
  assert.ok(!result.plan.targets[from]);
  assert.throws(
    () =>
      reconcileContentData(
        oldSeed,
        oldPublished,
        {},
        {
          ...plan,
          targets: {
            ...plan.targets,
            [to]: { ...target, primaryKeyword: "Different saved strategy" },
          },
        },
      ),
    /Conflicting keyword targets/,
  );
});
test("migration is idempotent and remains compatible with older clients writing an audited legacy record", () => {
  const first = reconcileContentData(
    oldSeed,
    oldPublished,
    originals.cms as Records,
    originals["seo-plan"] as SeoPlan,
  );
  const next = reconcileContentData(
    first.seed,
    first.published,
    first.records,
    first.plan,
  );
  assert.deepEqual(next.published, first.published);
  assert.deepEqual(next.records, first.records);
  assert.deepEqual(next.plan, first.plan);
  const legacy = root();
  legacy.seo.description = "An older editor saved this description";
  const updated = reconcileContentData(
    [],
    first.published,
    { ...first.records, [from]: record(legacy, "legacy-write") },
    first.plan,
  );
  assert.equal(updated.records[to].draft.body, canonical().body);
  assert.equal(
    updated.records[to].draft.seo.description,
    legacy.seo.description,
  );
});
test("creation rejects reserved root aliases, wrong types, duplicate canonical routes and conflicting article canonicals", () => {
  assert.throws(() => validateContent(root()), /reserved/);
  assert.throws(
    () => validateContent({ ...canonical(), path: from }),
    /reserved/,
  );
  assert.throws(
    () => validateContent({ ...canonical(), type: "page" }),
    /page URL/,
  );
  assert.throws(
    () =>
      validateContent({
        ...canonical(),
        seo: { ...canonical().seo, canonical: "https://vdallc.com/about.html" },
      }),
    /self-referencing/,
  );
  assert.throws(
    () =>
      applyEdit(
        {},
        seedPages.map((page) => page.content),
        { content: canonical(), revision: 0, action: "draft", create: true },
      ),
    /already exists/,
  );
});
test("canonical, social and structured URLs agree, retain original authors/dates, and internal links skip legacy aliases", () => {
  const article = structuredClone(seedMap.get(to)!.content);
  article.body += `<p><a href="${from}?source=article#hearing">Existing contextual link</a></p>`;
  const $ = load(
    renderPage(
      article,
      seedPages.map((page) => page.content),
      "https://vdallc.com",
    ),
  );
  assert.equal($('link[rel="canonical"]').length, 1);
  assert.equal(
    $('link[rel="canonical"]').attr("href"),
    "https://vdallc.com" + to,
  );
  assert.equal(
    $('meta[property="og:url"]').attr("content"),
    "https://vdallc.com" + to,
  );
  const schemas = $('script[type="application/ld+json"]')
    .map((_, node) => JSON.parse($(node).text()))
    .get();
  assert.equal(
    schemas.filter((schema) => schema["@type"] === "BlogPosting").length,
    1,
  );
  const schema = schemas.find((schema) => schema["@type"] === "BlogPosting");
  assert.deepEqual(schema.author, { "@type": "Organization", name: "VDA LLC" });
  assert.equal(schema.dateModified, "2026-10-15");
  assert.equal(schema.mainEntityOfPage, "https://vdallc.com" + to);
  assert.equal(schema.url, "https://vdallc.com" + to);
  assert.ok($(`a[href="${to}?source=article#hearing"]`).length);
  assert.equal(
    canonicalUrl({
      ...article,
      seo: { ...article.seo, canonical: "https://vdallc.com" + from },
    }),
    "https://vdallc.com" + to,
  );
});
test("sitemap and archive contain canonical articles once, never old root aliases", () => {
  const pages = seedPages.map((page) => page.content);
  const xml = renderSitemap(
    [...pages, canonical(), root()],
    "https://vdallc.com",
  );
  const $ = load(xml, { xml: true });
  const paths = $("loc")
    .map((_, node) => new URL($(node).text()).pathname)
    .get();
  assert.equal(paths.filter((path) => path === to).length, 1);
  assert.ok(!paths.some((path) => legacyArticleRoutes[path]));
  const archive = load(
    renderPage(seedMap.get("/blog.html")!.content, pages, "https://vdallc.com"),
  );
  assert.equal(archive(`.insights-grid-full a[href="${to}"]`).length, 1);
});
test("HTTP 301 handler redirects only the audited legacy routes directly and preserves query strings", async (t) => {
  for (const [old, destination] of Object.entries(legacyArticleRoutes)) {
    assert.equal(
      articleRedirect(`https://vdallc.com${old}?utm_source=old#detail`),
      `https://vdallc.com${destination}?utm_source=old#detail`,
    );
    for (const method of ["GET", "HEAD"]) {
      const response = await redirectWorker.fetch(
        new Request(`https://vdallc.com${old}?utm_source=old`, { method }),
      );
      assert.equal(response.status, 301);
      assert.equal(
        response.headers.get("location"),
        `https://vdallc.com${destination}?utm_source=old`,
      );
      assert.equal(
        articleRedirect(response.headers.get("location")!),
        null,
        "no redirect chain",
      );
    }
  }
  let passed = 0;
  t.mock.method(globalThis, "fetch", async () => {
    passed++;
    return new Response("GitHub Pages origin");
  });
  for (const path of ["/about.html", "/blog.html", to, "/unknown.html"]) {
    assert.equal(articleRedirect("https://vdallc.com" + path), null);
    const response = await redirectWorker.fetch(
      new Request("https://vdallc.com" + path),
    );
    assert.equal(await response.text(), "GitHub Pages origin");
  }
  assert.equal(passed, 4);
});
test("edge route configuration covers exactly the audited aliases on apex and www, including query suffixes", () => {
  const expected = Object.keys(legacyArticleRoutes).flatMap((path) =>
    ["vdallc.com", "www.vdallc.com"].map((host) => host + path + "*"),
  );
  assert.deepEqual(
    routes.routes.map((route) => route.pattern).sort(),
    expected.sort(),
  );
  assert.equal(rewriteLegacyLink(from, "/about.html"), to);
  assert.equal(
    rewriteLegacyLink("https://other.example" + from, "/about.html"),
    "https://other.example" + from,
  );
  assert.equal(rewriteLegacyLink("/about.html", to), "/about.html");
  assert.equal(
    rewriteLegacyLink(
      "http://www.vdallc.com" + from + "#detail",
      "/about.html",
    ),
    "https://vdallc.com" + to + "#detail",
  );
});

test("conflicting published rows sharing one URL are never silently collapsed", () => {
  const peer = canonical();
  assert.throws(
    () =>
      reconcileContentData(
        oldSeed,
        [...oldPublished, { ...peer, title: "Different saved content" }],
        {},
        emptySeoPlan(),
      ),
    /share URL/,
  );
});
