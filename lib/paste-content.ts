import MarkdownIt from "markdown-it";
import { cleanBody } from "./validation";

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
  typographer: false,
});

// Keep the editor's conventional article hierarchy when a source starts with
// a Markdown H1. H2-H6 headings retain their original levels.
const renderHeading = markdown.renderer.rules.heading_open;
const renderHeadingClose = markdown.renderer.rules.heading_close;
const normalizeHeading = (token: { tag: string }) => {
  if (token.tag === "h1") token.tag = "h2";
};
markdown.renderer.rules.heading_open = (tokens, index, options, env, self) => {
  normalizeHeading(tokens[index]);
  return renderHeading
    ? renderHeading(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};
markdown.renderer.rules.heading_close = (tokens, index, options, env, self) => {
  normalizeHeading(tokens[index]);
  return renderHeadingClose
    ? renderHeadingClose(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

// Paragraph/div/span wrappers alone do not mean the clipboard HTML is rich.
const semanticHtmlTag = /<(?:h[1-6]|strong|b|em|i|s|del|ul|ol|li|a|table|thead|tbody|tr|td|th|blockquote|pre|code|hr|img)\b/i;
const markdownSyntax = [
  /^\s{0,3}#{1,6}\s+\S/m,
  /^\s{0,3}(?:```|~~~)/m,
  /^\s{0,3}>\s?/m,
  /^\s{0,3}(?:[-+*]|\d+[.)])\s+\S/m,
  /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/m,
  /^\s*\|?.+\|\s*\n\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m,
  /\*\*[^*\n]+\*\*|__[^_\n]+__/,
  /~~[^~\n]+~~/,
  /(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)/,
  /`[^`\n]+`/,
  /\[[^\]]+\]\([^)]+\)/,
];

function hasMarkdownSyntax(value: string) {
  return Boolean(value && markdownSyntax.some((pattern) => pattern.test(value)));
}

function textFromHtml(html: string) {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(html, "text/html");
    document.querySelectorAll("script,style,noscript").forEach((node) => node.remove());
    const blocks = document.body.querySelectorAll("br,p,div,h1,h2,h3,h4,h5,h6,li,tr,blockquote,pre");
    for (const block of blocks) {
      if (block.tagName.toLowerCase() === "br") block.replaceWith("\n");
      else block.append("\n");
    }
    return document.body.textContent?.replace(/\u00a0/g, " ").trim() || "";
  }

  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

export type PasteContent =
  | { kind: "html" | "markdown"; html: string }
  | { kind: "text"; text: string };

/**
 * Use sanitized rich HTML when the clipboard provides semantic formatting,
 * otherwise convert recognizable Markdown or leave ordinary text alone.
 */
export function preparePastedContent(plainText: string, htmlText: string): PasteContent {
  const htmlVisibleText = htmlText ? textFromHtml(htmlText) : "";
  const markdownText = hasMarkdownSyntax(plainText)
    ? plainText
    : hasMarkdownSyntax(htmlVisibleText)
      ? htmlVisibleText
      : "";
  const safeHtml = htmlText.trim() ? cleanBody(htmlText) : "";
  const hasSemanticHtml = Boolean(safeHtml && semanticHtmlTag.test(safeHtml));

  // Semantic clipboard markup wins when its visible text is already formatted.
  // Wrapper-only HTML, or HTML whose visible text still contains Markdown,
  // falls through to the Markdown converter instead of preserving raw syntax.
  if (hasSemanticHtml && !hasMarkdownSyntax(htmlVisibleText))
    return { kind: "html", html: safeHtml };

  if (markdownText) {
    const converted = cleanBody(markdown.render(markdownText));
    if (converted.trim()) return { kind: "markdown", html: converted };
  }

  if (hasSemanticHtml) return { kind: "html", html: safeHtml };

  if (safeHtml.trim() && /<(?:p|br|div|span)\b/i.test(safeHtml))
    return { kind: "text", text: plainText || htmlVisibleText };

  return { kind: "text", text: plainText || htmlVisibleText };
}

export function markdownToSafeHtml(source: string) {
  return cleanBody(markdown.render(source));
}
