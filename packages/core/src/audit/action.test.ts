import { describe, it, expect } from 'vitest';
import { defineAuditActions } from './action';

describe('defineAuditActions', () => {
  it('vrátí záznam se stejnými klíči jako vstup', () => {
    const actions = defineAuditActions(['user.login', 'user.logout']);
    expect(Object.keys(actions).sort()).toEqual(['user.login', 'user.logout']);
    expect(String(actions['user.login'])).toBe('user.login');
  });

  it('výsledek je zmrazený, aby ho nikdo za běhu nedoplnil', () => {
    const actions = defineAuditActions(['user.login']);
    expect(Object.isFrozen(actions)).toBe(true);
  });

  it('odmítne název bez tečky', () => {
    expect(() => defineAuditActions(['login' as never])).toThrow(/entita\.sloveso/i);
  });

  it('odmítne entitu v množném čísle s velkým písmenem', () => {
    expect(() => defineAuditActions(['User.login' as never])).toThrow(/mal[yý]mi/i);
  });

  it('odmítne sloveso, které nekončí v minulém čase', () => {
    expect(() => defineAuditActions(['user.login_now' as never])).not.toThrow();
    expect(() => defineAuditActions(['user.LOGIN' as never])).toThrow();
  });

  it('odmítne duplicitu uvnitř jedné domény', () => {
    expect(() => defineAuditActions(['user.login', 'user.login'])).toThrow(/duplicit/i);
  });
});
