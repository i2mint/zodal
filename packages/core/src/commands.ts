/**
 * Operations as commands.
 *
 * An `OperationDefinition` stays declarative: what a renderer lists (name,
 * label, scope, icon, confirmation, shortcut). Executing it is a *command*, in
 * the shape of acture's `CommandRecord` (id, title, Zod params,
 * `execute → Result`), keyed by a shared id ({@link operationCommandId}). Keeping
 * the two apart is the fleet's rule ("query and display affordances in a
 * collection declaration; operations in commands"): one command registry then
 * yields the toolbar, palette, hotkeys, AI tools and MCP from a single
 * declaration.
 *
 * This module defines the shapes structurally (they match acture's exactly) and
 * the bridge; it does not depend on acture. With acture, prefer
 * `registry.register(defineCommand(toCommandRecord(...)))` so acture's own
 * registration checks run.
 *
 * What does not carry over, by design: acture has no `confirm` and no
 * destructive style, so a palette, hotkey or AI caller would run a
 * confirm-guarded operation without prompting. Gate such commands with `when`, or
 * keep the confirmation inside `execute`. Undo in acture-undo is recorded from
 * state patches made through a patch-capable state adapter (or from `effects`),
 * not from a provider call inside `execute`.
 */

import type { ZodType } from 'zod';
import type { OperationDefinition } from './types.js';

/** A state patch (acture's `Patch`). */
export interface OperationPatch {
  op: 'add' | 'remove' | 'replace';
  path: readonly (string | number)[];
  value?: unknown;
}

/** A side effect for an undo/effect queue (acture's `Effect`). */
export interface OperationEffect {
  type: string;
  [key: string]: unknown;
}

/** Errors as data (acture's `CommandError`). */
export interface OperationCommandError {
  code: string;
  message: string;
  details?: unknown;
}

/** What executing a command returns (acture's `Result`). */
export type OperationCommandResult<R> =
  | { ok: true; value: R; patches?: readonly OperationPatch[]; effects?: readonly OperationEffect[] }
  | { ok: false; error: OperationCommandError };

/** A command derived from an operation (acture's `CommandRecord`, the fields this bridge sets). */
export interface OperationCommand<P = unknown, R = unknown> {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  readonly icon?: string;
  readonly params?: ZodType<P>;
  readonly when?: string;
  readonly keybinding?: string;
  readonly execute: (
    params: P,
    ctx: Record<string, unknown>,
  ) => OperationCommandResult<R> | Promise<OperationCommandResult<R>>;
}

/** `{ ok: true, value }`, optionally with patches/effects for an undo history. */
export function ok<R>(
  value: R,
  extra: { patches?: readonly OperationPatch[]; effects?: readonly OperationEffect[] } = {},
): OperationCommandResult<R> {
  return { ok: true, value, ...extra };
}

/** `{ ok: false, error }`: a failure as data. */
export function fail(code: string, message: string, details?: unknown): OperationCommandResult<never> {
  return { ok: false, error: details === undefined ? { code, message } : { code, message, details } };
}

/**
 * One acture id segment from a name: `bulk-delete`/`bulk_delete` → `bulkDelete`,
 * `Archive` → `archive`, `URLFetch` → `urlFetch`. ASCII only: a name with other
 * characters is refused rather than silently shortened (`café` would collide
 * with `caf`).
 */
function toIdSegment(name: string, what: string): string {
  if (!/^[\x20-\x7e]+$/.test(name)) throw new Error(`${what} "${name}" must be printable ASCII to become a command id`);
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) throw new Error(`${what} "${name}" has no letters or digits`);
  const seg = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
  if (!/^[a-z]/.test(seg)) throw new Error(`${what} "${name}" must start with a letter`);
  return seg;
}

/**
 * The command id for an operation: `namespace.operationName`, both normalized to
 * acture's `app.domain.action` pattern (dot-separated camelCase segments). Use it
 * on both sides, where the command is registered and where a renderer dispatches.
 */
export function operationCommandId(namespace: string | undefined, operation: Pick<OperationDefinition, 'name'>): string {
  const ns = namespace ? namespace.split('.').map((s) => toIdSegment(s, 'Command namespace segment')).join('.') : '';
  const own = toIdSegment(operation.name, 'Operation name');
  return ns ? `${ns}.${own}` : own;
}

