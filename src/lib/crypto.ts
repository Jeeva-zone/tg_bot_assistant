/**
 * Client-side encryption for stored credentials.
 *
 * Threat model
 * ------------
 * The Telegram bot token and the TeleBotHost API key are bearer credentials:
 * anyone holding them controls the user's bot and account. They must therefore
 * never be written to disk in the clear, never persisted server-side, and never
 * end up in a log.
 *
 * What we do:
 *  - Encrypt with AES-GCM (256-bit, authenticated) via the Web Crypto API.
 *  - Keep the key **non-extractable**, so even code running in this origin can
 *    use it but cannot read its raw bytes out.
 *  - Store the key in IndexedDB (which can structured-clone `CryptoKey`) and the
 *    ciphertext in localStorage, so a copy of localStorage alone is useless.
 *
 * What this does NOT protect against: script injected into the same origin while
 * the app is running (XSS). No purely client-side scheme can. We mitigate that by
 * keeping the plaintext in memory only, and by never rendering credentials.
 */

const AES_KEY_LENGTH = 256;
const GCM_IV_BYTES = 12;
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;

/** True when the Web Crypto subtle API is usable (requires a secure context). */
export function isWebCryptoAvailable(): boolean {
  return (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
  );
}

export function assertWebCrypto(): void {
  if (!isWebCryptoAvailable()) {
    throw new Error(
      "Web Crypto is unavailable. Serve the app over HTTPS or localhost — " +
        "credential encryption cannot run in an insecure context.",
    );
  }
}

// ---------------------------------------------------------------------------
// Byte / string helpers
// ---------------------------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Key generation & derivation
// ---------------------------------------------------------------------------

/**
 * Generate a fresh device-bound AES-GCM key.
 *
 * `extractable: false` is the important part: the key can encrypt and decrypt,
 * but `crypto.subtle.exportKey()` will reject it, so it cannot be exfiltrated by
 * simply reading it back out of IndexedDB.
 */
export async function generateDeviceKey(): Promise<CryptoKey> {
  assertWebCrypto();
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

/**
 * Derive an AES-GCM key from a user passphrase with PBKDF2-SHA256.
 *
 * This is the portable option: the user can carry their vault between devices by
 * remembering the passphrase instead of relying on this browser's IndexedDB.
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  assertWebCrypto();
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase) as unknown as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

export function generateSalt(): Uint8Array {
  assertWebCrypto();
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a UTF-8 string. Returns `base64(iv || ciphertext)` — a fresh random IV
 * is generated per call, which is required for GCM safety.
 */
export async function encryptString(key: CryptoKey, plaintext: string): Promise<string> {
  assertWebCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as unknown as BufferSource,
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

/**
 * Decrypt a payload produced by {@link encryptString}.
 *
 * Throws if the key is wrong or the ciphertext was tampered with — GCM
 * authenticates, so a corrupted vault fails loudly rather than returning garbage.
 */
export async function decryptString(key: CryptoKey, payload: string): Promise<string> {
  assertWebCrypto();
  const combined = base64ToBytes(payload);
  if (combined.length <= GCM_IV_BYTES) {
    throw new Error("Encrypted payload is malformed (too short).");
  }

  const iv = combined.slice(0, GCM_IV_BYTES);
  const ciphertext = combined.slice(GCM_IV_BYTES);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );

  return new TextDecoder().decode(plaintext);
}

/** Encrypt an arbitrary JSON-serialisable value. */
export async function encryptJson<T>(key: CryptoKey, value: T): Promise<string> {
  return encryptString(key, JSON.stringify(value));
}

export async function decryptJson<T>(key: CryptoKey, payload: string): Promise<T> {
  const raw = await decryptString(key, payload);
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Masking — for display only, never for storage
// ---------------------------------------------------------------------------

/** Render a secret as `sk_live_••••••••4f2a` so it can be shown safely in the UI. */
export function maskSecret(secret: string, visibleTail = 4): string {
  const trimmed = secret.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= visibleTail) return "•".repeat(trimmed.length);

  const head = trimmed.slice(0, Math.min(3, trimmed.length - visibleTail));
  const tail = trimmed.slice(-visibleTail);
  const maskedLength = Math.max(4, trimmed.length - head.length - tail.length);
  return `${head}${"•".repeat(maskedLength)}${tail}`;
}

/**
 * Fingerprint a credential so the user can recognise *which* key is stored
 * without us ever showing it. Uses a truncated SHA-256 digest.
 */
export async function fingerprintSecret(secret: string): Promise<string> {
  assertWebCrypto();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret.trim()) as unknown as BufferSource,
  );
  const bytes = new Uint8Array(digest).slice(0, 4);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
