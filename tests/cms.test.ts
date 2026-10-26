import { test } from "node:test";
import assert from "node:assert/strict";
import { seedMap, seedPages } from "../lib/seed";
import { cleanBody, validateContent } from "../lib/validation";
import { renderPage, renderSitemap } from "../lib/render";
import { applyEdit, recordFor } from "../lib/records";
import oauth, { type OAuthEnv } from "../oauth-worker/index";
const published = () => seedPages.map((page) => structuredClone(page.content));
const example = () =>
  structuredClone(seedMap.get("/blog/va-ptsd-rating-criteria.html")!.content);

test("imports all existing routes with editable post/service bodies", () => {
  assert.equal(seedPages.length, 41);
  assert.equal(seedPages.filter((p) => p.content.type === "blog").length, 27);
  assert.equal(seedPages.filter((p) => p.content.type === "service").length, 5);
  for (const page of seedPages)
    assert.doesNotThrow(() => validateContent(page.content), page.content.path);
});
test("rejects unsafe paths and URLs and sanitizes submitted article HTML", () => {
  const content = example();
  assert.throws(() =>
    validateContent({ ...content, path: "/blog/../admin.html" }),
  );
  assert.throws(() =>
    validateContent({ ...content, image: "javascript:alert(1)" }),
  );
  assert.throws(() =>
    validateContent({
      ...content,
      seo: { ...content.seo, canonical: "//evil.example" },
    }),
  );
  assert.throws(() => validateContent({ ...content, date: "2026-02-31" }));
  const html = cleanBody(
    '<script>alert(1)</script><h2 id="evidence">Evidence</h2><img src="/image.webp" onerror="alert(1)"><a href="javascript:alert(1)">Bad link</a><p>Keep this.</p>',
  );
  assert.ok(
    !html.includes("<script") &&
      !html.includes("onerror") &&
      !html.includes("javascript:"),
  );
  assert.ok(html.includes('id="evidence"') && html.includes("Keep this."));
});
test("drafts do not change published content; revisions, original versions, publish and unpublish are preserved", () => {
  const content = example();
  const originalTitle = content.title;
  content.title = "Draft title";
  let state = applyEdit({}, published(), {
    content,
    action: "draft",
    revision: 0,
  });
  assert.equal(state.record.draft.title, "Draft title");
  assert.equal(
    state.published.find((p) => p.path === content.path)!.title,
    originalTitle,
  );
  assert.throws(
    () =>
      applyEdit(state.records, state.published, {
        content,
        action: "publish",
        revision: 0,
      }),
    /another session/,
  );
  state = applyEdit(state.records, state.published, {
    content,
    action: "publish",
    revision: state.record.revision,
  });
  assert.equal(
    state.published.find((p) => p.path === content.path)!.title,
    "Draft title",
  );
  state = applyEdit(state.records, state.published, {
    content,
    action: "unpublish",
    revision: state.record.revision,
  });
  assert.ok(!state.published.some((p) => p.path === content.path));
  assert.ok(
    recordFor(content.path, state.records, state.published)!.draft.body,
  );
  assert.ok(state.record.versions.some((v) => v.action === "original"));
});
test("new posts/services populate public listings, navigation and sitemap only when published", () => {
  for (const type of ["blog", "service"] as const) {
    const content = {
      ...example(),
      type,
      path: `/${type === "blog" ? "blog" : "services"}/new-content.html`,
      title: "New content",
      seo: { ...example().seo, canonical: "" },
    };
    let state = applyEdit({}, published(), {
      content,
      action: "draft",
      revision: 0,
      create: true,
    });
    assert.ok(!state.published.some((p) => p.path === content.path));
    assert.throws(
      () =>
        applyEdit(state.records, state.published, {
          content,
          action: "draft",
          revision: 0,
          create: true,
        }),
      /already exists/,
    );
    state = applyEdit(state.records, state.published, {
      content,
      action: "publish",
      revision: state.record.revision,
    });
    const html = renderPage(
      seedMap.get(type === "blog" ? "/blog.html" : "/")!.content,
      state.published,
      "https://vdallc.com",
    );
    assert.ok(html.includes(content.path));
    assert.ok(
      renderSitemap(state.published, "https://vdallc.com").includes(
        content.path,
      ),
    );
  }
});
test("standard pages allow SEO edits while preserving layout and calculator content", () => {
  const content = {
    ...seedMap.get("/about.html")!.content,
    title: "Do not replace the visible title",
    body: "<p>Do not replace the layout</p>",
    seo: {
      ...seedMap.get("/about.html")!.content.seo,
      title: "New SEO title",
      noindex: true,
    },
  };
  const state = applyEdit({}, published(), {
    content,
    action: "publish",
    revision: 0,
  });
  assert.notEqual(state.record.draft.title, content.title);
  const html = renderPage(
    state.record.published!,
    state.published,
    "https://vdallc.com",
  );
  assert.match(html, /<title>New SEO title<\/title>/);
  assert.match(html, /name="robots" content="noindex, follow"/);
  assert.ok(
    !renderSitemap(state.published, "https://vdallc.com").includes(
      "/about.html",
    ),
  );
});
test("server-generated SEO, social sharing, schema and canonical exclusions remain valid", () => {
  const content = example();
  content.seo = {
    ...content.seo,
    title: "SEO & <title>",
    socialTitle: "Social title",
    socialImage: "/img/test.webp",
  };
  const html = renderPage(content, [content], "https://vdallc.com");
  assert.match(html, /SEO &amp; &lt;title&gt;/);
  assert.match(html, /property="og:title" content="Social title"/);
  assert.match(
    html,
    /property="og:image" content="https:\/\/vdallc.com\/img\/test.webp"/,
  );
  assert.match(html, /"@type":"BlogPosting"/);
  content.seo.canonical = "https://vdallc.com/another-page.html";
  assert.ok(
    renderSitemap([content], "https://vdallc.com").includes(content.path),
  );
});
const env: OAuthEnv = {
  GITHUB_CLIENT_ID: "test-client",
  GITHUB_CLIENT_SECRET: "test-secret",
  CMS_ORIGIN: "https://vdallc.com",
  GITHUB_REPO: "jared-aca/vdallc.github.io",
};
test("OAuth authorization uses PKCE, state and a secure HttpOnly cookie; invalid callbacks cannot return tokens", async () => {
  const response = await oauth.fetch(
    new Request("https://auth.example/auth"),
    env,
  );
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get("location")!);
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("state"));
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  const invalid = await oauth.fetch(
    new Request("https://auth.example/callback?state=wrong&code=untrusted", {
      headers: { cookie: cookie.split(";")[0] },
    }),
    env,
  );
  const body = await invalid.text();
  assert.match(body, /did not match/);
  assert.ok(!body.includes('"token":'));
});
test("OAuth callback exchanges the code server-side, checks repository write access and posts only to the configured CMS origin", async (t) => {
  const start = await oauth.fetch(
    new Request("https://auth.example/auth"),
    env,
  );
  const state = new URL(start.headers.get("location")!).searchParams.get(
    "state",
  );
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://github.com/login/oauth/access_token") {
        const data = JSON.parse(options!.body as string);
        assert.equal(data.client_secret, env.GITHUB_CLIENT_SECRET);
        assert.ok(data.code_verifier);
        return Response.json({ access_token: "test-access-token" });
      }
      return Response.json({ permissions: { push: true } });
    },
  );
  const response = await oauth.fetch(
    new Request(`https://auth.example/callback?state=${state}&code=test-code`, {
      headers: { cookie },
    }),
    env,
  );
  const body = await response.text();
  assert.match(body, /"token":"test-access-token"/);
  assert.match(body, /"https:\/\/vdallc.com"/);
  assert.equal(calls.length, 2);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
});
test("OAuth denies accounts without repository write permission", async (t) => {
  const start = await oauth.fetch(
    new Request("https://auth.example/auth"),
    env,
  );
  const state = new URL(start.headers.get("location")!).searchParams.get(
    "state",
  );
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    String(input).includes("/access_token")
      ? Response.json({ access_token: "unprivileged-token" })
      : Response.json({ permissions: { push: false } }),
  );
  const response = await oauth.fetch(
    new Request(`https://auth.example/callback?state=${state}&code=test-code`, {
      headers: { cookie },
    }),
    env,
  );
  const body = await response.text();
  assert.match(body, /needs write access/);
  assert.ok(!body.includes("unprivileged-token") && !body.includes('"token":'));
});
