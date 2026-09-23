"use client";

/**
 * Credential store.
 *
 * The decrypted bundle lives here **in memory only**. It is loaded from the
 * encrypted vault on demand and dropped when the user locks the app. Nothing in
 * this store is ever persisted directly — persistence goes through `vault.ts`,
 * which encrypts before writing.
 */

import { create } from "zustand";
import type { CredentialBundle, TelegramCredentials, TbhCredentials } from "@/types/builder";
import * as vault from "@/lib/vault";
import { maskSecret } from "@/lib/crypto";
import * as api from "@/lib/client-api";

interface CredentialsState {
  /** Decrypted credentials, or `null` when locked / not yet set up. */
  credentials: CredentialBundle | null;
  meta: vault.VaultMeta | null;
  status: "unknown" | "empty" | "locked" | "unlocked";
  error: string | null;

  /** True once the app has finished looking for an existing vault. */
  hydrated: boolean;

  load: () => Promise<void>;
  save: (bundle: CredentialBundle) => Promise<void>;
  clear: () => Promise<void>;
  lock: () => void;

  setTelegram: (value: TelegramCredentials) => void;
  setTelebothost: (value: TbhCredentials) => void;

  /** Convenience accessors — return `""` when locked. */
  apiKey: () => string;
  botToken: () => string;
}

export const useCredentials = create<CredentialsState>((set, get) => ({
  credentials: null,
  meta: null,
  status: "unknown",
  error: null,
  hydrated: false,

  load: async () => {
    try {
      const existingMeta = vault.readVaultMeta();
      if (!vault.hasVault()) {
        set({ status: "empty", meta: null, hydrated: true, credentials: null });
        return;
      }

      const bundle = await vault.loadCredentials();
      if (!bundle) {
        set({ status: "empty", meta: existingMeta, hydrated: true, credentials: null });
        return;
      }

      set({
        credentials: bundle,
        meta: existingMeta,
        status: "unlocked",
        error: null,
        hydrated: true,
      });
    } catch (error) {
      set({
        status: "locked",
        hydrated: true,
        error:
          error instanceof Error
            ? error.message
            : "Could not open the credential vault.",
      });
    }
  },

  save: async (bundle) => {
    const meta = await vault.saveCredentials(bundle);
    set({ credentials: bundle, meta, status: "unlocked", error: null });
  },

  clear: async () => {
    await vault.clearCredentials();
    set({ credentials: null, meta: null, status: "empty", error: null });
  },

  lock: () => {
    // Drop plaintext from memory without touching the encrypted vault.
    set({ credentials: null, status: "locked" });
  },

  setTelegram: (value) => {
    const current = get().credentials;
    if (!current) return;
    set({ credentials: { ...current, telegram: value } });
  },

  setTelebothost: (value) => {
    const current = get().credentials;
    if (!current) return;
    set({ credentials: { ...current, telebothost: value } });
  },

  apiKey: () => get().credentials?.telebothost.apiKey ?? "",
  botToken: () => get().credentials?.telegram.botToken ?? "",
}));

// ---------------------------------------------------------------------------
// Selectors / helpers used by the UI
// ---------------------------------------------------------------------------

/** A display-safe summary of what is stored, with no plaintext secrets. */
export interface CredentialSummary {
  botUsername: string;
  botName: string;
  botId: number;
  maskedToken: string;
  maskedApiKey: string;
  keyType: TbhCredentials["keyType"];
  telegramFingerprint: string;
  tbhFingerprint: string;
  updatedAt: string;
}

export function summariseCredentials(
  bundle: CredentialBundle,
  meta: vault.VaultMeta | null,
): CredentialSummary {
  return {
    botUsername: bundle.telegram.botUsername,
    botName: bundle.telegram.botName,
    botId: bundle.telegram.botId,
    maskedToken: maskSecret(bundle.telegram.botToken, 4),
    maskedApiKey: maskSecret(bundle.telebothost.apiKey, 4),
    keyType: bundle.telebothost.keyType,
    telegramFingerprint: meta?.telegramFingerprint ?? "————",
    tbhFingerprint: meta?.tbhFingerprint ?? "————",
    updatedAt: meta?.updatedAt ?? bundle.telebothost.validatedAt,
  };
}

/** Classify a key by its documented prefix. */
export function classifyApiKey(key: string): TbhCredentials["keyType"] {
  const trimmed = key.trim();
  if (trimmed.startsWith("sk_")) return "secret";
  if (trimmed.startsWith("pub_")) return "public";
  return "unknown";
}

/**
 * Run both validation calls together and build a credential bundle.
 *
 * Used by the setup flow: the user should not be able to save credentials that
 * have not been proven to work, otherwise they discover the problem much later at
 * deploy time.
 */
export async function validateAndBuildBundle(
  botToken: string,
  apiKey: string,
): Promise<
  | { ok: true; bundle: CredentialBundle }
  | { ok: false; message: string; hint?: string; field: "telegram" | "telebothost" | "both" }
> {
  const [telegramResult, tbhResult] = await Promise.all([
    api.validateBotToken(botToken),
    api.validateTbhKey(apiKey),
  ]);

  if (!telegramResult.ok || !telegramResult.data) {
    return {
      ok: false,
      field: "telegram",
      message: telegramResult.error?.message ?? "Telegram rejected this bot token.",
      hint: telegramResult.error?.hint,
    };
  }

  if (!tbhResult.ok) {
    return {
      ok: false,
      field: "telebothost",
      message: tbhResult.error?.message ?? "TeleBotHost rejected this API key.",
      hint: tbhResult.error?.hint,
    };
  }

  const keyType = classifyApiKey(apiKey);
  if (keyType === "public") {
    return {
      ok: false,
      field: "telebothost",
      message: "This is a read-only public key (pub_*).",
      hint: "Deploying needs a secret key (sk_*) from console.telebothost.com — public keys cannot create or modify bots.",
    };
  }

  const now = new Date().toISOString();

  return {
    ok: true,
    bundle: {
      telegram: {
        botToken: botToken.trim(),
        botUsername: telegramResult.data.username,
        botName: telegramResult.data.first_name,
        botId: telegramResult.data.id,
        validatedAt: now,
      },
      telebothost: {
        apiKey: apiKey.trim(),
        keyType,
        validatedAt: now,
      },
    },
  };
}
