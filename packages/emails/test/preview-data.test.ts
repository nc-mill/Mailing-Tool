import { describe, expect, it } from 'vitest';
import { sampleRenderData } from '../src/preview-data';

describe('sampleRenderData', () => {
  it('provides both language variants', () => {
    expect(sampleRenderData('cs').contact.greeting).toContain('Dobrý den');
    expect(sampleRenderData('en').contact.greeting).toContain('Hello');
  });

  it('includes hostile values that break naive templates', () => {
    const data = sampleRenderData('cs');
    expect(data.contact.first_name).toMatch(/[ěščřžýáíé]/);
    expect(data.contact.last_name).toBe('');
    expect(JSON.stringify(data)).toContain('<');
    expect(JSON.stringify(data)).toContain('&');
  });

  it('always fills the internal context roots', () => {
    const data = sampleRenderData('cs');
    expect(data._context.timezone).toBe('Europe/Prague');
    expect(data._context.locale).toBe('cs');
  });

  it('starts with an empty presence map so the caller must fill it', () => {
    expect(sampleRenderData('cs')._present).toEqual({});
  });

  it('points every system url at the disabled anchor', () => {
    const data = sampleRenderData('cs');
    for (const key of ['unsubscribe_url', 'preferences_url', 'webview_url'] as const) {
      expect(data[key]).toBe('#preview-disabled');
    }
  });
});
