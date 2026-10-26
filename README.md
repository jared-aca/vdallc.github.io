# VDA LLC website and Content Studio

The public website and `/admin/` stay on **GitHub Pages**. Next.js and React build the admin; the public pages are exported as static HTML with their existing design, `.html` addresses, enquiry forms, theme switching and calculators.

Content is stored in the GitHub repository. Editors sign in with GitHub and need write access to `jared-aca/vdallc.github.io`. There is no shared admin password or content database.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:3101/` or `http://localhost:3101/admin/`. `npm run dev` runs the React admin at `http://localhost:3000/admin/`; use the full static build to preview the public website.

The GitHub login button reports a setup message until the OAuth service is configured. This is intentional: the site does not ship demo credentials or a browser-only password bypass.

## What the admin manages

- **SEO & pages:** SEO titles, meta descriptions, canonical URLs, Open Graph / Twitter sharing, social image alt text, noindex, nofollow and sitemap exclusions for all 51 existing pages.
- **Blog posts:** create posts and edit all 27 imported articles, including title, introduction, visual/HTML body, category, publish date, image URL and alt text.
- **Services:** create services and edit all five existing service pages with the same content and SEO controls.
- **Keyword targeting:** primary, secondary and target phrases, search intent, cluster assignment and a primary/supporting page role, saved alongside the page’s draft or publish commit.
- **Keywords & clusters:** create, edit, archive and restore topic clusters; define primary and supporting keywords, questions, included/excluded topics and notes; assign one primary page and supporting pages; review missing assignments, draft body links and explicitly shared primary phrases. No search-volume/rank provider or AI generation is connected.
- **Publishing:** save drafts, preview unsaved changes, publish, unpublish, and load up to ten recent saved versions. Existing URLs stay fixed after creation. Publish dates are display dates; publishing is immediate in the repository and goes live after the Pages workflow finishes.
- Posts update the Insights listing and homepage. Services update homepage cards and desktop, mobile and footer navigation. The sitemap includes only published, indexable pages with a self-referencing canonical URL.

Standard pages and calculators expose metadata controls; the original layouts and calculator logic are retained. Images use `/img/` files or external HTTPS URLs; image uploads and a visual page-layout builder are outside this implementation.

## Configure GitHub sign-in once

GitHub Pages cannot hold an OAuth client secret. `oauth-worker/` contains a small callback service, separate from the static website, to exchange the GitHub authorization code. It stores no site content and needs no database. The website and admin remain on GitHub Pages.

1. In the Cloudflare account that will own the callback service, authenticate Wrangler with `npx wrangler login`, then run `npm run oauth:deploy`. Note the returned `https://vda-cms-oauth.<account>.workers.dev` URL. Before secrets are configured, the Worker returns a setup response.
2. Create a GitHub OAuth app under the owner's **GitHub Settings → Developer settings → OAuth Apps**. Set its homepage to `https://vdallc.com` and its authorization callback to `https://vda-cms-oauth.<account>.workers.dev/callback`.
3. Add the app credentials as encrypted Worker secrets. Each command prompts for its value:

   ```sh
   npx wrangler secret put GITHUB_CLIENT_ID --config oauth-worker/wrangler.jsonc
   npx wrangler secret put GITHUB_CLIENT_SECRET --config oauth-worker/wrangler.jsonc
   ```

4. Set `oauthUrl` in `cms.config.json` to the Worker origin, without `/auth` or `/callback`. Keep the configured repository, branch and site URL correct. `CMS_ORIGIN` and `GITHUB_REPO` in `oauth-worker/wrangler.jsonc` must match. No secret goes in `cms.config.json`.
5. Add Josh's GitHub account as a repository collaborator with write access, if needed. The callback service and admin both check write permission before allowing editing. The OAuth app requests `public_repo` scope for this public repository. GitHub organization authorization policies must also allow the app.

The OAuth `public_repo` permission is broader than a single repository; the editor targets only VDA, but the granted token is not restricted to this repository. A repository-scoped GitHub App would provide tighter token permissions.

