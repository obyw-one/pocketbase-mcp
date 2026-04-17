import { describe, it, expect } from 'vitest';
import { flattenErrors, pocketbaseErrorMessage } from '../index.js';

// ── Unit tests for exported helpers ────────────────────────

describe('flattenErrors', () => {
  it('extracts message from simple error object', () => {
    expect(flattenErrors({ message: 'bad request' })).toEqual(['bad request']);
  });

  it('handles nested data with code/message', () => {
    const err = {
      message: 'Validation failed',
      data: {
        email: { code: 'validation_required', message: 'Email is required' },
        name: { code: 'validation_min', message: 'Name too short' },
      },
    };
    const msgs = flattenErrors(err);
    expect(msgs).toContain('Validation failed');
    expect(msgs).toContain('Email is required');
    expect(msgs).toContain('Name too short');
  });

  it('returns string directly', () => {
    expect(flattenErrors('raw error')).toEqual(['raw error']);
  });

  it('flattens arrays', () => {
    expect(flattenErrors(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('returns empty for null/undefined', () => {
    expect(flattenErrors(null)).toEqual([]);
    expect(flattenErrors(undefined)).toEqual([]);
  });
});

describe('pocketbaseErrorMessage', () => {
  it('joins multiple messages', () => {
    const msg = pocketbaseErrorMessage({
      message: 'top',
      data: { f: { message: 'nested' } },
    });
    expect(msg).toContain('top');
    expect(msg).toContain('nested');
  });

  it('returns fallback for empty errors', () => {
    expect(pocketbaseErrorMessage({})).toBe('No errors found');
  });
});

// ── Integration tests (require live PB) ────────────────────
// These run ONLY when POCKETBASE_URL + admin creds are set.
// Skip in CI or when PB is down.

const LIVE = !!process.env.POCKETBASE_URL && !!process.env.POCKETBASE_ADMIN_EMAIL;

describe.skipIf(!LIVE)('PocketBase MCP — live integration', () => {
  // Dynamic import to avoid loading PB SDK in unit-only runs
  let PocketBase: any;
  let pb: any;

  it('connects + authenticates as superuser', async () => {
    const PB = (await import('pocketbase')).default;
    pb = new PB(process.env.POCKETBASE_URL);
    const auth = await pb.collection('_superusers').authWithPassword(
      process.env.POCKETBASE_ADMIN_EMAIL!,
      process.env.POCKETBASE_ADMIN_PASSWORD!
    );
    expect(auth.token).toBeTruthy();
    expect(auth.record.email).toBe(process.env.POCKETBASE_ADMIN_EMAIL);
  });

  it('health check returns healthy', async () => {
    const health = await pb.health.check();
    expect(health.code).toBe(200);
    expect(health.message).toContain('healthy');
  });

  it('get_settings returns smtp config', async () => {
    const settings = await pb.settings.getAll();
    expect(settings.smtp).toBeDefined();
    expect(settings.smtp.host).toBe('127.0.0.1');
    expect(settings.smtp.port).toBe(2525);
  });

  it('list_collections returns non-empty', async () => {
    const collections = await pb.collections.getFullList();
    expect(collections.length).toBeGreaterThan(0);
    const names = collections.map((c: any) => c.name);
    expect(names).toContain('waitlist');
    expect(names).toContain('waitlist_v2');
  });

  it('list_records on waitlist_v2 returns records', async () => {
    const records = await pb.collection('waitlist_v2').getList(1, 5);
    expect(records.items).toBeDefined();
    expect(records.totalItems).toBeGreaterThanOrEqual(0);
  });

  it('update_settings can change appName', async () => {
    // Read current
    const before = await pb.settings.getAll();
    const originalName = before.meta.appName;

    // Update
    await pb.settings.update({ meta: { appName: 'TestMCP' } });
    const after = await pb.settings.getAll();
    expect(after.meta.appName).toBe('TestMCP');

    // Restore
    await pb.settings.update({ meta: { appName: originalName } });
    const restored = await pb.settings.getAll();
    expect(restored.meta.appName).toBe(originalName);
  });
});
