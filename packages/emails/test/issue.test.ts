import { describe, expect, it } from 'vitest';
import { fromLiquidIssue, hasBlockingIssue } from '../src/issue';
import { toCatalogPath, toLiquidRoots, toMergePath, toPreparedSchema } from '../src/paths';

describe('issue and path helpers', () => {
  it('drops the liquid span and keeps the document pointer', () => {
    const issue = fromLiquidIssue(
      {
        code: 'liquid_unknown_field',
        severity: 'error',
        span: { start: 3, end: 9, line: 1, col: 4 },
      },
      '/blocks/0/props/content/0/children/0/expr',
      'blocks.0.props.content.0.children.0.expr',
    );
    expect(issue).toEqual({
      code: 'liquid_unknown_field',
      severity: 'error',
      pointer: '/blocks/0/props/content/0/children/0/expr',
      path: 'blocks.0.props.content.0.children.0.expr',
      params: undefined,
    });
    expect('span' in issue).toBe(false);
  });

  it('treats only errors as blocking', () => {
    expect(hasBlockingIssue([{ code: 'a', severity: 'warning', pointer: '' }])).toBe(false);
    expect(hasBlockingIssue([{ code: 'a', severity: 'error', pointer: '' }])).toBe(true);
  });

  it('converts between template paths and catalog paths', () => {
    expect(toCatalogPath('contact.attr.city')).toBe('attr.city');
    expect(toCatalogPath('contact.first_name')).toBe('first_name');
    expect(toCatalogPath('workspace.sender_address')).toBe('workspace.sender_address');
    expect(toMergePath('attr.city')).toBe('contact.attr.city');
  });

  it('narrows the rich catalog to the liquid roots without casting', () => {
    expect(
      toLiquidRoots({
        version: 'v1',
        fields: [
          {
            path: 'first_name',
            type: 'string',
            label: { en: 'First name' },
            group: 'name',
            deleted: false,
          },
          {
            path: 'attr.city',
            type: 'string',
            label: { en: 'City' },
            group: 'custom',
            deleted: false,
          },
        ],
      }),
    ).toEqual({ contactFirstClass: ['first_name'], contactAttrKeys: ['city'] });
  });

  it('narrows the render schema to what prepareRenderData wants', () => {
    expect(
      toPreparedSchema({
        version: 1,
        fields: [{ path: 'contact.first_name', type: 'string', required: false }],
        systemTags: ['unsubscribe_url'],
        presence: ['contact.attr.city'],
        loops: [],
      }),
    ).toEqual({ fields: ['contact.first_name'], presence: ['contact.attr.city'] });
  });
});
