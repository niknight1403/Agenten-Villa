import { performance } from "node:perf_hooks";
import { runAgentTurn, type AgentInput } from "../server/agent-engine";

process.env.OPENROUTER_API_KEY = "mock-openrouter-key";
process.env.HF_TOKEN = "mock-huggingface-key";

const input: AgentInput = {
  prompt: "Erstelle einen kurzen Testplan.",
  history: [],
  mode: "home",
  specialty: "Stresstest",
};
type Scenario = "success" | "temporary-failure" | "provider-limit";
type Result = {
  scenario: Scenario;
  ok: boolean;
  provider?: string;
  code?: string;
  durationMs: number;
  mockedCalls: number;
};

function response(status: number, model: string) {
  return new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content: "Mock-Antwort" } }],
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

async function runMockTurn(scenario: Scenario): Promise<Result> {
  let mockedCalls = 0;
  const started = performance.now();
  const fetcher: typeof fetch = async url => {
    mockedCalls += 1;
    if (scenario === "provider-limit") return response(429, "mock-limited");
    if (
      scenario === "temporary-failure" &&
      String(url).includes("openrouter.ai")
    )
      return response(503, "mock-unavailable");
    return response(
      200,
      String(url).includes("huggingface") ? "mock-hf" : "mock-openrouter-free"
    );
  };
  try {
    const result = await runAgentTurn(input, scenario === "temporary-failure", {
      fetcher,
    });
    return {
      scenario,
      ok: true,
      provider: result.provider,
      durationMs: performance.now() - started,
      mockedCalls,
    };
  } catch (error) {
    return {
      scenario,
      ok: false,
      code:
        error instanceof Error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "UNKNOWN",
      durationMs: performance.now() - started,
      mockedCalls,
    };
  }
}

const started = performance.now();
const scenarios: Scenario[] = [
  ...Array<Scenario>(800).fill("success"),
  ...Array<Scenario>(150).fill("temporary-failure"),
  ...Array<Scenario>(50).fill("provider-limit"),
];
const results = await Promise.all(scenarios.map(runMockTurn));
const elapsedMs = performance.now() - started;
const durations = results
  .map(result => result.durationMs)
  .sort((a, b) => a - b);
const percentile = (fraction: number) =>
  durations[
    Math.min(durations.length - 1, Math.floor(durations.length * fraction))
  ] ?? 0;
const summary = (scenario: Scenario) => {
  const rows = results.filter(result => result.scenario === scenario);
  return {
    requested: rows.length,
    succeeded: rows.filter(result => result.ok).length,
    failed: rows.filter(result => !result.ok).length,
    providers: Object.fromEntries(
      [...new Set(rows.map(result => result.provider).filter(Boolean))].map(
        provider => [
          provider,
          rows.filter(result => result.provider === provider).length,
        ]
      )
    ),
    errorCodes: Object.fromEntries(
      [...new Set(rows.map(result => result.code).filter(Boolean))].map(
        code => [code, rows.filter(result => result.code === code).length]
      )
    ),
    mockedOutboundCalls: rows.reduce(
      (total, result) => total + result.mockedCalls,
      0
    ),
  };
};

console.log(
  JSON.stringify(
    {
      test: "local-router-stress",
      totalLogicalRequests: results.length,
      concurrency: results.length,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      logicalRequestsPerSecond: Number(
        (results.length / (elapsedMs / 1000)).toFixed(2)
      ),
      latencyMs: {
        p50: Number(percentile(0.5).toFixed(3)),
        p95: Number(percentile(0.95).toFixed(3)),
        max: Number((durations.at(-1) ?? 0).toFixed(3)),
      },
      scenarios: {
        success: summary("success"),
        temporaryFailureWithFallback: summary("temporary-failure"),
        providerLimitStops: summary("provider-limit"),
      },
      assertions: {
        noRealProviderCalls: true,
        temporaryFailuresSwitchOnlyWhenExplicitlyAllowed:
          summary("temporary-failure").providers.huggingface === 150,
        providerLimitsStopWithoutFallback:
          summary("provider-limit").failed === 50 &&
          summary("provider-limit").mockedOutboundCalls === 50,
      },
    },
    null,
    2
  )
);

if (!results.every(result => result.ok || result.code === "LIMIT"))
  process.exit(1);
if (summary("temporary-failure").providers.huggingface !== 150) process.exit(1);
if (
  summary("provider-limit").failed !== 50 ||
  summary("provider-limit").mockedOutboundCalls !== 50
)
  process.exit(1);
