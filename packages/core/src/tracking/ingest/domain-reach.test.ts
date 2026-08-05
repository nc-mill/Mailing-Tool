import { describe, expect, it } from 'vitest';
import { classifyTrackingDomain, isTrackingDomainUnreachable } from './domain-reach';

describe('classifyTrackingDomain', () => {
  it('localhost je smyčka, tedy zvenčí nedosažitelný', () => {
    expect(classifyTrackingDomain('http://localhost:3200')).toEqual({
      kind: 'loopback',
      host: 'localhost',
    });
  });

  it('127.0.0.1 je smyčka stejně jako localhost', () => {
    expect(classifyTrackingDomain('http://127.0.0.1:3000').kind).toBe('loopback');
  });

  it('adresa z privátního rozsahu je jen z vnitřní sítě', () => {
    for (const host of ['10.0.0.5', '192.168.1.10', '172.20.0.3', '169.254.1.1']) {
      expect(classifyTrackingDomain(`http://${host}`).kind).toBe('private');
    }
  });

  it('veřejná IP privátní není', () => {
    expect(classifyTrackingDomain('http://172.32.0.1').kind).toBe('public');
    expect(classifyTrackingDomain('http://8.8.8.8').kind).toBe('public');
  });

  it('jméno bez tečky nebo s vývojářskou příponou je vnitřní', () => {
    for (const host of ['mlain', 'app.local', 'shop.test', 'x.internal']) {
      expect(classifyTrackingDomain(`https://${host}`).kind).toBe('private');
    }
  });

  it('skutečná doména je veřejná', () => {
    expect(classifyTrackingDomain('https://t.mlain.cz')).toEqual({
      kind: 'public',
      host: 't.mlain.cz',
    });
  });

  it('holé jméno bez schématu se posoudí taky', () => {
    expect(classifyTrackingDomain('t.mlain.cz').kind).toBe('public');
    expect(classifyTrackingDomain('localhost').kind).toBe('loopback');
  });

  it('prázdná hodnota je neplatná, ne veřejná', () => {
    expect(classifyTrackingDomain('').kind).toBe('invalid');
    expect(classifyTrackingDomain('  ').kind).toBe('invalid');
  });

  it('varování se ukazuje všude kromě veřejné domény', () => {
    expect(isTrackingDomainUnreachable('http://localhost:3200')).toBe(true);
    expect(isTrackingDomainUnreachable('https://t.mlain.cz')).toBe(false);
  });
});
