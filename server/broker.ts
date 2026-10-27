/**
 * Alpaca Broker Integration
 *
 * Supports three modes (set via environment):
 *   simulation   — no broker, local portfolio.ts only (default)
 *   paper        — Alpaca paper trading (free, no real money)
 *   live         — Alpaca live trading (real money, requires ALPACA_MODE=live)
 *
 * Required .env variables:
 *   ALPACA_API_KEY=your_key
 *   ALPACA_API_SECRET=your_secret
 *   ALPACA_MODE=paper  (or "live" for real money — be careful)
 *
 * Get free Alpaca API keys at: https://app.alpaca.markets
 */

import db from './db.js';

export type BrokerMode = 'simulation' | 'paper' | 'live';

export interface BrokerConfigData {
  mode: BrokerMode;
  apiKey: string;
  apiSecret: string;
  hasKey: boolean;
  hasSecret: boolean;
  maskedKey: string;
  maskedSecret: string;
  connected: boolean;
  updatedAt: number;
}

function maskString(str: string): string {
  if (!str || str.length < 8) return '';
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

export function getBrokerConfig(): BrokerConfigData {
  const row = db.prepare(`SELECT * FROM broker_config WHERE id = 1`).get() as any;
  const dbKey = (row?.api_key ?? '').trim();
  const dbSecret = (row?.api_secret ?? '').trim();
  const dbMode = (row?.mode ?? '').trim().toLowerCase();

  const apiKey = dbKey || process.env.ALPACA_API_KEY?.trim() || '';
  const apiSecret = dbSecret || process.env.ALPACA_API_SECRET?.trim() || '';
  let mode: BrokerMode = 'simulation';

  if (dbMode === 'simulation') {
    mode = 'simulation';
  } else if (!apiKey || !apiSecret) {
    mode = 'simulation';
  } else if (dbMode === 'live' || (dbMode === '' && process.env.ALPACA_MODE === 'live')) {
    mode = 'live';
  } else {
    mode = 'paper';
  }

  return {
    mode,
    apiKey,
    apiSecret,
    hasKey: Boolean(apiKey),
    hasSecret: Boolean(apiSecret),
    maskedKey: maskString(apiKey),
    maskedSecret: maskString(apiSecret),
    connected: mode !== 'simulation' && Boolean(apiKey && apiSecret),
    updatedAt: Number(row?.updated_at ?? Date.now() / 1000),
  };
}

export function updateBrokerConfig(params: {
  mode?: BrokerMode;
  apiKey?: string;
  apiSecret?: string;
}): BrokerConfigData {
  const current = getBrokerConfig();
  const nextMode = params.mode ?? current.mode;
  const nextKey = params.apiKey !== undefined && params.apiKey.trim() !== '' ? params.apiKey.trim() : current.apiKey;
  const nextSecret = params.apiSecret !== undefined && params.apiSecret.trim() !== '' ? params.apiSecret.trim() : current.apiSecret;

  db.prepare(`
    UPDATE broker_config
    SET mode = @mode,
        api_key = @api_key,
        api_secret = @api_secret,
        updated_at = unixepoch()
    WHERE id = 1
  `).run({
    mode: nextMode,
    api_key: nextKey,
    api_secret: nextSecret,
  });

  return getBrokerConfig();
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function getBrokerMode(): BrokerMode {
  return getBrokerConfig().mode;
}

export function isBrokerConnected(): boolean {
  return getBrokerConfig().connected;
}

function getBaseURL(): string {
  return getBrokerMode() === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets';
}

function getHeaders(): Record<string, string> {
  const config = getBrokerConfig();
  return {
    'APCA-API-KEY-ID':     config.apiKey,
    'APCA-API-SECRET-KEY': config.apiSecret,
    'Content-Type': 'application/json',
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrokerAccount {
  cash:           number;
  portfolioValue: number;
  buyingPower:    number;
  equity:         number;
  longMarketValue: number;
  tradingBlocked: boolean;
  accountBlocked: boolean;
  mode:           BrokerMode;
}

export interface BrokerPosition {
  symbol:          string;
  qty:             number;
  avgEntryPrice:   number;
  currentPrice:    number;
  marketValue:     number;
  unrealizedPl:    number;
  unrealizedPlPct: number;
  side:            'long' | 'short';
}

export interface BrokerOrder {
  id:              string;
  clientOrderId:   string;
  symbol:          string;
  side:            'buy' | 'sell';
  qty:             number;
  filledQty:       number;
  filledAvgPrice:  number | null;
  status:          string;        // 'new', 'partially_filled', 'filled', 'canceled', 'rejected'
  orderType:       string;        // 'market', 'limit'
  timeInForce:     string;
  createdAt:       string;        // ISO timestamp
  filledAt:        string | null;
}

// ─── API Client ───────────────────────────────────────────────────────────────

async function alpaca<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getBaseURL()}${path}`, {
    ...options,
    headers: { ...getHeaders(), ...(options?.headers as any ?? {}) },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Alpaca ${res.status} ${path}: ${text.slice(0, 200)}`);
  }

  // 204 No Content
  if (res.status === 204) return {} as T;
  return res.json();
}

// ─── Account ──────────────────────────────────────────────────────────────────

export async function getAccount(): Promise<BrokerAccount> {
  const a = await alpaca<any>('/v2/account');
  return {
    cash:            parseFloat(a.cash),
    portfolioValue:  parseFloat(a.portfolio_value),
    buyingPower:     parseFloat(a.buying_power),
    equity:          parseFloat(a.equity),
    longMarketValue: parseFloat(a.long_market_value ?? '0'),
    tradingBlocked:  a.trading_blocked,
    accountBlocked:  a.account_blocked,
    mode:            getBrokerMode(),
  };
}

