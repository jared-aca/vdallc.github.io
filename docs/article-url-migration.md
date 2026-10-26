# Article URL and CMS classification fix

## Audit and root cause

The original source contained ten root-level article HTML files and ten corresponding `/blog/` files. Each root copy carried `BlogPosting` JSON-LD, explicitly declared the `/blog/` canonical, and contained the same article text as its canonical peer. The import script classified every root HTML file as a `page`, leaving article `body` empty in the Page record while retaining the full HTML template. `data/seed.json` and `data/published.json` therefore contained both identities, the admin displayed the root versions under Pages, and the static exporter served both with HTTP 200. Root rendering also retained the original article schema while adding WebPage schema. This was a legacy-source/import/export issue, not a database or redirect issue.

The audit covers **27 published articles, zero draft-only article CMS records, four saved genuine-page CMS records and four keyword clusters** in the checked snapshot. **Ten articles are duplicated**, not just hearing loss. Their mapping and evidence are in [article-url-audit.json](article-url-audit.json). No affected alias had a saved CMS override or keyword assignment; the four edited genuine pages and all strategy data are preserved byte-for-value.

Counts change from 51 to 41 active content records: **27 articles, nine genuine pages, five services**. The homepage, `/blog.html`, genuine page URLs, and service URLs remain unchanged. There are no alias collisions with genuine pages. The original sitemap already preferred canonical article URLs; the fix also prevents duplicates and wrong article canonicals in future sitemap generation.

## Local changes applied

- `data/article-routes.json` explicitly identifies only the ten confirmed legacy aliases. No filename-only or blanket `.html` redirect rule is used.
- `lib/content-urls.ts` centralizes article paths, canonical URLs, legacy identity lookup, link rewriting and redirect destinations.
- The local JSON migration removes the ten alias records, preserves every canonical article's text, dates, categories and SEO metadata, and captures original article structured data including authors and modification dates.
- Full pre-migration JSON is retained in `migrations/backups/article-urls-v1.json`; original root HTML files were moved intact into `legacy/articles/`. Historical import baselines support safe reconciliation if an older open admin client writes a legacy alias later.
- Reconciliation combines non-overlapping saved edits and history, migrates keyword targets to the canonical identity, and stops on differing edits to the same field, incompatible publication states or different keyword strategies. It never silently chooses a winner or trims migration history. Conflicts leave original inputs available for explicit review.
- The importer skips registered aliases, refuses unregistered root article schemas, and uses canonical article paths. CMS reads, creation, edits, previews, contextual links, cards, related links, schema, social URLs and sitemap output use the shared identity/URL helpers. Article canonicals are self-referencing and cannot be changed to another route in the editor. Temporarily invalid new slugs show validation errors without crashing the editor.
- Generated output contains the canonical pages only. Stale root alias files and old alias preview templates are removed. No JavaScript/meta-refresh file is substituted for a server 301.
- No CSS, site design, article prose or keyword strategy was changed. Existing edit, publish, unpublish, draft, preview, conflict detection, version history and keyword/cluster workflows remain covered by regression tests.

There is **no database migration**. `npm run migrate:articles` applies the source JSON/filesystem migration locally. It has already been applied locally, **not to production**. `npm run audit:articles` is read-only. Reconciliation is idempotent. Before a future approved rollout, fetch the latest repository data and rerun the audit against it so newer editor commits cannot be overwritten by this local snapshot.

## Production hosting constraint and prepared 301 implementation

Inspection found:

- Next.js uses `output: 'export'`; `.github/workflows/pages.yml` builds `out/` for GitHub Pages.
- The site currently resolves directly to GitHub Pages A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
- Authoritative nameservers are currently `ns-cloud-d1` through `ns-cloud-d4.googledomains.com`, not a proxied Cloudflare zone.
- Live checks still return HTTP 200 for both hearing-loss URLs. No production change has been made during this task.

**GitHub Pages cannot implement custom HTTP 301 rules for this static export.** A Next.js `redirects()` entry, `_redirects` file, JavaScript navigation or a meta refresh would not meet the requested server-side 301 requirement on the current host.

