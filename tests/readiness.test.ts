import test from 'node:test';
import assert from 'node:assert/strict';
import { isWithinRegularSession, summarizeReadinessGates, type ReadinessGate } from '../server/readiness.js';

test('readiness summary fails when any gate is false', () => {
  const gates: ReadinessGate[] = [
    { id: 'paper_track_record', label: 'Paper Track Record', passed: true, value: '30d', detail: 'ok' },
    { id: 'audit_coverage', label: 'Audit Coverage', passed: false, value: '90%', detail: 'missing links' },
  ];

  assert.equal(summarizeReadinessGates(gates), false);
});

test('regular session helper rejects weekend timestamps', () => {
  const saturday = Math.floor(new Date('2026-03-14T15:00:00Z').getTime() / 1000);
  assert.equal(isWithinRegularSession(saturday), false);
});
