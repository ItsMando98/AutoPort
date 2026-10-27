/**
 * Deterministic Risk Engine
 *
 * This module enforces hard trading rules BEFORE any order reaches execution.
 * All decisions are logged to the risk_events table for full auditability.
 *
 * Per PRD: "Probabilistische Komponenten erzeugen Hypothesen.
 *           Deterministische Komponenten entscheiden, ob gehandelt werden darf."
 */

import db from './db.js';
import { getEarningsForSymbol } from './fundamentals.js';
import type { MacroRegime } from './macro.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortfolioPosition {
  symbol: string;
  shares: number;
  avgPrice: number;
}

export interface RiskPortfolioState {
  cash: number;
  positions: PortfolioPosition[];
  totalValue: number;
}

export interface RiskCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RiskCheckResult {
  allowed: boolean;
  failedCheck: string | null;
  reason: string;
  checks: RiskCheck[];
}

export interface StopLossAlert {
  symbol: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  pnlPct: number;        // negative value
  unrealizedLoss: number;
}

// ─── Risk Limits (all configurable here) ─────────────────────────────────────

const LIMITS = {
  maxPositionPct:       0.15,   // Single position ≤ 15% of portfolio
  maxSectorPct:         0.30,   // Sector exposure ≤ 30%
  maxInvestedPct:       0.90,   // Total invested ≤ 90% (10% cash reserve)
  maxGrossExposurePct:  1.25,   // Long + short gross exposure ≤ 125%
  maxShortExposurePct:  0.35,   // Total short exposure ≤ 35%
  minCashReservePct:    0.10,   // Always keep 10% cash
  dailyLossLimit:      -0.03,   // -3%: no new BUYs today
  portfolioDrawdown:   -0.15,   // -15%: kill switch
  stopLossPct:         -0.08,   // -8%: auto-sell
  earningsWarningDays:  3,      // Warn if earnings within 3 days
  earningsBlockDays:    1,      // Hard block if earnings tomorrow
  startingCapital:  100_000,
};

// ─── Main Check ───────────────────────────────────────────────────────────────