export async function testConnection(credentialsOverride?: { apiKey?: string; apiSecret?: string; mode?: BrokerMode }): Promise<{ ok: boolean; account?: BrokerAccount; error?: string }> {
  const config = getBrokerConfig();
  const mode = credentialsOverride?.mode || config.mode;
  const apiKey = credentialsOverride?.apiKey?.trim() || config.apiKey;
  const apiSecret = credentialsOverride?.apiSecret?.trim() || config.apiSecret;

  if (mode === 'simulation' && (!apiKey || !apiSecret)) {
    return { ok: false, error: 'Keine API-Keys hinterlegt — Broker läuft im Simulationsmodus.' };
  }
  if (!apiKey || !apiSecret) {
    return { ok: false, error: 'Sowohl API Key ID als auch Secret Key sind erforderlich.' };
  }

  const url = mode === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
  try {
    const res = await fetch(`${url}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let errorDetail = text.slice(0, 150);
      try {
        const json = JSON.parse(text);
        if (json?.message) errorDetail = json.message;
      } catch {}
      return { ok: false, error: `Alpaca HTTP ${res.status}: ${errorDetail}` };
    }

    const a = await res.json() as any;
    return {
      ok: true,
      account: {
        cash: parseFloat(a.cash),
        portfolioValue: parseFloat(a.portfolio_value),
        buyingPower: parseFloat(a.buying_power),
        equity: parseFloat(a.equity),
        longMarketValue: parseFloat(a.long_market_value ?? '0'),
        tradingBlocked: a.trading_blocked,
        accountBlocked: a.account_blocked,
        mode,
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Verbindung fehlgeschlagen' };
  }
}

// ─── Positions ────────────────────────────────────────────────────────────────

export async function getPositions(): Promise<BrokerPosition[]> {
  const positions = await alpaca<any[]>('/v2/positions');
  return positions.map(p => ({
    symbol:          p.symbol,
    qty:             parseFloat(p.qty),
    avgEntryPrice:   parseFloat(p.avg_entry_price),
    currentPrice:    parseFloat(p.current_price ?? p.avg_entry_price),
    marketValue:     parseFloat(p.market_value ?? '0'),
    unrealizedPl:    parseFloat(p.unrealized_pl ?? '0'),
    unrealizedPlPct: parseFloat(p.unrealized_plpc ?? '0'),
    side:            p.side,
  }));
}

export async function closePosition(symbol: string): Promise<void> {
  await alpaca<any>(`/v2/positions/${symbol}`, { method: 'DELETE' });
}

export async function closeAllPositions(): Promise<void> {
  await alpaca<any>('/v2/positions', {
    method: 'DELETE',
    body: JSON.stringify({ cancel_orders: true }),
  });
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function placeMarketOrder(
  symbol: string,
  side: 'buy' | 'sell',
  qty: number,
  clientOrderId: string,
): Promise<BrokerOrder> {
  const order = await alpaca<any>('/v2/orders', {
    method: 'POST',
    body: JSON.stringify({
      symbol,
      qty:           String(qty),
      side,
      type:          'market',
      time_in_force: 'day',
      client_order_id: clientOrderId,
    }),
  });

  return mapOrder(order);
}

export async function getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null> {
  const res = await fetch(
    `${getBaseURL()}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
    { headers: getHeaders() },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Alpaca ${res.status} order lookup: ${body.slice(0, 200)}`);
  }
  return mapOrder(await res.json());
}

export async function cancelOrder(orderId: string): Promise<void> {
  await alpaca<any>(`/v2/orders/${orderId}`, { method: 'DELETE' });
}

export async function cancelAllOrders(): Promise<void> {
  await alpaca<any>('/v2/orders', { method: 'DELETE' });
}

export async function getOrders(status: 'open' | 'closed' | 'all' = 'closed', limit = 50): Promise<BrokerOrder[]> {
  const orders = await alpaca<any[]>(`/v2/orders?status=${status}&limit=${limit}&direction=desc`);
  return orders.map(mapOrder);
}

function mapOrder(o: any): BrokerOrder {
  return {
    id:             o.id,
    clientOrderId:  o.client_order_id,
    symbol:         o.symbol,
    side:           o.side,
    qty:            parseFloat(o.qty),
    filledQty:      parseFloat(o.filled_qty ?? '0'),
    filledAvgPrice: o.filled_avg_price ? parseFloat(o.filled_avg_price) : null,
    status:         o.status,
    orderType:      o.type,
    timeInForce:    o.time_in_force,
    createdAt:      o.created_at,
    filledAt:       o.filled_at ?? null,
  };
}

// ─── Portfolio Sync ───────────────────────────────────────────────────────────

/**
 * Syncs Alpaca account state into our local portfolio.ts state.
 * Call after each trade and periodically (every 60s).
 */
export async function syncToLocalPortfolio(): Promise<void> {
  if (!isBrokerConnected()) return;

  try {
    const [account, positions] = await Promise.all([getAccount(), getPositions()]);

    // Import the named sync helper dynamically to avoid circular deps.
    const portfolioModule = await import('./portfolio.js');

    // Update local state to match Alpaca
    if (typeof portfolioModule.syncFromBroker === 'function') {
      portfolioModule.syncFromBroker({
        cash:      account.cash,
        positions: positions.map(p => ({
          symbol:   p.symbol,
          shares:   p.side === 'short' ? -p.qty : p.qty,
          avgPrice: p.avgEntryPrice,
        })),
      });
    }
  } catch (err: any) {
    console.error('[Broker] Sync failed:', err?.message);
  }
}
