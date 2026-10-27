const pageUrl = process.env.PAGES_URL;
const revision = process.env.GITHUB_SHA;
if (!pageUrl || !revision)
  throw new Error("PAGES_URL and GITHUB_SHA are required to verify the deployment.");

const base = pageUrl.endsWith("/") ? pageUrl : `${pageUrl}/`;
const markerUrl = new URL("vda-build.json", base);
let lastResult = "no response";

for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    const response = await fetch(markerUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: { "Cache-Control": "no-cache" },
    });
    if (response.ok) {
      const marker = await response.json();
      if (
        marker.generator === "vda-next-static-export" &&
        marker.revision === revision
      ) {
        console.log(
          `PASS: Pages serves the Next.js export artifact for ${revision} (${marker.articleRedirectStage} article stage).`,
        );
        process.exit(0);
      }
      lastResult = `unexpected marker ${JSON.stringify(marker)}`;
    } else lastResult = `HTTP ${response.status}`;
  } catch (error) {
    lastResult = error.message;
  }
  if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5000));
}

throw new Error(
  `GitHub Pages did not serve the uploaded out/ artifact at ${markerUrl}; expected revision ${revision}. Last response: ${lastResult}. Check that Pages is configured to use GitHub Actions, not the repository branch source.`,
);
