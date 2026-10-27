/**
 * Server-side paper trading portfolio.
 * Single source of truth — persisted to SQLite, shared between the agent loop and the API.
 */

import db from './db.js';

export interface ServerPosition {
  symbol: string;
  shares: number;
  avgPrice: number;
}

interface State {
  cash: number;
  positions: ServerPosition[];
}

const STARTING_CASH = 100_000;
const IS_TEST_ENV = process.argv.includes('--test');

let state: State = { cash: STARTING_CASH, positions: [] };
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Initialization ───────────────────────────────────────────────────────────

export function loadFromDB(): void {
  const row = db.prepare(
    'SELECT * FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 1'
  ).get() as any;

  if (row) {
    state = {
      cash:      row.cash,
      positions: JSON.parse(row.positions ?? '[]'),
    };
    console.log(
      `[Portfolio] Loaded from DB — cash: $${state.cash.toLocaleString()}, ` +
      `${state.positions.length} position(s)`
    );
  } else {
    state = { cash: STARTING_CASH, positions: [] };
    console.log('[Portfolio] No saved state — starting fresh with $100,000');
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export function getState(): { cash: number; positions: ServerPosition[] } {
  return { cash: state.cash, positions: [...state.positions] };
}

export function getTotalValue(prices: Record<string, number>): number {
  return state.cash + state.positions.reduce(
    (sum, pos) => sum + pos.shares * (prices[pos.symbol] ?? pos.avgPrice),
    0
  );
}

// ─── Trade Execution ──────────────────────────────────────────────────────────

export function executeTrade(
  action: 'BUY' | 'SELL',
  symbol: string,
  shares: number,
  price: number
): boolean {
  if (shares <= 0 || price <= 0) return false;
  const cost = shares * price;
  const existing = state.positions.find(p => p.symbol === symbol);

  if (action === 'BUY') {
    if (state.cash < cost) return false;
    state.cash -= cost;

    if (existing && existing.shares < 0) {
      const coverShares = Math.min(shares, Math.abs(existing.shares));
      existing.shares += coverShares;

      const residualShares = shares - coverShares;
      if (existing.shares === 0) {
        state.positions = state.positions.filter(p => p.symbol !== symbol);
      }

      if (residualShares > 0) {
        const longPosition = state.positions.find(p => p.symbol === symbol);
        if (longPosition) {
          const newShares = longPosition.shares + residualShares;
          longPosition.avgPrice = ((longPosition.shares * longPosition.avgPrice) + (residualShares * price)) / newShares;
          longPosition.shares = newShares;
        } else {
          state.positions.push({ symbol, shares: residualShares, avgPrice: price });
        }
      }
    } else {
      if (existing) {
        const newShares = existing.shares + shares;
        existing.avgPrice = ((existing.shares * existing.avgPrice) + cost) / newShares;
        existing.shares = newShares;
      } else {
        state.positions.push({ symbol, shares, avgPrice: price });
      }
    }
  } else {
    state.cash += cost;

    if (existing && existing.shares > 0) {
      const sellShares = Math.min(shares, existing.shares);
      existing.shares -= sellShares;
      const residualShares = shares - sellShares;
      if (existing.shares === 0) {
        state.positions = state.positions.filter(p => p.symbol !== symbol);
      }

      if (residualShares > 0) {
        const shortPosition = state.positions.find(p => p.symbol === symbol);
        if (shortPosition) {
          const currentShortNotional = Math.abs(shortPosition.shares) * shortPosition.avgPrice;
          const additionalNotional = residualShares * price;
          const newShortShares = Math.abs(shortPosition.shares) + residualShares;
          shortPosition.avgPrice = (currentShortNotional + additionalNotional) / newShortShares;
          shortPosition.shares = -newShortShares;
        } else {
          state.positions.push({ symbol, shares: -residualShares, avgPrice: price });
        }
      }
    } else if (existing && existing.shares < 0) {
      const currentShortNotional = Math.abs(existing.shares) * existing.avgPrice;
      const additionalNotional = shares * price;
      const newShortShares = Math.abs(existing.shares) + shares;
      existing.avgPrice = (currentShortNotional + additionalNotional) / newShortShares;
      existing.shares = -newShortShares;
    } else {
      state.positions.push({ symbol, shares: -shares, avgPrice: price });
    }
  }

  scheduleSave();
  return true;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function scheduleSave(): void {
  if (IS_TEST_ENV) {
    persistToDB();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistToDB, 5_000);
}

/** Called by broker.ts to overwrite local state with Alpaca's truth. */
export function syncFromBroker(brokerState: { cash: number; positions: ServerPosition[] }): void {
  state.cash      = brokerState.cash;
  state.positions = brokerState.positions;
  scheduleSave();
  console.log(`[Portfolio] Synced from broker: cash=$${brokerState.cash.toLocaleString()}, ${brokerState.positions.length} positions`);
}

export function persistToDB(totalValue?: number): void {
  try {
    // Calculate total_value from positions if not provided
    const storedValue = totalValue ?? null;

    db.prepare(`
      INSERT INTO portfolio_snapshots (cash, positions, transactions, total_value)
      VALUES (@cash, @positions, @transactions, @total_value)
    `).run({
      cash:         state.cash,
      positions:    JSON.stringify(state.positions),
      transactions: JSON.stringify([]),
      total_value:  storedValue,
    });
    // Keep only the last 200 snapshots
    db.prepare(`
      DELETE FROM portfolio_snapshots WHERE id NOT IN (
        SELECT id FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 200
      )
    `).run();
  } catch (err) {
    console.error('[Portfolio] DB save failed:', err);
  }
}
