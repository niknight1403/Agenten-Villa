import { randomUUID } from "node:crypto";
import { z } from "zod";

export const GITHUB_REPOSITORY = "niknight1403/Agenten-Villa";
const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const MAX_FILE_BYTES = 48_000;
const MAX_READ_CHARS = 16_000;

export const githubToolSchemas = {
  github_repo_overview: { type: "object", properties: {}, additionalProperties: false },
  github_list_commits: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 10 } }, additionalProperties: false },
  github_list_files: { type: "object", properties: { path: { type: "string", maxLength: 240 } }, additionalProperties: false },
  github_read_file: { type: "object", required: ["path"], properties: { path: { type: "string", minLength: 1, maxLength: 240 }, ref: { type: "string", maxLength: 100 } }, additionalProperties: false },
  github_list_issues: { type: "object", properties: { state: { type: "string", enum: ["open", "closed", "all"] } }, additionalProperties: false },
  github_create_issue: { type: "object", required: ["title", "body"], properties: { title: { type: "string", minLength: 1, maxLength: 200 }, body: { type: "string", maxLength: 6000 } }, additionalProperties: false },
  github_create_branch: { type: "object", required: ["purpose"], properties: { purpose: { type: "string", minLength: 1, maxLength: 80 } }, additionalProperties: false },
  github_write_file: { type: "object", required: ["path", "branch", "content", "message"], properties: { path: { type: "string", minLength: 1, maxLength: 240 }, branch: { type: "string", minLength: 1, maxLength: 100 }, content: { type: "string", maxLength: MAX_FILE_BYTES }, message: { type: "string", minLength: 1, maxLength: 120 } }, additionalProperties: false },
  github_open_pull_request: { type: "object", required: ["branch", "title", "body"], properties: { branch: { type: "string", minLength: 1, maxLength: 100 }, title: { type: "string", minLength: 1, maxLength: 200 }, body: { type: "string", maxLength: 6000 } }, additionalProperties: false },
} as const;

function toolDescription(name: keyof typeof githubToolSchemas) {
  const descriptions: Record<keyof typeof githubToolSchemas, string> = {
    github_repo_overview: "Read basic metadata and the default branch for the configured repository.",
    github_list_commits: "List the most recent commits from the configured repository's default branch.",
    github_list_files: "List file and directory names at a repository path, using the default branch unless path points to root.",
    github_read_file: "Read a text file from the configured repository; return at most 16000 characters.",
    github_list_issues: "List issues (not pull requests) from the configured repository.",
    github_create_issue: "Create an issue only when the user explicitly requests it.",
    github_create_branch: "Create a new uniquely named agent/<purpose>-<id> branch from the default branch. Never writes to the default branch.",
    github_write_file: "Create or update one text file on an existing agent/* branch only. Never modify workflows, secrets, or files on the default branch.",
    github_open_pull_request: "Open a draft pull request from an agent/* branch to the repository default branch. Never merge it.",
  };
  return descriptions[name];
}

export const githubTools = Object.entries(githubToolSchemas).map(([name, parameters]) => ({
  type: "function" as const,
  function: { name, description: toolDescription(name as keyof typeof githubToolSchemas), parameters },
}));

const pathSchema = z.string().trim().min(1).max(240).refine((path) => {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  const normalized = path.toLowerCase();
  const fileName = parts.at(-1) ?? "";
  if (parts.some((part) => ["secrets", "credentials"].includes(part.toLowerCase()))) return false;
  if (parts.some((part) => part.toLowerCase() === ".env" || part.toLowerCase().startsWith(".env."))) return false;
  if ([".npmrc", ".pypirc", ".git-credentials", "id_rsa", "id_ed25519"].includes(fileName) || /\.(pem|key|p12|pfx)$/i.test(fileName)) return false;
  if (normalized === ".github/workflows" || normalized.startsWith(".github/workflows/")) return false;
  return true;
}, "This repository path is not permitted.");

const inputSchemas: Record<string, z.ZodTypeAny> = {
  github_repo_overview: z.object({}).strict(),
  github_list_commits: z.object({ limit: z.number().int().min(1).max(10).default(5) }).strict(),
  github_list_files: z.object({ path: z.string().max(240).optional() }).strict(),
  github_read_file: z.object({ path: pathSchema, ref: z.string().trim().min(1).max(100).optional() }).strict(),
  github_list_issues: z.object({ state: z.enum(["open", "closed", "all"]).default("open") }).strict(),
  github_create_issue: z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(6000) }).strict(),
  github_create_branch: z.object({ purpose: z.string().trim().min(1).max(80) }).strict(),
  github_write_file: z.object({ path: pathSchema, branch: z.string().trim().min(1).max(100), content: z.string().max(MAX_FILE_BYTES), message: z.string().trim().min(1).max(120) }).strict(),
  github_open_pull_request: z.object({ branch: z.string().trim().min(1).max(100), title: z.string().trim().min(1).max(200), body: z.string().max(6000) }).strict(),
};

