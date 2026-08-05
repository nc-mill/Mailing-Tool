import { describe, expect, it } from 'vitest';
import { SegmentAstV1 } from './ast';
import {
  CAMPAIGN_SEGMENT_KINDS,
  campaignSegmentDefinition,
  isCampaignSegmentKind,
} from './campaign-presets';
import { assertWithinLimits } from './limits';
import { compileSegmentSql } from './compile/index';

const CAMPAIGN_ID = '019fcd5c-03ba-7db3-b5b4-6c992f6fa887';

describe('campaignSegmentDefinition', () => {
  it('vyrábí platný AST v mezích pro obě předlohy', () => {
    for (const kind of CAMPAIGN_SEGMENT_KINDS) {
      const ast = SegmentAstV1.parse(campaignSegmentDefinition(kind, CAMPAIGN_ID));
      expect(() => assertWithinLimits(ast), kind).not.toThrow();
    }
  });

  it('každá podmínka je omezená na TUHLE kampaň', () => {
    for (const kind of CAMPAIGN_SEGMENT_KINDS) {
      const ast = campaignSegmentDefinition(kind, CAMPAIGN_ID);
      for (const child of ast.root.children) {
        expect(child.type, kind).toBe('condition');
        if (child.type !== 'condition' || child.field.kind !== 'engagement') continue;
        // Bez tohohle by se z „klikli v téhle kampani" stalo „klikli kdykoliv".
        expect(child.field.scope, kind).toEqual({ campaign_id: CAMPAIGN_ID });
      }
    }
  });

  it('„klikli" je jediná podmínka: kdo klikl, ten kampaň dostal', () => {
    const ast = campaignSegmentDefinition('clicked', CAMPAIGN_ID);
    expect(ast.root.children).toHaveLength(1);
    expect(ast.root.children[0]).toMatchObject({
      field: { kind: 'engagement', metric: 'clicked' },
      operator: 'did',
    });
  });

  /**
   * Nejdůležitější tvrzení celého souboru. Bez podmínky na doručení by segment
   * „neotevřeli" obsahoval i lidi, kterým kampaň nikdy neodešla, tedy skoro
   * celou databázi, a znovuposlání by šlo úplně cizím lidem.
   */
  it('„neotevřeli" drží množinu na příjemcích kampaně', () => {
    const ast = campaignSegmentDefinition('not_opened', CAMPAIGN_ID);
    expect(ast.root.children).toContainEqual({
      type: 'condition',
      field: { kind: 'engagement', metric: 'sent', scope: { campaign_id: CAMPAIGN_ID } },
      operator: 'did',
    });
  });

  /**
   * Shoda s reportem. Produkt počítá proklik jako důkaz otevření
   * (`impliedOpenFromClick`), takže člověk, který klikl, je v reportu mezi
   * těmi, kdo otevřeli. Segment čte syrové `message_events`, kde dopočítané
   * otevření není, a bez téhle podmínky by tvrdil opak.
   */
  it('„neotevřeli" vylučuje ty, kdo v kampani klikli', () => {
    const ast = campaignSegmentDefinition('not_opened', CAMPAIGN_ID);
    expect(ast.root.children).toContainEqual({
      type: 'condition',
      field: { kind: 'engagement', metric: 'clicked', scope: { campaign_id: CAMPAIGN_ID } },
      operator: 'did_not',
    });
  });

  it('rozezná jen známé předlohy', () => {
    expect(isCampaignSegmentKind('clicked')).toBe(true);
    expect(isCampaignSegmentKind('not_opened')).toBe(true);
    expect(isCampaignSegmentKind('not_clicked')).toBe(false);
    expect(isCampaignSegmentKind(undefined)).toBe(false);
  });

  /**
   * Definice musí projít až do SQL, ne jen validací tvaru. Kdyby kompilátor
   * `scope.campaign_id` ignoroval, vrátil by segment lidi ze VŠECH kampaní
   * a nikde by to nespadlo.
   */
  it('kompiluje se do SQL, které se ptá na tuhle kampaň', () => {
    for (const kind of CAMPAIGN_SEGMENT_KINDS) {
      const result = compileSegmentSql(campaignSegmentDefinition(kind, CAMPAIGN_ID), {
        alias: 'c',
        paramOffset: 0,
        workspaceId: '019fc763-7184-72dd-a48d-3cf3ec306179',
        asOf: new Date('2026-08-05T00:00:00.000Z'),
        timezone: 'Europe/Prague',
        fieldClasses: {},
        segmentKinds: {},
      });
      expect(result.sql, kind).toContain('campaign_id =');
      expect(result.params, kind).toContain(CAMPAIGN_ID);
    }
  });
});
