import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELITE_LIMITS,
  runAutonomousProjectWithGitHub,
} from "./agent-engine";

const workshopInput = {
  prompt: "Setze die Idee als fertige Repository-Änderung um",
  history: [],
  mode: "workshop" as const,
  specialty: "Autonomous Product Engineering",
};

function reply(content: string, model = "elite-free-model") {
  return new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function toolReply(id: string, name: string, args: unknown) {
  return new Response(
    JSON.stringify({
      model: "elite-free-model",
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("administrator elite autonomous project mission", () => {
  it("can inspect/write through a mission-created branch and deliver a draft PR", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const branch = "agent/elite-project-123abc";

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        toolReply("branch", "github_create_branch", {
          purpose: "elite project",
        })
      )
      .mockResolvedValueOnce(
        toolReply("write", "github_write_file", {
          path: "docs/elite-project.md",
          branch,
          content: "# Elite project\nImplemented.",
          message: "docs: add elite project",
        })
      )
      .mockResolvedValueOnce(
        toolReply("pr", "github_open_pull_request", {
          branch,
          title: "feat: elite project",
          body: "Autonomous project delivery",
        })
      )
      .mockResolvedValueOnce(reply("Projekt als Draft-PR vorbereitet."));

    const executeTool = vi.fn(async (name: string) => {
      if (name === "github_create_branch")
        return { result: { branch, sha: "abc123" } };
      if (name === "github_write_file")
        return { result: { path: "docs/elite-project.md", branch } };
      if (name === "github_open_pull_request")
        return {
          result: {
            number: 77,
            url: "https://github.com/example/repo/pull/77",
            head: branch,
          },
        };
      return { result: {} };
    });

    const result = await runAutonomousProjectWithGitHub(
      workshopInput,
      executeTool,
      { fetcher }
    );

    expect(result).toMatchObject({
      provider: "openrouter",
      githubActions: 3,
      completed: true,
      pullRequestOpened: true,
      branch,
      pullRequest: {
        number: 77,
        branch,
      },
    });
    expect(executeTool).toHaveBeenCalledTimes(3);

    const firstPayload = JSON.parse(
      String(fetcher.mock.calls[0]?.[1]?.body)
    ) as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ function: { name: string } }>;
    };
    expect(firstPayload.max_tokens).toBe(
      ELITE_LIMITS.defaultOutputTokens
    );
    expect(firstPayload.messages[0]?.content).toContain(
      "Administrator-Elite-Projektfabrik"
    );
    expect(
      firstPayload.tools.some(
        tool => tool.function.name === "github_check_runs"
      )
    ).toBe(true);
  });

  it("nudges a plan-only answer to continue implementation instead of stopping immediately", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const branch = "agent/elite-followthrough-123abc";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply("Ich würde zuerst einen Plan erstellen."))
      .mockResolvedValueOnce(
        toolReply("branch", "github_create_branch", {
          purpose: "followthrough",
        })
      )
      .mockResolvedValueOnce(
        toolReply("pr", "github_open_pull_request", {
          branch,
          title: "feat: follow through",
          body: "Delivery",
        })
      )
      .mockResolvedValueOnce(reply("Fertig zur Prüfung."));

    const executeTool = vi.fn(async (name: string) =>
      name === "github_create_branch"
        ? { result: { branch } }
        : {
            result: {
              number: 78,
              url: "https://github.com/example/repo/pull/78",
              head: branch,
            },
          }
    );

    const result = await runAutonomousProjectWithGitHub(
      workshopInput,
      executeTool,
      { fetcher }
    );

    expect(result.completed).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const secondPayload = JSON.parse(
      String(fetcher.mock.calls[1]?.[1]?.body)
    ) as { messages: Array<{ role: string; content?: string }> };
    expect(
      secondPayload.messages.some(message =>
        message.content?.includes("noch nicht als überprüfbares Repository-Ergebnis")
      )
    ).toBe(true);
  });
});
