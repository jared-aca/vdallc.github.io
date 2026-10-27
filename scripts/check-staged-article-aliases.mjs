import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import {
  articleContentSignature,
  decideStagedAliasRelease,
} from "../lib/staged-article-release.ts";

const routes = JSON.parse(await readFile("data/article-routes.json", "utf8"));
const config = JSON.parse(await readFile("cms.config.json", "utf8"));
const origin = process.env.REDIRECT_CHECK_ORIGIN || config.siteUrl;
const failures = [];
const outcomes = [];

for (const [alias, canonical] of Object.entries(routes)) {
  const expected = new URL(canonical, origin);
  const aliasFile = `out${alias}`;
  const canonicalFile = `out${canonical}`;
  let stagedHtml;

  try {
    stagedHtml = await readFile(aliasFile, "utf8");
    const canonicalHtml = await readFile(canonicalFile, "utf8");
    const $alias = load(stagedHtml);
    if (stagedHtml !== canonicalHtml)
      throw new Error("staged page differs from its canonical article");
    if ($alias('link[rel="canonical"]').attr("href") !== expected.href)
      throw new Error(`staged page must canonicalize to ${expected.href}`);
    if ($alias('meta[name="description"]').length !== 1)
      throw new Error("staged page must retain its article description");
  } catch (error) {
    failures.push(`${alias}: ${error.message}`);
    continue;
  }

  try {
    const canonicalResponse = await fetch(expected, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "Cache-Control": "no-cache" },
    });
    if (canonicalResponse.status !== 200) {
      failures.push(
        `${canonical.pathname}: canonical article must return 200 before staging; got ${canonicalResponse.status}`,
      );
      continue;
    }
    const canonicalHtml = await canonicalResponse.text();

    const source = new URL(alias, origin);
    source.searchParams.set("vda_stage_check", "1");
    const response = await fetch(source, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "Cache-Control": "no-cache" },
    });
    const destination = response.headers.get("location")
      ? new URL(response.headers.get("location"), source).href
      : null;
    const targetWithQuery = new URL(expected);
    targetWithQuery.search = source.search;
    const liveHtml = response.status === 200 ? await response.text() : undefined;
    const decision = decideStagedAliasRelease({
      status: response.status,
      location: destination,
      expectedLocation: targetWithQuery.href,
      liveContent: liveHtml && articleContentSignature(liveHtml),
      canonicalContent: articleContentSignature(canonicalHtml),
    });
    if (decision.kind === "block") failures.push(`${alias}: ${decision.reason}`);
    else if (decision.kind === "redirected")
      outcomes.push(`${alias}: already redirects directly to its canonical`);
    else if (decision.kind === "preserved")
      outcomes.push(
        `${alias}: live 200 content is preserved by a canonical-tagged compatibility page`,
      );
    else
      outcomes.push(
        `${alias}: already 404; staged artifact will restore it as a canonical-tagged compatibility page`,
      );
  } catch (error) {
    failures.push(`${alias}: ${error.message}`);
  }
}

if (failures.length) {
  console.error("Staged article release blocked; no alias will be allowed to regress.");
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  for (const outcome of outcomes) console.log(`STAGED: ${outcome}`);
  console.log(
    `PASS: the staged artifact safely resolves all ${Object.keys(routes).length} legacy URLs; current 404s are reported, and live content cannot regress. The strict all-301 check remains separate for the final migration.`,
  );
}
