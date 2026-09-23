/**
 * Encrypted credential vault.
 *
 * Layout on disk (localStorage holds ciphertext only):
 *
 *   tgbot.vault.v1        -> { version, updatedAt, payload: "base64(iv||ct)" }
 *   tgbot.vault.meta.v1   -> non-sensitive display metadata (fingerprints, dates)
 *
 * The AES key lives in IndexedDB (see `keystore.ts`) and is non-extractable.
 * The plaintext bundle exists in memory only, for the lifetime of the tab.
 */

import type { CredentialBundle, BotProject, DeploymentRecord } from "@/types/builder";
import { decryptJson, encryptJson, fingerprintSecret } from "./crypto";
import { getOrCreateDeviceKey, destroyDeviceKey } from "./keystore";

const VAULT_KEY = "tgbot.vault.v1";
const VAULT_META_KEY = "tgbot.vault.meta.v1";
const PROJECT_KEY = "tgbot.project.v1";
const DEPLOYMENTS_KEY = "tgbot.deployments.v1";

interface VaultEnvelope {
  version: 1;
  updatedAt: string;
  /** base64(iv || ciphertext) of the JSON-serialised CredentialBundle. */
  payload: string;
}

/**
 * Deliberately non-sensitive. We store a short SHA-256 fingerprint of each
 * credential so the UI can show "the key ending ...4f2a is stored" without
 * decrypting anything — and without ever revealing the secret.
 */
export interface VaultMeta {
  updatedAt: string;
  telegramFingerprint: string;
  tbhFingerprint: string;
  botUsername: string;
  keyType: "secret" | "public" | "unknown";
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function hasVault(): boolean {
  if (!hasLocalStorage()) return false;
  return localStorage.getItem(VAULT_KEY) !== null;
}

export function readVaultMeta(): VaultMeta | null {
  if (!hasLocalStorage()) return null;
  const raw = localStorage.getItem(VAULT_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VaultMeta;
  } catch {
    return null;
  }
}

/**
 * Encrypt and persist the credential bundle.
 *
 * The plaintext is never written anywhere — only the GCM ciphertext reaches
 * localStorage, and the key that produced it stays non-extractable in IndexedDB.
 */
export async function saveCredentials(bundle: CredentialBundle): Promise<VaultMeta> {
  const key = await getOrCreateDeviceKey();
  const payload = await encryptJson(key, bundle);

  const envelope: VaultEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    payload,
  };

  const meta: VaultMeta = {
    updatedAt: envelope.updatedAt,
    telegramFingerprint: await fingerprintSecret(bundle.telegram.botToken),
    tbhFingerprint: await fingerprintSecret(bundle.telebothost.apiKey),
    botUsername: bundle.telegram.botUsername,
    keyType: bundle.telebothost.keyType,
  };

  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope));
  localStorage.setItem(VAULT_META_KEY, JSON.stringify(meta));

  return meta;
}

/** Decrypt the stored bundle, or return `null` when no vault exists. */
export async function loadCredentials(): Promise<CredentialBundle | null> {
  if (!hasVault()) return null;

  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;

  let envelope: VaultEnvelope;
  try {
    envelope = JSON.parse(raw) as VaultEnvelope;
  } catch {
    throw new Error("The stored credential vault is corrupt and cannot be read.");
  }

  const key = await getOrCreateDeviceKey();
  try {
    return await decryptJson<CredentialBundle>(key, envelope.payload);
  } catch {
    // GCM authentication failed: wrong key, or the ciphertext was tampered with.
    throw new Error(
      "Could not decrypt the saved credentials. The vault key no longer matches — " +
        "please re-enter your credentials.",
    );
  }
}

/** Remove every trace of the vault, including the encryption key itself. */
export async function clearCredentials(): Promise<void> {
  if (hasLocalStorage()) {
    localStorage.removeItem(VAULT_KEY);
    localStorage.removeItem(VAULT_META_KEY);
  }
  await destroyDeviceKey();
}

// ---------------------------------------------------------------------------
// Project & deployment history — not secret, so plain localStorage is fine
// ---------------------------------------------------------------------------

export function saveProject(project: BotProject): void {
  if (!hasLocalStorage()) return;
  const stamped: BotProject = { ...project, updatedAt: new Date().toISOString() };
  localStorage.setItem(PROJECT_KEY, JSON.stringify(stamped));
}

export function loadProject(): BotProject | null {
  if (!hasLocalStorage()) return null;
  const raw = localStorage.getItem(PROJECT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BotProject;
  } catch {
    return null;
  }
}

export function clearProject(): void {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(PROJECT_KEY);
}

export function saveDeployments(records: DeploymentRecord[]): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(DEPLOYMENTS_KEY, JSON.stringify(records));
}

export function loadDeployments(): DeploymentRecord[] {
  if (!hasLocalStorage()) return [];
  const raw = localStorage.getItem(DEPLOYMENTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DeploymentRecord[];
  } catch {
    return [];
  }
}
