export type OAuthEnv = {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  CMS_ORIGIN: string;
  GITHUB_REPO: string;
};
const encoder = new TextEncoder();
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function random() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
function cookieName(url: URL) {
  return url.protocol === "https:"
    ? "__Host-vda-oauth-state"
    : "vda-oauth-state";
}
function stateCookie(url: URL, value: string, maxAge = 600) {
  return `${cookieName(url)}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${url.protocol === "https:" ? "; Secure" : ""}`;
}
function result(
  url: URL,
  env: OAuthEnv,
  data: { token?: string; error?: string },
) {
  const nonce = random();
  const payload = JSON.stringify({ type: "vda-github-auth", ...data }).replace(
    /</g,
    "\\u003c",
  );
  const origin = JSON.stringify(new URL(env.CMS_ORIGIN).origin);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>VDA GitHub sign-in</title></head><body><p>Returning to VDA Content Studio…</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${payload},${origin});}else{document.body.textContent='Return to Content Studio and sign in again.';}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Set-Cookie": stateCookie(url, "", 0),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}
export default {
  async fetch(request: Request, env: OAuthEnv): Promise<Response> {
    const url = new URL(request.url);
    if (
      !env.GITHUB_CLIENT_ID ||
      !env.GITHUB_CLIENT_SECRET ||
      !env.CMS_ORIGIN ||
      !env.GITHUB_REPO
    )
      return new Response(
        "Configure the GitHub OAuth application and CMS_ORIGIN first.",
        { status: 503 },
      );
    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/auth") {
      const state = random();
      const verifier = random();
      const challenge = base64url(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
        ),
      );
      const stateValue = base64url(
        encoder.encode(JSON.stringify({ state, verifier, at: Date.now() })),
      );
      const location = new URL("https://github.com/login/oauth/authorize");
      location.search = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: url.origin + "/callback",
        scope: "public_repo",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return new Response(null, {
        status: 302,
        headers: {
          Location: location.href,
          "Set-Cookie": stateCookie(url, stateValue),
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (url.pathname === "/callback") {
      try {
        const raw = request.headers
          .get("cookie")
          ?.split(";")
          .map((value) => value.trim())
          .find((value) => value.startsWith(cookieName(url) + "="))
          ?.split("=")[1];
        if (!raw)
          throw new Error("The sign-in state is missing. Please try again.");
        const state = JSON.parse(
          atob(raw.replace(/-/g, "+").replace(/_/g, "/")),
        );
        if (
          !state.state ||
          state.state !== url.searchParams.get("state") ||
          typeof state.at !== "number" ||
          Date.now() - state.at > 600000 ||
          Date.now() < state.at
        )
          throw new Error(
            "The sign-in state expired or did not match. Please try again.",
          );
        if (url.searchParams.get("error"))
          throw new Error("GitHub authorization was cancelled.");
        const code = url.searchParams.get("code");
        if (!code)
          throw new Error("GitHub did not return an authorization code.");
        const response = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              client_id: env.GITHUB_CLIENT_ID,
              client_secret: env.GITHUB_CLIENT_SECRET,
              code,
              redirect_uri: url.origin + "/callback",
              code_verifier: state.verifier,
            }),
          },
        );
        const data = (await response.json()) as {
          access_token?: string;
          error?: string;
        };
        if (!response.ok || !data.access_token || data.error)
          throw new Error(
            "GitHub could not complete sign-in. Please try again.",
          );
        const access = await fetch(
          `https://api.github.com/repos/${env.GITHUB_REPO}`,
          {
            headers: {
              Authorization: `Bearer ${data.access_token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "VDA-Content-Studio",
            },
          },
        );
        const repo = (await access.json()) as {
          permissions?: { push?: boolean };
        };
        if (!access.ok || !repo.permissions?.push)
          throw new Error(
            "This GitHub account needs write access to the VDA website repository.",
          );
        return result(url, env, { token: data.access_token });
      } catch (error) {
        return result(url, env, {
          error:
            error instanceof Error ? error.message : "GitHub sign-in failed.",
        });
      }
    }
    return new Response("VDA GitHub OAuth callback service", {
      headers: { "Cache-Control": "no-store" },
    });
  },
};
