import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseAgent } from '../server/agents/base.js';
import { AgentRegistry, registry } from '../server/agents/registry.js';

class TestAgent extends BaseAgent {
  readonly name: string;
  readonly intervalMs = 25;
  readonly sourceKey: string;
  runs = 0;

  constructor(name: string, sourceKey: string) {
    super();
    this.name = name;
    this.sourceKey = sourceKey;
  }

  async run(): Promise<void> {
    this.runs += 1;
    await new Promise(resolve => setTimeout(resolve, 50));
    this.markSuccess(this.runs);
  }
}

test('BaseAgent prevents overlapping runs', async () => {
  const agent = new TestAgent('test_agent_overlap', 'test_overlap');

  await Promise.all([
    agent.trigger('manual'),
    agent.trigger('manual'),
  ]);

  assert.equal(agent.runs, 1);
});

test('AgentRegistry starts and stops registered agents', async () => {
  const registry = new AgentRegistry(false);
  const first = new TestAgent('first', 'first_source');
  const second = new TestAgent('second', 'second_source');
  registry.register(first);
  registry.register(second);

  registry.startAll();
  await new Promise(resolve => setTimeout(resolve, 80));
  registry.stopAll();

  const statuses = registry.getAllStatuses();
  assert.equal(statuses.every(status => status.running === false), true);
  assert.equal(first.runs > 0, true);
  assert.equal(second.runs > 0, true);
});

test('coordinator is the only default agent using the trading source key', () => {
  const statuses = registry.getAllStatuses();
  const tradingAgents = statuses.filter(status => status.sourceKey === 'agent');

  assert.deepEqual(tradingAgents.map(status => status.name), ['coordinator']);
});
