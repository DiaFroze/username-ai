import { describe, it, expect } from 'vitest';
import { StatusTransitionEngine } from '../../src/modules/watchlist/status-transition.js';
import { CheckStatus } from '@username/shared';

describe('StatusTransitionEngine', () => {
  it('suppresses alerts when status remains identical (no notification storm)', () => {
    const takenToTaken = StatusTransitionEngine.evaluate(CheckStatus.TAKEN, CheckStatus.TAKEN, 0.95);
    expect(takenToTaken.shouldNotify).toBe(false);

    const availToAvail = StatusTransitionEngine.evaluate(CheckStatus.AVAILABLE, CheckStatus.AVAILABLE, 1.0);
    expect(availToAvail.shouldNotify).toBe(false);
  });

  it('suppresses transitions between ambiguous or transient errors', () => {
    const errToErr = StatusTransitionEngine.evaluate(CheckStatus.ERROR, CheckStatus.ERROR, 0.0);
    expect(errToErr.shouldNotify).toBe(false);

    const unknownToRateLimited = StatusTransitionEngine.evaluate(CheckStatus.UNKNOWN, CheckStatus.RATE_LIMITED, 0.0);
    expect(unknownToRateLimited.shouldNotify).toBe(false);

    const rateLimitedToUnknown = StatusTransitionEngine.evaluate(CheckStatus.RATE_LIMITED, CheckStatus.UNKNOWN, 0.0);
    expect(rateLimitedToUnknown.shouldNotify).toBe(false);
  });

  it('triggers notification with double confirmation on TAKEN -> AVAILABLE', () => {
    const transition = StatusTransitionEngine.evaluate(CheckStatus.TAKEN, CheckStatus.AVAILABLE, 0.9);

    expect(transition.shouldNotify).toBe(true);
    expect(transition.eventType).toBe('STATUS_CHANGED_AVAILABLE');
    expect(transition.requiresDoubleConfirmation).toBe(true);
  });

  it('requires high confidence (>= 0.85) to notify on UNKNOWN -> AVAILABLE', () => {
    const lowConfidence = StatusTransitionEngine.evaluate(CheckStatus.UNKNOWN, CheckStatus.AVAILABLE, 0.6);
    expect(lowConfidence.shouldNotify).toBe(false);

    const highConfidence = StatusTransitionEngine.evaluate(CheckStatus.UNKNOWN, CheckStatus.AVAILABLE, 0.9);
    expect(highConfidence.shouldNotify).toBe(true);
    expect(highConfidence.eventType).toBe('STATUS_CHANGED_AVAILABLE');
    expect(highConfidence.requiresDoubleConfirmation).toBe(true);
  });

  it('triggers informational alert without double confirmation on AVAILABLE -> TAKEN', () => {
    const transition = StatusTransitionEngine.evaluate(CheckStatus.AVAILABLE, CheckStatus.TAKEN, 0.95);

    expect(transition.shouldNotify).toBe(true);
    expect(transition.eventType).toBe('STATUS_CHANGED_TAKEN');
    expect(transition.requiresDoubleConfirmation).toBe(false);
  });
});
