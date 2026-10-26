import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptySeoPlan,
  emptyTarget,
  effectiveTarget,
  keywordList,
  validateSeoPlan,
  updateTarget,
  clusterHealth,
  targetChecks,
  type KeywordCluster,
} from "../lib/seo-plan";
import { seedMap } from "../lib/seed";
const primary = "/services/va-disability-claims.html";
const supporting = "/blog/va-claim-denied.html";
const paths = [primary, supporting];
const cluster = (): KeywordCluster => ({
  id: "appeals",
  name: "VA Appeals",
  primaryKeyword: "VA appeal",
  secondaryKeywords: ["VA appeal process"],
  intent: "informational",
  supportingQuestions: ["How do I appeal?"],
  includedTopics: ["Evidence"],
  excludedTerms: [],
  notes: "",
  status: "active",
  createdAt: "2026-10-26T00:00:00Z",
  updatedAt: "2026-10-26T00:00:00Z",
});
test("keyword phrases normalize and deduplicate while preserving the first spelling", () => {
  assert.deepEqual(
    keywordList(" VA   claim,va claim\nVA appeal\n\nva APPEAL"),
    ["VA claim", "VA appeal"],
  );
});
test("existing sites start with an empty, backward-compatible SEO plan", () => {
  assert.deepEqual(validateSeoPlan(emptySeoPlan(), paths), emptySeoPlan());
  assert.equal(
    updateTarget(emptySeoPlan(), primary, emptyTarget(), 0, paths).revision,
    0,
  );
});
test("target updates use revisions, known pages and explicit existing clusters", () => {
  const plan = { ...emptySeoPlan(), clusters: [cluster()] };
  const target = {
    ...emptyTarget(),
    clusterId: "appeals",
    clusterRole: "primary" as const,
  };
  const saved = updateTarget(plan, primary, target, 0, paths);
  assert.equal(saved.revision, 1);
  assert.throws(
    () =>
      updateTarget(
        saved,
        supporting,
        { ...target, clusterRole: "supporting" },
        0,
        paths,
      ),
    /another session/,
  );
  assert.throws(
    () => updateTarget(plan, "/unknown.html", target, 0, paths),
    /unknown page/,
  );
  assert.throws(
    () =>
      updateTarget(
        plan,
        primary,
        { ...target, clusterId: "unknown" },
        0,
        paths,
      ),
    /no longer exists/,
  );
});
test("an active topic has one primary owner; supporting pages do not steal ownership", () => {
  let plan = { ...emptySeoPlan(), clusters: [cluster()] };
  const target = {
    ...emptyTarget(),
    clusterId: "appeals",
    clusterRole: "primary" as const,
  };
  plan = updateTarget(plan, primary, target, 0, paths);
  assert.throws(
    () => updateTarget(plan, supporting, target, 1, paths),
    /already has a primary page/,
  );
  plan = updateTarget(
    plan,
    supporting,
    { ...target, clusterRole: "supporting" },
    1,
    paths,
  );
  assert.equal(plan.targets[primary].clusterRole, "primary");
  assert.equal(plan.targets[supporting].clusterRole, "supporting");
});
test("cluster defaults are available without overwriting page-specific targeting", () => {
  const plan = { ...emptySeoPlan(), clusters: [cluster()] };
  const inherited = effectiveTarget(
    { ...emptyTarget(), clusterId: "appeals" },
    plan,
  );
  assert.equal(inherited.primaryKeyword, "VA appeal");
  assert.equal(inherited.searchIntent, "informational");
  const explicit = effectiveTarget(
    {
      ...inherited,
      primaryKeyword: "VA claim denial",
      secondaryKeywords: ["appeal denial"],
      searchIntent: "commercial",
    },
    plan,
  );
  assert.equal(explicit.primaryKeyword, "VA claim denial");
  assert.deepEqual(explicit.secondaryKeywords, ["appeal denial"]);
  assert.equal(plan.clusters[0].primaryKeyword, "VA appeal");
});
test("planning validation bounds inputs and rejects duplicate IDs, bad intent and dangling assignments", () => {
  assert.throws(
    () =>
      validateSeoPlan(
        { ...emptySeoPlan(), clusters: [cluster(), cluster()] },
        paths,
      ),
    /unique/,
  );
  assert.throws(
    () =>
      validateSeoPlan(
        { ...emptySeoPlan(), clusters: [{ ...cluster(), intent: "invented" }] },
        paths,
      ),
    /intent/,
  );
  assert.throws(
    () =>
      validateSeoPlan(
        {
          ...emptySeoPlan(),
          clusters: [{ ...cluster(), notes: "x".repeat(10001) }],
        },
        paths,
      ),
    /Notes/,
  );
  assert.throws(
    () =>
      validateSeoPlan(
        {
          ...emptySeoPlan(),
          targets: {
            [primary]: { ...emptyTarget(), primaryKeyword: "x".repeat(251) },
          },
        },
        paths,
      ),
    /Primary keyword/,
  );
});
test("cluster review uses real assigned draft links, not a manual coverage checkbox", () => {
  const plan = {
    ...emptySeoPlan(),
    clusters: [cluster()],
    targets: {
      [primary]: {
        ...emptyTarget(),
        clusterId: "appeals",
        clusterRole: "primary" as const,
      },
      [supporting]: {
        ...emptyTarget(),
        clusterId: "appeals",
        clusterRole: "supporting" as const,
      },
    },
  };
  const pages = paths.map((path) =>
    structuredClone(seedMap.get(path)!.content),
  );
  pages[1].body = "<p>No links yet.</p>";
  assert.equal(
    clusterHealth(cluster(), plan, pages, "https://vdallc.com").missingLinks
      .length,
    1,
  );
  pages[1].body = `<p><a href="${primary}#evidence">VA disability claims</a></p>`;
  assert.equal(
    clusterHealth(cluster(), plan, pages, "https://vdallc.com").gaps.length,
    0,
  );
  const checks = targetChecks(pages[1], {
    ...emptyTarget(),
    primaryKeyword: "VA appeal",
    searchIntent: "informational",
  });
  assert.ok(checks.some((check) => check.includes("article text")));
});
