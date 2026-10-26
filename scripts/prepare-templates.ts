import { mkdir, writeFile, rm } from "node:fs/promises";
import { seedMap, seedPages } from "../lib/seed";
async function main() {
  await rm("public/cms/templates/pages", { recursive: true, force: true });
  await mkdir("public/cms/templates/pages", { recursive: true });
  await writeFile(
    "public/cms/templates/blog.html",
    seedMap.get("/blog/va-disability-ratings.html")!.html,
  );
  await writeFile(
    "public/cms/templates/service.html",
    seedMap.get("/services/va-disability-claims.html")!.html,
  );
  for (const page of seedPages.filter((page) => page.content.type === "page"))
    await writeFile(
      `public/cms/templates/pages${page.content.path === "/" ? "/index.html" : page.content.path}`,
      page.html,
    );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
