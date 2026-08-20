import { describe, expect, it } from 'vitest'
import { detectInstallPlatform } from '@/lib/install-platform'

describe('detectInstallPlatform', () => {
  it('detects macOS desktop', () => {
    expect(
      detectInstallPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel'),
    ).toBe('mac')
  })

  it('detects Windows desktop', () => {
    expect(
      detectInstallPlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Win32',
      ),
    ).toBe('windows')
  })

  it('detects Linux desktop', () => {
    expect(
      detectInstallPlatform('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'Linux x86_64'),
    ).toBe('linux')
  })

  it('detects iPhone as mobile', () => {
    expect(
      detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone'),
    ).toBe('mobile')
  })

  it('detects Android phone as mobile', () => {
    expect(
      detectInstallPlatform(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile',
        'Linux armv8l',
      ),
    ).toBe('mobile')
  })
})
