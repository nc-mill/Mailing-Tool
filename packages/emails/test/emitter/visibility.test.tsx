import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { presenceKey, Visible, visibilityTags } from '../../src/emitter/visibility';

describe('visibility', () => {
  it('maps a field path to a presence key with double underscores', () => {
    expect(presenceKey('contact.city')).toBe('contact__city');
    expect(presenceKey('contact.attr.mesto')).toBe('contact__attr__mesto');
  });

  it('emits if and endif over the presence map for present', () => {
    expect(visibilityTags({ field: 'contact.city', op: 'present' })).toEqual([
      '{% if _present.contact__city %}',
      '{% endif %}',
    ]);
  });

  it('emits unless and endunless over the presence map for blank', () => {
    expect(visibilityTags({ field: 'contact.city', op: 'blank' })).toEqual([
      '{% unless _present.contact__city %}',
      '{% endunless %}',
    ]);
  });

  it('uses the field itself for boolean operators, no presence map needed', () => {
    expect(visibilityTags({ field: 'contact.attr.is_vip', op: 'true' })).toEqual([
      '{% if contact.attr.is_vip %}',
      '{% endif %}',
    ]);
    expect(visibilityTags({ field: 'contact.attr.is_vip', op: 'false' })).toEqual([
      '{% unless contact.attr.is_vip %}',
      '{% endunless %}',
    ]);
  });

  it('survives react rendering without a single html entity', async () => {
    const html = await render(
      <Visible when={{ field: 'contact.city', op: 'present' }}>
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </Visible>,
    );
    expect(html).toContain('{% if _present.contact__city %}');
    expect(html).toContain('{% endif %}');
    expect(html).not.toMatch(/&(quot|#39|lt|gt|amp);/);
  });

  it('renders children untouched when there is no condition', async () => {
    const html = await render(
      <Visible when={null}>
        <span>x</span>
      </Visible>,
    );
    expect(html).not.toContain('{%');
    expect(html).toContain('<span>x</span>');
  });
});
