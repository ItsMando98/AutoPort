# Autonomous Trading Safety Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paper validation and broker execution trustworthy by isolating test state, enforcing point-in-time data, unifying order submission, and closing remote-control gaps.

**Architecture:** Introduce small policy and gateway modules around the existing SQLite, market-data, broker, and Express code. Preserve the current coordinator and public response shapes while moving broker/local branching into one testable execution boundary and making replay/forecast decisions explicit about time and target identity.

**Tech Stack:** TypeScript 5.8, Node test runner through `tsx`, Express 4, better-sqlite3, Alpaca REST API, Vite 6.

## Global Constraints

- Do not place real or paper broker orders during tests.
- Do not open or mutate `data/portfolio.db` during tests.
- Do not perform destructive schema migrations.
- Preserve current frontend read APIs.
- Fail closed when quote eligibility, forecast identity, authentication, or broker submission state is ambiguous.
- The workspace has no `.git` directory; replace commit steps with verified local checkpoints unless the user initializes Git.

---

## File map

- Create `server/dbPath.ts`: pure database path resolution.
- Create `scripts/run-tests.ts`: launches the test process with an isolated temporary database.
- Create `server/apiSecurity.ts`: host validation and bearer-token middleware.
- Create `server/executionGateway.ts`: unified simulation/broker order submission and audit result.
- Modify `server/db.ts`: consume explicit database path.
- Modify `server/broker.ts`: deterministic client order IDs and lookup.
- Modify `server/execution.ts`: represent ambiguous submission state.
- Modify `server/agents/coordinator.ts`: route candidate and stop-loss orders through the gateway.
- Modify `server/recovery.ts`: reconcile by client order ID before resubmission.
- Modify `server/marketdata.ts` and `server/degradation.ts`: expose and enforce quote eligibility.
- Modify `server/autonomy.ts`, macro/breadth/theme producers: canonical forecast outcome symbol.
- Modify `server/backtest.ts`: availability-aware next-bar replay and modeled costs.
- Modify `server/index.ts`: secure host binding and mutating routes.
- Modify `src/lib/api.ts`: optional bearer token on mutations.
- Add focused regression tests under `tests/`.

---

### Task 1: Isolated test database

**Files:**
- Create: `server/dbPath.ts`
- Create: `scripts/run-tests.ts`
- Create: `tests/dbPath.test.ts`
- Modify: `server/db.ts:1-14`
- Modify: `package.json:scripts.test`

**Interfaces:**
- Produces: `resolveDatabasePath(env?: NodeJS.ProcessEnv): string`
- Produces: test runner that sets `PORTFOLIO_DB_PATH` before importing any test module.

- [ ] **Step 1: Write the failing path-resolution test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDatabasePath } from '../server/dbPath.js';

test('explicit portfolio database path overrides the production database', () => {
  assert.equal(resolveDatabasePath({ PORTFOLIO_DB_PATH: '/tmp/portfolio-test.db' }), '/tmp/portfolio-test.db');
});

test('default database remains data/portfolio.db', () => {
  assert.equal(resolveDatabasePath({}).endsWith(path.join('data', 'portfolio.db')), true);
});
```

- [ ] **Step 2: Run RED**

Run: `npx tsx --test tests/dbPath.test.ts`

Expected: FAIL because `server/dbPath.ts` does not exist.

- [ ] **Step 3: Implement pure path resolution**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PORTFOLIO_DB_PATH
    ? path.resolve(env.PORTFOLIO_DB_PATH)
    : path.join(serverDir, '..', 'data', 'portfolio.db');
}
```

Use `resolveDatabasePath()` in `server/db.ts` and create its parent directory rather than a hard-coded `data` directory.

- [ ] **Step 4: Add the isolated runner**

`scripts/run-tests.ts` must create a directory with `mkdtemp`, run `tsx --test --test-concurrency=1 tests/*.test.ts` in a child process with `PORTFOLIO_DB_PATH=<temp>/portfolio.test.db`, propagate the exit code, and delete only that temporary directory in `finally`.

Change `package.json` to:

```json
"test": "tsx scripts/run-tests.ts"
```

- [ ] **Step 5: Verify GREEN and database immutability**

Run:

```bash
npx tsx --test tests/dbPath.test.ts
shasum data/portfolio.db
npm test
shasum data/portfolio.db
```

Expected: tests pass and both hashes are identical.

---

### Task 2: Broker order idempotency