`redirect-worker/index.ts` is a separate, stateless Cloudflare **Route Worker**. It returns HTTP 301 directly to the `/blog/` canonical for GET/HEAD requests to the ten audited paths, preserving query parameters. Apex and `www` aliases both redirect straight to the HTTPS apex canonical. Genuine pages and unknown paths pass through to the existing GitHub Pages origin; no blanket root redirect is applied. The Wrangler route list covers exactly the audited paths, with trailing wildcards to include query strings. It does not change the OAuth Worker.

This keeps GitHub Pages as the content host, but requires **an approved Cloudflare DNS/proxy setup for `vdallc.com`**, or an equivalently capable edge proxy. Merely deploying a Worker on `workers.dev` would not intercept traffic to the site. No nameserver, DNS, route, Pages setting, Worker deployment or production source migration has been performed.

References: [GitHub Pages is a static host](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Cloudflare Route Worker prerequisites and origin passthrough](https://developers.cloudflare.com/workers/configuration/routing/routes/), [HTTP redirect response implementation](https://developers.cloudflare.com/workers/examples/redirect/), [Google redirect guidance](https://developers.google.com/search/docs/crawling-indexing/301-redirects).

## Rollout order — requires explicit approval

1. Review the local diff, backups and audit. Refresh source/CMS/SEO-plan data from current `main` and resolve any concurrent edits before committing the migration.
2. Obtain domain-owner approval to add an active Cloudflare zone and proxy the website hostnames. Preserve the existing GitHub Pages origin records and all unrelated DNS records, including mail. Verify HTTPS to the Pages origin. If no DNS/proxy change is approved, the true-301 requirement remains blocked on GitHub Pages; do not deploy the removal of root aliases alone.
3. Deploy `redirect-worker/wrangler.jsonc` in the account owning that zone. Its exact route list must be active on the proxied apex and `www` hosts. The canonical `/blog/` targets already exist, so the redirect layer can go first.
4. Run `npm run check:redirects` against production. It requires direct 301s with correct destinations for all ten aliases. This is a read-only check, not a deployment.
5. Confirm the repository Pages source is **GitHub Actions**, not the old branch/Jekyll publisher. A previously observed competing built-in Jekyll workflow could otherwise publish the original source rather than `out/`. A repo owner/maintainer must change this setting; the connected account previously had write access only.
6. Only after approval and successful redirect checks, commit/push the reviewed migration and application changes. The Pages deployment job now checks live 301s before deploying, preventing the static cleanup from replacing old working URLs with 404s while redirects are absent.
7. Verify both article URLs, canonical/social/schema URLs, archive links, admin classification, sitemap, `/about.html`, all articles and editor workflows. Check that the deployment succeeded before considering the live migration complete.

For rollback, retain the redirect layer while restoring the previous Pages artifact/source. Use the saved JSON/HTML backup to recover original data if needed; never overwrite newer CMS edits with an older backup without reconciling them. No destructive rollback or production migration is automated.

## Local validation

```sh
npm run check
npm test
npm run build
npm run check:links
npm run redirects:check    # Wrangler dry run only; does not deploy
PORT=3102 npm start
# Another terminal:
QA_BASE_URL=http://localhost:3102 npm run qa
REDIRECT_CHECK_ORIGIN=http://localhost:3102 npm run check:redirects
```

The local preview server uses the same explicit redirect map to return real HTTP 301s. Browser QA uses a mocked GitHub API and does not mutate the production repository. Regression tests cover all ten aliases, exact route configuration, article creation/classification, conflicting metadata and publication states, draft retention, keyword target preservation, idempotence, structured data authors/dates, canonical/social URLs and sitemap deduplication. The link audit checks exported internal destinations and rejects any link still targeting a legacy alias.

No separate lint command is configured in this project. Type checking, the production build and formatting checks cover the available static checks. Production 301 verification is intentionally outstanding until the hosting configuration and deployment are approved.