export function checkTradeAllowed(
  symbol: string,
  action: 'BUY' | 'SELL',
  shares: number,
  price: number,
  portfolio: RiskPortfolioState
): RiskCheckResult {
  const checks: RiskCheck[] = [];
  const tradeValue = shares * price;
  const { cash, positions, totalValue } = portfolio;
  const existing = positions.find(position => position.symbol === symbol);
  const existingShares = existing?.shares ?? 0;
  const resultingShares = action === 'BUY'
    ? existingShares + shares
    : existingShares - shares;
  const newLongShares = Math.max(resultingShares, 0) - Math.max(existingShares, 0);
  const newShortShares = Math.abs(Math.min(resultingShares, 0)) - Math.abs(Math.min(existingShares, 0));
  const increasesRisk = newLongShares > 0 || newShortShares > 0;
  const opensLong = newLongShares > 0;
  const opensShort = newShortShares > 0;
  const resultingPositionValue = Math.abs(resultingShares) * price;

  // ── 1. Kill Switch: portfolio drawdown from starting capital ──────────────
  const drawdown = (totalValue - LIMITS.startingCapital) / LIMITS.startingCapital;
  const killTriggered = drawdown <= LIMITS.portfolioDrawdown;
  checks.push({
    name: 'Kill Switch (Drawdown)',
    passed: !(killTriggered && increasesRisk),
    detail: `Portfolio ${drawdown >= 0 ? '+' : ''}${(drawdown * 100).toFixed(1)}% from start (limit: ${(LIMITS.portfolioDrawdown * 100).toFixed(0)}%)`,
  });
  if (killTriggered && increasesRisk) {
    return reject('Kill Switch', `Portfolio down ${(Math.abs(drawdown) * 100).toFixed(1)}% — kill switch active, no new directional exposure`, checks, symbol, action, shares, price);
  }

  // ── 2. Daily loss limit (new exposure only) ───────────────────────────────
  if (increasesRisk) {
    const dailyStartValue = getDailyStartValue(totalValue);
    const dailyLoss = (totalValue - dailyStartValue) / dailyStartValue;
    checks.push({
      name: 'Daily Loss Limit',
      passed: dailyLoss > LIMITS.dailyLossLimit,
      detail: `Today P&L: ${dailyLoss >= 0 ? '+' : ''}${(dailyLoss * 100).toFixed(1)}% (limit: ${(LIMITS.dailyLossLimit * 100).toFixed(0)}%)`,
    });
    if (dailyLoss <= LIMITS.dailyLossLimit) {
      return reject('Daily Loss Limit', `Daily loss of ${(Math.abs(dailyLoss) * 100).toFixed(1)}% reached — no new exposure today`, checks, symbol, action, shares, price);
    }
  }

  // ── 3. Cash reserve (new long only) ───────────────────────────────────────
  if (opensLong) {
    const cashAfter   = cash - tradeValue;
    const cashResPct  = cashAfter / totalValue;
    checks.push({
      name: 'Cash Reserve',
      passed: cashResPct >= LIMITS.minCashReservePct,
      detail: `Cash after trade: ${(cashResPct * 100).toFixed(1)}% of portfolio (min: ${(LIMITS.minCashReservePct * 100).toFixed(0)}%)`,
    });
    if (cashResPct < LIMITS.minCashReservePct) {
      return reject('Cash Reserve', `Trade would reduce cash below ${(LIMITS.minCashReservePct * 100).toFixed(0)}% reserve`, checks, symbol, action, shares, price);
    }
  }

  // ── 4. Max position size (new long or short) ──────────────────────────────
  if (increasesRisk) {
    const posPct = totalValue > 0 ? resultingPositionValue / totalValue : 0;
    checks.push({
      name: 'Max Position Size',
      passed: posPct <= LIMITS.maxPositionPct,
      detail: `${symbol} would be ${(posPct * 100).toFixed(1)}% of portfolio (max: ${(LIMITS.maxPositionPct * 100).toFixed(0)}%)`,
    });
    if (posPct > LIMITS.maxPositionPct) {
      return reject('Max Position Size', `${symbol} position would exceed ${(LIMITS.maxPositionPct * 100).toFixed(0)}% of portfolio`, checks, symbol, action, shares, price);
    }
  }

  // ── 5. Max sector exposure (gross, long + short) ──────────────────────────
  if (increasesRisk) {
    const sector = getSymbolSector(symbol);
    const sectorValue = positions
      .filter(p => p.symbol !== symbol && getSymbolSector(p.symbol) === sector)
      .reduce((sum, p) => sum + Math.abs(p.shares) * getReferencePrice(p.symbol, p.avgPrice), 0);
    const newSectorPct = totalValue > 0 ? (sectorValue + resultingPositionValue) / totalValue : 0;
    checks.push({
      name: 'Sector Exposure',
      passed: newSectorPct <= LIMITS.maxSectorPct,
      detail: `${sector} sector would be ${(newSectorPct * 100).toFixed(1)}% (max: ${(LIMITS.maxSectorPct * 100).toFixed(0)}%)`,
    });
    if (newSectorPct > LIMITS.maxSectorPct) {
      return reject('Sector Exposure', `${sector} sector would exceed ${(LIMITS.maxSectorPct * 100).toFixed(0)}% of portfolio`, checks, symbol, action, shares, price);
    }
  }

  // ── 6. Gross and short exposure limits ────────────────────────────────────
  if (increasesRisk) {
    const currentGross = positions.reduce((sum, position) => sum + Math.abs(position.shares) * getReferencePrice(position.symbol, position.avgPrice), 0);
    const currentSymbolGross = Math.abs(existingShares) * price;
    const grossAfterPct = totalValue > 0 ? (currentGross - currentSymbolGross + resultingPositionValue) / totalValue : 0;
    checks.push({
      name: 'Max Gross Exposure',
      passed: grossAfterPct <= LIMITS.maxGrossExposurePct,
      detail: `Gross exposure after trade: ${(grossAfterPct * 100).toFixed(1)}% (max: ${(LIMITS.maxGrossExposurePct * 100).toFixed(0)}%)`,
    });
    if (grossAfterPct > LIMITS.maxGrossExposurePct) {
      return reject('Max Gross Exposure', `Portfolio would exceed ${(LIMITS.maxGrossExposurePct * 100).toFixed(0)}% gross exposure`, checks, symbol, action, shares, price);
    }
  }

  if (opensLong) {
    const currentInvested = positions.reduce((sum, position) => sum + Math.max(position.shares, 0) * getReferencePrice(position.symbol, position.avgPrice), 0);
    const currentLongInSymbol = Math.max(existingShares, 0) * price;
    const investedAfterPct = totalValue > 0
      ? (currentInvested - currentLongInSymbol + Math.max(resultingShares, 0) * price) / totalValue
      : 0;
    checks.push({
      name: 'Max Total Invested',
      passed: investedAfterPct <= LIMITS.maxInvestedPct,
      detail: `Invested after trade: ${(investedAfterPct * 100).toFixed(1)}% (max: ${(LIMITS.maxInvestedPct * 100).toFixed(0)}%)`,
    });
    if (investedAfterPct > LIMITS.maxInvestedPct) {
      return reject('Max Total Invested', `Portfolio would exceed ${(LIMITS.maxInvestedPct * 100).toFixed(0)}% invested`, checks, symbol, action, shares, price);
    }
  }

  if (opensShort) {
    const currentShortExposure = positions.reduce((sum, position) => sum + Math.abs(Math.min(position.shares, 0)) * getReferencePrice(position.symbol, position.avgPrice), 0);
    const currentShortInSymbol = Math.abs(Math.min(existingShares, 0)) * price;
    const shortAfterPct = totalValue > 0
      ? (currentShortExposure - currentShortInSymbol + Math.abs(Math.min(resultingShares, 0)) * price) / totalValue
      : 0;
    checks.push({
      name: 'Max Short Exposure',
      passed: shortAfterPct <= LIMITS.maxShortExposurePct,
      detail: `Short exposure after trade: ${(shortAfterPct * 100).toFixed(1)}% (max: ${(LIMITS.maxShortExposurePct * 100).toFixed(0)}%)`,
    });
    if (shortAfterPct > LIMITS.maxShortExposurePct) {
      return reject('Max Short Exposure', `Portfolio would exceed ${(LIMITS.maxShortExposurePct * 100).toFixed(0)}% short exposure`, checks, symbol, action, shares, price);
    }
  }

  // ── 7. Earnings proximity (new exposure only) ─────────────────────────────
  if (increasesRisk) {
    const earnings = getEarningsForSymbol(symbol, LIMITS.earningsWarningDays + 1);
    if (earnings) {
      const isHardBlock = earnings.daysUntil <= LIMITS.earningsBlockDays;
      checks.push({
        name: 'Earnings Proximity',
        passed: !isHardBlock,
        detail: `${symbol} earnings in ${earnings.daysUntil} day(s)${isHardBlock ? ' — too risky to add exposure' : ' — proceed with caution'}`,
      });
      if (isHardBlock) {
        return reject('Earnings Proximity', `${symbol} has earnings tomorrow — blocked to avoid new event risk`, checks, symbol, action, shares, price);
      }
    } else {
      checks.push({
        name: 'Earnings Proximity',
        passed: true,
        detail: `No earnings within ${LIMITS.earningsWarningDays} days`,
      });
    }
  }

  // ── All passed ────────────────────────────────────────────────────────────
  logRiskEvent(symbol, action, shares, price, true, null, 'All risk checks passed', checks);
  return { allowed: true, failedCheck: null, reason: 'All risk checks passed', checks };
}

