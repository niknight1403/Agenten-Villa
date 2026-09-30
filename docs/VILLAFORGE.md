# VillaForge integration

Source selected by the owner: `niknight1403/AgentForge`, whose README title is VillaForge. Source revision inspected: `30dd46092c3ac57e924dd6933b7ef9cd79c45fd0`. Target baseline: `7aeb882d4a91b8d2190cbdf2397f287732a602c6`.

This is a native adaptation of useful concepts, not a second Hub server or a wholesale source-code transplant. Agenten-Villa keeps React/tRPC, PostgreSQL, authentication, per-user mission ownership and its existing provider guardian.

## Included

- `agent.forgePlan`: administrator-only offline planning, no model calls or database dependency. Returns logical role stages and their dependencies, acceptance criteria and existing execution bounds.
- `OPTIMIZE` is the default. `REBUILD` explicitly selects a rebuild plan; it never authorizes data deletion, destructive repository actions or overwriting production.
- Optional BUSINESS/GROWTH product review, disabled by default. It proposes hypotheses and measurable product improvements without payments, outreach or tracking side effects.
- Structured mission-local memory: FACT, DECISION, ARTIFACT, LESSON, IDEA, CONSTRAINT. At most 12 items, bounded titles/content and importance from 1 to 10. Context is importance-ranked and searchable through `searchForgeMemory`.
- The UI adds/removes context entries and displays the offline plan. On execution the structured input is persisted in the existing mission ledger, included in the idempotency hash and retained for an explicitly acknowledged restart. No schema migration is required.
- Context is added as a user message, never elevated into system authority. Existing repository/secret/branch security instructions remain intact.
- Elite missions retain the existing 24 tool-action/12-round limits and at most two completion nudges. The integration does not create thousands of live workers, uncontrolled task loops or automatic crash replays.
- For Forge-enabled missions with a Draft PR and remaining action budget, a final read collects GitHub check-runs for an immutable full commit SHA. The read consumes an action from the SAME budget and obeys control/lease checks.
- CI assessment is explicitly `not_checked`, `pending`, `failed` or `passed`. Empty, truncated, wrong-branch or wrong-commit evidence is never green. Skipped/neutral checks are not successful tests. Unknown check outcomes remain pending.

## Completion semantics

The existing `completed` field means a Draft PR was prepared. It does NOT mean that all application features, production integrations or Android devices were tested. `verification` separately reports a point-in-time observation of CI for the specified commit; it is not a deployment or live-device certification. Replaying a completed request returns the original evidence, not a refreshed CI result.

There is no continuous monitoring or automatic repair daemon in this integration. If CI is pending/failed/unavailable, the result states that explicitly. A new or restarted external mission still follows the existing explicit restart and idempotency rules.

## Intentionally not imported

- VillaForge's SQLite datastore, unauthenticated REST server and plaintext secret persistence.
- General filesystem access, unrestricted URL fetching or command execution. Whitelisting `npm test` alone does not sandbox arbitrary repository scripts or protect server credentials.
- The source Kotlin/Compose Android client, which would conflict with this project's Capacitor frontend. The same React integration is included in a future Capacitor build; no signed APK is produced by this change.
- Cross-mission memory tools or durable parallel worker/task infrastructure. Memory is local to the saved mission, not a global Villa memory database.
- Quota bypasses, fabricated offline AI results, new paid provider subscriptions or unlimited-use promises.

## Verification

Use the repository's supported Node 22 and pnpm 10:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
git diff --check
```

`server/forge.test.ts` and `server/forge-integration.test.ts` cover bounded validation, roles/dependencies, untrusted memory, administrator access, immutable CI evidence, stopped control/lease behavior and context-aware idempotency. The existing old-request replay tests guard backwards compatibility. Credential-dependent live tests require real provider/database setup and are not claimed as passed when skipped.
