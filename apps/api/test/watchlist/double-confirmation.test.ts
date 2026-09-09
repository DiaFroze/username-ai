import { describe, it, expect } from 'vitest';
import { DoubleConfirmationService } from '../../src/modules/watchlist/double-confirmation.js';
import {
  CheckerCoordinator,
  YouTubeChecker,
  DomainChecker,
} from '@username/checker-engine';
import { Platform, CheckStatus } from '@username/shared';

describe('DoubleConfirmationService', () => {
  it('CRITICAL REGRESSION: strictly rejects Telegram confirmed AVAILABLE to prevent false alerts', async () => {
    const coordinator = new CheckerCoordinator();
    const service = new DoubleConfirmationService(coordinator);

    const result = await service.confirmAvailability(Platform.TELEGRAM, 'some_handle');

    expect(result.confirmed).toBe(false);
    expect(result.secondResult.status).toBe(CheckStatus.UNKNOWN);
    expect(result.reason).toContain('MTProto');
  });

  it('confirms availability when 2nd independent check returns AVAILABLE', async () => {
    const mockYtFetch = async () => ({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    }) as any;

    const coordinator = new CheckerCoordinator({
      youtubeChecker: new YouTubeChecker({ fetch: mockYtFetch }),
    });
    const service = new DoubleConfirmationService(coordinator);

    const result = await service.confirmAvailability(Platform.YOUTUBE, 'vacant_channel');

    expect(result.confirmed).toBe(true);
    expect(result.secondResult.status).toBe(CheckStatus.AVAILABLE);
  });

  it('rejects confirmation when 2nd independent check encounters taken or error state', async () => {
    const mockDomFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: ['active'] }),
    }) as any;

    const coordinator = new CheckerCoordinator({
      domainChecker: new DomainChecker({ fetch: mockDomFetch }),
    });
    const service = new DoubleConfirmationService(coordinator);

    const result = await service.confirmAvailability(Platform.DOMAIN, 'registered.com');

    expect(result.confirmed).toBe(false);
    expect(result.secondResult.status).toBe(CheckStatus.TAKEN);
    expect(result.reason).toContain('not AVAILABLE');
  });
});
