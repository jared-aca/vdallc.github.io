import type { Content } from "./model";
import { validateContent } from "./validation";
export async function previewContent(input: Content) {
  const content = validateContent(input);
  const key =
    content.type === "page"
      ? `pages${content.path === "/" ? "/index.html" : content.path}`
      : `${content.type}.html`;
  const response = await fetch(`/cms/templates/${key}`);
  if (!response.ok)
    throw new Error(
      "The preview template is unavailable. Build the static site first.",
    );
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  doc.title = content.seo.title;
  if (content.type !== "page") {
    const setText = (selector: string, text: string) => {
      const node = doc.querySelector(selector);
      if (node) node.textContent = text;
    };
    setText(".page-hero h1", content.title);
    setText(".page-hero-lead", content.excerpt);
    setText('.breadcrumb [aria-current="page"]', content.title);
    const body = doc.querySelector(".service-content");
    if (body) body.innerHTML = content.body;
    const image = doc.querySelector(".page-hero-bg img");
    if (image && content.image) {
      image.setAttribute("src", content.image);
      image.setAttribute("alt", content.imageAlt);
    }
    if (!content.image) doc.querySelector(".page-hero-bg")?.remove();
  }
  for (const script of doc.querySelectorAll("script:not([src])"))
    if (script.textContent?.includes("localStorage")) script.remove();
  for (const node of doc.querySelectorAll("form, #theme-toggle")) node.remove();
  doc.documentElement.setAttribute("data-theme", "light");
  const banner = doc.createElement("div");
  banner.textContent = "Draft preview · These changes have not been published.";
  banner.setAttribute(
    "style",
    "position:sticky;top:0;z-index:10000;padding:12px;background:#17273f;color:white;text-align:center;font:14px system-ui",
  );
  doc.body.prepend(banner);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
