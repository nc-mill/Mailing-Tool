import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, blockDefaults } from '../../src/document/defaults';

describe('defaults', () => {
  it('uses the documented theme defaults', () => {
    expect(DEFAULT_THEME.contentWidth).toBe(600);
    expect(DEFAULT_THEME.typography).toEqual({
      baseFontSize: 16,
      baseLineHeight: 1.5,
      headingScale: 1.25,
    });
    expect(DEFAULT_THEME.radius).toBe(6);
    expect(DEFAULT_THEME.darkMode.strategy).toBe('auto');
    expect(DEFAULT_THEME.colors).toEqual({});
  });

  it('uses the common block padding default for content blocks', () => {
    expect(blockDefaults('text').padding).toEqual({ top: 0, right: 24, bottom: 16, left: 24 });
    expect(blockDefaults('section').padding).toEqual({ top: 24, right: 24, bottom: 24, left: 24 });
  });

  it('defaults the footer sender info to a merge tag, never a constant', () => {
    expect(blockDefaults('footer').senderInfo).toEqual([
      { t: 'p', children: [{ t: 'var', expr: 'workspace.sender_address' }] },
    ]);
    expect(blockDefaults('footer').showUnsubscribe).toBe(true);
  });

  it('defaults buttons and images to trackable', () => {
    expect(blockDefaults('button').trackable).toBe(true);
    expect(blockDefaults('image').trackable).toBe(true);
  });
});
