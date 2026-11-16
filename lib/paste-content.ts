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

const richHtmlTag = /<(?:h[1-6]|p|br|strong|b|em|i|s|del|ul|ol|li|a|table|thead|tbody|tr|td|th|blockquote|pre|code|hr|img)\b/i;
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

export type PasteContent =
  | { kind: "html" | "markdown"; html: string }
  | { kind: "text"; text: string };

/**
 * Use sanitized rich HTML when the clipboard provides semantic formatting,
 * otherwise convert recognizable Markdown or leave ordinary text alone.
 */
export function preparePastedContent(plainText: string, htmlText: string): PasteContent {
  if (htmlText.trim()) {
    const safeHtml = cleanBody(htmlText);
    if (safeHtml.trim() && richHtmlTag.test(safeHtml))
      return { kind: "html", html: safeHtml };
  }

  if (plainText && markdownSyntax.some((pattern) => pattern.test(plainText))) {
    const converted = cleanBody(markdown.render(plainText));
    if (converted.trim()) return { kind: "markdown", html: converted };
  }

  return { kind: "text", text: plainText };
}
