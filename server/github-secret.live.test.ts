import { describe, expect, it } from "vitest";
import { executeGitHubTool } from "./github-tools";
import { isAgentAdminForTests } from "./agent-router";

const runLive = process.env.RUN_LIVE_GITHUB_SECRET === "1";
describe.skipIf(!runLive)("configured GitHub repository token", () => {
  it("recognizes only the explicitly configured administrator email", () => {
    expect(process.env.AGENT_ADMIN_EMAIL?.trim().toLowerCase()).toBe("niko.oeben@gmail.com");
    expect(isAgentAdminForTests({ role: "user", email: "niko.oeben@gmail.com" })).toBe(true);
    expect(isAgentAdminForTests({ role: "user", email: "not-the-admin@example.invalid" })).toBe(false);
  });

  it("authenticates and reads only the configured repository without mutating it", async () => {
    const token = process.env.GITHUB_TOKEN?.trim();
    expect(token, "GITHUB_TOKEN must be set in the protected WebDev secrets manager").toBeTruthy();
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" };
    const auth = await fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(12_000) });
    expect(auth.status, "GitHub token authentication (/user)").toBe(200);
    const adapterResult = await executeGitHubTool("github_repo_overview", {});
    expect(adapterResult).toMatchObject({ tool: "github_repo_overview", result: { repository: "niknight1403/Agenten-Villa" } });
    const repo = await fetch("https://api.github.com/repos/niknight1403/Agenten-Villa", { headers, signal: AbortSignal.timeout(12_000) });
    expect(repo.status, "configured repository access").toBe(200);
    const metadata = await repo.json() as { full_name?: string; default_branch?: string };
    expect(metadata.full_name).toBe("niknight1403/Agenten-Villa");
    expect(metadata.default_branch).toBeTruthy();
  });
});
