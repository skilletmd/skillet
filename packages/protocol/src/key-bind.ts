/** Domain-separated PoP message prefix for author browser key bind. */
export const KEY_BIND_POP_PREFIX = 'skillet-key-bind:v1:' as const;

export function keyBindPopMessage(nonce: string, keyId: string): string {
  return `${KEY_BIND_POP_PREFIX}${nonce}:${keyId}`;
}

export function keyBindPopMessageBytes(nonce: string, keyId: string): Buffer {
  return Buffer.from(keyBindPopMessage(nonce, keyId), 'utf8');
}
