import config from "../cms.config.json";
import { articleRedirect } from "../lib/content-urls";
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = new URL(config.siteUrl);
    if (![origin.hostname, "www." + origin.hostname].includes(url.hostname))
      return new Response("Not found", { status: 404 });
    if (["GET", "HEAD"].includes(request.method)) {
      const target = articleRedirect(request.url, config.siteUrl);
      if (target)
        return new Response(null, {
          status: 301,
          headers: {
            Location: target,
            "Cache-Control": "public, max-age=3600",
          },
        });
    }
    // On a Cloudflare ROUTE (not a Custom Domain), this subrequest goes to the
    // existing GitHub Pages origin configured in the proxied zone's DNS.
    return fetch(request);
  },
};
