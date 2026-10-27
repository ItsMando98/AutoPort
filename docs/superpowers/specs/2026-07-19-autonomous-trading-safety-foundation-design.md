# Autonomous Trading Safety Foundation Design

## Goal

Make the existing research and trading runtime safe enough for trustworthy paper validation by removing execution-path divergence, duplicate-order ambiguity, point-in-time replay errors, forecast target corruption, and test/database coupling.

This phase does not redesign alpha generation or portfolio optimization. Those systems will be built only after this foundation produces reliable evidence.

## Scope

Phase 1 delivers seven bounded changes:

1. Isolate tests from `data/portfolio.db`.
2. Route stop-loss exits through the broker-aware execution path.
3. Give every broker order a deterministic client order ID and reconcile before retrying.
4. Resolve forecasts against an explicit outcome symbol.
5. Prohibit EOD fallback quotes from producing paper or live fills.
6. Make replay decisions point-in-time correct and execute on a later tradable bar.
7. Restrict API exposure to loopback by default and support token authentication for mutating endpoints.

## Architecture

### Database isolation

`server/db.ts` will resolve the database path from `PORTFOLIO_DB_PATH` when set and otherwise retain `data/portfolio.db`. The test script will set a unique temporary database path before any server module is imported. Test cleanup may delete only that temporary database and its SQLite sidecar files.

Production code must never infer test mode from symbol names or test data. Database selection is an explicit process-level configuration.

### Unified execution gateway

A focused execution service will accept an `ExecutionIntent` containing symbol, side, shares, reference price, reason, mode, and lineage identifiers. It owns:

- readiness and rollout checks;
- deterministic risk evaluation where applicable;
- execution-attempt creation and lifecycle updates;
- broker versus simulation routing;
- trade audit persistence;
- reconciliation metadata.

Coordinator candidates and stop-loss exits use this service. Stop-loss exits are risk-reducing orders: they bypass entry sizing and exposure-increase checks, but not market-session, broker, degradation, audit, or reconciliation controls.

The broker account is authoritative whenever broker execution is enabled. Local portfolio mutations may only represent simulation fills or state synchronized from broker fills.

### Broker idempotency

`placeMarketOrder` accepts a required `clientOrderId`. The execution-attempt ID is used as the stable client order ID for an initial submission. Recovery derives a stable retry ID from the original attempt and retry ordinal.

Before resubmitting after an ambiguous error, the runtime queries Alpaca by client order ID. If the broker already knows the order, the existing broker order is reconciled instead of submitting another order.

### Forecast outcome identity

Every market forecast stores an explicit `outcomeSymbol`. The persistence layer writes it into metadata under one canonical key. Outcome resolution rejects forecasts without a valid symbol; it never silently substitutes AAPL.

- macro and breadth forecasts use `SPY`;
- theme forecasts use their configured benchmark symbol;
- symbol forecasts continue to use their own symbol.

Existing legacy forecasts without an outcome symbol expire with a diagnostic reason rather than entering calibration statistics.

### Quote eligibility

Market-data status exposes both fetch freshness and source type. Execution eligibility is independent from valuation eligibility:

- Alpaca and sufficiently current Polygon quotes may be execution eligible according to mode;
- stored EOD closes are valuation-only;
- stale cached quotes are valuation-only;
- no execution attempt may be marked filled using a valuation-only quote.

Paper mode must fail closed when no execution-eligible quote exists.

### Point-in-time replay

Replay uses each research event's availability timestamp. Until a dedicated `available_at` column is migrated, the effective timestamp is `max(event_timestamp, created_at)` so information cannot be used before ingestion.

For daily bars:

- events available during trading day D may first trade at day D+1 open;
- technical features use bars ending no later than D;
- stop-loss triggers use the next available open when the previous close breached the threshold;
- entries and exits include configurable spread/slippage in basis points;
- unused configuration fields are either implemented or removed from the public config.

The replay result reports skipped events, execution delay, and total modeled costs. Existing result fields remain compatible where practical.

### API boundary

The server binds to `127.0.0.1` unless `API_HOST` is explicitly configured. When `API_AUTH_TOKEN` is configured, all mutating `/api` requests require `Authorization: Bearer <token>`. Read-only endpoints remain available locally for the dashboard.

Live-enablement, rollout-profile, direct broker-order, recovery, agent-control, and kill-switch routes require the token whenever `API_AUTH_TOKEN` is configured. Startup fails if a non-loopback host is configured without `API_AUTH_TOKEN`, so those routes can never be exposed remotely without authentication.

The kill switch remains fail-safe: authentication protects remote invocation, but internal risk logic can engage it without HTTP.

## Error handling and invariants

The following invariants are mandatory:

1. One execution intent creates at most one active broker order per client order ID.
2. Broker-enabled stop-loss processing never mutates the local portfolio before a broker fill is confirmed.
3. No EOD fallback quote can create a paper or live fill.
4. No unresolved or targetless forecast contributes to calibration.
5. Replay never uses an event or bar before its availability time.
6. Tests never open or mutate the default production database.
7. A remotely reachable API cannot start agents, enable live trading, place orders, or close positions without authentication.

Ambiguous broker submissions remain `submitted_unknown` or an equivalent non-terminal state until reconciliation establishes the broker outcome. They are not converted to `rejected` merely because the HTTP response was lost.

## Testing strategy

All behavioral changes follow red-green-refactor.

Required test groups:

- database-path resolution and temporary database isolation;
- broker request payload contains stable `client_order_id`;
- ambiguous submission is reconciled before retry;
- stop-loss uses broker execution when enabled and local simulation otherwise;
- missing forecast target does not resolve against AAPL;
- macro, breadth, and theme forecasts resolve against their declared benchmark;
- EOD fallback is valuation-only in both paper and live modes;
- same-day events cannot execute at the same-day close;
- replay uses next-bar open and applies modeled costs;
- mutating API routes reject missing or invalid tokens;
- non-loopback startup without a token is rejected.

The full verification gate is:

```bash
npm test
npm run lint
npm run build
```

Tests must run against a temporary database path, and the verification output must demonstrate that `data/portfolio.db` was not modified.

## Migration and compatibility

Schema changes use the repository's existing additive migration style. No destructive migration is allowed. Existing forecast rows remain readable but are excluded from outcome calibration when their target cannot be established safely.

Existing frontend read operations remain unchanged. If an API token is enabled, the frontend API client reads it from the existing Vite environment mechanism and attaches it only to mutating requests.

## Acceptance criteria

Phase 1 is accepted when:

- all seven scoped changes are implemented;
- every new behavior has a regression test that was observed failing before implementation;
- the full test, type-check, and production-build commands pass;
- broker submission retries are demonstrably idempotent;
- stop-loss behavior maintains broker/local consistency;
- replay no longer trades on information from the same daily bar;
- forecast calibration contains no implicit AAPL fallback;
- tests cannot mutate the default database;
- no non-loopback unauthenticated execution configuration can start.

## Explicitly deferred

The following are intentionally deferred to later designs:

- expected-return distributions and Bayesian alpha calibration;
- covariance-aware portfolio optimization;
- factor, beta, ADV, and borrow-cost risk budgets;
- multi-model research verification and evidence extraction;
- intraday event-driven backtesting;
- multi-instance leader election and durable job queues.
