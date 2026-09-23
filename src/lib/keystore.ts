/**
 * IndexedDB-backed key storage.
 *
 * IndexedDB is the only browser store that can persist a `CryptoKey` object via
 * the structured clone algorithm. Because our keys are non-extractable, the
 * stored value is an opaque handle: it can be *used* but not read.
 *
 * This is what makes the vault meaningfully better than "encrypt with a key that
 * is also sitting in localStorage" — copying localStorage alone gets you nothing.
 */

import { generateDeviceKey, isWebCryptoAvailable } from "./crypto";

const DB_NAME = "tg-bot-builder";
const DB_VERSION = 1;
const KEY_STORE = "crypto-keys";
const DEVICE_KEY_ID = "device-key";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser context."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
    request.onblocked = () =>
      reject(new Error("IndexedDB is blocked — close other tabs of this app and retry."));
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

async function readKey(id: string): Promise<CryptoKey | undefined> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(KEY_STORE, "readonly");
    const store = tx.objectStore(KEY_STORE);
    const value = await promisifyRequest<unknown>(store.get(id));
    return value instanceof CryptoKey ? value : undefined;
  } finally {
    db.close();
  }
}

async function writeKey(id: string, key: CryptoKey): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(key, id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to persist key."));
      tx.onabort = () => reject(tx.error ?? new Error("Key write aborted."));
    });
  } finally {
    db.close();
  }
}

async function deleteKey(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to delete key."));
    });
  } finally {
    db.close();
  }
}

/**
 * Return the device key, creating it on first use.
 *
 * The key is generated once and reused, so credentials survive a page reload
 * without the user re-entering anything.
 */
export async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  if (!isWebCryptoAvailable()) {
    throw new Error("Web Crypto is unavailable; cannot manage encryption keys.");
  }

  const existing = await readKey(DEVICE_KEY_ID);
  if (existing) return existing;

  const created = await generateDeviceKey();
  await writeKey(DEVICE_KEY_ID, created);
  return created;
}

export async function hasDeviceKey(): Promise<boolean> {
  try {
    return (await readKey(DEVICE_KEY_ID)) !== undefined;
  } catch {
    return false;
  }
}

/** Forget the device key. Any vault encrypted with it becomes unreadable. */
export async function destroyDeviceKey(): Promise<void> {
  await deleteKey(DEVICE_KEY_ID);
}
