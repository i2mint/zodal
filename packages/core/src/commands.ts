/**
 * Operations as commands.
 *
 * An `OperationDefinition` stays declarative: what a renderer lists (name,
 * label, scope, icon, confirmation, shortcut). Executing it is a *command*, in
 * the shape of acture's `CommandRecord` (id, title, Zod params,
 * `execute → Result`), keyed by the same id. Keeping the two apart is the fleet's
 * rule ("query and display affordances in a collection declaration; operations in
 * commands"): one command registry then yields the toolbar, palette, hotkeys, AI
 * tools, MCP and undo from a single declaration.
 *
 * This module only defines the structural shape and the bridge. It does not
 * depend on acture: an app registers the result with acture's registry, or with
 * a hand-written one.
 */

import type { ZodType } from 'zod';
import type { OperationDefinition } from './types.js';

/** Errors as data (structurally acture's `CommandError`). */
export interface OperationCommandError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * What executing a command returns (structurally acture's `Result`). `patches`
 * and `effects` let an undo history record what to invert.
 */
export type OperationCommandResult<R> =
  | { ok: true; value: R; patches?: readonly unknown[]; effects?: readonly unknown[] }
  | { ok: false; error: OperationCommandError };

/** A command derived from an operation (structurally acture's `CommandRecord`). */
export interface OperationCommand<P = unknown, R = unknown> {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  readonly icon?: string;
  readonly params?: ZodType<P>;
  readonly keybinding?: string;
  readonly execute: (
    params: P,
    ctx: Record<string, unknown>,
  ) => OperationCommandResult<R> | Promise<OperationCommandResult<R>>;
}

export interface ToCommandOptions<P> {
  /** Parameters the command takes (validated by the dispatcher). */
  params?: ZodType<P>;
  /** Grouping in a palette, e.g. the collection's name. */
  category?: string;
  /** Longer text than the operation's label. */
  description?: string;
}

/**
 * Bridge a declarative operation to an executable command with the same id.
 *
 * `execute` may return a plain value (wrapped as `{ ok: true, value }`), a full
 * result, or throw (converted to `{ ok: false, error }`), so handlers stay simple.
 *
 * @example
 * ```ts
 * const archive: OperationDefinition = { name: 'archive', label: 'Archive', scope: 'selection' };
 * const cmd = toCommandRecord(archive, async ({ ids }) => provider.updateMany(ids, { archived: true }), {
 *   params: z.object({ ids: z.array(z.string()) }),
 * });
 * registry.register(cmd); // acture, or any registry with the same shape
 * ```
 */
export function toCommandRecord<P = unknown, R = unknown>(
  operation: OperationDefinition,
  execute: (params: P, ctx: Record<string, unknown>) => R | OperationCommandResult<R> | Promise<R | OperationCommandResult<R>>,
  options: ToCommandOptions<P> = {},
): OperationCommand<P, R> {
  return {
    id: operation.name,
    title: operation.label,
    ...(options.description ? { description: options.description } : {}),
    ...(options.category ? { category: options.category } : {}),
    ...(operation.icon ? { icon: operation.icon } : {}),
    ...(options.params ? { params: options.params } : {}),
    ...(operation.keyboardShortcut ? { keybinding: operation.keyboardShortcut } : {}),
    async execute(params, ctx) {
      try {
        const out = await execute(params, ctx);
        return isResult<R>(out) ? out : { ok: true, value: out as R };
      } catch (err) {
        const e = err as { code?: unknown; message?: unknown };
        return {
          ok: false,
          error: {
            code: typeof e?.code === 'string' ? e.code : 'operation_failed',
            message: typeof e?.message === 'string' ? e.message : String(err),
            details: err,
          },
        };
      }
    },
  };
}

function isResult<R>(value: unknown): value is OperationCommandResult<R> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as { ok: unknown }).ok === 'boolean' &&
    ((value as { ok: boolean }).ok ? 'value' in value : 'error' in value)
  );
}
