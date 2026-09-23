"use client";

/**
 * Builder store — the visual bot project and every edit operation on it.
 *
 * Persistence is debounced: the project is written to localStorage ~600ms after
 * the last keystroke, so typing in a textarea does not hammer storage.
 */

import { create } from "zustand";
import type {
  BotProject,
  CommandNode,
  FlowStep,
  MediaAttachment,
  ReplyKeyboardConfig,
  ResponseConfig,
  TriggerConfig,
  InlineButton,
} from "@/types/builder";
import {
  createCommandNode,
  createFlowStep,
  createId,
  createProject,
} from "@/types/builder";
import * as vault from "@/lib/vault";

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(project: BotProject) {
  if (typeof window === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    vault.saveProject(project);
    saveTimer = null;
  }, 600);
}

interface BuilderState {
  project: BotProject;
  selectedCommandId: string | null;
  hydrated: boolean;
  /** Set when a saved project could not be read, so the UI can say so. */
  loadError: string | null;

  hydrate: () => void;
  reset: () => void;
  setProjectName: (name: string) => void;
  setProjectDescription: (description: string) => void;

  selectCommand: (id: string | null) => void;
  addCommand: () => string;
  duplicateCommand: (id: string) => void;
  removeCommand: (id: string) => void;
  moveCommand: (id: string, direction: -1 | 1) => void;
  setCommandEnabled: (id: string, enabled: boolean) => void;
  setCommandLabel: (id: string, label: string) => void;

  updateTrigger: (id: string, patch: Partial<TriggerConfig>) => void;
  updateResponse: (id: string, patch: Partial<ResponseConfig>) => void;
  updateKeyboard: (id: string, patch: Partial<ReplyKeyboardConfig>) => void;
  setAliases: (id: string, aliases: string[]) => void;
  setNeedReply: (id: string, value: boolean) => void;
  setGroupOnly: (id: string, value: boolean) => void;
  setFolder: (id: string, value: string) => void;

  // Media
  addMedia: (id: string) => void;
  updateMedia: (id: string, mediaId: string, patch: Partial<MediaAttachment>) => void;
  removeMedia: (id: string, mediaId: string) => void;

  // Reply keyboard grid
  setKeyboardCell: (id: string, row: number, column: number, value: string) => void;
  addKeyboardRow: (id: string) => void;
  removeKeyboardRow: (id: string, row: number) => void;
  addKeyboardButton: (id: string, row: number) => void;

  // Inline keyboard grid
  setInlineEnabled: (id: string, enabled: boolean) => void;
  addInlineRow: (id: string) => void;
  removeInlineRow: (id: string, row: number) => void;
  addInlineButton: (id: string, row: number) => void;
  updateInlineButton: (
    id: string,
    row: number,
    buttonId: string,
    patch: Partial<InlineButton>,
  ) => void;
  removeInlineButton: (id: string, row: number, buttonId: string) => void;

  // Flow
  setFlowEnabled: (id: string, enabled: boolean) => void;
  setFlowScope: (id: string, scope: "user" | "bot") => void;
  setFlowCompletion: (id: string, message: string) => void;
  addFlowStep: (id: string) => void;
  updateFlowStep: (id: string, stepId: string, patch: Partial<FlowStep>) => void;
  removeFlowStep: (id: string, stepId: string) => void;
  moveFlowStep: (id: string, stepId: string, direction: -1 | 1) => void;
}

/** Apply a change to one command inside the project, then persist. */
function withCommand(
  state: BuilderState,
  commandId: string,
  updater: (command: CommandNode) => CommandNode,
): Partial<BuilderState> {
  const commands = state.project.commands.map((command) =>
    command.id === commandId ? updater(command) : command,
  );
  const project = { ...state.project, commands };
  scheduleSave(project);
  return { project };
}

/**
 * Seed the store with a real project so the very first paint is coherent: without
 * a preselected command the builder would flash its "nothing selected" empty state
 * before hydration picks one.
 */
const initialProject = createProject();

