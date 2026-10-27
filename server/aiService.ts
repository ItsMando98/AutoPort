import { db } from './db.js';

export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'openrouter' | 'ollama';

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
}

export interface AiConfigData {
  provider: AiProvider;
  model: string;
  apiKeysConfigured: Record<AiProvider, boolean>;
  maskedKeys: Record<string, string>;
  budgetLimitUsd: number;
  totalSpendUsd: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalRequests: number;
  budgetBlocked: boolean;
  remainingBudgetUsd: number;
  spendPercent: number;
  updatedAt: number;
}

export class AIBudgetExceededError extends Error {
  public readonly spent: number;
  public readonly limit: number;

  constructor(spent: number, limit: number) {
    super(`AI budget exceeded: spent $${spent.toFixed(4)} of $${limit.toFixed(2)} limit. Further AI processing is blocked.`);
    this.name = 'AIBudgetExceededError';
    this.spent = spent;
    this.limit = limit;
  }
}

// Pricing per 1 Million tokens [input, output] in USD
const PRICING_PER_1M: Record<string, [number, number]> = {
  // Anthropic Claude
  'claude-3-7-sonnet': [3.00, 15.00],
  'claude-3-5-sonnet': [3.00, 15.00],
  'claude-3-5-haiku': [0.80, 4.00],
  'claude-3-opus': [15.00, 75.00],
  // OpenAI
  'gpt-4.5': [75.00, 150.00],
  'gpt-4o': [2.50, 10.00],
  'gpt-4o-mini': [0.15, 0.60],
  'o1': [15.00, 60.00],
  'o1-mini': [3.00, 12.00],
  'o3-mini': [1.10, 4.40],
  'gpt-4-turbo': [10.00, 30.00],
  'gpt-3.5-turbo': [0.50, 1.50],
  // Google Gemini
  'gemini-2.5-flash': [0.075, 0.30],
  'gemini-2.5-pro': [1.25, 5.00],
  'gemini-2.0-flash-lite': [0.05, 0.20],
  'gemini-2.0-flash': [0.075, 0.30],
  'gemini-1.5-flash': [0.075, 0.30],
  'gemini-1.5-pro': [1.25, 5.00],
  // Groq & DeepSeek
  'deepseek-r1': [0.55, 2.19],
  'deepseek-v3': [0.14, 0.28],
  'llama-3.3-70b': [0.59, 0.79],
  'llama-3.1-8b': [0.05, 0.08],
  'qwen-qwq-32b': [0.20, 0.40],
  'mixtral-8x7b': [0.24, 0.24],
  // Ollama (local)
  'ollama': [0.0, 0.0],
};

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const normalized = model.toLowerCase();
  let rates: [number, number] = [0.50, 1.50]; // default fallback per 1M

  if (normalized.includes('ollama') || normalized.startsWith('local/')) {
    rates = [0, 0];
  } else {
    for (const [key, val] of Object.entries(PRICING_PER_1M)) {
      if (normalized.includes(key)) {
        rates = val;
        break;
      }
    }
  }

  const inputCost = (inputTokens / 1_000_000) * rates[0];
  const outputCost = (outputTokens / 1_000_000) * rates[1];
  return inputCost + outputCost;
}

function maskApiKey(key: string | null | undefined): string {
  if (!key || key.length < 8) return '';
  const first = key.slice(0, 6);
  const last = key.slice(-4);
  return `${first}...${last}`;
}

