import assert from "node:assert/strict";
import test from "node:test";
import {
  articleContentSignature,
  decideStagedAliasRelease,
} from "../lib/staged-article-release";

const expectedLocation =
  "https://vdallc.com/blog/hearing-loss.html?vda_stage_check=1";
const liveArticle =
  '<main><h1>Hearing Loss Ratings</h1><div class="service-content"><p>Preserved text.</p></div><div class="page-hero-bg"><img src="/img/article.webp" alt="Hearing"><\/div></main>';
const stagedArticle =
  '<main><h1>Hearing Loss Ratings</h1><div class="service-content"><p>Preserved text.</p></div><div class="page-hero-bg"><img src="/img/article.webp" alt="Hearing"><\/div></main>';

test("staged mode preserves matching live aliases and permits current 404 recovery", () => {
  assert.equal(
    decideStagedAliasRelease({
      status: 200,
      location: null,
      expectedLocation,
      liveContent: articleContentSignature(liveArticle),
      canonicalContent: articleContentSignature(stagedArticle),
    }).kind,
    "preserved",
  );
  assert.equal(
    decideStagedAliasRelease({
      status: 404,
      location: null,
      expectedLocation,
    }).kind,
    "restore",
  );
});

test("staged mode blocks changed live content and incorrect redirects", () => {
  const contentConflict = decideStagedAliasRelease({
    status: 200,
    location: null,
    expectedLocation,
    liveContent: articleContentSignature(
      liveArticle.replace("Preserved text.", "Different live text."),
    ),
    canonicalContent: articleContentSignature(stagedArticle),
  });
  assert.equal(contentConflict.kind, "block");

  const wrongRedirect = decideStagedAliasRelease({
    status: 301,
    location: "https://vdallc.com/about.html",
    expectedLocation,
  });
  assert.equal(wrongRedirect.kind, "block");
});

test("staged mode accepts only an exact canonical 301 and blocks unknown statuses", () => {
  assert.equal(
    decideStagedAliasRelease({
      status: 301,
      location: expectedLocation,
      expectedLocation,
      canonicalContent: articleContentSignature(stagedArticle),
    }).kind,
    "redirected",
  );
  assert.equal(
    decideStagedAliasRelease({
      status: 503,
      location: null,
      expectedLocation,
      canonicalContent: articleContentSignature(stagedArticle),
    }).kind,
    "block",
  );
});
