import sharp from 'sharp'

export const AVATAR_SIZE = 256
/** Hard cap on the processed webp output. A 256px webp is normally ~10–30KB;
 *  this is a safety ceiling, not the expected size. */
export const MAX_AVATAR_OUTPUT_BYTES = 64 * 1024

/** The single source of truth for the accepted raw-upload cap. The output is
 *  always a tiny 256px webp, so this only bounds the raw input a hostile caller
 *  can make the decoder chew on. 2MB matches X's avatar cap; big-*dimension*
 *  photos still pass (the 64MP decode ceiling below resizes them) — this only
 *  refuses genuinely heavy byte payloads. Enforced by the route before it
 *  buffers the body. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
/** Human-facing megabyte figure derived from {@link MAX_UPLOAD_BYTES}, so copy
 *  can never drift from the enforced limit. */
export const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

export class AvatarProcessingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AvatarProcessingError'
  }
}

export interface ProcessedAvatar {
  bytes: Uint8Array
  contentType: 'image/webp'
}

/**
 * Decode an arbitrary uploaded image and re-encode it to a canonical 256px
 * square webp with all metadata stripped. This is the trusted, server-side
 * processing step: the client's claimed type, dimensions, and size are
 * ignored — whatever bytes come in, a small clean webp comes out, or we throw.
 *
 * Oversized images are the norm, not the exception: a 24MP phone photo is
 * ~50 megapixels after nothing, so we *resize* down rather than reject. The
 * decode ceiling below is only a DoS guard against a hostile pixel bomb — it
 * sits far above any real camera so genuine uploads always get resized, never
 * bounced.
 *
 * Throws {@link AvatarProcessingError} when the input isn't a decodable image,
 * exceeds the decode ceiling, or can't be brought under
 * {@link MAX_AVATAR_OUTPUT_BYTES}.
 */
// Decode-bomb ceiling, in pixels. 64 megapixels (8192×8192) clears every
// mainstream phone and camera (48/50/60MP shots) with headroom, while a
// worst-case uncompressed decode stays bounded (~256MB). Everything under this
// is resized down to AVATAR_SIZE; only a genuine pixel bomb is rejected.
const MAX_DECODE_PIXELS = 8192 * 8192

export async function processAvatar(
  input: ArrayBuffer | Uint8Array | Buffer,
): Promise<ProcessedAvatar> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input as ArrayBuffer)

  const encode = (quality: number): Promise<Buffer> =>
    sharp(buf, { limitInputPixels: MAX_DECODE_PIXELS })
      // .rotate() applies EXIF orientation; the subsequent re-encode drops all
      // metadata (orientation, GPS, etc.) so nothing rides along in the output.
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality })
      .toBuffer()

  let out: Buffer
  try {
    out = await encode(82)
  } catch (err) {
    // A too-large image reads as a distinct, actionable message; anything else
    // is an undecodable file. Either way this is a 422 (bad input), never a 500.
    const message = /pixel limit/i.test(String((err as Error)?.message))
      ? 'That image is too large to process. Try one under 64 megapixels.'
      : 'That file is not a readable image.'
    throw new AvatarProcessingError(message)
  }

  // Safety net: step quality down if somehow over the cap (256px rarely is).
  // Guarded so a surprise sharp failure here also surfaces as a clean 422.
  try {
    for (const quality of [60, 45]) {
      if (out.byteLength <= MAX_AVATAR_OUTPUT_BYTES) break
      out = await encode(quality)
    }
  } catch {
    throw new AvatarProcessingError('That file is not a readable image.')
  }
  if (out.byteLength > MAX_AVATAR_OUTPUT_BYTES) {
    throw new AvatarProcessingError(
      'Avatar image could not be compressed under the size limit.',
    )
  }

  return { bytes: new Uint8Array(out), contentType: 'image/webp' }
}
