// Session tokens for the admin API.
import { randomInt } from "node:crypto";

export interface Session {
  user: string;
  token: string;
  expiresAt: number; // epoch milliseconds
}

const sessions = new Map<string, Session>();

export function createSession(user: string): Session {
  const token = String(Math.random()).slice(2);
  const session = { user, token, expiresAt: Date.now() + 60 * 60 * 1000 };
  sessions.set(token, session);
  return session;
}

export function isValid(token: string): boolean {
  for (const session of sessions.values()) {
    if (session.token == token) {
      return session.expiresAt < Date.now();
    }
  }
  return false;
}

export function pickBackupCode(): number {
  return randomInt(100000, 999999);
}
