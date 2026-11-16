import assert from "node:assert/strict";
import test from "node:test";
import { preparePastedContent } from "../lib/paste-content";

test("converts complete Markdown articles into sanitized rich HTML", () => {
  const article = `# Article title

## H2 heading
### H3 heading
#### H4 heading
##### H5 heading
###### H6 heading

A paragraph with **bold**, *italic*, ~~strikethrough~~, \`inline code\`, and a [safe link](https://example.com).
Line two stays in the paragraph.

- Parent item
  - Nested item
1. Ordered item

| Condition | Evidence |
| --- | --- |
| PTSD | **Medical opinion** |

> A blockquote with *emphasis*.

\`\`\`txt
code block
\`\`\`

---`;
  const result = preparePastedContent(article, "");

  assert.equal(result.kind, "markdown");
  assert.match(result.html, /<h2>Article title<\/h2>/);
  assert.match(result.html, /<h2>H2 heading<\/h2>/);
  assert.match(result.html, /<h3>H3 heading<\/h3>/);
  assert.match(result.html, /<h4>H4 heading<\/h4>/);
  assert.match(result.html, /<h5>H5 heading<\/h5>/);
  assert.match(result.html, /<h6>H6 heading<\/h6>/);
  assert.match(result.html, /<strong>bold<\/strong>/);
  assert.match(result.html, /<em>italic<\/em>/);
  assert.match(result.html, /<s>strikethrough<\/s>/);
  assert.match(result.html, /<a href="https:\/\/example.com">safe link<\/a>/);
  assert.match(result.html, /<ul>[\s\S]*<ul>[\s\S]*Nested item/);
  assert.match(result.html, /<ol>/);
  assert.match(result.html, /<table>[\s\S]*<thead>[\s\S]*Condition[\s\S]*<tbody>/);
  assert.match(result.html, /<blockquote>/);
  assert.match(result.html, /<code>inline code<\/code>/);
  assert.match(result.html, /<pre><code(?: class="[^"]+")?>code block/);
  assert.match(result.html, /<hr\s*\/?\s*>/);
  assert.match(result.html, /<br\s*\/?\s*>\s*\nLine two stays in the paragraph\./);
});

test("prefers sanitized semantic HTML from the clipboard", () => {
  const result = preparePastedContent(
    "## Markdown fallback",
    '<p><strong>Formatted source</strong> <a href="javascript:alert(1)">unsafe link</a><script>alert(1)</script></p>',
  );

  assert.equal(result.kind, "html");
  assert.match(result.html, /<strong>Formatted source<\/strong>/);
  assert.doesNotMatch(result.html, /javascript:|<script/i);
});

test("leaves ordinary plain text alone", () => {
  const plain = "A simple sentence.\nAnother sentence.";
  assert.deepEqual(preparePastedContent(plain, ""), { kind: "text", text: plain });
});