export function getAiConfig(): AiConfigData {
  const row = db.prepare(`SELECT * FROM ai_config WHERE id = 1`).get() as any;
  const apiKeys: Record<string, string> = row?.api_keys ? JSON.parse(row.api_keys) : {};

  const getEnvKey = (provider: AiProvider): string | undefined => {
    switch (provider) {
      case 'gemini': return process.env.GEMINI_API_KEY;
      case 'openai': return process.env.OPENAI_API_KEY;
      case 'anthropic': return process.env.ANTHROPIC_API_KEY;
      case 'groq': return process.env.GROQ_API_KEY;
      case 'openrouter': return process.env.OPENROUTER_API_KEY;
      default: return undefined;
    }
  };

  const providers: AiProvider[] = ['gemini', 'openai', 'anthropic', 'groq', 'openrouter', 'ollama'];
  const apiKeysConfigured: Record<AiProvider, boolean> = {
    gemini: false,
    openai: false,
    anthropic: false,
    groq: false,
    openrouter: false,
    ollama: true, // Ollama does not require an API key
  };
  const maskedKeys: Record<string, string> = {};

  for (const p of providers) {
    const key = apiKeys[p] || getEnvKey(p);
    if (key) {
      apiKeysConfigured[p] = true;
      maskedKeys[p] = maskApiKey(key);
    }
  }

  const budgetLimitUsd = Number(row?.budget_limit_usd ?? 10.0);
  const totalSpendUsd = Number(row?.total_spend_usd ?? 0.0);
  const budgetBlocked = budgetLimitUsd > 0 && totalSpendUsd >= budgetLimitUsd;
  const remainingBudgetUsd = budgetLimitUsd > 0 ? Math.max(0, budgetLimitUsd - totalSpendUsd) : 0;
  const spendPercent = budgetLimitUsd > 0 ? Math.min(100, (totalSpendUsd / budgetLimitUsd) * 100) : 0;

  return {
    provider: (row?.provider ?? 'gemini') as AiProvider,
    model: row?.model ?? 'gemini-2.5-flash',
    apiKeysConfigured,
    maskedKeys,
    budgetLimitUsd,
    totalSpendUsd,
    totalTokensInput: Number(row?.total_tokens_input ?? 0),
    totalTokensOutput: Number(row?.total_tokens_output ?? 0),
    totalRequests: Number(row?.total_requests ?? 0),
    budgetBlocked,
    remainingBudgetUsd,
    spendPercent,
    updatedAt: Number(row?.updated_at ?? Date.now() / 1000),
  };
}

export function getActiveApiKey(provider: AiProvider): string | null {
  const row = db.prepare(`SELECT api_keys FROM ai_config WHERE id = 1`).get() as any;
  const apiKeys: Record<string, string> = row?.api_keys ? JSON.parse(row.api_keys) : {};

  if (apiKeys[provider]?.trim()) {
    return apiKeys[provider].trim();
  }

  switch (provider) {
    case 'gemini': return process.env.GEMINI_API_KEY?.trim() || null;
    case 'openai': return process.env.OPENAI_API_KEY?.trim() || null;
    case 'anthropic': return process.env.ANTHROPIC_API_KEY?.trim() || null;
    case 'groq': return process.env.GROQ_API_KEY?.trim() || null;
    case 'openrouter': return process.env.OPENROUTER_API_KEY?.trim() || null;
    case 'ollama': return 'ollama';
    default: return null;
  }
}

export function updateAiConfig(params: {
  provider?: AiProvider;
  model?: string;
  apiKey?: string;
  budgetLimitUsd?: number;
}): AiConfigData {
  const current = getAiConfig();
  const row = db.prepare(`SELECT api_keys FROM ai_config WHERE id = 1`).get() as any;
  const apiKeys: Record<string, string> = row?.api_keys ? JSON.parse(row.api_keys) : {};

  const nextProvider = params.provider ?? current.provider;
  const nextModel = params.model ?? current.model;
  const nextBudget = params.budgetLimitUsd !== undefined ? Number(params.budgetLimitUsd) : current.budgetLimitUsd;

  if (params.apiKey !== undefined && params.apiKey.trim() !== '') {
    apiKeys[nextProvider] = params.apiKey.trim();
  }

  const budgetBlocked = nextBudget > 0 && current.totalSpendUsd >= nextBudget ? 1 : 0;

  db.prepare(`
    UPDATE ai_config
    SET provider = @provider,
        model = @model,
        api_keys = @api_keys,
        budget_limit_usd = @budget_limit_usd,
        budget_blocked = @budget_blocked,
        updated_at = unixepoch()
    WHERE id = 1
  `).run({
    provider: nextProvider,
    model: nextModel,
    api_keys: JSON.stringify(apiKeys),
    budget_limit_usd: nextBudget,
    budget_blocked: budgetBlocked,
  });

  return getAiConfig();
}

export function resetAiSpend(): AiConfigData {
  db.prepare(`
    UPDATE ai_config
    SET total_spend_usd = 0.0,
        total_tokens_input = 0,
        total_tokens_output = 0,
        total_requests = 0,
        budget_blocked = 0,
        updated_at = unixepoch()
    WHERE id = 1
  `).run();

  return getAiConfig();
}

