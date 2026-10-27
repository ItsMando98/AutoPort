import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuoteEligibility } from '../server/marketdata.js';

test('fresh Alpaca and Polygon quotes are execution eligible', () => {
  assert.equal(evaluateQuoteEligibility({ source: 'alpaca', staleMs: 10_000, lastError: null, mode: 'paper' }).executionEligible, true);
  assert.equal(evaluateQuoteEligibility({ source: 'polygon', staleMs: 10_000, lastError: null, mode: 'paper' }).executionEligible, true);
});

test('stored EOD prices are valuation-only in paper and live modes', () => {
  assert.equal(evaluateQuoteEligibility({ source: 'stored_eod_fallback', staleMs: 0, lastError: null, mode: 'paper' }).executionEligible, false);
  assert.equal(evaluateQuoteEligibility({ source: 'stored_eod_fallback', staleMs: 0, lastError: null, mode: 'live' }).executionEligible, false);
});

test('stale or errored quotes fail closed', () => {
  assert.equal(evaluateQuoteEligibility({ source: 'alpaca', staleMs: 60_001, lastError: null, mode: 'paper' }).executionEligible, false);
  assert.equal(evaluateQuoteEligibility({ source: 'alpaca', staleMs: 0, lastError: 'provider failed', mode: 'paper' }).executionEligible, false);
});
