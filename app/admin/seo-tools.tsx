"use client";
import { useEffect, useRef, useState } from "react";
import type { Content } from "@/lib/model";
import config from "@/cms.config.json";
import {
  clusterHealth,
  effectiveTarget,
  emptyTarget,
  keywordKey,
  keywordList,
  searchIntents,
  targetChecks,
  type KeywordCluster,
  type SeoPlan,
  type SeoTarget,
} from "@/lib/seo-plan";
import Field from "./field";
export function KeywordInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint?: string;
}) {
  const [text, setText] = useState(value.join("\n"));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value.join("\n"));
  }, [value]);
  return (
    <Field
      label={label}
      hint={
        hint ||
        "One phrase per line, or separate phrases with commas. Duplicates are removed."
      }
    >
      <textarea
        rows={3}
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          setText(keywordList(text).join("\n"));
        }}
        onChange={(event) => {
          setText(event.target.value);
          onChange(keywordList(event.target.value));
        }}
      />
    </Field>
  );
}
export function SeoTargetFields({
  content,
  target,
  plan,
  onChange,
  onCreateCluster,
}: {
  content: Content;
  target: SeoTarget;
  plan: SeoPlan;
  onChange: (target: SeoTarget) => void;
  onCreateCluster: () => Promise<void>;
}) {
  const cluster = plan.clusters.find(
    (cluster) => cluster.id === target.clusterId,
  );
  const effective = effectiveTarget(target, plan);
  const checks = targetChecks(content, effective);
  return (
    <div className="panel seo-target-panel">
      <div className="panel-heading">
        <h2>Keywords & topic targeting</h2>
        <p>
          Plan what this page covers and how it supports the rest of your
          content.
        </p>
      </div>
      <Field
        label="Primary keyword"
        hint={
          cluster
            ? `Leave blank to use the cluster keyword: ${cluster.primaryKeyword}`
            : "The main search phrase this page should answer."
        }
      >
        <input
          value={target.primaryKeyword}
          onChange={(event) =>
            onChange({ ...target, primaryKeyword: event.target.value })
          }
        />
      </Field>
      <KeywordInput
        label="Secondary keywords"
        value={target.secondaryKeywords}
        onChange={(value) => onChange({ ...target, secondaryKeywords: value })}
        hint={
          cluster
            ? "Optional page-specific supporting phrases. Leave empty to use the cluster’s phrases."
            : undefined
        }
      />
      <KeywordInput
        label="Target keywords"
        value={target.targetKeywords}
        onChange={(value) => onChange({ ...target, targetKeywords: value })}
        hint="Additional closely related queries you want to cover naturally."
      />
      <Field label="Search intent">
        <select
          value={target.searchIntent}
          onChange={(event) =>
            onChange({
              ...target,
              searchIntent: event.target.value as SeoTarget["searchIntent"],
            })
          }
        >
          <option value="">
            {cluster
              ? `Use cluster intent (${cluster.intent})`
              : "Choose an intent"}
          </option>
          {searchIntents.map((intent) => (
            <option key={intent} value={intent}>
              {intent[0].toUpperCase() + intent.slice(1)}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-grid">
        <Field label="Keyword cluster">
          <select
            value={target.clusterId}
            onChange={(event) =>
              onChange({
                ...target,
                clusterId: event.target.value,
                clusterRole: "supporting",
              })
            }
          >
            <option value="">No cluster assigned</option>
            {plan.clusters
              .filter(
                (item) =>
                  item.status === "active" || item.id === target.clusterId,
              )
              .map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                  disabled={
                    item.status === "archived" && item.id !== target.clusterId
                  }
                >
                  {item.name}
                  {item.status === "archived" ? " (archived)" : ""}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Role in cluster">
          <select
            value={target.clusterRole}
            disabled={!target.clusterId}
            onChange={(event) =>
              onChange({
                ...target,
                clusterRole: event.target.value as SeoTarget["clusterRole"],
              })
            }
          >
            <option value="supporting">Supporting content</option>
            <option value="primary">Primary topic page</option>
          </select>
        </Field>
      </div>
      {!cluster && (
        <button
          type="button"
          className="text-button create-cluster-link"
          disabled={!target.primaryKeyword.trim()}
          onClick={() => void onCreateCluster()}
        >
          + Create a cluster from this primary keyword
        </button>
      )}
      {cluster && (
        <div className="cluster-summary">
          <strong>{cluster.name}</strong>
          <span>
            {cluster.primaryKeyword} · {cluster.secondaryKeywords.length}{" "}
            supporting phrases · {cluster.intent}
          </span>
          <small>
            {cluster.status === "archived"
              ? "This cluster is archived. Choose an active cluster when revising the page."
              : target.clusterRole === "primary"
                ? "This page owns the cluster’s main topic."
                : "Link this supporting content to the cluster’s primary page where useful."}
          </small>
        </div>
      )}
      <div className="seo-checks">
        <h3>Content checks</h3>
        {checks.length ? (
          <ul>
            {checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        ) : (
          <p>
            Primary keyword, intent, title and description are set. Review the
            page for usefulness and natural language.
          </p>
        )}
        <small>
          These are editorial prompts, not a ranking score. Keywords are
          planning data; no meta keywords tag is added.
        </small>
      </div>
    </div>
  );
}
function freshCluster(): KeywordCluster {
  const at = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "",
    primaryKeyword: "",
    secondaryKeywords: [],
    intent: "informational",
    supportingQuestions: [],
    includedTopics: [],
    excludedTerms: [],
    notes: "",
    status: "active",
    createdAt: at,
    updatedAt: at,
  };
}
export default function SeoWorkspace({
  plan,
  documents,
  busy,
  onSave,
  onOpen,
  onDirtyChange,
  onRefresh,
}: {
  plan: SeoPlan;
  documents: Content[];
  busy: boolean;
  onSave: (plan: SeoPlan) => Promise<void>;
  onOpen: (path: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [editing, setEditing] = useState<KeywordCluster | null>(null);
  const [primaryPath, setPrimaryPath] = useState("");
  const [supportingPaths, setSupportingPaths] = useState<string[]>([]);
  const [keepPrevious, setKeepPrevious] = useState(true);
  const [originalKeyword, setOriginalKeyword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    onDirtyChange(Boolean(editing));
    return () => onDirtyChange(false);
  }, [editing, onDirtyChange]);
  const active = plan.clusters.filter((cluster) => cluster.status === "active");
  const health = active.map((cluster) =>
    clusterHealth(cluster, plan, documents, config.siteUrl),
  );
  const visible = plan.clusters.filter(
    (cluster) =>
      (status === "all" || cluster.status === status) &&
      `${cluster.name} ${cluster.primaryKeyword} ${cluster.secondaryKeywords.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const targeted = documents.filter((page) => {
    const target = plan.targets[page.path];
    return Boolean(target?.primaryKeyword || target?.clusterId);
  });
  const explicitTargets = targeted.filter((page) =>
    plan.targets[page.path].primaryKeyword.trim(),
  );
  const duplicateKeywords = [
    ...new Set(
      explicitTargets.map((page) =>
        keywordKey(plan.targets[page.path].primaryKeyword),
      ),
    ),
  ].filter(
    (keyword) =>
      explicitTargets.filter(
        (page) =>
          keywordKey(plan.targets[page.path].primaryKeyword) === keyword,
      ).length > 1,
  );
  function edit(cluster: KeywordCluster) {
    setEditing(structuredClone(cluster));
    setOriginalKeyword(cluster.primaryKeyword);
    setKeepPrevious(true);
    setError("");
    setPrimaryPath(
      Object.keys(plan.targets).find(
        (path) =>
          plan.targets[path].clusterId === cluster.id &&
          plan.targets[path].clusterRole === "primary",
      ) || "",
    );
    setSupportingPaths(
      Object.keys(plan.targets).filter(
        (path) =>
          plan.targets[path].clusterId === cluster.id &&
          plan.targets[path].clusterRole === "supporting",
      ),
    );
  }
  async function save() {
    if (!editing) return;
    setError("");
    try {
      const at = new Date().toISOString();
      const secondary = keywordList([
        ...editing.secondaryKeywords,
        ...(keepPrevious &&
        originalKeyword &&
        keywordKey(originalKeyword) !== keywordKey(editing.primaryKeyword)
          ? [originalKeyword]
          : []),
      ]).filter(
        (keyword) => keywordKey(keyword) !== keywordKey(editing.primaryKeyword),
      );
      const cluster = {
        ...editing,
        name: editing.name.trim() || editing.primaryKeyword.trim(),
        secondaryKeywords: secondary,
        updatedAt: at,
      };
      const targets = structuredClone(plan.targets);
      for (const [path, target] of Object.entries(targets))
        if (target.clusterId === cluster.id)
          targets[path] = {
            ...target,
            clusterId: "",
            clusterRole: "supporting",
          };
      for (const path of [
        ...new Set([primaryPath, ...supportingPaths].filter(Boolean)),
      ]) {
        const old = plan.targets[path] ?? emptyTarget();
        if (old.clusterId && old.clusterId !== cluster.id)
          throw new Error(
            "A selected page belongs to another cluster. Update its assignment in the page editor before moving it here.",
          );
        targets[path] = {
          ...old,
          clusterId: cluster.id,
          clusterRole: path === primaryPath ? "primary" : "supporting",
        };
      }
      await onSave({
        ...plan,
        clusters: [
          ...plan.clusters.filter((item) => item.id !== cluster.id),
          cluster,
        ],
        targets,
      });
      setEditing(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function archive(cluster: KeywordCluster) {
    setError("");
    try {
      await onSave({
        ...plan,
        clusters: plan.clusters.map((item) =>
          item.id === cluster.id
            ? {
                ...item,
                status: item.status === "active" ? "archived" : "active",
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">SEO STRATEGY</p>
          <h1>Keywords & clusters</h1>
          <p>
            Map search topics to a primary page and useful supporting content.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="secondary"
            disabled={busy || Boolean(editing)}
            onClick={() => void onRefresh()}
          >
            Refresh plan
          </button>{" "}
          <button
            className="primary"
            disabled={busy || Boolean(editing)}
            onClick={() => {
              setEditing(freshCluster());
              setOriginalKeyword("");
              setPrimaryPath("");
              setSupportingPaths([]);
              setError("");
            }}
          >
            + New cluster
          </button>
        </div>
      </header>
      <div className="stats-grid">
        <div className="stat-card">
          <span>Active clusters</span>
          <strong>{active.length}</strong>
        </div>
        <div className="stat-card">
          <span>Pages with targeting</span>
          <strong>{targeted.length}</strong>
        </div>
        <div className="stat-card">
          <span>Clusters to review</span>
          <strong>{health.filter((item) => item.gaps.length).length}</strong>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <fieldset className="cluster-form panel" disabled={busy}>
          <div className="panel-heading">
            <h2>
              {plan.clusters.some((cluster) => cluster.id === editing.id)
                ? "Edit cluster"
                : "New keyword cluster"}
            </h2>
            <p>
              Changes are saved to the SEO plan. They do not rewrite or publish
              page content.
            </p>
          </div>
          <div className="field-grid">
            <Field label="Cluster name">
              <input
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
                placeholder="e.g. VA disability appeals"
              />
            </Field>
            <Field label="Cluster primary keyword">
              <input
                required
                value={editing.primaryKeyword}
                onChange={(event) =>
                  setEditing({ ...editing, primaryKeyword: event.target.value })
                }
              />
            </Field>
          </div>
          <KeywordInput
            label="Cluster supporting keywords"
            value={editing.secondaryKeywords}
            onChange={(value) =>
              setEditing({ ...editing, secondaryKeywords: value })
            }
          />
          {originalKeyword &&
            keywordKey(originalKeyword) !==
              keywordKey(editing.primaryKeyword) && (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={keepPrevious}
                  onChange={(event) => setKeepPrevious(event.target.checked)}
                />
                Keep the previous primary keyword as a supporting keyword
              </label>
            )}
          <div className="field-grid">
            <Field label="Cluster search intent">
              <select
                value={editing.intent}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    intent: event.target.value as KeywordCluster["intent"],
                  })
                }
              >
                {searchIntents.map((intent) => (
                  <option key={intent} value={intent}>
                    {intent}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Primary topic page">
              <select
                value={primaryPath}
                onChange={(event) => setPrimaryPath(event.target.value)}
              >
                <option value="">Planned — no page assigned yet</option>
                {documents.map((page) => (
                  <option key={page.path} value={page.path}>
                    {page.title} · {page.path}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Supporting pages"
            hint="Select one or more pages. Hold Command on Mac or Control on Windows for multiple selections."
          >
            <select
              multiple
              size={6}
              value={supportingPaths.filter((path) => path !== primaryPath)}
              onChange={(event) =>
                setSupportingPaths(
                  [...event.target.selectedOptions].map(
                    (option) => option.value,
                  ),
                )
              }
            >
              {documents
                .filter((page) => page.path !== primaryPath)
                .map((page) => (
                  <option key={page.path} value={page.path}>
                    {page.title} · {page.path}
                  </option>
                ))}
            </select>
          </Field>
          <KeywordInput
            label="Supporting questions"
            value={editing.supportingQuestions}
            onChange={(value) =>
              setEditing({ ...editing, supportingQuestions: value })
            }
          />
          <KeywordInput
            label="Included topics"
            value={editing.includedTopics}
            onChange={(value) =>
              setEditing({ ...editing, includedTopics: value })
            }
          />
          <KeywordInput
            label="Excluded terms"
            value={editing.excludedTerms}
            onChange={(value) =>
              setEditing({ ...editing, excludedTerms: value })
            }
          />
          <Field label="Cluster notes">
            <textarea
              rows={4}
              value={editing.notes}
              onChange={(event) =>
                setEditing({ ...editing, notes: event.target.value })
              }
            />
          </Field>
          <div className="editor-actions">
            <button className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!editing.primaryKeyword.trim()}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save cluster"}
            </button>
          </div>
        </fieldset>
      )}
      <section className="content-panel clusters-panel">
        <div className="list-heading">
          <div>
            <h2>Content map</h2>
            <span>{visible.length} clusters</span>
          </div>
          <div className="list-filters">
            <input
              aria-label="Search clusters"
              type="search"
              placeholder="Find a topic or keyword…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="Cluster status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All clusters</option>
            </select>
          </div>
        </div>
        <div className="cluster-cards">
          {!visible.length && (
            <p className="empty-state">
              No clusters yet. Create a topic, add keywords, and assign its
              pages.
            </p>
          )}
          {visible.map((cluster) => {
            const review = clusterHealth(
              cluster,
              plan,
              documents,
              config.siteUrl,
            );
            return (
              <article className="cluster-card" key={cluster.id}>
                <header>
                  <div>
                    <h3>{cluster.name}</h3>
                    <p>
                      {cluster.primaryKeyword} · {cluster.intent} ·{" "}
                      {cluster.status}
                    </p>
                  </div>
                  <div className="editor-actions">
                    <button
                      className="secondary"
                      disabled={busy || Boolean(editing)}
                      onClick={() => edit(cluster)}
                    >
                      Edit cluster
                    </button>
                    <button
                      className="text-button"
                      disabled={busy || Boolean(editing)}
                      onClick={() => void archive(cluster)}
                    >
                      {cluster.status === "active" ? "Archive" : "Restore"}
                    </button>
                  </div>
                </header>
                <div className="keyword-tags">
                  {cluster.secondaryKeywords.map((keyword) => (
                    <span key={keywordKey(keyword)}>{keyword}</span>
                  ))}
                </div>
                <div className="cluster-map">
                  <div>
                    <span className="side-caption">PRIMARY PAGE</span>
                    {review.primary ? (
                      <button
                        className="page-title"
                        onClick={() => onOpen(review.primary!.path)}
                      >
                        {review.primary.title}
                      </button>
                    ) : (
                      <p className="muted">No primary page assigned</p>
                    )}
                  </div>
                  <div>
                    <span className="side-caption">SUPPORTING CONTENT</span>
                    {review.supporting.length ? (
                      review.supporting.map((page) => (
                        <button
                          className="page-title"
                          key={page.path}
                          onClick={() => onOpen(page.path)}
                        >
                          {page.title}
                        </button>
                      ))
                    ) : (
                      <p className="muted">No supporting pages assigned</p>
                    )}
                  </div>
                </div>
                {review.gaps.length > 0 && (
                  <div className="seo-checks">
                    <h4>Review next</h4>
                    <ul>
                      {review.gaps.map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!review.gaps.length && (
                  <p className="muted">
                    Primary and supporting pages are assigned, with body links
                    from the saved supporting drafts.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <section className="panel targeting-inventory">
        <div className="panel-heading">
          <h2>Page targeting</h2>
          <p>
            Review shared target phrases before creating overlapping content.
            This is an editorial review, not confirmed search cannibalization.
          </p>
        </div>
        {duplicateKeywords.length > 0 && (
          <p className="planning-note">
            Shared primary phrases to review: {duplicateKeywords.join(" · ")}
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Primary keyword</th>
                <th>Cluster / role</th>
              </tr>
            </thead>
            <tbody>
              {targeted.map((page) => {
                const target = plan.targets[page.path];
                const effective = effectiveTarget(target, plan);
                const cluster = plan.clusters.find(
                  (item) => item.id === target.clusterId,
                );
                return (
                  <tr key={page.path}>
                    <td>
                      <button
                        className="page-title"
                        onClick={() => onOpen(page.path)}
                      >
                        {page.title}
                      </button>
                    </td>
                    <td>{effective.primaryKeyword || "Not set"}</td>
                    <td>
                      {cluster
                        ? `${cluster.name} · ${target.clusterRole}`
                        : "Unassigned"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!targeted.length && (
            <p className="empty-state">
              Add keyword targeting in any page’s SEO & sharing tab.
            </p>
          )}
        </div>
      </section>
      <p className="workspace-note">
        Planning checks use saved drafts. Search rankings, traffic and live
        keyword volumes are not connected.
      </p>
    </>
  );
}
