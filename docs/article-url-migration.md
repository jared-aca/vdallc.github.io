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
- The staged export keeps all ten canonical `/blog/` pages and temporarily writes each audited root alias as an exact copy of its canonical article HTML. Each copy therefore carries the canonical `/blog/` title, description, Open Graph URL, schema URLs and canonical link; the aliases stay out of the sitemap. This is the availability stage while the edge 301 routes are not active. Final redirect mode omits the alias copies only after the strict 301 check passes.
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

### Staged publishing status checked 2026-10-27

All ten legacy root article URLs returned HTTP 404 when checked without following redirects. The earlier 200 observations predated the source migration; the 2026-10-26 `d67dd25` migration removed those root copies from the repository, and the active branch-based Pages publisher then published the root source. The `/blog/{slug}.html` canonical pages continue to return 200. The latest custom workflow built and uploaded the Next.js `out/` artifact but stopped at the strict redirect preflight because the legacy roots were 404.

The content-release stage now writes all ten explicit compatibility aliases as byte-identical copies of their `/blog/` HTML. A staged preflight verifies that each alias has a canonical article file and that the live alias status is either 200 with article text matching the currently live canonical page, 301 directly to the expected canonical, or a confirmed 404. Comparing the live alias to the live canonical allows legitimate new CMS edits to publish while blocking a divergent alias that could contain unique text. Unexpected statuses, network failures, wrong redirects or differing live content block deployment. Thus a currently working alias cannot disappear into a 404, and the known 404s can be restored as canonical-tagged pages while normal content/SEO releases proceed. `npm run check:redirects` remains strict and requires direct 301s for the separate final migration.

The Pages workflow uploads `out/` and verifies a `vda-build.json` marker at the deployed URL against the current commit. This detects a successful branch/Jekyll publication that substituted repository-root files for the Next.js export. Repository Settings still must use **GitHub Actions** as the Pages source; the connected GitHub account lacks admin permission to change that setting.

References: [GitHub Pages is a static host](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Cloudflare Route Worker prerequisites and origin passthrough](https://developers.cloudflare.com/workers/configuration/routing/routes/), [HTTP redirect response implementation](https://developers.cloudflare.com/workers/examples/redirect/), [Google redirect guidance](https://developers.google.com/search/docs/crawling-indexing/301-redirects).

## Rollout order — requires explicit approval

1. A repository admin sets **Settings → Pages → Build and deployment → Source → GitHub Actions**. Until then, the built-in branch/Jekyll publisher can continue to replace the intended artifact with repository-root files.
2. Review and push the staged publishing changes after explicit approval. Normal content pushes build current CMS data, retain the canonical `/blog/` paths, and deploy the ten canonical-tagged compatibility aliases. Check the post-deploy marker before treating content or SEO changes as live.
3. Separately, obtain domain-owner approval for an active Cloudflare zone/proxy. Preserve the GitHub Pages origin records and all unrelated DNS records, including mail; verify HTTPS to the origin. If this DNS/proxy change is not approved, keep the staged aliases in place.
4. Deploy `redirect-worker/wrangler.jsonc` in the account owning that zone. Its exact route list must be active on the proxied apex and `www` hosts.
5. Run the strict `npm run check:redirects` against production. It requires direct 301s with correct destinations for all ten aliases.
6. After the strict check passes, dispatch **Publish GitHub Pages** with `final_redirect_migration`. This rebuilds without the temporary aliases and cannot deploy unless the direct 301 check succeeds.
7. Verify legacy and canonical article URLs, social/schema URLs, archive links, sitemap, requested service/page URLs, admin publishing, and the deployed commit marker.

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
