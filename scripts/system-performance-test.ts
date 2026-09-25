import { performance } from "node:perf_hooks";
import { getVillaSnapshot, LOGICAL_AGENTS_PER_VILLA, routeProviderForTests } from "../server/agent-villa";

const started = performance.now();
const villas = Array.from({ length: 100 }, (_, index) => getVillaSnapshot(`benchmark-villa-${index}`));
const capacity = villas.reduce((total, villa) => total + villa.logicalAgentCapacity, 0);
const routingCases = [
  routeProviderForTests({ openRouterConfigured: true, huggingFaceConfigured: true, allowExplicitFallback: true }),
  routeProviderForTests({ openRouterConfigured: false, huggingFaceConfigured: true, allowExplicitFallback: false }),
  routeProviderForTests({ openRouterConfigured: false, huggingFaceConfigured: true, allowExplicitFallback: true }),
  routeProviderForTests({ openRouterConfigured: false, huggingFaceConfigured: false, allowExplicitFallback: true }),
];
const elapsedMs = performance.now() - started;

if (villas.some(villa => villa.logicalAgentCapacity !== LOGICAL_AGENTS_PER_VILLA)) {
  throw new Error("Villa capacity mismatch");
}
if (routingCases[0]?.model !== "openrouter/free" || routingCases[1] !== null || routingCases[3] !== null) {
  throw new Error("Provider router safety policy mismatch");
}
console.log(JSON.stringify({
  benchmark: "local logical orchestration",
  villasCreated: villas.length,
  logicalAgentsPerVilla: LOGICAL_AGENTS_PER_VILLA,
  totalLogicalCapacity: capacity,
  eagerModelCalls: 0,
  routingCases,
  elapsedMs: Number(elapsedMs.toFixed(3)),
}, null, 2));