The callback uses state, PKCE and a short-lived HttpOnly state cookie. It posts the token only to the configured CMS origin. The editor validates the popup origin and source, keeps the GitHub token in this tab's session storage, and clears it on sign-out. Token revocation is available in the user's GitHub authorized applications settings. Never commit a GitHub token or OAuth client secret.

For local OAuth development, copy `oauth-worker/.dev.vars.example` to `oauth-worker/.dev.vars`, fill the two credentials, and run `npm run oauth:dev -- --var CMS_ORIGIN:http://localhost:3101`. Use a separate development OAuth app with its localhost callback. Do not change the production app's callback to test locally.

## Publish through GitHub Pages

1. Push this implementation to the repository's `main` branch.
2. In **Repository Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Keep the existing custom domain `vdallc.com` and its DNS pointed at GitHub Pages.
3. Run **Publish GitHub Pages** in the Actions tab, or push a source/published-content change. `.github/workflows/pages.yml` installs dependencies, checks types, runs tests, builds `out/`, and deploys that artifact to Pages.
4. Verify the public site and `/admin/`, then complete one GitHub sign-in and publishing cycle with the configured OAuth app.

A draft commit changes `data/cms.json` and, when targeting changes, `data/seo-plan.json`. The Pages workflow ignores commits containing only these files. Cluster-only planning changes also skip deployment. Publish and unpublish atomically commit both `data/cms.json` and `data/published.json`; this triggers a Pages build. Publication takes effect after that workflow succeeds. If it fails, the last successful deployment stays live; check the Actions tab and rerun it after fixing the cause. The account must be allowed to commit directly to `main`; branch protection can prevent publishing.

## Data and implementation

- `data/seed.json`: original page templates and imported content, used to preserve the site design.
- `data/published.json`: current public content; the static build reads **only this file** for publication.
- `data/seo-plan.json`: revisioned keyword targets and cluster relationships. It is never copied to the generated website; it remains readable in this public repository. Keyword planning is independent of body/metadata publication, and its history is in Git commits. Restoring a page content version does not restore its keyword plan.
- `data/cms.json`: draft records, latest published versions, revisions and saved history; loaded through the authenticated GitHub API by the editor, never copied to `out/`.
- `cms.config.json`: public repository, branch, canonical origin and OAuth service URL.
- `public/`: runtime CSS, JavaScript and images. Public preview templates are generated from the original HTML sources.
- Root HTML files, `blog/`, `services/`, `css/`, `js/`, `img/`: retained import sources. `npm run content:import` refreshes the original templates and asset copies. It does not overwrite CMS drafts or published records. Edit runtime assets in `public/`, and keep their import sources in sync if re-importing later.

Drafts stay off the live website, but they are GitHub repository content. In a public repository they can be read from the source and commit history; do not put confidential information into them. Published exports do not include draft records or credentials.

Content saves use a consistent Git commit snapshot, validate revisions, create a new Git tree/commit, and update the branch without force. A competing repository change rejects the save instead of overwriting it. HTML is sanitized in the editor and again during the static build. All metadata and structured data are emitted into the HTML, so search engines do not depend on browser JavaScript to see them.

## Checks

```sh
npm run check
npm test
npm run build
npm start
# In another terminal:
npm run qa
npm audit --omit=dev
```

Browser QA uses a **mocked GitHub API**, never real repository writes or credentials. It checks the actual static admin and GitHub transport: draft-only commits, previews, publication commits, branch conflicts, posts/services, SEO edits, lists, sitemap, mobile layout, all 51 original URLs, both calculators and logout. It restores the local output afterward. The OAuth callback has separate tests for state/PKCE, code exchange and repository authorization. A real GitHub sign-in still requires the owner's OAuth app setup above. Screenshots are in ignored `test-results/`.

Keyword fields support editorial planning and content coverage. They are not emitted as a `meta keywords` tag: [Google ignores that tag for indexing and ranking](https://developers.google.com/search/docs/crawling-indexing/special-tags). Planning checks are prompts based on saved drafts, not measured search performance.

Blog images include AI-generated editorial illustrations, not documentary photographs of actual veterans, historical events or VA personnel.

References: [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [atomic Git tree commits](https://docs.github.com/en/rest/git/trees), [Next.js static export](https://nextjs.org/docs/app/guides/static-exports).
