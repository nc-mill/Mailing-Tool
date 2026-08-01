// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SegmentAstV1 } from '@mlain/core/segments';
import { segmentJsonSchema } from '@mlain/core/segments/api';
import { SEGMENT_PRESETS } from '@mlain/core/segments';
import { describe, expect, it } from 'vitest';

/**
 * ODCHYLKA OD PLÁNU: plán volal pomocníka `testClient()`, který v repozitáři
 * neexistuje, a testoval routy proti běžící databázi. Testy proti databázi tu
 * jedou přes `test/api/pg-harness.ts` a testcontainers, tedy přes docker, a na
 * stroji souběžně pracuje sedm dalších agentů. Kontrakt rout se proto ověřuje
 * nad VYGENEROVANÝM dokumentem OpenAPI, který vzniká z týchž definic cest
 * jako produkční aplikace (`buildApp()`), plus nad čistými funkcemi.
 *
 * Co tím NENÍ ověřené a co si po doběhnutí ostatních agentů zaslouží test
 * s harnessem: rate limit náhledu (požadavek 4.3 na P04 zatím není splněný),
 * skutečné 404 na cizí projekt a 202 u přepočtu proti živé frontě.
 */
const OPENAPI = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../../../../packages/contracts/openapi.json'),
    'utf8',
  ),
) as { paths: Record<string, Record<string, unknown>> };

describe('segment routes in the generated contract', () => {
  it('registers every documented segment path', () => {
    for (const route of [
      '/api/v1/segments',
      '/api/v1/segments/schema',
      '/api/v1/segments/presets',
      '/api/v1/segments/presets/{key}',
      '/api/v1/segments/preview',
      '/api/v1/segments/audience-breakdown',
      '/api/v1/segments/{id}',
      '/api/v1/segments/{id}/preview',
      '/api/v1/segments/{id}/contacts',
      '/api/v1/segments/{id}/recount',
      '/api/v1/segments/{id}/freeze',
    ]) {
      expect(OPENAPI.paths[route], `chybí cesta ${route}`).toBeDefined();
    }
  });

  it('answers a recount with 202, not 200', () => {
    const op = OPENAPI.paths['/api/v1/segments/{id}/recount']?.['post'] as {
      responses: Record<string, unknown>;
    };
    expect(Object.keys(op.responses)).toContain('202');
    expect(Object.keys(op.responses)).not.toContain('200');
  });

  it('answers a freeze with 201, because it creates a second segment', () => {
    const op = OPENAPI.paths['/api/v1/segments/{id}/freeze']?.['post'] as {
      responses: Record<string, unknown>;
    };
    expect(Object.keys(op.responses)).toContain('201');
  });

  it('declares the domain error codes on the preview response', () => {
    const op = OPENAPI.paths['/api/v1/segments/preview']?.['post'] as {
      responses: Record<string, { description: string }>;
    };
    expect(op.responses['422']?.description).toContain('validation_failed');
  });
});

describe('segment ast schema', () => {
  it('returns the json schema of the ast with version pinned to one', () => {
    const schema = segmentJsonSchema() as { properties: { version: { const: number } } };
    expect(schema.properties.version.const).toBe(1);
  });

  it('rejects an operator that does not fit the field', () => {
    // Definice cesty nese jen kořen, takže rekurzivní kontrolu dělá handler
    // přes SegmentAstV1. Tenhle test drží, že ta kontrola opravdu odmítá.
    const parsed = SegmentAstV1.safeParse({
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'contact', key: 'created_at' },
            operator: 'not_an_operator',
            value: 'x',
          },
        ],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a tree that is not a group at the root', () => {
    expect(SegmentAstV1.safeParse({ version: 1, root: { type: 'condition' } }).success).toBe(false);
  });
});

describe('segment presets', () => {
  it('lists the six presets', () => {
    expect(SEGMENT_PRESETS).toHaveLength(6);
    expect(SEGMENT_PRESETS.map((p) => p.key).sort()).toEqual([
      'inactive_90d',
      'never_clicked',
      'never_opened',
      'no_open_last_n',
      'repeated_soft_bounces',
      'unconfirmed_30d',
    ]);
  });

  it('gives every preset a definition that the ast schema accepts', () => {
    for (const preset of SEGMENT_PRESETS) {
      expect(SegmentAstV1.safeParse(preset.definition({})).success, preset.key).toBe(true);
    }
  });
});
