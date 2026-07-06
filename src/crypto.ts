// Cadence — symmetric AES-256-GCM helpers for token-at-rest encryption.
//
// The encryption key comes from env.SMARTCAR_ENCRYPTION_KEY as a base64-encoded
// 32-byte (256-bit) value. Generate one with:
//
//   openssl rand -base64 32
//
// And set it via:  wrangler secret put SMARTCAR_ENCRYPTION_KEY
//
// Encrypted ciphertext format: "<iv-base64>:<ct-base64>"
//   - iv: 12 random bytes per encryption (GCM nonce)
//   - ct: ciphertext + 16-byte GCM auth tag (concatenated by WebCrypto)
//
// Throws on missing key, wrong key length, or malformed ciphertext.

export async function importEncryptionKey(b64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(b64Key);
  if (raw.length !== 32) {
    throw new Error(
      `SMARTCAR_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length})`,
    );
  }
  return crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptString(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return bytesToBase64(iv) + ':' + bytesToBase64(new Uint8Array(ct));
}

export async function decryptString(key: CryptoKey, ciphertext: string): Promise<string> {
  const sep = ciphertext.indexOf(':');
  if (sep <= 0) throw new Error('malformed ciphertext (no iv separator)');
  const ivB64 = ciphertext.slice(0, sep);
  const ctB64 = ciphertext.slice(sep + 1);
  const iv = base64ToBytes(ivB64);
  const ct = base64ToBytes(ctB64);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

// --- base64 helpers (Workers' atob/btoa don't accept Uint8Array directly) ---

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}