type Fetcher = typeof fetch;
export type GitHubDependencies = { fetcher?: Fetcher; token?: string; repository?: string; now?: () => number };
type GitHubErrorCode = "NOT_CONFIGURED" | "AUTH" | "NOT_FOUND" | "PERMISSION" | "RATE_LIMIT" | "INVALID" | "UNAVAILABLE" | "CONFLICT";
export class GitHubToolError extends Error {
  constructor(public readonly code: GitHubErrorCode, message: string, public readonly status?: number) { super(message); this.name = "GitHubToolError"; }
}

function target(repository: string) {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new GitHubToolError("INVALID", "Das konfigurierte Repository ist ungültig.");
  return { owner: parts[0]!, repo: parts[1]!, path: `/repos/${encodeURIComponent(parts[0]!)}/${encodeURIComponent(parts[1]!)}` };
}
function encodedPath(path: string) { return path.split("/").map(encodeURIComponent).join("/"); }
function agentBranch(branch: string) { return /^agent\/[a-z0-9][a-z0-9._-]{0,90}$/i.test(branch) && !/^agent\/(main|master|trunk)(?:$|[-.])/i.test(branch); }

function safeApiError(status: number): GitHubToolError {
  if (status === 401) return new GitHubToolError("AUTH", "GitHub hat den Repository-Token abgewiesen.", status);
  if (status === 403) return new GitHubToolError("PERMISSION", "GitHub verweigert diese Aktion; prüfe die minimalen Repository-Berechtigungen oder das API-Limit.", status);
  if (status === 404) return new GitHubToolError("NOT_FOUND", "Repository oder angeforderte Ressource wurde nicht gefunden.", status);
  if (status === 409 || status === 422) return new GitHubToolError("CONFLICT", "GitHub konnte die Aktion wegen eines Branch-, Datei- oder Validierungskonflikts nicht anwenden.", status);
  if (status >= 500) return new GitHubToolError("UNAVAILABLE", "GitHub ist vorübergehend nicht erreichbar.", status);
  return new GitHubToolError("INVALID", "GitHub hat die Anfrage abgelehnt.", status);
}

