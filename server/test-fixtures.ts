export type TestVillaFixture = {
  id: string;
  name: string;
  project: string;
  capacity: number;
  status: "STOPPED" | "RUNNING";
};

export type TestAgentFixture = {
  id: string;
  villaId: string;
  role: string;
  status: "idle" | "ready";
};

export type TestFixtures = {
  villas: TestVillaFixture[];
  agents: TestAgentFixture[];
};

export function createTestFixtures(): TestFixtures {
  const villas: TestVillaFixture[] = [
    {
      id: "fixture-villa-01",
      name: "Fixture Villa",
      project: "AGI Agenten Loop Engineering",
      capacity: 5_000,
      status: "STOPPED",
    },
  ];
  const agents = Array.from(
    { length: 3 },
    (_, index): TestAgentFixture => ({
      id: `fixture-agent-${String(index + 1).padStart(2, "0")}`,
      villaId: villas[0].id,
      role: ["planner", "builder", "reviewer"][index],
      status: index === 0 ? "ready" : "idle",
    })
  );
  return { villas, agents };
}

export function resetTestFixtures(fixtures: TestFixtures) {
  fixtures.villas.length = 0;
  fixtures.agents.length = 0;
}
