# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Setup

1. Copy `.env.local.example` to `.env.local` (or create it) and set `GEMINI_API_KEY` to your Gemini API key.
2. `npm install`

## Environment

`.env` (required for backend):
```
POLYGON_API_KEY=your_polygon_key     # OHLCV data + live prices
GEMINI_API_KEY=your_gemini_key       # AI analysis (same key as frontend)

# Optional: Alpaca broker integration
ALPACA_API_KEY=your_key
ALPACA_API_SECRET=your_secret
ALPACA_MODE=paper                    # "paper" (default) or "live" (real money — be careful)

# Optional: override trading mode
TRADING_MODE=paper                   # "analysis" | "paper" | "live"
```

The frontend also reads `GEMINI_API_KEY` from `.env.local` (Vite), but the backend agent uses `.env`.

Without Alpaca keys, broker mode defaults to `simulation` (local portfolio only).

## Commands

```bash
# Terminal 1 — Backend (SQLite + Express API on port 3001)
npm run dev:server   # Backend with hot-reload (tsx --watch)
npm run server       # Backend without hot-reload

# Terminal 2 — Frontend (Vite on port 3000, proxies /api/* to :3001)
npm run dev

npm run build    # Production build
npm run lint     # Type-check only (tsc --noEmit — no ESLint configured)
npm run preview  # Preview production build
```

The app works without the backend (all API calls fail silently), but trades, analyses, and engine logs will only persist to localStorage. Run both for full persistence.

There is no test framework configured.

## Architecture

This is a single-page React + TypeScript + Vite app for **autonomous paper trading** of major US tech stocks, powered by Google Gemini AI.

### Context layer (the core)

Three React contexts wrap the entire app in `App.tsx`, in this order (outer → inner):

| Context | File | Responsibility |
|---|---|---|
| `MarketDataContext` | `src/context/MarketDataContext.tsx` | Fetches live prices for 11 tech stocks via Yahoo Finance (allorigins proxy), refreshed every 10 s. Provides `marketData: Record<string, MarketData>`. |
| `PaperTradingContext` | `src/context/PaperTradingContext.tsx` | Simulated brokerage with $100k starting cash. Manages positions, cash balance, and transaction history. Loads from `/api/portfolio/live` on mount, syncs every 15 s. Falls back to `localStorage`. |
| `AutoTradingContext` | `src/context/AutoTradingContext.tsx` | Thin polling wrapper — polls `/api/agent/status` + logs every 5 s. `setIsAutoTrading(true/false)` calls `/api/agent/start` or `/api/agent/stop`. |

### Trading logic

- **BUY**: spends 10% of current cash balance; requires `Math.floor(tradeAmount / price) >= 1` share.
- **SELL**: sells 50% of the current position in that symbol.
- Trades are rejected if market price data is unavailable or funds/shares are insufficient.

### View layer

`App.tsx` manages a single `activeTab` string. Each tab maps to a component in `src/components/`:
`Dashboard`, `MarketMonitor`, `DecisionEngine`, `RiskControls`, `ExecutionLog`, `Settings`, `Backtest`, `Reports`, `SmartMoney`, `Autonomy`.

### Path alias

`@` resolves to the project root (e.g., `@/src/components/...`). Configured in `vite.config.ts` and `tsconfig.json`.

### Styling

Tailwind CSS v4 via `@tailwindcss/vite`. Dark theme (zinc-950 background). Shared primitives in `src/components/ui/`. Utility helper `cn()` in `src/lib/utils.ts` (clsx + tailwind-merge).

### External dependencies of note

- `@google/genai` — Gemini SDK; uses `urlContext` tool so Gemini can fetch the article URL directly.
- `recharts` — charts in Dashboard/MarketMonitor.
- `motion` — animations.
- `date-fns` — date formatting in logs.
- `better-sqlite3`, `express`, `dotenv` — backend.

---

## Backend (server/)

### Entry points

| File | Responsibility |
|---|---|
| `server/db.ts` | SQLite schema setup, seeds 11 company profiles on first run. DB stored at `data/portfolio.db`. |
| `server/index.ts` | Express API on port 3001. Mounts all routes. |
| `src/lib/api.ts` | Frontend API client. All methods are fire-and-forget safe — never throw to caller. |

### Database tables

`companies`, `news_articles`, `analyses`, `signals`, `trades`, `company_knowledge`, `price_history`, `engine_logs`, `portfolio_snapshots`, `system_controls`, `agent_runs`, `agent_observations`

### Trading runtime

`server/runtime.ts` — `getTradingMode()` returns `'analysis' | 'paper' | 'live'`. Driven by `TRADING_MODE` env var + broker mode + kill switch + readiness gates. `canExecuteTrades()` is the main guard used before any order.

`server/controls.ts` — Kill switch, `liveTradingEnabled`, and `liveRolloutProfile` stored in SQLite `system_controls` table. Toggled via API.

`server/rollout.ts` — Live rollout profiles: `paper` | `limited_live` | `full_live`. Each profile has a `maxOrderValue`, `dailyNotionalLimit`, and `maxFilledOrdersPerDay`.

`server/readiness.ts` — Gates required before `liveExecutionAllowed` becomes true: ≥28 days paper track record, no critical data degradation, broker connected, etc.

### Broker integration

`server/broker.ts` — Alpaca integration. Three modes:
- `simulation` (no keys): local `portfolio.ts` only.
- `paper`: Alpaca paper trading API.
- `live`: Alpaca live trading (requires explicit `ALPACA_MODE=live` + readiness gates passing).

