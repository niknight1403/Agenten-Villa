import { afterEach, describe, expect, it, vi } from "vitest";
import { executeGitHubTool, GitHubToolError, isAgentBranchName, isSafeGitHubPath } from "./github-tools";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const repoResponse = () => new Response(JSON.stringify({ full_name: "niknight1403/Agenten-Villa", description: "test", default_branch: "main", private: true, html_url: "https://github.com/niknight1403/Agenten-Villa", open_issues_count: 2 }), { status: 200 });

describe("GitHub repository tool boundary", () => {
  it("uses a server-side token and the single configured repository", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(repoResponse());
    const result = await executeGitHubTool("github_repo_overview", {}, { token: "ghp-test-secret", fetcher });
    expect(result).toMatchObject({ result: { repository: "niknight1403/Agenten-Villa", defaultBranch: "main", visibility: "private" } });
    expect(fetcher).toHaveBeenCalledWith("https://api.github.com/repos/niknight1403/Agenten-Villa", expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer ghp-test-secret", "X-GitHub-Api-Version": "2026-03-10" }) }));
    expect(JSON.stringify(result)).not.toContain("ghp-test-secret");
  });

  it("rejects traversal, secret, workflow and absolute file paths", () => {
    for (const path of ["../README.md", "/README.md", "src\\Home.tsx", ".env", ".env.production", ".github/workflows/ci.yml", "config/secrets/key.json", "secrets/token.json", "id_rsa", "certs/app.pem", ".npmrc"]) expect(isSafeGitHubPath(path)).toBe(false);
    expect(isSafeGitHubPath("src/pages/Home.tsx")).toBe(true);
  });

  it("allows writes only to agent branches", () => {
    expect(isAgentBranchName("agent/feature-abc123")).toBe(true);
    expect(isAgentBranchName("main")).toBe(false);
    expect(isAgentBranchName("agent/main")).toBe(false);
    expect(isAgentBranchName("feature/regular")).toBe(false);
  });

  it("rejects a main-branch write before sending a mutation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(repoResponse());
    await expect(executeGitHubTool("github_write_file", { path: "README.md", branch: "main", content: "x", message: "update" }, { token: "test", fetcher })).rejects.toBeInstanceOf(GitHubToolError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("writes a new file only to an agent branch and base64 encodes the content", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(repoResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "not found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: { path: "docs/note.md", html_url: "https://github.com/example" }, commit: { sha: "abcdef1234567890" } }), { status: 201 }));
    const result = await executeGitHubTool("github_write_file", { path: "docs/note.md", branch: "agent/docs-abc123", content: "sichere Notiz", message: "docs: add note" }, { token: "test", fetcher });
    expect(result).toMatchObject({ result: { path: "docs/note.md", branch: "agent/docs-abc123", commit: "abcdef123456" } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const writeRequest = fetcher.mock.calls[2]?.[1];
    expect(writeRequest?.method).toBe("PUT");
    expect(JSON.parse(String(writeRequest?.body))).toMatchObject({ branch: "agent/docs-abc123", content: Buffer.from("sichere Notiz").toString("base64") });
  });

  it("fails closed without a configured server token", async () => {
    await expect(executeGitHubTool("github_repo_overview", {}, { token: "" })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});
