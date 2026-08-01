import { describe, expect, it } from 'vitest';
import { ConnectionLimiter } from './connections';

describe('ConnectionLimiter', () => {
  it('pustí nejvýš dvě spojení na jednu relaci', () => {
    const limiter = new ConnectionLimiter({ maxTotal: 100, maxPerSession: 2 });
    expect(limiter.acquire('s1')).not.toBeNull();
    expect(limiter.acquire('s1')).not.toBeNull();
    expect(limiter.acquire('s1')).toBeNull();
    expect(limiter.acquire('s2')).not.toBeNull();
  });

  it('po uvolnění dá slot zpátky', () => {
    const limiter = new ConnectionLimiter({ maxTotal: 100, maxPerSession: 1 });
    const release = limiter.acquire('s1');
    release?.();
    expect(limiter.acquire('s1')).not.toBeNull();
  });

  it('drží strop instance a hlásí obsazenost', () => {
    const limiter = new ConnectionLimiter({ maxTotal: 2, maxPerSession: 5 });
    limiter.acquire('a');
    limiter.acquire('b');
    expect(limiter.acquire('c')).toBeNull();
    expect(limiter.count).toBe(2);
  });

  it('dvojí uvolnění téhož spojení nesníží čítač dvakrát', () => {
    const limiter = new ConnectionLimiter({ maxTotal: 2, maxPerSession: 5 });
    const release = limiter.acquire('a');
    release?.();
    release?.();
    expect(limiter.count).toBe(0);
  });
});