### Multi-agent system (`server/agents/`)

`BaseAgent` (`agents/base.ts`) — Abstract class all agents extend. Handles interval scheduling, run tracking in `autonomy.ts`, freshness/staleness, dependency blocking, and `ops.ts` data-source health reporting.

`AgentRegistry` (`agents/registry.ts`) — Singleton `registry` that manages all agents. Agents are started automatically on server start.

| Agent | Cadence | Responsibility |
|---|---|---|
| `CoordinatorAgent` | 30 s | Orchestrates the full trade cycle: stop-loss scan → risk check → execute signals from `research.ts`. |
| `HedgeFundAgent` | 6 h | Fetches 13F filings / institutional holdings for smart-money tracking. |
| `KnowledgeAgent` | 1 h | Consolidates per-symbol AI knowledge profiles in `company_knowledge`. |
| `MacroAgent` | 1 h | Fetches macro indicators (Fed rate, CPI, etc.) and classifies the current regime. |
| `ResearchIngestionAgent` | 5 min | Fetches Yahoo Finance RSS news, runs Gemini analysis, writes signal candidates to `research.ts`. |
| `ScreenerAgent` | 15 min | Scores all watchlist symbols against technical + fundamental filters. |
| `SentimentAgent` | 30 min | Options flow, short interest, squeeze candidates from external APIs. |

`server/autonomy.ts` — Persistence layer for the agent system: `agent_runs`, `agent_observations`, theses, forecasts, portfolio intents, decision lineage, calibration summaries.

### Data modules

| Module | Source | What it provides |
|---|---|---|
| `server/technicals.ts` | Yahoo Finance v8 | EMA 20/50/200, RSI(14), MACD, Bollinger Bands, ATR, Volume Ratio. Refreshed on startup + daily at 1 AM. |
| `server/fundamentals.ts` | SEC EDGAR + Yahoo Finance | EPS, Revenue, Net Income, P/E, 52w High/Low. Refreshed weekly. |
| `server/marketdata.ts` | Polygon.io | Live prices, cached 15 s. Used for trade execution. |
| `server/news.ts` | Yahoo Finance RSS | Fetches and stores raw articles with `processed` flag to prevent re-analysis. |
| `server/macro.ts` | FRED / public APIs | Macro regime classification. |
| `server/sentiment.ts` | External APIs | Options flow, short interest, squeeze candidates. |
| `server/filings.ts` | SEC EDGAR | Recent 8-K/10-Q/10-K filings per symbol. |
| `server/insiders.ts` | SEC EDGAR Form 4 | Insider transactions. |
| `server/hedgeFund.ts` | SEC 13F | Institutional holdings, manager overlap, significant changes. |
| `server/multitimeframe.ts` | Derived | Weekly technical snapshots. |
| `server/sectorrotation.ts` | Derived | Sector performance + rotation signals. |
| `server/marketclock.ts` | System time | Market session status (pre/regular/after/closed). |

### Execution pipeline

`server/research.ts` — Signal candidates produced by agents, consumed by the Coordinator.

`server/execution.ts` — `ExecutionAttempt` lifecycle (created → filled/failed). Tracks slippage, fill quality.

`server/executionHistory.ts` / `server/executionQualityProfiles.ts` — Post-trade quality analytics.

`server/reconciliation.ts` — Reconciles broker orders against local execution attempts.

`server/recovery.ts` — Recovers stuck/failed execution attempts on startup.

`server/degradation.ts` / `server/ops.ts` — Data-source health monitoring. Marks sources fresh/stale/failed.

### Risk engine

`server/risk.ts` — **7 deterministic checks** before every trade:
1. Kill Switch (portfolio drawdown > -15%)
2. Daily Loss Limit (-3%)
3. Cash Reserve (min 10% cash)
4. Max Position Size (≤ 15%)
5. Sector Exposure (≤ 30%)
6. Max Total Invested (≤ 90%)
7. Earnings Proximity (hard block 1 day before, warning 3 days)

Endpoints: `POST /api/risk/check`, `POST /api/risk/stop-loss-scan`, `GET /api/risk/events`.

### Portfolio & performance

`server/portfolio.ts` — In-memory + SQLite paper trading state. Single source of truth when broker is in simulation mode.

`server/portfolioManager.ts` — Higher-level portfolio orchestration.

`server/performance.ts` — Calculates Sharpe, drawdown, daily return history.

`server/backtest.ts` — Historical backtesting against stored price history.

`server/reports.ts` — Daily report builder.

### Key API endpoints

```
GET  /api/health               — system health + market session + degradation state
GET  /api/system/health        — extended health with readiness status
GET  /api/agent/status         — all agent statuses from AgentRegistry
POST /api/agent/start          — start all agents
POST /api/agent/stop           — stop all agents
GET  /api/portfolio/live       — current cash + positions + prices
POST /api/portfolio/trade      — execute a trade
GET  /api/autonomy/theses      — latest per-symbol theses
GET  /api/autonomy/intents     — portfolio intents
GET  /api/autonomy/lineage/:id — decision lineage for a trade
GET  /api/controls             — system controls (kill switch, live trading)
POST /api/controls/kill-switch — toggle kill switch
GET  /api/rollout/policy       — current rollout policy
POST /api/rollout/profile      — set rollout profile
GET  /api/readiness            — live-trading readiness gates
GET  /api/broker/status        — broker connection status
GET  /api/technical/all        — all technical snapshots
GET  /api/fundamentals/all     — all fundamental data
GET  /api/backtest/run         — run a backtest
GET  /api/performance          — portfolio performance metrics
```