const KEY_NAMES: Record<string, string> = {
  // modifiers: `ctrl` is Control on every platform; use `mod` for Cmd-on-Mac / Ctrl-elsewhere
  ctrl: 'Control', control: 'Control', cmd: 'Meta', meta: 'Meta', command: 'Meta', super: 'Meta',
  alt: 'Alt', option: 'Alt', opt: 'Alt', shift: 'Shift', mod: '$mod', cmdorctrl: '$mod', commandorcontrol: '$mod',
  // keys, as KeyboardEvent.key names
  esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', backspace: 'Backspace',
  enter: 'Enter', return: 'Enter', tab: 'Tab', space: 'Space', spacebar: 'Space',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', ins: 'Insert', insert: 'Insert',
};

/**
 * `"ctrl+d"` → `"Control+d"`, `"mod+k"` → `"$mod+k"`, `"esc"` → `"Escape"`:
 * the names acture's hotkeys (tinykeys) expect. Chords are space-separated.
 * `ctrl` means Control everywhere; write `mod` for Cmd on a Mac and Ctrl
 * elsewhere.
 */
export function normalizeKeybinding(shortcut: string): string {
  return shortcut
    .trim()
    .split(/\s+/)
    .map((chord) =>
      chord
        .split(/\+(?!$)/)
        .map((k) => KEY_NAMES[k.toLowerCase()] ?? k)
        .join('+'),
    )
    .join(' ');
}

export interface ToCommandOptions<P> {
  /** Namespace for the id (e.g. the app and collection: `'notes'`, `'myApp.notes'`). Avoids two collections' `delete` colliding. */
  namespace?: string;
  /** Parameters the command takes (validated by the dispatcher). */
  params?: ZodType<P>;
  /** acture `when` clause, e.g. `'selection.length >= 1'` for a selection-scoped operation. */
  when?: string;
  /** Grouping in a palette, e.g. the collection's name. */
  category?: string;
  /** Longer text than the operation's label. */
  description?: string;
}

/**
 * Bridge a declarative operation to an executable command.
 *
 * `execute` returns a result explicitly (use {@link ok} / {@link fail}); nothing
 * is guessed from the shape of a return value. A throw becomes
 * `{ ok: false, error: { code: 'execute_threw', message } }` (acture's own code
 * for it), without the raw error object, which may hold credentials.
 *
 * @example
 * ```ts
 * const archive: OperationDefinition = { name: 'archive', label: 'Archive', scope: 'selection' };
 * const cmd = toCommandRecord(archive, async ({ ids }) => ok(await provider.updateMany(ids, { archived: true })), {
 *   namespace: 'notes',
 *   params: z.object({ ids: z.array(z.string()) }),
 *   when: 'selection.length >= 1',
 * });
 * registry.register(defineCommand(cmd)); // acture
 * ```
 */
export function toCommandRecord<P = unknown, R = unknown>(
  operation: OperationDefinition,
  execute: (params: P, ctx: Record<string, unknown>) => OperationCommandResult<R> | Promise<OperationCommandResult<R>>,
  options: ToCommandOptions<P> = {},
): OperationCommand<P, R> {
  const command: OperationCommand<P, R> = {
    id: operationCommandId(options.namespace, operation),
    title: operation.label,
    ...(options.description ? { description: options.description } : {}),
    ...(options.category ? { category: options.category } : {}),
    ...(operation.icon ? { icon: operation.icon } : {}),
    ...(options.params ? { params: options.params } : {}),
    ...(options.when ? { when: options.when } : {}),
    ...(operation.keyboardShortcut ? { keybinding: normalizeKeybinding(operation.keyboardShortcut) } : {}),
    async execute(params, ctx) {
      try {
        return await execute(params, ctx);
      } catch (err) {
        // Keep a string `code` the error carries (as acture's dispatcher does); never the raw object.
        const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : 'execute_threw';
        return fail(code, err instanceof Error ? err.message : String(err));
      }
    },
  };
  return Object.freeze(command);
}