**Files:**
- Modify: `server/broker.ts:150-205`
- Modify: `server/recovery.ts:350-410`
- Modify: `server/agents/coordinator.ts:725-813`
- Modify: `server/index.ts:931-947`
- Create: `tests/brokerIdempotency.test.ts`

**Interfaces:**
- Produces: `placeMarketOrder(symbol, side, qty, clientOrderId): Promise<BrokerOrder>`
- Produces: `getOrderByClientOrderId(clientOrderId): Promise<BrokerOrder | null>`
- Produces: `buildRetryClientOrderId(attemptId, retryOrdinal): string`

- [ ] **Step 1: Write failing broker payload and lookup tests**

Stub `globalThis.fetch`, call `placeMarketOrder('AAPL', 'buy', 2, 'attempt-123')`, and assert the posted JSON contains:

```ts
{
  symbol: 'AAPL',
  qty: '2',
  side: 'buy',
  type: 'market',
  time_in_force: 'day',
  client_order_id: 'attempt-123'
}
```

Add a second test asserting that a 404 from `/v2/orders:by_client_order_id?client_order_id=attempt-123` returns `null`, while a 200 response maps to `BrokerOrder`.

- [ ] **Step 2: Run RED**

Run: `npx tsx --test tests/brokerIdempotency.test.ts`

Expected: FAIL because the fourth parameter and lookup function are absent.

- [ ] **Step 3: Implement broker methods**

Add `client_order_id` to the request body and implement the lookup with URL encoding. Treat only HTTP 404 as not found; propagate other errors.

- [ ] **Step 4: Update every caller**

- coordinator initial submission uses `executionAttemptId`;
- manual broker route creates an execution attempt first and uses its ID;
- recovery uses `${attempt.id}-retry-${retryCount + 1}`;
- before recovery submits that ID, it calls `getOrderByClientOrderId` and reconciles an existing order.

- [ ] **Step 5: Verify GREEN**

Run: `npx tsx --test tests/brokerIdempotency.test.ts tests/recovery.test.ts tests/reconciliation.test.ts`

Expected: all selected tests pass without network access.

---

### Task 3: Canonical forecast outcome symbol

**Files:**
- Modify: `server/autonomy.ts:43-75,348-383,742-785,922-960`
- Modify: `server/agents/macro.ts:127-141`
- Modify: `server/agents/marketBreadth.ts:80-93`
- Modify: `server/themes.ts:686-709`
- Modify: `tests/autonomy.test.ts`
- Modify: `tests/macro.test.ts`
- Modify: `tests/themes.test.ts`

**Interfaces:**
- `MarketForecastInput` gains required `outcomeSymbol: string`.
- Persisted metadata uses only `outcomeSymbol`.
- Legacy rows without `outcomeSymbol` expire and do not write `realized_outcomes`.

- [ ] **Step 1: Write failing target-identity tests**

Add tests that save price history where AAPL rises and SPY falls, then assert a macro `down` forecast with `outcomeSymbol: 'SPY'` resolves correct. Add a legacy forecast without the field and assert it expires without a realized outcome.

- [ ] **Step 2: Run RED**

Run: `npx tsx --test tests/autonomy.test.ts tests/macro.test.ts tests/themes.test.ts`

Expected: the SPY assertion fails because the resolver currently uses AAPL; the required input also produces a type failure after the interface is tightened.

- [ ] **Step 3: Implement canonical persistence and resolution**

Persist:

```ts
metadata: JSON.stringify({ ...forecast.metadata, outcomeSymbol: normalizeSymbol(forecast.outcomeSymbol) })
```

Resolve with:

```ts
const outcomeSymbol = normalizeSymbol(metadata.outcomeSymbol);
if (!outcomeSymbol) {
  expireMarketForecast(row);
  expired += 1;
  continue;
}
const outcome = resolveDirectionalOutcome(outcomeSymbol, row.window_start_at, row.window_end_at, null);
```

