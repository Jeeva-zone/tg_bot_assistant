"use client";

/**
 * Copilot state.
 *
 * The conversation lives here rather than in the drawer component so it survives the
 * drawer being collapsed — closing the panel mid-generation should not throw away the
 * user's context. Messages are held in memory only: they can contain fragments of the
 * user's bot logic, and there is no reason to persist them to disk.
 */

import { create } from "zustand";
import {
  createAssistantPlaceholder,
  createCopilotId,
  createUserMessage,
  type CopilotArtifact,
  type CopilotBotContext,
  type CopilotMessage,
} from "@/types/copilot";

export type CopilotStatus = "idle" | "thinking" | "error";

interface CopilotState {
  open: boolean;
  messages: CopilotMessage[];
  status: CopilotStatus;
  /** Bot the copilot is currently reasoning about. */
  activeBotId: number | null;
  /** Live context snapshot, refreshed when the bot or its commands change. */
  context: CopilotBotContext | null;
  /** Set when the last turn failed, so the UI can offer a retry. */
  lastError: { message: string; hint?: string } | null;

  setOpen: (open: boolean) => void;
  toggle: () => void;

  setActiveBotId: (botId: number | null) => void;
  setContext: (context: CopilotBotContext | null) => void;

  pushUserMessage: (content: string) => void;
  pushAssistantPlaceholder: () => string;
  resolveAssistant: (
    id: string,
    payload: {
      content: string;
      artifact?: CopilotArtifact;
      parseError?: string;
      model?: string;
    },
  ) => void;
  failAssistant: (id: string, error: { message: string; hint?: string }) => void;

  setStatus: (status: CopilotStatus) => void;
  clear: () => void;
  /** Drop everything except the system-level state — used on sign-out. */
  reset: () => void;
}

export const useCopilot = create<CopilotState>((set, get) => ({
  open: false,
  messages: [],
  status: "idle",
  activeBotId: null,
  context: null,
  lastError: null,

  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),

  setActiveBotId: (activeBotId) => set({ activeBotId }),
  setContext: (context) => set({ context }),

  pushUserMessage: (content) => {
    const message = createUserMessage(content);
    set((state) => ({
      messages: [...state.messages, message],
      lastError: null,
      status: "thinking",
    }));
  },

  pushAssistantPlaceholder: () => {
    const placeholder = createAssistantPlaceholder();
    set((state) => ({ messages: [...state.messages, placeholder] }));
    return placeholder.id;
  },

  resolveAssistant: (id, payload) => {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id
          ? {
              ...message,
              pending: false,
              content: payload.content,
              artifact: payload.artifact,
              parseError: payload.parseError,
              model: payload.model,
            }
          : message,
      ),
      status: "idle",
    }));
  },

  failAssistant: (id, error) => {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id
          ? { ...message, pending: false, error: error.message, content: "" }
          : message,
      ),
      status: "error",
      lastError: error,
    }));
  },

  setStatus: (status) => set({ status }),

  clear: () => set({ messages: [], status: "idle", lastError: null }),

  reset: () =>
    set({
      open: false,
      messages: [],
      status: "idle",
      activeBotId: null,
      context: null,
      lastError: null,
    }),
}));

/**
 * Turn the stored conversation into the message array the API expects.
 *
 * Assistant turns are sent as their **explanation**, not the raw JSON blob — feeding
 * the previous JSON back would encourage the model to echo structure instead of
 * building on the conversation.
 */
export function toApiMessages(
  messages: CopilotMessage[],
): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((message) => !message.pending && !message.error && message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.artifact
        ? `${message.content}\n\n[Previous command: ${message.artifact.command_name}]`
        : message.content,
    }));
}

/** Stable id helper re-exported so the drawer does not import from two places. */
export { createCopilotId };
