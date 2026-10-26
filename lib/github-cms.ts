import config from "@/cms.config.json";
import { allRecords, recordFor, applyEdit, type Records } from "./records";
import type { Content, ContentSummary, RecordEntry } from "./model";
import {
  emptySeoPlan,
  validateSeoPlan,
  updateTarget,
  type SeoPlan,
  type SeoTarget,
} from "./seo-plan";
const API = "https://api.github.com";
const REPO = `/repos/${config.repository}`;
const STORAGE_KEY = `vda-github:${config.repository}`;
function token() {
  return sessionStorage.getItem(STORAGE_KEY);
}
async function github(path: string, options: RequestInit = {}, raw = false) {
  const accessToken = token();
  if (!accessToken) throw new Error("Sign in with GitHub to continue.");
  const response = await fetch(`${API}${path}`, {
    cache: "no-store",
    ...options,
    headers: {
      Accept: raw
        ? "application/vnd.github.raw+json"
        : "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem(STORAGE_KEY);
      throw new Error(
        "Your GitHub session expired. Sign out and sign in again.",
      );
    }
    if (response.status === 409 || response.status === 422)
      throw new Error(
        "The repository changed while you were saving. Reopen the page and try again.",
      );
    if (response.status === 403)
      throw new Error(
        "GitHub denied this operation. Check repository write access, branch protection, and your API rate limit.",
      );
    const message = (await response.json().catch(() => ({}))).message;
    throw Object.assign(
      new Error(message || `GitHub request failed (${response.status}).`),
      { status: response.status },
    );
  }
  return response.json();
}
async function file<T>(path: string, sha: string, fallback?: T): Promise<T> {
  try {
    return (await github(
      `${REPO}/contents/${path}?ref=${encodeURIComponent(sha)}`,
      {},
      true,
    )) as T;
  } catch (error) {
    if ((error as { status?: number }).status === 404 && fallback !== undefined)
      return fallback;
    throw error;
  }
}
async function snapshot() {
  const ref = await github(
    `${REPO}/git/ref/heads/${encodeURIComponent(config.branch)}`,
  );
  const sha = ref.object.sha as string;
  const [records, published, planData] = await Promise.all([
    file<Records>("data/cms.json", sha, {}),
    file<Content[]>("data/published.json", sha),
    file<SeoPlan>("data/seo-plan.json", sha, emptySeoPlan()),
  ]);
  const plan = validateSeoPlan(
    planData,
    allRecords(records, published).map((record) => record.draft.path),
  );
  return { sha, records, published, plan };
}
async function identity() {
  const [user, repository] = await Promise.all([github("/user"), github(REPO)]);
  if (!repository.permissions?.push)
    throw new Error(
      "This GitHub account needs write access to the VDA repository.",
    );
  return { authenticated: true, user: user.login as string };
}
export async function signInWithGitHub() {
  if (!config.oauthUrl)
    throw new Error(
      "GitHub sign-in needs one-time setup: deploy oauth-worker and set oauthUrl in cms.config.json.",
    );
  const auth = new URL(config.oauthUrl);
  if (
    auth.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(auth.hostname)
  )
    throw new Error("The OAuth service must use HTTPS.");
  auth.pathname = auth.pathname.replace(/\/$/, "") + "/auth";
  const popup = window.open(auth, "vda-github-login", "width=620,height=740");
  if (!popup)
    throw new Error("Allow the GitHub sign-in popup, then try again.");
  try {
    const accessToken = await new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        window.removeEventListener("message", receive);
        clearInterval(poll);
        clearTimeout(timer);
      };
      const receive = (event: MessageEvent) => {
        if (
          event.origin !== auth.origin ||
          event.source !== popup ||
          event.data?.type !== "vda-github-auth"
        )
          return;
        cleanup();
        if (typeof event.data.token === "string" && event.data.token)
          resolve(event.data.token);
        else reject(new Error(event.data.error || "GitHub sign-in failed."));
      };
      const poll = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error("GitHub sign-in was cancelled."));
        }
      }, 500);
      const timer = setTimeout(
        () => {
          cleanup();
          reject(new Error("GitHub sign-in timed out. Please try again."));
        },
        5 * 60 * 1000,
      );
      window.addEventListener("message", receive);
    });
    sessionStorage.setItem(STORAGE_KEY, accessToken);
    try {
      return await identity();
    } catch (error) {
      sessionStorage.removeItem(STORAGE_KEY);
      throw error;
    }
  } finally {
    popup.close();
  }
}
export const publishingStatusUrl = `https://github.com/${config.repository}/actions/workflows/pages.yml`;
export async function getSession(): Promise<{
  authenticated: boolean;
  user?: string;
}> {
  if (!token()) return { authenticated: false };
  try {
    return await identity();
  } catch (error) {
    sessionStorage.removeItem(STORAGE_KEY);
    throw error;
  }
}
export function signOutGitHub() {
  sessionStorage.removeItem(STORAGE_KEY);
}
export async function getEditor(path: string) {
  const current = await snapshot();
  const record = recordFor(path, current.records, current.published);
  if (!record) throw new Error("Content not found.");
  return { record, plan: current.plan };
}
export async function loadWorkspace() {
  const current = await snapshot();
  const records = allRecords(current.records, current.published);
  const pages: ContentSummary[] = records.map((record) => ({
    path: record.draft.path,
    title: record.draft.title,
    type: record.draft.type,
    status: record.published ? "published" : "draft",
    hasChanges: Boolean(
      record.published &&
        JSON.stringify(record.draft) !== JSON.stringify(record.published),
    ),
    revision: record.revision,
    updatedAt: record.updatedAt,
    noindex: record.draft.seo.noindex,
    seoComplete: Boolean(
      record.draft.seo.title && record.draft.seo.description,
    ),
  }));
  return {
    pages,
    documents: records.map((record) => record.draft),
    plan: current.plan,
  };
}
type TreeEntry = { path: string; mode: string; type: string; content: string };
async function commitFiles(sha: string, entries: TreeEntry[], message: string) {
  const commit = await github(`${REPO}/git/commits/${sha}`);
  const tree = await github(`${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }),
  });
  const saved = await github(`${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [sha] }),
  });
  await github(`${REPO}/git/refs/heads/${encodeURIComponent(config.branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: saved.sha, force: false }),
  });
}
export async function commitContent(data: {
  content: Content;
  action: "draft" | "publish" | "unpublish";
  revision: number;
  create: boolean;
  target: SeoTarget;
  planRevision: number;
}) {
  const current = await snapshot();
  const next = applyEdit(current.records, current.published, data);
  const plan = updateTarget(
    current.plan,
    data.content.path,
    data.target,
    data.planRevision,
    allRecords(next.records, next.published).map((record) => record.draft.path),
  );
  const entries: TreeEntry[] = [
    {
      path: "data/cms.json",
      mode: "100644",
      type: "blob",
      content: JSON.stringify(next.records),
    },
  ];
  if (data.action !== "draft")
    entries.push({
      path: "data/published.json",
      mode: "100644",
      type: "blob",
      content: JSON.stringify(next.published),
    });
  if (plan !== current.plan)
    entries.push({
      path: "data/seo-plan.json",
      mode: "100644",
      type: "blob",
      content: JSON.stringify(plan),
    });
  await commitFiles(
    current.sha,
    entries,
    `${data.action === "draft" ? "Save draft" : data.action === "publish" ? "Publish" : "Unpublish"}: ${next.record.draft.title}`,
  );
  return { record: next.record, plan };
}
export async function commitSeoPlan(
  proposed: SeoPlan,
  expectedRevision: number,
): Promise<SeoPlan> {
  const current = await snapshot();
  if (current.plan.revision !== expectedRevision)
    throw new Error(
      "The SEO plan changed in another session. Refresh the workspace before saving.",
    );
  const plan = validateSeoPlan(
    { ...proposed, revision: expectedRevision + 1 },
    allRecords(current.records, current.published).map(
      (record) => record.draft.path,
    ),
  );
  await commitFiles(
    current.sha,
    [
      {
        path: "data/seo-plan.json",
        mode: "100644",
        type: "blob",
        content: JSON.stringify(plan),
      },
    ],
    "Update SEO keywords and clusters",
  );
  return plan;
}
