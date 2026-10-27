import { randomUUID } from 'crypto';
import db from '../db.js';
import {
  finishAgentRun,
  getAgentFreshnessStatus,
  startAgentRun,
} from '../autonomy.js';
import { markDataSourceFailure, markDataSourceSuccess } from '../ops.js';

export interface AgentStatus {
  name: string;
  sourceKey: string;
  intervalMs: number;
  running: boolean;
  inFlight: boolean;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastUsableOutputAt: number | null;
  lastError: string | null;
  errorCount: number;
  cadenceStatus: 'on_time' | 'late' | 'missed' | 'idle';
  freshnessStatus: 'fresh' | 'stale' | 'idle';
  blockedDependencies: string[];
}

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly intervalMs: number;
  abstract readonly sourceKey: string;

  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private currentRunId: string | null = null;
  private currentRunStartedAt: number | null = null;
  private currentRunFinalized = false;
  private lastMarkedDetails: Record<string, any> | null = null;
  private lastRecordsWritten = 0;
  protected running = false;
  protected lastRunAt: number | null = null;
  protected lastSuccessAt: number | null = null;
  protected lastUsableOutputAt: number | null = null;
  protected lastError: string | null = null;
  protected errorCount = 0;

  abstract run(): Promise<void>;

  protected get freshnessTtlMs(): number {
    return this.intervalMs * 2;
  }

  protected get dependencySourceKeys(): string[] {
    return [];
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log('Agent started.');
    void this.trigger('startup');
    this.timer = setInterval(() => {
      void this.trigger('interval');
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.log('Agent stopped.');
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus(): AgentStatus {
    return {
      name: this.name,
      sourceKey: this.sourceKey,
      intervalMs: this.intervalMs,
      running: this.running,
      inFlight: this.inFlight,
      lastRunAt: this.lastRunAt,
      lastSuccessAt: this.lastSuccessAt,
      lastUsableOutputAt: this.lastUsableOutputAt,
      lastError: this.lastError,
      errorCount: this.errorCount,
      cadenceStatus: this.getFreshnessRow()?.cadenceStatus ?? 'idle',
      freshnessStatus: this.getFreshnessRow()?.freshnessStatus ?? 'idle',
      blockedDependencies: this.getBlockedDependencies(),
    };
  }

  async trigger(reason = 'manual'): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.lastRunAt = Date.now();
    this.currentRunStartedAt = Date.now();
    this.currentRunFinalized = false;
    this.currentRunId = startAgentRun({
      agentName: this.name,
      sourceKey: this.sourceKey,
      triggerReason: reason,
      cadenceMs: this.intervalMs,
      freshnessTtlMs: this.freshnessTtlMs,
      inputs: {
        blockedDependencies: this.getBlockedDependencies(),
      },
    });

    try {
      this.lastMarkedDetails = null;
      this.lastRecordsWritten = 0;
      await this.run();
      if (this.currentRunId && !this.currentRunFinalized) {
        finishAgentRun(this.currentRunId, 'success', {
          recordsWritten: this.lastRecordsWritten,
          runtimeMs: this.currentRunStartedAt ? Date.now() - this.currentRunStartedAt : undefined,
          usableOutputAt: this.lastUsableOutputAt ?? this.lastSuccessAt ?? Date.now(),
          details: this.lastMarkedDetails,
        });
      }
    } catch (err: any) {
      this.markFailure(err?.message ?? 'Unknown error', { reason });
      this.log(`Run failed: ${err?.message ?? 'Unknown error'}`, 'error');
    } finally {
      this.currentRunId = null;
      this.currentRunStartedAt = null;
      this.currentRunFinalized = false;
      this.inFlight = false;
    }
  }

  getLogs(limit = 100): any[] {
    return db.prepare(`
      SELECT *
      FROM engine_logs
      WHERE asset = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(this.name, Math.min(limit, 500)) as any[];
  }

  protected log(message: string, level: 'info' | 'error' = 'info'): void {
    db.prepare(`
      INSERT INTO engine_logs (id, timestamp, log_type, asset, content, action, status)
      VALUES (@id, @timestamp, @log_type, @asset, @content, @action, @status)
    `).run({
      id: randomUUID(),
      timestamp: Date.now(),
      log_type: level === 'error' ? 'ERROR' : 'MONITOR',
      asset: this.name,
      content: message,
      action: this.sourceKey,
      status: level === 'error' ? 'REJECTED' : 'COMPLETED',
    });
  }

  protected markSuccess(count?: number, details?: Record<string, any>): void {
    this.lastSuccessAt = Date.now();
    this.lastUsableOutputAt = Date.now();
    this.lastError = null;
    this.lastMarkedDetails = details ?? null;
    this.lastRecordsWritten = count ?? 0;
    markDataSourceSuccess(this.sourceKey, count, details);
  }

  protected markFailure(error: string, details?: Record<string, any>): void {
    this.lastError = error;
    this.errorCount += 1;
    this.lastMarkedDetails = details ?? null;
    if (this.currentRunId) {
      finishAgentRun(this.currentRunId, 'failure', {
        recordsWritten: this.lastRecordsWritten,
        runtimeMs: this.currentRunStartedAt ? Date.now() - this.currentRunStartedAt : undefined,
        usableOutputAt: this.lastUsableOutputAt,
        error,
        details,
      });
      this.currentRunFinalized = true;
    }
    markDataSourceFailure(this.sourceKey, error, details);
  }

  private getFreshnessRow() {
    return getAgentFreshnessStatus().find(row => row.agentName === this.name);
  }

  private getBlockedDependencies(): string[] {
    if (this.dependencySourceKeys.length === 0) return [];
    const freshness = getAgentFreshnessStatus();
    return this.dependencySourceKeys.filter(sourceKey => {
      const dependency = freshness.find(row => row.sourceKey === sourceKey);
      return !dependency || dependency.freshnessStatus === 'stale' || dependency.cadenceStatus === 'missed';
    });
  }
}