export function createGitHubClient(deps: GitHubDependencies = {}) {
  const token = deps.token ?? process.env.GITHUB_TOKEN?.trim();
  const repository = deps.repository ?? GITHUB_REPOSITORY;
  if (!token) throw new GitHubToolError("NOT_CONFIGURED", "Der GitHub-Token ist noch nicht im geschützten Server-Secret hinterlegt.");
  const repo = target(repository);
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${API_ROOT}${repo.path}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch { throw new GitHubToolError("UNAVAILABLE", "Die GitHub-API ist vorübergehend nicht erreichbar."); }
    if (!response.ok) throw safeApiError(response.status);
    try { return await response.json() as T; }
    catch { throw new GitHubToolError("INVALID", "GitHub lieferte keine lesbare Antwort."); }
  }

  async function overview() {
    const data = await request<any>("GET", "");
    return { repository: data.full_name, description: data.description ?? null, defaultBranch: data.default_branch, visibility: data.visibility ?? (data.private ? "private" : "public"), url: data.html_url, openIssues: data.open_issues_count };
  }

  async function run(name: string, rawArgs: unknown): Promise<{ tool: string; result: unknown }> {
    const schema = inputSchemas[name];
    if (!schema) throw new GitHubToolError("INVALID", "Unbekanntes GitHub-Werkzeug.");
    const parsed = schema.safeParse(rawArgs ?? {});
    if (!parsed.success) throw new GitHubToolError("INVALID", "Die GitHub-Werkzeugparameter sind ungültig oder überschreiten das Aktionslimit.");
    const args = parsed.data as Record<string, any>;
    const current = await overview();
    const defaultBranch = current.defaultBranch as string;

    if (name === "github_repo_overview") return { tool: name, result: current };
    if (name === "github_list_commits") {
      const rows = await request<any[]>("GET", `/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=${args.limit ?? 5}`);
      return { tool: name, result: rows.map((row) => ({ sha: row.sha?.slice(0, 12), message: String(row.commit?.message ?? "").split("\n")[0].slice(0, 180), author: row.commit?.author?.name ?? null, date: row.commit?.author?.date ?? null, url: row.html_url })) };
    }
    if (name === "github_list_files") {
      const path = args.path ? pathSchema.parse(args.path) : "";
      const rows = await request<any>("GET", `/contents${path ? `/${encodedPath(path)}` : `?ref=${encodeURIComponent(defaultBranch)}`}`);
      if (!Array.isArray(rows)) return { tool: name, result: [{ name: rows.name, path: rows.path, type: rows.type }] };
      return { tool: name, result: rows.slice(0, 100).map((row) => ({ name: row.name, path: row.path, type: row.type, size: row.size })) };
    }
    if (name === "github_read_file") {
      const path = pathSchema.parse(args.path);
      const ref = args.ref ?? defaultBranch;
      const row = await request<any>("GET", `/contents/${encodedPath(path)}?ref=${encodeURIComponent(ref)}`);
      if (row.type !== "file" || row.encoding !== "base64" || typeof row.content !== "string") throw new GitHubToolError("INVALID", "Diese Datei kann nicht als normale Textdatei gelesen werden.");
      const content = Buffer.from(row.content.replace(/\s/g, ""), "base64").toString("utf8");
      return { tool: name, result: { path: row.path, size: row.size, content: content.slice(0, MAX_READ_CHARS), truncated: content.length > MAX_READ_CHARS } };
    }
    if (name === "github_list_issues") {
      const rows = await request<any[]>("GET", `/issues?state=${args.state ?? "open"}&per_page=30`);
      return { tool: name, result: rows.filter((row) => !row.pull_request).slice(0, 30).map((row) => ({ number: row.number, title: row.title, state: row.state, url: row.html_url, updatedAt: row.updated_at })) };
    }
    if (name === "github_create_issue") {
      const row = await request<any>("POST", "/issues", { title: args.title, body: args.body });
      return { tool: name, result: { number: row.number, title: row.title, url: row.html_url, state: row.state } };
    }
    if (name === "github_create_branch") {
      const purpose = String(args.purpose).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "change";
      const baseRef = await request<any>("GET", `/git/ref/heads/${encodeURIComponent(defaultBranch)}`);
      const branch = `agent/${purpose}-${now().toString(36)}-${randomUUID().slice(0, 6)}`;
      const created = await request<any>("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: baseRef.object.sha });
      return { tool: name, result: { branch, sha: created.object?.sha ?? baseRef.object.sha, base: defaultBranch, url: created.url } };
    }
    if (name === "github_write_file") {
      const path = pathSchema.parse(args.path);
      if (!agentBranch(args.branch)) throw new GitHubToolError("INVALID", "Schreibzugriffe sind ausschließlich auf agent/*-Branches erlaubt.");
      if (Buffer.byteLength(args.content, "utf8") > MAX_FILE_BYTES) throw new GitHubToolError("INVALID", "Dateiinhalt überschreitet das sichere Größenlimit.");
      let sha: string | undefined;
      try {
        const existing = await request<any>("GET", `/contents/${encodedPath(path)}?ref=${encodeURIComponent(args.branch)}`);
        if (existing.type !== "file" || typeof existing.sha !== "string") throw new GitHubToolError("INVALID", "Nur reguläre Dateien können aktualisiert werden.");
        sha = existing.sha;
      } catch (error) {
        if (!(error instanceof GitHubToolError) || error.code !== "NOT_FOUND") throw error;
      }
      const body: Record<string, unknown> = { message: args.message, content: Buffer.from(args.content, "utf8").toString("base64"), branch: args.branch };
      if (sha) body.sha = sha;
      const row = await request<any>("PUT", `/contents/${encodedPath(path)}`, body);
      return { tool: name, result: { path: row.content?.path ?? path, branch: args.branch, commit: row.commit?.sha?.slice(0, 12), url: row.content?.html_url } };
    }
    if (name === "github_open_pull_request") {
      if (!agentBranch(args.branch) || args.branch === defaultBranch) throw new GitHubToolError("INVALID", "Pull Requests dürfen ausschließlich von agent/*-Branches zum Default-Branch eröffnet werden.");
      const row = await request<any>("POST", "/pulls", { title: args.title, body: args.body, head: args.branch, base: defaultBranch, draft: true });
      return { tool: name, result: { number: row.number, title: row.title, url: row.html_url, draft: row.draft, base: defaultBranch, head: args.branch } };
    }
    throw new GitHubToolError("INVALID", "Unbekanntes GitHub-Werkzeug.");
  }

  return { overview, run };
}

export async function executeGitHubTool(name: string, rawArgs: unknown, deps: GitHubDependencies = {}) { return createGitHubClient(deps).run(name, rawArgs); }
export function isSafeGitHubPath(path: string) { return pathSchema.safeParse(path).success; }
export function isAgentBranchName(branch: string) { return agentBranch(branch); }
export const GITHUB_TOOL_LIMITS = { filesPerListing: 100, commits: 10, issuesPerListing: 30, readChars: MAX_READ_CHARS, writeBytes: MAX_FILE_BYTES, actionsPerTurn: 3 } as const;