Set macro and breadth to `SPY`; set theme forecasts to `discovery.benchmarkSymbol`.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx --test tests/autonomy.test.ts tests/macro.test.ts tests/themes.test.ts`

Expected: selected tests pass and no assertion depends on implicit AAPL.

---

### Task 4: Execution-eligible quotes

**Files:**
- Modify: `server/marketdata.ts:13-148`
- Modify: `server/degradation.ts:53-162`
- Modify: `server/agents/coordinator.ts:80-210`
- Modify: `tests/degradation.test.ts`
- Create: `tests/marketdataEligibility.test.ts`

**Interfaces:**
- Produces: `MarketPriceSource = 'alpaca' | 'polygon' | 'stored_eod_fallback' | null`
- `getMarketDataStatus()` gains `source` and `executionEligible`.
- `executionAllowedPaper` is false for EOD fallback.

- [ ] **Step 1: Write failing policy tests**

Expose a pure function:

```ts
evaluateQuoteEligibility({ source, staleMs, lastError, mode })
```

Assert Alpaca/fresh/paper is eligible, EOD/fresh/paper is ineligible, EOD/fresh/live is ineligible, and stale Alpaca is ineligible.

- [ ] **Step 2: Run RED**

Run: `npx tsx --test tests/marketdataEligibility.test.ts`

Expected: FAIL because the policy function does not exist.

- [ ] **Step 3: Implement source tracking and fail-closed policy**

Store the source alongside cached prices. `commitPrices` updates both. Coordinator checks `executionEligible`, not only `staleMs`. Degradation treats EOD fallback as execution-blocking in paper and live modes while leaving valuation data available.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx --test tests/marketdataEligibility.test.ts tests/degradation.test.ts`

Expected: all selected tests pass.

---

### Task 5: Unified execution gateway and broker-aware stop-loss

**Files:**
- Create: `server/executionGateway.ts`
- Create: `tests/executionGateway.test.ts`
- Modify: `server/agents/coordinator.ts:440-505,701-875`
- Modify: `server/execution.ts`
- Modify: `server/reconciliation.ts`

**Interfaces:**
- Produces:

```ts
export interface ExecutionIntent {
  attemptId: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  shares: number;
  referencePrice: number;
  reason: string;
  riskReducing: boolean;
}

export interface ExecutionGatewayResult {
  ok: boolean;
  status: 'submitted' | 'partially_filled' | 'filled' | 'rejected' | 'cancelled' | 'submitted_unknown';
  brokerOrder?: BrokerOrder;
  fillPrice: number | null;
  reason?: string;
}

export async function executeOrderIntent(intent: ExecutionIntent): Promise<ExecutionGatewayResult>;
```

- [ ] **Step 1: Write failing simulation and broker tests**

Using injected dependencies, assert:

- simulation calls local `executeTrade` and returns `filled`;
- broker mode calls `placeMarketOrder` with `attemptId` and does not mutate local state before confirmed fill;
- ambiguous broker error with an existing client-ID lookup returns the broker state;
- ambiguous broker error without a known order returns `submitted_unknown`, never `rejected`.

- [ ] **Step 2: Run RED**

Run: `npx tsx --test tests/executionGateway.test.ts`

Expected: FAIL because the gateway module is absent.

- [ ] **Step 3: Implement the minimal gateway**

Use a dependency object for testability but default it to the real broker, runtime, portfolio, and execution-attempt functions. Centralize status normalization, slippage calculation, local simulation mutation, broker sync, and ambiguous-submission reconciliation.

- [ ] **Step 4: Route coordinator candidate execution through the gateway**

Keep sizing, risk checks, and attempt creation in the coordinator. Replace broker/local branching inside `executeCandidateTrade` with `executeOrderIntent` and retain candidate-specific trade/thesis persistence after a confirmed fill.

- [ ] **Step 5: Route stop-loss through the same gateway**

For every alert, create the attempt as today, call the gateway with `riskReducing: true`, and write the stop-loss trade audit only after a confirmed fill. Submitted or partial broker orders remain active and are completed through reconciliation.

- [ ] **Step 6: Verify GREEN**

Run: `npx tsx --test tests/executionGateway.test.ts tests/agents.test.ts tests/reconciliation.test.ts tests/recovery.test.ts`

Expected: selected tests pass; broker stop-loss tests show zero premature local mutations.

---

### Task 6: Point-in-time replay and modeled execution costs

**Files:**
- Modify: `server/backtest.ts`
- Modify: `tests/research.test.ts`
- Create: `tests/backtestPointInTime.test.ts`

**Interfaces:**
- `BacktestConfig` gains `slippageBps?: number` and `spreadBps?: number`.
- `BacktestResult.diagnostics` gains `eventsDeferred` and `modeledCosts`.
- Research availability is `max(eventTimestamp, createdAt)`.

- [ ] **Step 1: Write failing same-day look-ahead test**

Seed day-D research at 20:00 UTC and D/D+1 bars with materially different close/open prices. Assert no trade uses D close and the first possible fill is D+1 open.

- [ ] **Step 2: Write failing cost test**

