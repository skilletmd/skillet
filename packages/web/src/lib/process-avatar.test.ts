import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  processAvatar,
  AvatarProcessingError,
  AVATAR_SIZE,
  MAX_AVATAR_OUTPUT_BYTES,
} from './process-avatar'

function solidImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .png()
    .toBuffer()
}

describe('processAvatar', () => {
  it('resizes a large image to a 256×256 webp under the cap', async () => {
    const input = await solidImage(1200, 800)
    const { bytes, contentType } = await processAvatar(input)

    expect(contentType).toBe('image/webp')
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_AVATAR_OUTPUT_BYTES)

    const meta = await sharp(Buffer.from(bytes)).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(AVATAR_SIZE)
    expect(meta.height).toBe(AVATAR_SIZE)
  })

  it('center-crops a non-square image to a square', async () => {
    const input = await solidImage(800, 400)
    const { bytes } = await processAvatar(input)
    const meta = await sharp(Buffer.from(bytes)).metadata()
    expect(meta.width).toBe(AVATAR_SIZE)
    expect(meta.height).toBe(AVATAR_SIZE)
  })

  it('resizes a real high-megapixel photo instead of rejecting it', async () => {
    // 6000×4000 = 24MP, above the old 16.7MP decode limit that used to bounce
    // every modern phone photo. It must now resize down to a 256px webp.
    const input = await sharp(await solidImage(6000, 4000)).jpeg({ quality: 92 }).toBuffer()
    const { bytes, contentType } = await processAvatar(input)
    expect(contentType).toBe('image/webp')
    const meta = await sharp(Buffer.from(bytes)).metadata()
    expect(meta.width).toBe(AVATAR_SIZE)
    expect(meta.height).toBe(AVATAR_SIZE)
  })

  it('throws AvatarProcessingError on a non-image buffer', async () => {
    await expect(
      processAvatar(new TextEncoder().encode('definitely not an image')),
    ).rejects.toBeInstanceOf(AvatarProcessingError)
  })

  it('strips EXIF/metadata from the output', async () => {
    const withExif = await sharp(await solidImage(300, 300))
      .withExif({ IFD0: { Copyright: 'should-be-gone' } })
      .jpeg()
      .toBuffer()

    const { bytes } = await processAvatar(withExif)
    const meta = await sharp(Buffer.from(bytes)).metadata()
    expect(meta.exif).toBeUndefined()
  })
})
