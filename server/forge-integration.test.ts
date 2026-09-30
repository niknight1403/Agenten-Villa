import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { appRouter } from "./routers";
import { resetAgentRouterForTests } from "./agent-router";
import { runAutonomousProjectWithGitHub } from "./agent-engine";
import { executeGitHubTool } from "./github-tools";
import * as missionStore from "./elite-mission-store";
import type { TrpcContext } from "./_core/context";
import {
  forgeOptionsSchema,
  buildForgePlan,
  assessForgeChecks,
} from "../shared/forge";

const forge = {
  strategy: "OPTIMIZE" as const,
  productReview: true,
  memory: [
    {
      kind: "CONSTRAINT" as const,
      title: "Daten",
      content: "Keine Daten löschen",
      importance: 10,
    },
  ],
};
const sha = "a".repeat(40);
function ctx(role: "user" | "admin" = "admin"): TrpcContext {
  const date = new Date();
  return {
    user: {
      id: 1,
      role,
      openId: "test",
      email: "forge@example.com",
      name: "Forge",
      loginMethod: "test",
      createdAt: date,
      updatedAt: date,
      lastSignedIn: date,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
const response = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const tool = (name: string, args: unknown) =>
  response({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: name,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  });
afterEach(() => {
  resetAgentRouterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("VillaForge authenticated integration", () => {
  it("offers offline plans only to admins without requiring providers or a database", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "");
    expect(
      await appRouter.createCaller(ctx()).agent.forgePlan(forge)
    ).toMatchObject({ offline: true, strategy: "OPTIMIZE" });
    await expect(
      appRouter.createCaller(ctx("user")).agent.forgePlan(forge)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      appRouter.createCaller({ ...ctx(), user: null }).agent.forgePlan(forge)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rejects unbounded or forged options", () => {
    expect(() =>
      forgeOptionsSchema.parse({
        ...forge,
        memory: Array(13).fill(forge.memory[0]),
      })
    ).toThrow();
    expect(() =>
      forgeOptionsSchema.parse({ ...forge, strategy: "DELETE" })
    ).toThrow();
    expect(() =>
      forgeOptionsSchema.parse({
        ...forge,
        memory: [{ ...forge.memory[0], importance: 11 }],
      })
    ).toThrow();
    expect(() => forgeOptionsSchema.parse({ ...forge, shell: true })).toThrow();
    expect(() =>
      forgeOptionsSchema.parse({
        ...forge,
        memory: [{ ...forge.memory[0], content: "a".repeat(601) }],
      })
    ).toThrow();
  });
  it("keeps optional product roles out of unrelated missions and dependencies consistent", () => {
    const plan = buildForgePlan({
      strategy: "OPTIMIZE",
      productReview: false,
      memory: [],
    });
    expect(plan.tasks.some(t => ["BUSINESS", "GROWTH"].includes(t.role))).toBe(
      false
    );
    const seen = new Set<string>();
    for (const task of plan.tasks) {
      expect(task.dependsOn.every(id => seen.has(id))).toBe(true);
      seen.add(task.id);
    }
  });
  it("counts a commit-pinned final CI read inside the action budget and persists explicit uncertainty", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const branch = "agent/forge-test";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tool("github_create_branch", { purpose: "forge" }))
      .mockResolvedValueOnce(
        tool("github_open_pull_request", {
          branch,
          title: "Forge",
          body: "Draft",
        })
      )
      .mockResolvedValueOnce(
        response({ choices: [{ message: { content: "Draft vorbereitet" } }] })
      );
    const execute = vi.fn(async (name: string) => {
      if (name === "github_create_branch") return { result: { branch } };
      if (name === "github_open_pull_request")
        return { result: { number: 1, head: branch } };
      return {
        result: {
          ref: branch,
          sha,
          complete: true,
          total: 1,
          checks: [{ sha, status: "completed", conclusion: "success" }],
        },
      };
    });
    const result = await runAutonomousProjectWithGitHub(
      {
        prompt: "Baue Forge",
        mode: "workshop",
        specialty: "Projekt",
        history: [],
        forge,
      },
      execute,
      { fetcher }
    );
    expect(result.githubActions).toBe(3);
    expect(result.verification).toMatchObject({ state: "passed", sha });
    expect(result.forgePlan?.tasks.some(t => t.role === "GROWTH")).toBe(true);
    const messages = JSON.parse(
      String(fetcher.mock.calls[0][1]?.body)
    ).messages;
    expect(messages[0].content).not.toContain("Keine Daten löschen");
    expect(
      messages.some(
        (m: { role: string; content: string }) =>
          m.role === "user" && m.content.includes("Keine Daten löschen")
      )
    ).toBe(true);
  });
  it("does not start a final external read when control or lease is lost", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const branch = "agent/forge-stopped";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tool("github_create_branch", { purpose: "forge" }))
      .mockResolvedValueOnce(
        tool("github_open_pull_request", {
          branch,
          title: "Forge",
          body: "Draft",
        })
      )
      .mockResolvedValueOnce(
        response({ choices: [{ message: { content: "Draft" } }] })
      );
    const execute = vi.fn(async (name: string) =>
      name === "github_create_branch"
        ? { result: { branch } }
        : { result: { number: 2, head: branch } }
    );
    const result = await runAutonomousProjectWithGitHub(
      {
        prompt: "Build",
        mode: "workshop",
        specialty: "Projekt",
        history: [],
        forge,
      },
      execute,
      { fetcher, beforeFallback: async () => false }
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.verification?.state).toBe("not_checked");
  });
  it("never exceeds the 24-action budget with its final verification read", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const branch = "agent/full-budget";
    const batch = response({
      choices: [
        {
          message: {
            content: null,
            tool_calls: Array.from({ length: 22 }, (_, i) => ({
              id: `read-${i}`,
              type: "function",
              function: { name: "github_repo_overview", arguments: "{}" },
            })),
          },
        },
      ],
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        tool("github_create_branch", { purpose: "budget" })
      )
      .mockResolvedValueOnce(
        tool("github_open_pull_request", {
          branch,
          title: "Budget",
          body: "Draft",
        })
      )
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce(
        response({ choices: [{ message: { content: "Draft" } }] })
      );
    const execute = vi.fn(async (name: string) =>
      name === "github_create_branch"
        ? { result: { branch } }
        : name === "github_open_pull_request"
          ? { result: { number: 3, head: branch } }
          : { result: {} }
    );
    const result = await runAutonomousProjectWithGitHub(
      {
        prompt: "Build",
        mode: "workshop",
        specialty: "Projekt",
        history: [],
        forge,
      },
      execute,
      { fetcher }
    );
    expect(result.githubActions).toBe(24);
    expect(execute).toHaveBeenCalledTimes(24);
    expect(
      execute.mock.calls.some(call => call[0] === "github_check_runs")
    ).toBe(false);
    expect(result.verification?.state).toBe("not_checked");
  });
  it("does not verify a different branch after a PR has been prepared", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const first = "agent/first",
      second = "agent/second";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tool("github_create_branch", { purpose: "first" }))
      .mockResolvedValueOnce(
        tool("github_open_pull_request", {
          branch: first,
          title: "First",
          body: "Draft",
        })
      )
      .mockResolvedValueOnce(
        tool("github_create_branch", { purpose: "second" })
      )
      .mockResolvedValueOnce(
        response({ choices: [{ message: { content: "Draft" } }] })
      );
    let branches = 0;
    const execute = vi.fn(async (name: string) =>
      name === "github_create_branch"
        ? { result: { branch: ++branches === 1 ? first : second } }
        : { result: { number: 4, head: first } }
    );
    const result = await runAutonomousProjectWithGitHub(
      {
        prompt: "Build",
        mode: "workshop",
        specialty: "Projekt",
        history: [],
        forge,
      },
      execute,
      { fetcher }
    );
    expect(result.branch).toBe(second);
    expect(result.pullRequest?.branch).toBe(first);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.verification?.state).toBe("not_checked");
  });
  it("pins GitHub checks to the resolved full SHA, preserving total and truncation evidence", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ default_branch: "main" }))
      .mockResolvedValueOnce(response({ sha }))
      .mockResolvedValueOnce(
        response({
          total_count: 101,
          check_runs: [
            {
              name: "test",
              head_sha: sha,
              status: "completed",
              conclusion: "success",
            },
          ],
        })
      );
    const result = await executeGitHubTool(
      "github_check_runs",
      { ref: "agent/forge" },
      { token: "test", fetcher }
    );
    expect(fetcher.mock.calls[2][0]).toContain(`/commits/${sha}/check-runs`);
    expect(result).toMatchObject({
      result: { sha, total: 101, complete: false },
    });
    expect(assessForgeChecks(result, "agent/forge").state).toBe("not_checked");
  });
  it.each(["skipped", "neutral", null])(
    "does not treat %s checks as passed",
    conclusion => {
      expect(
        assessForgeChecks(
          {
            result: {
              ref: "agent/forge",
              sha,
              complete: true,
              total: 1,
              checks: [{ sha, status: "completed", conclusion }],
            },
          },
          "agent/forge"
        ).state
      ).toBe("pending");
    }
  );
  it("rejects checks from a different commit and empty check evidence", () => {
    expect(
      assessForgeChecks(
        {
          result: {
            ref: "agent/forge",
            sha,
            complete: true,
            total: 1,
            checks: [
              {
                sha: "b".repeat(40),
                status: "completed",
                conclusion: "success",
              },
            ],
          },
        },
        "agent/forge"
      ).state
    ).toBe("not_checked");
    expect(
      assessForgeChecks(
        {
          result: {
            ref: "agent/forge",
            sha,
            complete: true,
            total: 0,
            checks: [],
          },
        },
        "agent/forge"
      ).state
    ).toBe("not_checked");
  });
  it("includes structured context in idempotency and replays without starting external actions", async () => {
    const key = "1f4d2afe-d52c-42cc-95a9-abc12a123abc";
    const prompt = "Baue Forge";
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          villaId: null,
          prompt,
          history: [],
          specialty: "Autonomous Product Engineering",
          forge,
        })
      )
      .digest("hex");
    vi.spyOn(missionStore, "findMissionByKey").mockResolvedValue({
      requestHash: hash,
      status: "completed",
      result: { answer: "Draft", verification: { state: "pending" } },
    } as never);
    const caller = appRouter.createCaller(ctx());
    expect(
      await caller.agent.eliteMission({ idempotencyKey: key, prompt, forge })
    ).toMatchObject({ verification: { state: "pending" } });
    await expect(
      caller.agent.eliteMission({
        idempotencyKey: key,
        prompt,
        forge: { ...forge, productReview: false },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
