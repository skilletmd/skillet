import { describe, it, expect, vi, afterEach } from 'vitest';
import { deviceNoun, findOnDeviceLabel, uploadEmptyHint } from './platform-copy';

describe('platform-copy', () => {
  const prevUa = navigator.userAgent;

  afterEach(() => {
    vi.stubGlobal('navigator', { userAgent: prevUa });
  });

  it('uses PC copy on Windows user agent', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    expect(deviceNoun()).toBe('this PC');
    expect(findOnDeviceLabel(false)).toBe('Find on this PC');
  });

  it('uses Mac copy on macOS user agent', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    });
    expect(deviceNoun()).toBe('this Mac');
    expect(findOnDeviceLabel(false)).toBe('Find on this Mac');
  });

  it('uploadEmptyHint uses platform noun', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    expect(uploadEmptyHint()).toContain('this PC');
    expect(uploadEmptyHint()).not.toContain('this Mac');
  });
});
