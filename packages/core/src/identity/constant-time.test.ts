import { describe, it, expect, vi } from 'vitest';
import { withConstantTime, AUTH_MIN_RESPONSE_MS } from './constant-time';

describe('withConstantTime', () => {
  it('podlaha je 250 ms', () => {
    expect(AUTH_MIN_RESPONSE_MS).toBe(250);
  });

  it('rychlá operace se natáhne na podlahu', async () => {
    const started = Date.now();
    const result = await withConstantTime(120, async () => 'hotovo');
    const elapsed = Date.now() - started;
    expect(result).toBe('hotovo');
    expect(elapsed).toBeGreaterThanOrEqual(118);
  });

  it('pomalá operace se nezkracuje a zaloguje varování', async () => {
    const warn = vi.fn();
    const started = Date.now();
    await withConstantTime(
      30,
      async () => {
        await new Promise((r) => setTimeout(r, 90));
        return 1;
      },
      warn,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(88);
    expect(warn).toHaveBeenCalledWith('constant_time_floor_exceeded', expect.any(Number));
  });

  it('výjimka se propaguje, ale až po uplynutí podlahy', async () => {
    const started = Date.now();
    await expect(
      withConstantTime(120, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(Date.now() - started).toBeGreaterThanOrEqual(118);
  });

  it('dvě různě dlouhé operace skončí prakticky stejně', async () => {
    const measure = async (workMs: number) => {
      const t = Date.now();
      await withConstantTime(200, async () => {
        await new Promise((r) => setTimeout(r, workMs));
      });
      return Date.now() - t;
    };
    const fast = await measure(5);
    const slow = await measure(80);
    expect(Math.abs(fast - slow) / Math.max(fast, slow)).toBeLessThan(0.2);
  });
});