export const useBuilder = create<BuilderState>((set, get) => ({
  project: initialProject,
  selectedCommandId: initialProject.commands[0]?.id ?? null,
  hydrated: false,
  loadError: null,

  hydrate: () => {
    if (get().hydrated) return;
    try {
      const saved = vault.loadProject();
      if (saved && Array.isArray(saved.commands)) {
        set({
          project: saved,
          selectedCommandId: saved.commands[0]?.id ?? null,
          hydrated: true,
        });
        return;
      }
    } catch (error) {
      set({
        loadError:
          error instanceof Error ? error.message : "The saved project could not be read.",
      });
    }
    const fresh = createProject();
    set({ project: fresh, selectedCommandId: fresh.commands[0]?.id ?? null, hydrated: true });
  },

  reset: () => {
    const fresh = createProject();
    vault.saveProject(fresh);
    set({ project: fresh, selectedCommandId: fresh.commands[0]?.id ?? null, loadError: null });
  },

  setProjectName: (name) => {
    const project = { ...get().project, name };
    scheduleSave(project);
    set({ project });
  },

  setProjectDescription: (description) => {
    const project = { ...get().project, description };
    scheduleSave(project);
    set({ project });
  },

  selectCommand: (id) => set({ selectedCommandId: id }),

  addCommand: () => {
    const node = createCommandNode({
      label: `Command ${get().project.commands.length + 1}`,
      trigger: { kind: "command", value: "/new", caseInsensitive: false },
    });
    const project = { ...get().project, commands: [...get().project.commands, node] };
    scheduleSave(project);
    set({ project, selectedCommandId: node.id });
    return node.id;
  },

  duplicateCommand: (id) => {
    const source = get().project.commands.find((command) => command.id === id);
    if (!source) return;

    const copy: CommandNode = {
      ...structuredClone(source),
      id: createId("cmd"),
      label: `${source.label} (copy)`,
      trigger: { ...source.trigger },
    };

    const commands = [...get().project.commands];
    commands.splice(commands.findIndex((command) => command.id === id) + 1, 0, copy);

    const project = { ...get().project, commands };
    scheduleSave(project);
    set({ project, selectedCommandId: copy.id });
  },

  removeCommand: (id) => {
    const commands = get().project.commands.filter((command) => command.id !== id);
    const project = { ...get().project, commands };
    scheduleSave(project);
    set({
      project,
      selectedCommandId:
        get().selectedCommandId === id ? (commands[0]?.id ?? null) : get().selectedCommandId,
    });
  },

  moveCommand: (id, direction) => {
    const commands = [...get().project.commands];
    const index = commands.findIndex((command) => command.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= commands.length) return;

    const [moved] = commands.splice(index, 1);
    if (!moved) return;
    commands.splice(target, 0, moved);

    const project = { ...get().project, commands };
    scheduleSave(project);
    set({ project });
  },

  setCommandEnabled: (id, enabled) => set((state) => withCommand(state, id, (c) => ({ ...c, enabled }))),
  setCommandLabel: (id, label) => set((state) => withCommand(state, id, (c) => ({ ...c, label }))),

  updateTrigger: (id, patch) =>
    set((state) =>
      withCommand(state, id, (c) => ({ ...c, trigger: { ...c.trigger, ...patch } })),
    ),

  updateResponse: (id, patch) =>
    set((state) =>
      withCommand(state, id, (c) => ({ ...c, response: { ...c.response, ...patch } })),
    ),

  updateKeyboard: (id, patch) =>
    set((state) => withCommand(state, id, (c) => ({ ...c, keyboard: { ...c.keyboard, ...patch } }))),

  setAliases: (id, aliases) => set((state) => withCommand(state, id, (c) => ({ ...c, aliases }))),

  setNeedReply: (id, needReply) =>
    set((state) => withCommand(state, id, (c) => ({ ...c, needReply }))),

  setGroupOnly: (id, groupOnly) =>
    set((state) => withCommand(state, id, (c) => ({ ...c, groupOnly }))),

  setFolder: (id, folder) => set((state) => withCommand(state, id, (c) => ({ ...c, folder }))),

  // -- Media ---------------------------------------------------------------
  addMedia: (id) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        response: {
          ...c.response,
          media: [
            ...c.response.media,
            { id: createId("media"), kind: "photo", source: "", caption: "" },
          ],
        },
      })),
    ),

  updateMedia: (id, mediaId, patch) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        response: {
          ...c.response,
          media: c.response.media.map((item) =>
            item.id === mediaId ? { ...item, ...patch } : item,
          ),
        },
      })),
    ),

  removeMedia: (id, mediaId) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        response: {
          ...c.response,
          media: c.response.media.filter((item) => item.id !== mediaId),
        },
      })),
    ),

  // -- Reply keyboard ------------------------------------------------------
  setKeyboardCell: (id, row, column, value) =>
    set((state) =>
      withCommand(state, id, (c) => {
        const rows = c.keyboard.rows.map((r) => [...r]);
        const target = rows[row];
        if (!target) return c;
        target[column] = value;
        return { ...c, keyboard: { ...c.keyboard, rows } };
      }),
    ),

  addKeyboardRow: (id) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        keyboard: { ...c.keyboard, rows: [...c.keyboard.rows, [""]] },
      })),
    ),

  removeKeyboardRow: (id, row) =>
    set((state) =>
      withCommand(state, id, (c) => {
        const rows = c.keyboard.rows.filter((_, index) => index !== row);
        return { ...c, keyboard: { ...c.keyboard, rows: rows.length > 0 ? rows : [[""]] } };
      }),
    ),

  addKeyboardButton: (id, row) =>
    set((state) =>
      withCommand(state, id, (c) => {
        const rows = c.keyboard.rows.map((r, index) =>
          index === row ? [...r, ""] : [...r],
        );
        return { ...c, keyboard: { ...c.keyboard, rows } };
      }),
    ),

  // -- Inline keyboard -----------------------------------------------------
  setInlineEnabled: (id, enabled) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        response: {
          ...c.response,
          inlineKeyboard: {
            enabled,
            rows:
              enabled && c.response.inlineKeyboard.rows.length === 0
                ? [[{ id: createId("btn"), text: "Button", action: "callback", value: "action" }]]
                : c.response.inlineKeyboard.rows,
          },
        },
      })),
    ),

  addInlineRow: (id) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        response: {
          ...c.response,
          inlineKeyboard: {
            ...c.response.inlineKeyboard,
            rows: [
              ...c.response.inlineKeyboard.rows,
              [{ id: createId("btn"), text: "", action: "callback", value: "" }],
            ],
          },
        },
      })),
    ),

  removeInlineRow: (id, row) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        response: {
          ...c.response,
          inlineKeyboard: {
            ...c.response.inlineKeyboard,
            rows: c.response.inlineKeyboard.rows.filter((_, index) => index !== row),
          },
        },
      })),
    ),

  addInlineButton: (id, row) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        response: {
          ...c.response,
          inlineKeyboard: {
            ...c.response.inlineKeyboard,
            rows: c.response.inlineKeyboard.rows.map((r, index) =>
              index === row
                ? [...r, { id: createId("btn"), text: "", action: "callback" as const, value: "" }]
                : r,
            ),
          },
        },
      })),
    ),

  updateInlineButton: (id, row, buttonId, patch) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        response: {
          ...c.response,
          inlineKeyboard: {
            ...c.response.inlineKeyboard,
            rows: c.response.inlineKeyboard.rows.map((r, index) =>
              index === row
                ? r.map((button) => (button.id === buttonId ? { ...button, ...patch } : button))
                : r,
            ),
          },
        },
      })),
    ),

  removeInlineButton: (id, row, buttonId) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        response: {
          ...c.response,
          inlineKeyboard: {
            ...c.response.inlineKeyboard,
            rows: c.response.inlineKeyboard.rows.map((r, index) =>
              index === row ? r.filter((button) => button.id !== buttonId) : r,
            ),
          },
        },
      })),
    ),

  // -- Flow ----------------------------------------------------------------
  setFlowEnabled: (id, enabled) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        flow: {
          ...c.flow,
          enabled,
          steps:
            enabled && c.flow.steps.length === 0
              ? [createFlowStep(0)]
              : c.flow.steps,
        },
      })),
    ),

  setFlowScope: (id, scope) =>
    set((state) => withCommand(state, id, (c) => ({ ...c, flow: { ...c.flow, scope } }))),

  setFlowCompletion: (id, completionMessage) =>
    set((state) =>
      withCommand(state, id, (c) => ({ ...c, flow: { ...c.flow, completionMessage } })),
    ),

  addFlowStep: (id) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        flow: { ...c.flow, steps: [...c.flow.steps, createFlowStep(c.flow.steps.length)] },
      })),
    ),

  updateFlowStep: (id, stepId, patch) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        flow: {
          ...c.flow,
          steps: c.flow.steps.map((step) =>
            step.id === stepId ? { ...step, ...patch } : step,
          ),
        },
      })),
    ),

  removeFlowStep: (id, stepId) =>
    set((state) =>
      withCommand(state, id, (c) => ({
        ...c,
        flow: { ...c.flow, steps: c.flow.steps.filter((step) => step.id !== stepId) },
      })),
    ),

  moveFlowStep: (id, stepId, direction) =>
    set((state) =>
      withCommand(state, id, (c) => {
        const steps = [...c.flow.steps];
        const index = steps.findIndex((step) => step.id === stepId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= steps.length) return c;

        const [moved] = steps.splice(index, 1);
        if (!moved) return c;
        steps.splice(target, 0, moved);

        return { ...c, flow: { ...c.flow, steps } };
      }),
    ),
}));

/** The currently selected command, or `null`. */
export function useSelectedCommand(): CommandNode | null {
  return useBuilder((state) => {
    if (!state.selectedCommandId) return null;
    return state.project.commands.find((c) => c.id === state.selectedCommandId) ?? null;
  });
}
