"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Content,
  ContentSummary,
  ContentType,
  RecordEntry,
  Seo,
} from "@/lib/model";
import { articlePath, canonicalUrl } from "@/lib/content-urls";
import Field from "./field";
import { cleanBody } from "@/lib/validation";
import {
  getSession,
  signInWithGitHub,
  signOutGitHub,
  loadWorkspace,
  getEditor,
  commitSeoPlan,
  commitContent,
  publishingStatusUrl,
} from "@/lib/github-cms";
import SeoWorkspace, { SeoTargetFields } from "./seo-tools";
import {
  emptySeoPlan,
  emptyTarget,
  targetFor,
  type SeoPlan,
  type SeoTarget,
  type KeywordCluster,
} from "@/lib/seo-plan";
import { previewContent } from "@/lib/client-preview";

type Section = "overview" | "page" | "blog" | "service" | "strategy";
const labels = {
  overview: "Overview",
  page: "SEO & pages",
  blog: "Blog posts",
  service: "Services",
  strategy: "Keywords & clusters",
};
const icons = {
  overview: "◈",
  page: "◎",
  blog: "▤",
  service: "◇",
  strategy: "⌘",
};
const blankSeo: Seo = {
  title: "",
  description: "",
  canonical: "",
  socialTitle: "",
  socialDescription: "",
  socialImage: "",
  socialImageAlt: "",
  noindex: false,
  nofollow: false,
  excludeFromSitemap: false,
};
function newContent(type: "blog" | "service"): Content {
  return {
    path: "",
    type,
    title: "",
    excerpt: "",
    body: "<h2>Introduction</h2><p>Start writing here.</p>",
    image: "",
    imageAlt: "",
    category: type === "blog" ? "VA Claims" : "Our Services",
    date: new Date().toISOString().slice(0, 10),
    seo: { ...blankSeo },
  };
}
const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
function displayedCanonical(content: Content) {
  if (content.type !== "blog") return content.seo.canonical;
  try {
    return canonicalUrl(content);
  } catch {
    return "";
  }
}
function RichText({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  useEffect(() => {
    if (
      ref.current &&
      document.activeElement !== ref.current &&
      ref.current.innerHTML !== value
    )
      ref.current.innerHTML = cleanBody(value);
  }, [value, htmlMode]);
  function command(name: string, argument?: string) {
    ref.current?.focus();
    document.execCommand(name, false, argument);
    if (ref.current) onChange(ref.current.innerHTML);
  }
  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <span>Article content</span>
        <button
          type="button"
          className="text-button"
          onClick={() => setHtmlMode(!htmlMode)}
        >
          {htmlMode ? "Visual editor" : "Edit HTML"}
        </button>
      </div>
      {htmlMode ? (
        <textarea
          aria-label="Article HTML"
          className="code-editor"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <>
          <div className="format-toolbar" aria-label="Text formatting">
            {[
              ["Paragraph", "formatBlock", "p"],
              ["Heading 2", "formatBlock", "h2"],
              ["Heading 3", "formatBlock", "h3"],
              ["Bold", "bold", ""],
              ["Italic", "italic", ""],
              ["Bullets", "insertUnorderedList", ""],
              ["Numbered list", "insertOrderedList", ""],
            ].map(([label, cmd, arg]) => (
              <button
                type="button"
                key={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => command(cmd, arg)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const href = window.prompt(
                  "Link URL (https://… or /site-path)",
                );
                if (href && /^(https?:\/\/|\/(?!\/)|mailto:|tel:)/.test(href))
                  command("createLink", href);
              }}
            >
              Link
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command("unlink")}
            >
              Unlink
            </button>
          </div>
          <div
            ref={ref}
            role="textbox"
            aria-label="Article content"
            aria-multiline="true"
            contentEditable={!disabled}
            suppressContentEditableWarning
            className="visual-editor"
            onInput={(e) => onChange(e.currentTarget.innerHTML)}
            onPaste={(e) => {
              e.preventDefault();
              document.execCommand(
                "insertText",
                false,
                e.clipboardData.getData("text/plain"),
              );
            }}
          />
        </>
      )}
    </div>
  );
}
export default function Admin() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [account, setAccount] = useState("GitHub editor");
  const [section, setSection] = useState<Section>("overview");
  const [pages, setPages] = useState<ContentSummary[]>([]);
  const [plan, setPlan] = useState<SeoPlan>(emptySeoPlan());
  const [documents, setDocuments] = useState<Content[]>([]);
  const [target, setTarget] = useState<SeoTarget>(emptyTarget());
  const [savedTarget, setSavedTarget] = useState(JSON.stringify(emptyTarget()));
  const [strategyDirty, setStrategyDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<RecordEntry | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"content" | "seo" | "history">("content");
  const [preview, setPreview] = useState("");
  const [saved, setSaved] = useState("");
  const dirty =
    Boolean(
      content &&
        (JSON.stringify(content) !== saved ||
          JSON.stringify(target) !== savedTarget),
    ) || strategyDirty;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const workspace = await loadWorkspace();
      setPages(workspace.pages);
      setDocuments(workspace.documents);
      setPlan(workspace.plan);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void getSession()
      .then((data) => {
        setAuthenticated(data.authenticated);
        if (data.user) setAccount(data.user);
      })
      .catch((cause) => {
        setError(cause.message);
        setAuthenticated(false);
      });
  }, []);
  useEffect(() => {
    if (authenticated) void reload().catch((cause) => setError(cause.message));
  }, [authenticated, reload]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const identity = await signInWithGitHub();
      setAccount(identity.user || "GitHub editor");
      setAuthenticated(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function leaveEditor() {
    if (busy || (dirty && !window.confirm("Discard unsaved changes?")))
      return false;
    setContent(null);
    setStrategyDirty(false);
    setRecord(null);
    setCreating(false);
    setPreview("");
    setError("");
    setNotice("");
    return true;
  }
  function navigate(next: Section) {
    if (leaveEditor()) {
      setSection(next);
      setSearch("");
      setFilter("all");
    }
  }
  async function open(path: string) {
    if (busy || (dirty && !window.confirm("Discard unsaved changes?"))) return;
    setBusy(true);
    setError("");
    setNotice("");
    setPreview("");
    try {
      const editor = await getEditor(path);
      const next = editor.record;
      setPlan(editor.plan);
      const targeting = targetFor(editor.plan, next.draft.path);
      setTarget(targeting);
      setSavedTarget(JSON.stringify(targeting));
      setStrategyDirty(false);
      setRecord(next);
      setContent(next.draft);
      setSaved(JSON.stringify(next.draft));
      setCreating(false);
      setTab(next.draft.type === "page" ? "seo" : "content");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function create(type: "blog" | "service") {
    if (!leaveEditor()) return;
    const draft = newContent(type);
    setRecord(null);
    setTarget(emptyTarget());
    setSavedTarget(JSON.stringify(emptyTarget()));
    setContent(draft);
    setSaved(JSON.stringify(draft));
    setCreating(true);
    setTab("content");
  }
  async function save(action: "draft" | "publish" | "unpublish") {
    if (!content) return;
    if (
      action === "unpublish" &&
      !window.confirm(
        "Unpublish this page? It will be removed from the public site, listings and sitemap. You can publish it again later.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await commitContent({
        content,
        action,
        revision: record?.revision ?? 0,
        create: creating,
        target,
        planRevision: plan.revision,
      });
      const next = result.record;
      setPlan(result.plan);
      setTarget(targetFor(result.plan, next.draft.path));
      setSavedTarget(JSON.stringify(targetFor(result.plan, next.draft.path)));
      setRecord(next);
      setContent(next.draft);
      setSaved(JSON.stringify(next.draft));
      setCreating(false);
      setNotice(
        action === "publish"
          ? "Publication committed. GitHub Pages will update after the deployment workflow finishes."
          : action === "unpublish"
            ? "Unpublish committed. GitHub Pages will remove the page after the next deployment."
            : "Draft committed to GitHub. The live page has not changed.",
      );
      await reload();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function savePlan(proposed: SeoPlan) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await commitSeoPlan(proposed, plan.revision);
      setPlan(next);
      setNotice("SEO plan saved to GitHub. Public pages have not changed.");
    } catch (cause) {
      setError((cause as Error).message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }
  async function createTargetCluster() {
    if (!content || !target.primaryKeyword.trim()) return;
    const at = new Date().toISOString();
    const cluster: KeywordCluster = {
      id: crypto.randomUUID(),
      name: target.primaryKeyword.trim(),
      primaryKeyword: target.primaryKeyword.trim(),
      secondaryKeywords: target.secondaryKeywords,
      intent:
        target.searchIntent ||
        (content.type === "blog" ? "informational" : "commercial"),
      supportingQuestions: [],
      includedTopics: [],
      excludedTerms: [],
      notes: "",
      status: "active",
      createdAt: at,
      updatedAt: at,
    };
    try {
      await savePlan({ ...plan, clusters: [...plan.clusters, cluster] });
      setTarget({ ...target, clusterId: cluster.id, clusterRole: "primary" });
      setNotice(
        "Cluster created. Save this page to keep its keyword targeting and assignment.",
      );
    } catch {
      /* savePlan shows the error and preserves the editor. */
    }
  }
  async function openPreview() {
    if (!content) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await previewContent(content));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if (!leaveEditor()) return;
    setBusy(true);
    try {
      signOutGitHub();
      setAuthenticated(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const change = (key: keyof Content, value: unknown) =>
    setContent((old) => (old ? { ...old, [key]: value } : null));
  const seoChange = (key: keyof Seo, value: unknown) =>
    setContent((old) =>
      old ? { ...old, seo: { ...old.seo, [key]: value } } : null,
    );
  const count = (type: ContentType) =>
    pages.filter((page) => page.type === type).length;
  const list = pages
    .filter(
      (page) =>
        (section === "overview" || page.type === section) &&
        `${page.title} ${page.path}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" ||
          (filter === "changes" ? page.hasChanges : page.status === filter)),
    )
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.path.localeCompare(b.path),
    );
  if (authenticated === null)
    return <div className="loading-screen">Loading Content Studio…</div>;
  if (!authenticated)
    return (
      <main className="login-page">
        <div className="login-intro">
          <a href="/" className="wordmark">
            VDA<span>LLC</span>
          </a>
          <div>
            <p className="eyebrow">YOUR WEBSITE, IN YOUR HANDS</p>
            <h1>
              Clear content.
              <br />
              Stronger presence.
            </h1>
            <p>
              Manage your pages, share your expertise, and help more veterans
              find the support they need.
            </p>
          </div>
          <small>Veterans Disability Advocates</small>
        </div>
        <section className="login-form">
          <div>
            <p className="eyebrow">VDA CONTENT STUDIO</p>
            <h2>Welcome back.</h2>
            <p>Sign in to manage your website.</p>
            <div className="github-signin">
              <p>
                Use a GitHub account with write access to the VDA website
                repository.
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy} onClick={signIn}>
                {busy ? "Connecting to GitHub…" : "Sign in with GitHub →"}
              </button>
            </div>
            <a className="return-link" href="/">
              ← Return to website
            </a>
          </div>
        </section>
      </main>
    );
  return (
    <div className="studio">
      <aside className="sidebar">
        <a
          href="/admin"
          className="wordmark"
          onClick={(event) => {
            event.preventDefault();
            navigate("overview");
          }}
        >
          VDA<span>LLC</span>
        </a>
        <div className="studio-label">CONTENT STUDIO</div>
        <div className="side-caption">WORKSPACE</div>
        <nav aria-label="Content sections">
          {(Object.keys(labels) as Section[]).map((item) => (
            <button
              key={item}
              className={section === item ? "active" : ""}
              disabled={busy}
              onClick={() => navigate(item)}
            >
              <span className="nav-icon">{icons[item]}</span>
              {labels[item]}
              {item !== "overview" && (
                <small>
                  {item === "strategy"
                    ? plan.clusters.filter(
                        (cluster) => cluster.status === "active",
                      ).length
                    : count(item)}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="site-status">
            <i /> VDA LLC website
          </div>
          <a href="/" target="_blank" rel="noreferrer">
            View website ↗
          </a>
          <a href={publishingStatusUrl} target="_blank" rel="noreferrer">
            Publishing status ↗
          </a>
          <button onClick={signOut} disabled={busy}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">
        <div className="workspace-top">
          <span>
            VDA LLC <b>/</b> {content ? "Editor" : labels[section]}
          </span>
          <span className="workspace-account">● {account}</span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {content ? (
          <>
            <header className="editor-heading">
              <div>
                <button
                  className="text-button back-button"
                  onClick={leaveEditor}
                  disabled={busy}
                >
                  ← Back to content
                </button>
                <h1>
                  {creating
                    ? `New ${content.type === "blog" ? "blog post" : "service"}`
                    : content.title}
                </h1>
                <p>
                  <span
                    className={`badge ${record?.published ? "published" : "draft"}`}
                  >
                    {record?.published ? "Published" : "Draft"}
                  </span>{" "}
                  {dirty
                    ? "Unsaved changes"
                    : record?.updatedAt
                      ? `Saved ${new Date(record.updatedAt).toLocaleString()}`
                      : "Original page"}
                </p>
              </div>
              <div className="editor-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={openPreview}
                >
                  Preview
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => save("draft")}
                >
                  Save draft
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => save("publish")}
                >
                  {busy ? "Working…" : "Publish changes"}
                </button>
              </div>
            </header>
            <div
              className="editor-tabs"
              role="tablist"
              aria-label="Editor sections"
            >
              {(content.type === "page"
                ? ["seo", "history"]
                : ["content", "seo", "history"]
              ).map((item) => (
                <button
                  role="tab"
                  aria-selected={tab === item}
                  key={item}
                  onClick={() => setTab(item as typeof tab)}
                >
                  {item === "seo"
                    ? "SEO & sharing"
                    : item === "history"
                      ? "Version history"
                      : "Content"}
                </button>
              ))}
            </div>
            <fieldset disabled={busy} className="editor-layout">
              <section className="editor-main">
                {tab === "content" && (
                  <>
                    <div className="panel">
                      <div className="panel-heading">
                        <h2>The essentials</h2>
                        <p>Your heading, introduction, and page address.</p>
                      </div>
                      <Field label="Page title">
                        <input
                          required
                          value={content.title}
                          onChange={(e) => {
                            const title = e.target.value;
                            setContent({
                              ...content,
                              title,
                              ...(creating &&
                              (!content.path ||
                                content.path ===
                                  (content.type === "blog"
                                    ? articlePath(
                                        slugify(content.title) || "new-article",
                                      )
                                    : `/services/${slugify(content.title)}.html`))
                                ? {
                                    path:
                                      content.type === "blog"
                                        ? slugify(title)
                                          ? articlePath(slugify(title))
                                          : ""
                                        : `/services/${slugify(title)}.html`,
                                  }
                                : {}),
                              seo: {
                                ...content.seo,
                                ...(creating &&
                                (!content.seo.title ||
                                  content.seo.title ===
                                    `${content.title} | VDA LLC`)
                                  ? { title: `${title} | VDA LLC` }
                                  : {}),
                              },
                            });
                          }}
                        />
                      </Field>
                      <Field
                        label="URL path"
                        hint={
                          creating
                            ? "Choose a unique address. It stays fixed after the first save."
                            : "This address is preserved to protect existing links and search rankings."
                        }
                      >
                        <input
                          value={content.path}
                          readOnly={!creating}
                          onChange={(e) => change("path", e.target.value)}
                        />
                      </Field>
                      <Field
                        label="Introduction / excerpt"
                        hint="Shown below the heading and in content listings."
                      >
                        <textarea
                          rows={3}
                          value={content.excerpt}
                          onChange={(e) => change("excerpt", e.target.value)}
                        />
                      </Field>
                      <div className="field-grid">
                        <Field label="Category">
                          <input
                            value={content.category}
                            onChange={(e) => change("category", e.target.value)}
                          />
                        </Field>
                        {content.type === "blog" && (
                          <Field
                            label="Publish date"
                            hint="Display date only. Publishing takes effect immediately."
                          >
                            <input
                              type="date"
                              value={content.date}
                              onChange={(e) => change("date", e.target.value)}
                            />
                          </Field>
                        )}
                      </div>
                    </div>
                    <RichText
                      disabled={busy}
                      value={content.body}
                      onChange={(value) => change("body", value)}
                    />
                    <div className="panel">
                      <div className="panel-heading">
                        <h2>Featured image</h2>
                        <p>Used in the page hero and listings.</p>
                      </div>
                      <Field
                        label="Image URL"
                        hint="Use /img/blog/your-image.webp or an https:// image URL."
                      >
                        <input
                          value={content.image}
                          onChange={(e) => change("image", e.target.value)}
                        />
                      </Field>
                      <Field label="Image description (alt text)">
                        <input
                          value={content.imageAlt}
                          onChange={(e) => change("imageAlt", e.target.value)}
                        />
                      </Field>
                    </div>
                  </>
                )}
                {tab === "seo" && (
                  <>
                    <SeoTargetFields
                      content={content}
                      target={target}
                      plan={plan}
                      onChange={setTarget}
                      onCreateCluster={createTargetCluster}
                    />
                    <div className="panel">
                      <div className="panel-heading">
                        <h2>Search appearance</h2>
                        <p>Choose how this page appears in search results.</p>
                      </div>
                      <Field
                        label="SEO title"
                        hint={`${content.seo.title.length} characters · Around 50–60 is a useful guide.`}
                      >
                        <input
                          value={content.seo.title}
                          onChange={(e) => seoChange("title", e.target.value)}
                        />
                      </Field>
                      <Field
                        label="Meta description"
                        hint={`${content.seo.description.length} characters · Aim for a clear, useful summary.`}
                      >
                        <textarea
                          rows={4}
                          value={content.seo.description}
                          onChange={(e) =>
                            seoChange("description", e.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="Canonical URL"
                        hint={
                          content.type === "blog"
                            ? "Articles use one fixed, self-referencing /blog/ URL."
                            : "Leave blank to use this page’s address. Use another URL only for duplicate content."
                        }
                      >
                        <input
                          value={displayedCanonical(content)}
                          readOnly={content.type === "blog"}
                          onChange={(e) =>
                            seoChange("canonical", e.target.value)
                          }
                          placeholder={content.path || "/blog/your-post.html"}
                        />
                      </Field>
                    </div>
                    <div className="panel">
                      <div className="panel-heading">
                        <h2>Social sharing</h2>
                        <p>
                          These fall back to the SEO title, description, and
                          featured image.
                        </p>
                      </div>
                      <Field label="Social title">
                        <input
                          value={content.seo.socialTitle}
                          onChange={(e) =>
                            seoChange("socialTitle", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Social description">
                        <textarea
                          rows={3}
                          value={content.seo.socialDescription}
                          onChange={(e) =>
                            seoChange("socialDescription", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Social image URL">
                        <input
                          value={content.seo.socialImage}
                          onChange={(e) =>
                            seoChange("socialImage", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Social image description">
                        <input
                          value={content.seo.socialImageAlt}
                          onChange={(e) =>
                            seoChange("socialImageAlt", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                    <div className="panel">
                      <div className="panel-heading">
                        <h2>Search visibility</h2>
                        <p>Settings take effect when you publish.</p>
                      </div>
                      {(
                        [
                          [
                            "noindex",
                            "Ask search engines not to index this page",
                          ],
                          [
                            "nofollow",
                            "Ask search engines not to follow links on this page",
                          ],
                          ["excludeFromSitemap", "Exclude from the sitemap"],
                        ] as const
                      ).map(([key, label]) => (
                        <label className="check-field" key={key}>
                          <input
                            type="checkbox"
                            checked={content.seo[key]}
                            onChange={(e) => seoChange(key, e.target.checked)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {tab === "history" && (
                  <div className="panel">
                    <div className="panel-heading">
                      <h2>Version history</h2>
                      <p>
                        Load a previous version into the editor, review it, then
                        save or publish.
                      </p>
                    </div>
                    {!record?.versions.length ? (
                      <p className="muted">
                        Your saved versions will appear here.
                      </p>
                    ) : (
                      record.versions.map((version) => (
                        <div className="version-row" key={version.id}>
                          <div>
                            <strong>
                              {version.action === "original"
                                ? "Original content"
                                : version.action === "publish"
                                  ? "Published"
                                  : version.action === "unpublish"
                                    ? "Unpublished"
                                    : "Draft saved"}
                            </strong>
                            <small>
                              {new Date(version.at).toLocaleString()}
                            </small>
                          </div>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => {
                              if (
                                dirty &&
                                !window.confirm(
                                  "Replace unsaved changes with this version?",
                                )
                              )
                                return;
                              setContent(version.content);
                              setTab(
                                content.type === "page" ? "seo" : "content",
                              );
                              setNotice(
                                "Previous version loaded. Review it, then save or publish.",
                              );
                            }}
                          >
                            Load version
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </section>
              <aside className="editor-aside">
                <div className="panel">
                  <p className="eyebrow">SEARCH PREVIEW</p>
                  <div className="search-preview">
                    <small>vdallc.com</small>
                    <span>{content.path || "/your-new-page.html"}</span>
                    <h3>
                      {content.seo.title || content.title || "Your page title"}
                    </h3>
                    <p>
                      {content.seo.description ||
                        content.excerpt ||
                        "Add a description to explain what readers will find on this page."}
                    </p>
                  </div>
                </div>
                <div className="panel publishing-panel">
                  <h3>Publishing</h3>
                  <p>
                    Save a draft to keep working in the repository. Publish when
                    your changes are ready for visitors.
                  </p>
                  {record?.published && (
                    <a href={content.path} target="_blank" rel="noreferrer">
                      View live page ↗
                    </a>
                  )}
                  {record?.published && (
                    <button
                      className="danger-link"
                      disabled={busy}
                      onClick={() => save("unpublish")}
                    >
                      Unpublish page
                    </button>
                  )}
                  <small>
                    Publishing triggers GitHub Pages to rebuild listings,
                    navigation and the sitemap.
                  </small>
                </div>
              </aside>
            </fieldset>
          </>
        ) : section === "strategy" ? (
          <SeoWorkspace
            plan={plan}
            documents={documents}
            busy={busy}
            onSave={savePlan}
            onOpen={open}
            onDirtyChange={setStrategyDirty}
            onRefresh={async () => {
              try {
                await reload();
                setError("");
              } catch (cause) {
                setError((cause as Error).message);
              }
            }}
          />
        ) : (
          <>
            <header className="page-heading">
              <div>
                <p className="eyebrow">YOUR CONTENT, AT A GLANCE</p>
                <h1>
                  {section === "overview"
                    ? "A stronger presence starts here."
                    : labels[section]}
                </h1>
                <p>
                  {section === "overview"
                    ? "Keep your website useful, current, and easy to find."
                    : section === "page"
                      ? "Manage search metadata and sharing settings for every existing page."
                      : `Create, edit, and publish ${section === "blog" ? "articles for veterans" : "the services you offer"}.`}
                </p>
              </div>
              <div className="heading-actions">
                {section !== "service" && section !== "page" && (
                  <button
                    className="primary"
                    onClick={() => create("blog")}
                    disabled={busy}
                  >
                    + New blog post
                  </button>
                )}
                {section === "service" && (
                  <button
                    className="primary"
                    onClick={() => create("service")}
                    disabled={busy}
                  >
                    + New service
                  </button>
                )}
              </div>
            </header>
            {section === "overview" && (
              <div className="stats-grid">
                {(["page", "blog", "service"] as ContentType[]).map((type) => (
                  <button
                    className="stat-card"
                    key={type}
                    onClick={() => navigate(type)}
                  >
                    <span>{labels[type]}</span>
                    <strong>{count(type).toString().padStart(2, "0")}</strong>
                    <small>
                      Manage{" "}
                      {type === "page"
                        ? "metadata"
                        : type === "blog"
                          ? "articles"
                          : "services"}{" "}
                      <b>↗</b>
                    </small>
                  </button>
                ))}
              </div>
            )}
            <section className="content-panel">
              <div className="list-heading">
                <div>
                  <h2>
                    {section === "overview" ? "All content" : labels[section]}
                  </h2>
                  <span>
                    {list.length} {list.length === 1 ? "item" : "items"}
                  </span>
                </div>
                <div className="list-filters">
                  <label className="sr-only" htmlFor="content-search">
                    Search content
                  </label>
                  <input
                    id="content-search"
                    type="search"
                    placeholder="Search title or URL…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <label className="sr-only" htmlFor="status-filter">
                    Publishing status
                  </label>
                  <select
                    id="status-filter"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                    <option value="changes">Unpublished changes</option>
                  </select>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>PAGE / TITLE</th>
                      <th>STATUS</th>
                      <th>SEO</th>
                      <th>LAST SAVED</th>
                      <th>
                        <span className="sr-only">Edit content</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((page) => (
                      <tr key={page.path}>
                        <td>
                          <button
                            className="page-title"
                            disabled={busy}
                            onClick={() => open(page.path)}
                          >
                            {page.title}
                          </button>
                          <span className="page-path">{page.path}</span>
                        </td>
                        <td>
                          <span className={`badge ${page.status}`}>
                            {page.status === "published"
                              ? "Published"
                              : "Draft"}
                          </span>
                          {page.hasChanges && (
                            <small className="has-changes">
                              Unpublished edits
                            </small>
                          )}
                        </td>
                        <td>
                          <span
                            className={
                              page.seoComplete ? "seo-ready" : "seo-review"
                            }
                          >
                            {page.seoComplete
                              ? "● Metadata set"
                              : "○ Needs metadata"}
                          </span>
                          {page.noindex && (
                            <small className="has-changes">Noindex</small>
                          )}
                        </td>
                        <td className="saved-date">
                          {page.updatedAt
                            ? new Date(page.updatedAt).toLocaleDateString(
                                "en-GB",
                              )
                            : "Original content"}
                        </td>
                        <td>
                          <button
                            className="edit-link"
                            disabled={busy}
                            onClick={() => open(page.path)}
                          >
                            Edit <span>↗</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {loading && <p className="empty-state">Loading content…</p>}
                {!loading && !list.length && (
                  <p className="empty-state">
                    No content matches these filters.
                  </p>
                )}
              </div>
            </section>
            <p className="workspace-note">
              <span>◌</span> Drafts stay off the live site. Publish when you’re
              ready.
            </p>
          </>
        )}
      </main>
      {preview && (
        <div className="preview-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            className="preview-dialog"
          >
            <header>
              <h2 id="preview-title">Draft preview</h2>
              <button
                autoFocus
                className="secondary"
                onClick={() => setPreview("")}
              >
                Close preview
              </button>
            </header>
            <iframe
              title="Draft preview"
              srcDoc={preview}
              sandbox="allow-scripts"
            />
          </section>
        </div>
      )}
    </div>
  );
}