// ─── Stop-Loss Scanner ────────────────────────────────────────────────────────

/**
 * Scans all current positions and returns those that have breached the stop-loss.
 * Called at the start of every trading cycle.
 */
export function getStopLossAlerts(
  positions: PortfolioPosition[],
  currentPrices: Record<string, number>,
  macroRegime: MacroRegime = 'neutral',
): StopLossAlert[] {
  const alerts: StopLossAlert[] = [];
  const stopLossPct = getStopLossThreshold(macroRegime);
  for (const pos of positions) {
    const currentPrice = currentPrices[pos.symbol];
    if (!currentPrice) continue;
    const pnlPct = pos.shares >= 0
      ? (currentPrice - pos.avgPrice) / pos.avgPrice
      : (pos.avgPrice - currentPrice) / pos.avgPrice;
    if (pnlPct <= stopLossPct) {
      const unrealizedLoss = (currentPrice - pos.avgPrice) * pos.shares;
      alerts.push({
        symbol:        pos.symbol,
        shares:        pos.shares,
        avgPrice:      pos.avgPrice,
        currentPrice,
        pnlPct,
        unrealizedLoss,
      });
    }
  }
  return alerts;
}

export function getStopLossThreshold(macroRegime: MacroRegime = 'neutral'): number {
  switch (macroRegime) {
    case 'bull':
      return -0.08;
    case 'bear':
      return -0.05;
    case 'neutral':
    default:
      return -0.06;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSymbolSector(symbol: string): string {
  const row = db.prepare('SELECT sector FROM companies WHERE symbol = ?').get(symbol) as any;
  return row?.sector ?? 'Unknown';
}

function getReferencePrice(symbol: string, fallback: number): number {
  const row = db.prepare(`
    SELECT close
    FROM price_history
    WHERE symbol = ?
    ORDER BY date DESC
    LIMIT 1
  `).get(symbol) as { close: number } | undefined;
  return row?.close ?? fallback;
}

/** Looks up the most recent portfolio snapshot from 24+ hours ago for daily P&L. */
function getDailyStartValue(fallback: number): number {
  const yesterday = Math.floor(Date.now() / 1000) - 86400;
  const row = db.prepare(`
    SELECT total_value FROM portfolio_snapshots
    WHERE created_at <= ? AND total_value IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(yesterday) as any;
  return row?.total_value ?? fallback;
}

function reject(
  failedCheck: string,
  reason: string,
  checks: RiskCheck[],
  symbol: string,
  action: string,
  shares: number,
  price: number
): RiskCheckResult {
  logRiskEvent(symbol, action, shares, price, false, failedCheck, reason, checks);
  return { allowed: false, failedCheck, reason, checks };
}

function logRiskEvent(
  symbol: string,
  action: string,
  shares: number,
  price: number,
  allowed: boolean,
  failedCheck: string | null,
  reason: string,
  checks: RiskCheck[]
): void {
  try {
    db.prepare(`
      INSERT INTO risk_events (symbol, action, shares, price, allowed, failed_check, reason, checks)
      VALUES (@symbol, @action, @shares, @price, @allowed, @failed_check, @reason, @checks)
    `).run({
      symbol,
      action,
      shares,
      price,
      allowed: allowed ? 1 : 0,
      failed_check: failedCheck,
      reason,
      checks: JSON.stringify(checks),
    });
  } catch (e) {
    console.error('[Risk] Failed to log event:', e);
  }
}

export { LIMITS };
