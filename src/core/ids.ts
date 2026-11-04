// @sigil implements design/task-core.sigil TaskCore (task id)
import { randomBytes } from 'node:crypto';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
export const TASK_ID_PATTERN = /^sz-[a-z2-7]{6}$/;

/** A task id is sz- followed by six base32 characters. */
export function newTaskId(): string {
  const bytes = randomBytes(6);
  let id = 'sz-';
  for (const byte of bytes) id += BASE32[byte & 31];
  return id;
}

export function isTaskId(value: string): boolean {
  return TASK_ID_PATTERN.test(value);
}