With `spreadBps: 10` and `slippageBps: 5`, assert a buy at a raw open of 100 fills at 100.15 and diagnostics record the modeled cost.

- [ ] **Step 3: Run RED**

Run: `npx tsx --test tests/backtestPointInTime.test.ts`

Expected: existing replay trades at day-D close and ignores costs.

- [ ] **Step 4: Implement delayed decision/fill queues**

At day D, compute candidates only from events whose availability timestamp is no later than D market close and whose signal has not been consumed. Queue eligible intents for the next symbol bar. At D+1, execute queued entries at open with side-aware cost:

```ts
const costBps = (config.spreadBps ?? 0) / 2 + (config.slippageBps ?? 0);
const executionPrice = rawOpen * (action === 'BUY' ? 1 + costBps / 10_000 : 1 - costBps / 10_000);
```

Technical features for the decision use bars ending before the execution bar. Stop-loss breaches observed at D close exit at D+1 open.

- [ ] **Step 5: Remove or implement unused config fields**

Use `positionSizePct` as an upper target-weight cap, pass configured RSI thresholds into historical factor generation, and use `minVolumeRatioForBreakout` instead of hard-coded `1.5`.

- [ ] **Step 6: Verify GREEN**

Run: `npx tsx --test tests/backtestPointInTime.test.ts tests/research.test.ts`

Expected: all selected tests pass and no trade uses same-bar future information.

---

### Task 7: API host and bearer-token boundary

**Files:**
- Create: `server/apiSecurity.ts`
- Create: `tests/apiSecurity.test.ts`
- Modify: `server/index.ts:84-88,149-200,874-947,1170-1215,1246-1327,1331`
- Modify: `src/lib/api.ts`
- Modify: `.env.local.example` if present
- Modify: `README.md`

**Interfaces:**
- Produces: `resolveApiHost(env?): string`
- Produces: `assertSafeApiExposure(host, token): void`
- Produces: `requireMutationAuth(options?): express.RequestHandler`

- [ ] **Step 1: Write failing pure policy tests**

Assert:

- empty host resolves to `127.0.0.1`;
- `0.0.0.0` without a token throws;
- `0.0.0.0` with a token is allowed;
- missing or wrong bearer token receives 401 when configured;
- correct bearer token calls `next()`.

- [ ] **Step 2: Run RED**

Run: `npx tsx --test tests/apiSecurity.test.ts`

Expected: FAIL because the security module is absent.

- [ ] **Step 3: Implement host and middleware policy**

Use constant-time token comparison with `timingSafeEqual` after equal-length validation. Return JSON `{ error: 'Unauthorized' }` without revealing whether the header or token was wrong.

- [ ] **Step 4: Apply middleware**

Mount mutation authentication before state-changing `/api` routes. Bind with:

```ts
const host = resolveApiHost();
assertSafeApiExposure(host, process.env.API_AUTH_TOKEN);
app.listen(PORT, host, () => { /* existing startup */ });
```

The frontend reads `VITE_API_AUTH_TOKEN` and attaches `Authorization` only for non-GET requests.

- [ ] **Step 5: Verify GREEN**

Run: `npx tsx --test tests/apiSecurity.test.ts`

Expected: all policy and middleware tests pass.

---

### Task 8: Full verification and structural refresh

**Files:**
- Modify only files required by failures found below.

**Interfaces:**
- Consumes all Phase-1 interfaces.
- Produces fresh verification evidence and a refreshed architecture index.

- [ ] **Step 1: Verify production DB is unchanged by the suite**

Run:

```bash
shasum data/portfolio.db
npm test
shasum data/portfolio.db
```

Expected: identical hashes and zero failed tests.

- [ ] **Step 2: Run static and production verification**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Run targeted acceptance checks**

Run:

```bash
npx tsx --test tests/dbPath.test.ts tests/brokerIdempotency.test.ts tests/executionGateway.test.ts tests/marketdataEligibility.test.ts tests/backtestPointInTime.test.ts tests/apiSecurity.test.ts
```

Expected: all Phase-1 regression tests pass.

- [ ] **Step 4: Refresh Codebase Memory**

Run a fast non-persistent repository index refresh, then trace inbound callers of `placeMarketOrder`, `executeOrderIntent`, and `resolveForecastOutcomes`. Confirm all order callers provide client IDs and all coordinator order paths reach the gateway.

- [ ] **Step 5: Review the requirement checklist**

Confirm each acceptance criterion in the design specification against a passing test or source reference. Report any unmet criterion explicitly; do not claim Phase 1 complete if any item lacks evidence.
