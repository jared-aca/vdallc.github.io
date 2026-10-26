import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { renderPage, renderSitemap } from "../lib/render.ts";
import { seedMap } from "../lib/seed.ts";
const base = process.env.QA_BASE_URL || "http://localhost:3101";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw new Error("Run QA against a local static build.");
const config = JSON.parse(await readFile("cms.config.json", "utf8"));
const baseline = JSON.parse(await readFile("data/published.json", "utf8"));
const repo = `/repos/${config.repository}`;
let files = {
  "data/cms.json": "{}",
  "data/seo-plan.json": JSON.stringify({
    revision: 0,
    clusters: [],
    targets: {},
  }),
  "data/published.json": JSON.stringify(baseline),
};
let head = "commit-0";
let sequence = 0;
const trees = new Map([["tree-0", files]]);
const commits = new Map([
  ["commit-0", { tree: { sha: "tree-0" }, parents: [] }],
]);
const changes = [];
let conflictNext = false;
let previousPages = baseline;
async function updateArtifact(pages) {
  for (const page of previousPages)
    if (!pages.some((item) => item.path === page.path))
      await rm(`out${page.path === "/" ? "/index.html" : page.path}`, {
        force: true,
      });
  for (const content of pages) {
    const file = `out${content.path === "/" ? "/index.html" : content.path}`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, renderPage(content, pages, config.siteUrl));
  }
  await writeFile("out/sitemap.xml", renderSitemap(pages, config.siteUrl));
  previousPages = pages;
}
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
// Exercise the real GitHub transport with a deterministic API fixture. Never
// send a test commit, access token, or API write to the actual repository.
await context.route("https://api.github.com/**", async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const method = request.method();
  const data = request.postDataJSON();
  const reply = (body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  if (request.headers().authorization !== "Bearer vda-qa-fixture")
    return reply({ message: "Bad credentials" }, 401);
  if (path === "/user") return reply({ login: "qa-editor" });
  if (path === repo) return reply({ permissions: { push: true } });
  if (path === repo + "/git/ref/heads/main")
    return reply({ object: { sha: head } });
  if (path.startsWith(repo + "/contents/")) {
    const file = path.slice((repo + "/contents/").length);
    if (!(file in files)) return reply({ message: "Not found" }, 404);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: files[file],
    });
  }
  if (path.startsWith(repo + "/git/commits/") && method === "GET")
    return reply(commits.get(path.split("/").at(-1)));
  if (path === repo + "/git/trees" && method === "POST") {
    const sha = "tree-" + ++sequence;
    const next = { ...trees.get(data.base_tree) };
    for (const item of data.tree) next[item.path] = item.content;
    trees.set(sha, next);
    changes.push(data.tree.map((item) => item.path));
    return reply({ sha });
  }
  if (path === repo + "/git/commits" && method === "POST") {
    const sha = "commit-" + ++sequence;
    commits.set(sha, { tree: { sha: data.tree }, parents: data.parents });
    return reply({ sha });
  }
  if (path === repo + "/git/refs/heads/main" && method === "PATCH") {
    assert.equal(data.force, false);
    if (conflictNext || commits.get(data.sha).parents[0] !== head) {
      conflictNext = false;
      return reply({ message: "Update is not a fast forward" }, 422);
    }
    const previous = files;
    head = data.sha;
    files = trees.get(commits.get(head).tree.sha);
    if (files["data/published.json"] !== previous["data/published.json"])
      await updateArtifact(JSON.parse(files["data/published.json"]));
    return reply({ object: { sha: head } });
  }
  throw new Error("Unexpected GitHub API call: " + method + " " + path);
});
try {
  await mkdir("test-results", { recursive: true });
  await page.goto(base + "/admin/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).waitFor();
  await page.screenshot({ path: "test-results/github-login.png" });
  // OAuth itself is covered by the Worker tests. Set an isolated fixture token
  // for browser editing checks; it is accepted only by the mocked API above.
  await page.evaluate(
    (key) => sessionStorage.setItem(key, "vda-qa-fixture"),
    `vda-github:${config.repository}`,
  );
  await page.reload();
  await page.locator("tbody tr").first().waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/admin-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.ok(
    await page
      .getByRole("button", { name: "Sign out", exact: true })
      .isVisible(),
  );
  await page.screenshot({ path: "test-results/admin-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "New blog post" }).click();
  await page
    .getByLabel("Page title", { exact: true })
    .fill("QA Veterans Guide");
  await page
    .getByLabel("Introduction / excerpt", { exact: true })
    .fill("A useful introduction for the publishing check.");
  await page.getByRole("tab", { name: "SEO & sharing" }).click();
  await page
    .getByLabel("SEO title", { exact: true })
    .fill("QA Search Title | VDA LLC");
  await page
    .getByLabel("Meta description", { exact: true })
    .fill("A useful metadata description for the publishing workflow.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Draft committed" })
    .waitFor();
  assert.deepEqual(changes.at(-1), ["data/cms.json"]);
  assert.equal(
    (await context.request.get(`${base}/blog/qa-veterans-guide.html`)).status(),
    404,
  );
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("dialog", { name: "Draft preview" }).waitFor();
  await page
    .frameLocator("iframe")
    .getByRole("heading", { name: "QA Veterans Guide", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close preview" }).click();
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Publication committed" })
    .waitFor();
  assert.deepEqual(changes.at(-1), ["data/cms.json", "data/published.json"]);
  const request = context.request;
  const html = await (
    await request.get(`${base}/blog/qa-veterans-guide.html`)
  ).text();
  assert.match(html, /<title>QA Search Title \| VDA LLC<\/title>/);
  assert.match(
    await (await request.get(base + "/blog.html")).text(),
    /\/blog\/qa-veterans-guide.html/,
  );
  assert.match(
    await (await request.get(base + "/sitemap.xml")).text(),
    /\/blog\/qa-veterans-guide.html/,
  );
  await page.screenshot({
    path: "test-results/editor-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Content", exact: true }).click();
  await page.getByLabel("Page title", { exact: true }).fill("Follow-up draft");
  conflictNext = true;
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "repository changed" })
    .waitFor();
  assert.equal(
    JSON.parse(files["data/cms.json"])["/blog/qa-veterans-guide.html"].draft
      .title,
    "QA Veterans Guide",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Draft committed" })
    .waitFor();
  assert.ok(
    !(
      await (await request.get(`${base}/blog/qa-veterans-guide.html`)).text()
    ).includes("Follow-up draft"),
  );
  await page.getByRole("tab", { name: "Version history" }).click();
  assert.ok(
    (await page.getByRole("button", { name: "Load version" }).count()) >= 3,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Unpublish page", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Unpublish committed" })
    .waitFor();
  assert.equal(
    (await request.get(`${base}/blog/qa-veterans-guide.html`)).status(),
    404,
  );
  await page.getByRole("button", { name: "Back to content" }).click();
  await page
    .getByRole("navigation", { name: "Content sections" })
    .getByRole("button", { name: "Services" })
    .click();
  await page.getByRole("button", { name: "New service" }).click();
  await page
    .getByLabel("Page title", { exact: true })
    .fill("QA Veterans Support");
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Publication committed" })
    .waitFor();
  assert.match(
    await (
      await request.get(`${base}/services/qa-veterans-support.html`)
    ).text(),
    /"@type":"Service"/,
  );
  assert.match(
    await (await request.get(base + "/")).text(),
    /\/services\/qa-veterans-support.html/,
  );
  await page.getByRole("button", { name: "Back to content" }).click();
  await page
    .getByRole("navigation", { name: "Content sections" })
    .getByRole("button", { name: "SEO & pages" })
    .click();
  await page
    .getByRole("button", { name: "About VDA LLC", exact: true })
    .click();
  await page
    .getByLabel("SEO title", { exact: true })
    .fill("QA About Search Title");
  await page
    .getByLabel("Primary keyword", { exact: true })
    .fill("veterans advocates");
  await page
    .getByLabel("Secondary keywords", { exact: true })
    .fill("VA claims help\nVeterans benefits\nva claims help");
  await page
    .getByLabel("Target keywords", { exact: true })
    .fill("find a VA advocate, accredited veterans advocate");
  await page
    .getByLabel("Search intent", { exact: true })
    .selectOption("commercial");
  await page
    .getByRole("button", { name: "Create a cluster from this primary keyword" })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Cluster created" })
    .waitFor();
  assert.deepEqual(changes.at(-1), ["data/seo-plan.json"]);

  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Publication committed" })
    .waitFor();
  assert.match(
    await (await request.get(base + "/about.html")).text(),
    /<title>QA About Search Title<\/title>/,
  );
  let planning = JSON.parse(files["data/seo-plan.json"]);
  assert.equal(
    planning.targets["/about.html"].primaryKeyword,
    "veterans advocates",
  );
  assert.equal(planning.targets["/about.html"].secondaryKeywords.length, 2);
  assert.equal(planning.targets["/about.html"].clusterRole, "primary");
  assert.ok(changes.at(-1).includes("data/seo-plan.json"));
  assert.ok(
    !JSON.parse(files["data/published.json"]).find(
      (page) => page.path === "/about.html",
    ).seo.primaryKeyword,
  );
  await page.getByRole("button", { name: "Back to content" }).click();
  await page
    .getByRole("navigation", { name: "Content sections" })
    .getByRole("button", { name: "Keywords & clusters" })
    .click();
  await page
    .getByRole("heading", { name: "Keywords & clusters", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "New cluster", exact: false }).click();
  await page.getByLabel("Cluster name", { exact: true }).fill("QA VA Appeals");
  await page
    .getByLabel("Cluster primary keyword", { exact: true })
    .fill("VA appeal denied");
  await page
    .getByLabel("Cluster supporting keywords", { exact: true })
    .fill("VA appeal process\nsupplemental VA claim");
  await page
    .getByLabel("Primary topic page", { exact: true })
    .selectOption("/services/va-disability-claims.html");
  await page
    .getByLabel("Supporting pages", { exact: true })
    .selectOption(["/blog/va-claim-denied.html"]);
  await page
    .getByLabel("Supporting questions", { exact: true })
    .fill("What happens after a VA claim denial?");
  await page
    .getByLabel("Included topics", { exact: true })
    .fill("appeal lanes\nevidence");
  await page
    .getByLabel("Excluded terms", { exact: true })
    .fill("social security");
  await page
    .getByLabel("Cluster notes", { exact: true })
    .fill("Review evidence and add links before publishing changes.");
  await page.getByRole("button", { name: "Save cluster", exact: true }).click();
  await page
    .locator(".cluster-card")
    .filter({ hasText: "QA VA Appeals" })
    .waitFor();
  assert.deepEqual(changes.at(-1), ["data/seo-plan.json"]);
  planning = JSON.parse(files["data/seo-plan.json"]);
  const appeals = planning.clusters.find(
    (cluster) => cluster.name === "QA VA Appeals",
  );
  assert.equal(
    planning.targets["/services/va-disability-claims.html"].clusterRole,
    "primary",
  );
  assert.equal(
    planning.targets["/blog/va-claim-denied.html"].clusterId,
    appeals.id,
  );
  assert.equal(
    planning.targets["/blog/va-claim-denied.html"].clusterRole,
    "supporting",
  );
  await page.screenshot({
    path: "test-results/seo-clusters-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-results/seo-clusters-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator(".cluster-card")
    .filter({ hasText: "QA VA Appeals" })
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await page
    .getByLabel("Cluster status", { exact: true })
    .selectOption("archived");
  await page
    .locator(".cluster-card")
    .filter({ hasText: "QA VA Appeals" })
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await page
    .getByLabel("Cluster status", { exact: true })
    .selectOption("active");
  await page.getByRole("button", { name: "Refresh plan", exact: true }).click();
  await page
    .locator(".cluster-card")
    .filter({ hasText: "veterans advocates" })
    .getByRole("button", { name: "About VDA LLC", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Primary keyword", { exact: true }).inputValue(),
    "veterans advocates",
  );
  assert.equal(
    await page.getByLabel("Role in cluster", { exact: true }).inputValue(),
    "primary",
  );
  assert.equal(
    await page.getByLabel("Secondary keywords", { exact: true }).inputValue(),
    "VA claims help\nVeterans benefits",
  );
  assert.ok(
    !(await (await request.get(base + "/about.html")).text()).includes(
      'name="keywords"',
    ),
  );
  for (const { content } of seedMap.values())
    assert.equal(
      (await request.get(base + content.path)).status(),
      200,
      content.path,
    );
  for (const path of [
    "/data/cms.json",
    "/data/seo-plan.json",
    "/data/published.json",
    "/oauth-worker/index.ts",
    "/.env.local",
  ])
    assert.equal((await request.get(base + path)).status(), 404, path);
  const publicPage = await context.newPage();
  publicPage.on("pageerror", (error) => errors.push(error.message));
  await publicPage.goto(base + "/va-disability-calculator.html");
  await publicPage
    .locator("#rating-buttons")
    .getByRole("button", { name: "50%", exact: true })
    .click();
  await publicPage
    .locator("#rating-buttons")
    .getByRole("button", { name: "30%", exact: true })
    .click();
  assert.equal(await publicPage.locator("#gauge-number").textContent(), "70%");
  await publicPage.goto(base + "/va-back-pay-calculator.html");
  await publicPage.locator("#effective").fill("2025-01-01");
  await publicPage.locator("#end-date").fill("2025-03-01");
  await publicPage.locator("#owed").selectOption("70");
  await publicPage.locator("#paid").selectOption("0");
  await publicPage.locator('input[name="married"][value="no"]').check();
  await publicPage.locator("#calculate").click();
  assert.notEqual(
    await publicPage.locator("#retro-result").textContent(),
    "$0.00",
  );
  await publicPage.close();
  await page.getByRole("button", { name: "Back to content" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign in with GitHub" }).waitFor();
  assert.equal(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      `vda-github:${config.repository}`,
    ),
    null,
  );
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(
    "PASS: static-site browser QA using a mocked GitHub API: keyword targeting, cluster creation/assignment/archive/restore, planning-only commits, drafts, previews, atomic commits, branch conflicts, posts, services, SEO, listings, sitemap, mobile layout, all 51 routes, both calculators, and logout.",
  );
} finally {
  await browser.close();
  await updateArtifact(baseline);
}