export function isBudgetExceeded(): boolean {
  const config = getAiConfig();
  return config.budgetBlocked;
}

// ─── Model Auto-Loading ────────────────────────────────────────────────────────

const FALLBACK_MODELS: Record<AiProvider, ModelOption[]> = {
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Google DeepMind flagship fast model' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Advanced reasoning & complex market analysis' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'High throughput multimodal model' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', description: 'Ultra low-cost high speed model' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Production battle-tested fast model' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Large 2M token context model' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Flagship multimodal high-intelligence model' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast, cheap, and capable (Recommended)' },
    { id: 'o3-mini', name: 'o3-mini', description: 'State-of-the-art fast specialized reasoning' },
    { id: 'o1', name: 'o1', description: 'Full deep reasoning model' },
    { id: 'o1-mini', name: 'o1-mini', description: 'Compact reasoning model' },
    { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview', description: 'Orion high-scale intelligence' },
    { id: 'chatgpt-4o-latest', name: 'ChatGPT-4o Latest', description: 'Continuously updated chat model' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'High-capability legacy model' },
  ],
  anthropic: [
    { id: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet (Latest)', description: 'Latest flagship with hybrid reasoning and coding dominance' },
    { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (20250219)', description: 'Pinned Claude 3.7 Sonnet release' },
    { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', description: 'Industry benchmark in financial reasoning & code' },
    { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', description: 'Ultra-fast Claude model, great for streaming & ingestion' },
    { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', description: 'Deep analytical and narrative capabilities' },
  ],
  groq: [
    { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill Llama 70B', description: 'Ultra-fast open reasoning model on LPUs' },
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', description: 'State-of-the-art open model with ultra-fast inference' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', description: 'Instant, lightweight low-cost processing' },
    { id: 'qwen-qwq-32b', name: 'Qwen QwQ 32B', description: 'Alibaba reasoning model with fast inference' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: 'MoE model with 32k context' },
  ],
  openrouter: [
    { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', description: 'Hybrid reasoning via OpenRouter' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Benchmark reasoning via OpenRouter' },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', description: 'Fast and cheap via OpenRouter' },
    { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'OpenAI flagship via OpenRouter' },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'OpenAI fast model via OpenRouter' },
    { id: 'openai/o3-mini', name: 'o3-mini', description: 'OpenAI fast reasoning via OpenRouter' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', description: 'Full open reasoning flagship' },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'DeepMind 2.5 Flash via OpenRouter' },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', description: 'DeepMind fast multimodal via OpenRouter' },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', description: 'Meta open weights via OpenRouter' },
  ],
  ollama: [
    { id: 'deepseek-r1:latest', name: 'DeepSeek R1 (Local)', description: 'Local open-weights reasoning model' },
    { id: 'llama3.3:latest', name: 'Llama 3.3 (Local)', description: 'Local Meta 70B/Instruct model' },
    { id: 'llama3.2:latest', name: 'Llama 3.2 (Local)', description: 'Local lightweight model' },
    { id: 'qwen2.5:latest', name: 'Qwen 2.5 (Local)', description: 'Local high-performance allround model' },
    { id: 'mistral:latest', name: 'Mistral (Local)', description: 'Local general-purpose model' },
  ],
};

function sortModels(models: ModelOption[]): ModelOption[] {
  const priorityTerms = ['3.7', '2.5', '4.5', '4o', 'o3', 'o1', '3.5', 'r1', '3.3', '3.2', '2.0'];
  return [...models].sort((a, b) => {
    const aId = a.id.toLowerCase();
    const bId = b.id.toLowerCase();
    const aIdx = priorityTerms.findIndex(t => aId.includes(t));
    const bIdx = priorityTerms.findIndex(t => bId.includes(t));

    if (aIdx !== -1 && bIdx !== -1) {
      if (aIdx !== bIdx) return aIdx - bIdx;
    } else if (aIdx !== -1) {
      return -1;
    } else if (bIdx !== -1) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export async function fetchModelsForProvider(
  provider: AiProvider,
  apiKeyOverride?: string
): Promise<ModelOption[]> {
  const apiKey = apiKeyOverride?.trim() || getActiveApiKey(provider);

  try {
    if (provider === 'gemini') {
      if (!apiKey) return FALLBACK_MODELS.gemini;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return FALLBACK_MODELS.gemini;
      const data = await res.json() as any;
      if (Array.isArray(data?.models)) {
        const filtered = data.models
          .filter((m: any) =>
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent') &&
            m.name.includes('gemini') &&
            !m.name.includes('vision') &&
            !m.name.includes('embedding')
          )
          .map((m: any) => {
            const id = m.name.replace(/^models\//, '');
            return {
              id,
              name: m.displayName || id,
              description: m.description ? m.description.slice(0, 100) : undefined,
              contextWindow: m.inputTokenLimit,
            };
          });
        if (filtered.length > 0) return sortModels(filtered);
      }
      return FALLBACK_MODELS.gemini;
    }

    if (provider === 'openai') {
      if (!apiKey) return FALLBACK_MODELS.openai;
      const res = await fetch(`https://api.openai.com/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return FALLBACK_MODELS.openai;
      const data = await res.json() as any;
      if (Array.isArray(data?.data)) {
        const relevant = data.data
          .filter((m: any) => {
            const id = m.id.toLowerCase();
            const isChat = id.startsWith('gpt-4') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('chatgpt-') || id.startsWith('gpt-3.5');
            const isExcluded = id.includes('realtime') || id.includes('audio') || id.includes('tts') || id.includes('dall-e') || id.includes('embedding') || id.includes('moderation') || id.includes('transcription');
            return isChat && !isExcluded;
          })
          .map((m: any) => ({
            id: m.id,
            name: m.id,
          }));
        if (relevant.length > 0) return sortModels(relevant);
      }
      return FALLBACK_MODELS.openai;
    }

    if (provider === 'anthropic') {
      if (!apiKey) return FALLBACK_MODELS.anthropic;
      const res = await fetch(`https://api.anthropic.com/v1/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return FALLBACK_MODELS.anthropic;
      const data = await res.json() as any;
      if (Array.isArray(data?.data)) {
        const models = data.data.map((m: any) => ({
          id: m.id,
          name: m.display_name || m.id,
        }));
        if (models.length > 0) return sortModels(models);
      }
      return FALLBACK_MODELS.anthropic;
    }

    if (provider === 'groq') {
      if (!apiKey) return FALLBACK_MODELS.groq;
      const res = await fetch(`https://api.groq.com/openai/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return FALLBACK_MODELS.groq;
      const data = await res.json() as any;
      if (Array.isArray(data?.data)) {
        const models = data.data
          .filter((m: any) => {
            const id = m.id.toLowerCase();
            return m.active !== false && !id.includes('whisper') && !id.includes('embedding');
          })
          .map((m: any) => ({ id: m.id, name: m.id }));
        if (models.length > 0) return sortModels(models);
      }
      return FALLBACK_MODELS.groq;
    }

    if (provider === 'openrouter') {
      if (!apiKey) return FALLBACK_MODELS.openrouter;
      const res = await fetch(`https://openrouter.ai/api/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return FALLBACK_MODELS.openrouter;
      const data = await res.json() as any;
      if (Array.isArray(data?.data)) {
        const models = data.data
          .filter((m: any) => {
            const id = m.id.toLowerCase();
            return !id.includes('whisper') && !id.includes('embedding') && !id.includes('image');
          })
          .slice(0, 50)
          .map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            description: m.description ? m.description.slice(0, 80) : undefined,
          }));
        if (models.length > 0) return sortModels(models);
      }
      return FALLBACK_MODELS.openrouter;
    }

    if (provider === 'ollama') {
      const res = await fetch(`http://localhost:11434/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return FALLBACK_MODELS.ollama;
      const data = await res.json() as any;
      if (Array.isArray(data?.models)) {
        const models = data.models.map((m: any) => ({
          id: m.name,
          name: m.name,
        }));
        if (models.length > 0) return sortModels(models);
      }
      return FALLBACK_MODELS.ollama;
    }
  } catch {
    // Return curated fallback list if network / endpoint fails
  }

  return FALLBACK_MODELS[provider] || [];
}

// ─── Universal AI Invocation & Budget Enforcement ─────────────────────────────

export interface GenerateJsonOptions {
  prompt: string;
  systemPrompt?: string;
  purpose?: string;
  temperature?: number;
}

export async function generateJson<T>(options: {
  prompt: string;
  systemPrompt?: string;
  purpose?: string;
  temperature?: number;
}): Promise<T> {
  const config = getAiConfig();
  const purpose = options.purpose ?? 'ai_call';

  // 1. Budget enforcement: Check if budget limit is exceeded
  if (config.budgetLimitUsd > 0 && config.totalSpendUsd >= config.budgetLimitUsd) {
    db.prepare(`
      INSERT INTO ai_usage_logs (provider, model, purpose, tokens_input, tokens_output, cost_usd, blocked, created_at)
      VALUES (?, ?, ?, 0, 0, 0.0, 1, unixepoch())
    `).run(config.provider, config.model, purpose);

    throw new AIBudgetExceededError(config.totalSpendUsd, config.budgetLimitUsd);
  }

  const apiKey = getActiveApiKey(config.provider);
  if (!apiKey && config.provider !== 'ollama') {
    throw new Error(`API key for provider "${config.provider}" is not configured. Please add it in Settings.`);
  }

  let rawText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  if (config.provider === 'gemini') {
    const res = await executeGemini(config.model, apiKey!, options.prompt, options.systemPrompt, options.temperature);
    rawText = res.text;
    inputTokens = res.inputTokens;
    outputTokens = res.outputTokens;
  } else if (config.provider === 'anthropic') {
    const res = await executeAnthropic(config.model, apiKey!, options.prompt, options.systemPrompt, options.temperature);
    rawText = res.text;
    inputTokens = res.inputTokens;
    outputTokens = res.outputTokens;
  } else {
    // OpenAI, Groq, OpenRouter, Ollama (OpenAI-compatible)
    const baseUrl = getOpenAiCompatibleBaseUrl(config.provider);
    const res = await executeOpenAiCompatible(baseUrl, config.model, apiKey || '', options.prompt, options.systemPrompt, options.temperature);
    rawText = res.text;
    inputTokens = res.inputTokens;
    outputTokens = res.outputTokens;
  }

  // Fallback token estimation if provider did not return usage numbers
  if (inputTokens === 0) inputTokens = Math.ceil((options.prompt.length + (options.systemPrompt?.length ?? 0)) / 4);
  if (outputTokens === 0) outputTokens = Math.ceil(rawText.length / 4);

  const costUsd = estimateCostUsd(config.model, inputTokens, outputTokens);

  // Parse JSON
  let parsed: T;
  try {
    const cleaned = extractJsonSubstring(rawText);
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`Failed to parse AI JSON response: ${err?.message}\nRaw: ${rawText.slice(0, 200)}`);
  }

  // 2. Track usage and update spend atomically
  const newTotalSpend = config.totalSpendUsd + costUsd;
  const isNowBlocked = config.budgetLimitUsd > 0 && newTotalSpend >= config.budgetLimitUsd ? 1 : 0;

  db.prepare(`
    UPDATE ai_config
    SET total_spend_usd = total_spend_usd + @cost,
        total_tokens_input = total_tokens_input + @in_tokens,
        total_tokens_output = total_tokens_output + @out_tokens,
        total_requests = total_requests + 1,
        budget_blocked = @blocked,
        updated_at = unixepoch()
    WHERE id = 1
  `).run({
    cost: costUsd,
    in_tokens: inputTokens,
    out_tokens: outputTokens,
    blocked: isNowBlocked,
  });

  db.prepare(`
    INSERT INTO ai_usage_logs (provider, model, purpose, tokens_input, tokens_output, cost_usd, blocked, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, unixepoch())
  `).run(config.provider, config.model, purpose, inputTokens, outputTokens, costUsd);

  return parsed;
}

// ─── Provider Execution Implementations ────────────────────────────────────────

function extractJsonSubstring(text: string): string {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > firstBrace) return cleaned.slice(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1) {
    const lastBracket = cleaned.lastIndexOf(']');
    if (lastBracket > firstBracket) return cleaned.slice(firstBracket, lastBracket + 1);
  }
  return cleaned;
}

async function executeGemini(
  model: string,
  apiKey: string,
  prompt: string,
  systemPrompt?: string,
  temperature = 0.2,
  timeoutMs = 30000
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature,
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text();
    let msg = errText;
    try {
      const parsedErr = JSON.parse(errText);
      if (parsedErr?.error?.message) msg = parsedErr.error.message;
    } catch {}
    throw new Error(`Gemini API error (${res.status}): ${msg}`);
  }

  const data = await res.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const usage = data?.usageMetadata ?? {};
  return {
    text,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
  };
}

function getOpenAiCompatibleBaseUrl(provider: AiProvider): string {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'ollama': return 'http://localhost:11434/v1';
    default: return 'https://api.openai.com/v1';
  }
}

async function executeOpenAiCompatible(
  baseUrl: string,
  model: string,
  apiKey: string,
  prompt: string,
  systemPrompt?: string,
  temperature = 0.2,
  timeoutMs = 30000
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const messages: any[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: `${systemPrompt}\nYou must respond with valid JSON only.` });
  } else {
    messages.push({ role: 'system', content: 'You are a financial AI assistant. You must respond with valid JSON only.' });
  }
  messages.push({ role: 'user', content: prompt });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text();
    let msg = errText;
    try {
      const parsedErr = JSON.parse(errText);
      if (parsedErr?.error?.message) msg = parsedErr.error.message;
    } catch {}
    throw new Error(`AI API error (${res.status}): ${msg}`);
  }

  const data = await res.json() as any;
  const text = data?.choices?.[0]?.message?.content ?? '{}';
  const usage = data?.usage ?? {};
  return {
    text,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
  };
}

async function executeAnthropic(
  model: string,
  apiKey: string,
  prompt: string,
  systemPrompt?: string,
  temperature = 0.2,
  timeoutMs = 30000
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const sys = (systemPrompt ? `${systemPrompt}\n` : '') + 'Respond ONLY with valid JSON. Do not include markdown codeblocks or conversational text.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: sys,
      messages: [{ role: 'user', content: `${prompt}\n\nRespond with valid JSON only.` }],
      max_tokens: 4096,
      temperature,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text();
    let msg = errText;
    try {
      const parsedErr = JSON.parse(errText);
      if (parsedErr?.error?.message) msg = parsedErr.error.message;
    } catch {}
    throw new Error(`Anthropic API error (${res.status}): ${msg}`);
  }

  const data = await res.json() as any;
  const text = data?.content?.[0]?.text ?? '{}';
  const usage = data?.usage ?? {};
  return {
    text,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}

// ─── Test Connection ──────────────────────────────────────────────────────────

export async function testAiConnection(
  provider?: AiProvider,
  model?: string,
  apiKey?: string
): Promise<{ ok: boolean; latencyMs: number; error?: string; sampleResponse?: any }> {
  const activeProvider = provider || getAiConfig().provider;
  const activeModel = model || getAiConfig().model;
  const key = apiKey?.trim() || getActiveApiKey(activeProvider);

  if (!key && activeProvider !== 'ollama') {
    return {
      ok: false,
      latencyMs: 0,
      error: `No API key provided for ${activeProvider}.`,
    };
  }

  const startTime = Date.now();
  try {
    let resultText = '';
    const timeoutMs = 8000;
    if (activeProvider === 'gemini') {
      const res = await executeGemini(
        activeModel,
        key!,
        'Return JSON: {"status": "ok", "message": "Connection test successful."}',
        undefined,
        0.2,
        timeoutMs
      );
      resultText = res.text;
    } else if (activeProvider === 'anthropic') {
      const res = await executeAnthropic(
        activeModel,
        key!,
        'Return JSON: {"status": "ok", "message": "Connection test successful."}',
        undefined,
        0.2,
        timeoutMs
      );
      resultText = res.text;
    } else {
      const baseUrl = getOpenAiCompatibleBaseUrl(activeProvider);
      const res = await executeOpenAiCompatible(
        baseUrl,
        activeModel,
        key || '',
        'Return JSON: {"status": "ok", "message": "Connection test successful."}',
        undefined,
        0.2,
        timeoutMs
      );
      resultText = res.text;
    }

    const latencyMs = Date.now() - startTime;
    const parsed = JSON.parse(extractJsonSubstring(resultText));
    return {
      ok: true,
      latencyMs,
      sampleResponse: parsed,
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - startTime,
      error: err?.message || 'Connection test failed',
    };
  }
}

export function getAiUsageHistory(limit = 50): any[] {
  return db.prepare(`
    SELECT *
    FROM ai_usage_logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as any[];
}
