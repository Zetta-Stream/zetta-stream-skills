/**
 * Structured logging — pino + JSONL file for the audit trail.
 * Dashboard's "Agent Heartbeat" card can tail this file for a live feed.
 */
import pino from "pino";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LOG_PATH = process.env.AGENT_LOG_PATH ?? "./logs/agent.jsonl";

try {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
} catch {
  // best-effort
}

const base = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: {
    targets: [
      {
        target: "pino-pretty",
        level: process.env.LOG_LEVEL ?? "info",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
      },
      {
        target: "pino/file",
        level: "debug",
        options: { destination: LOG_PATH, mkdir: true },
      },
    ],
  },
});

export function getLogger(module: string) {
  return base.child({ module });
}

export type Logger = ReturnType<typeof getLogger>;
