/**
 * Centralized wrapper for the `onchainos` CLI.
 *
 * Every skill invocation in the agent funnels through here, giving us:
 *   1. One place to handle exit code 2 ("confirming" — needs re-run with --force)
 *   2. Typed argument building + zod-validated JSON parsing
 *   3. A session-wide skill usage counter (feeds the "10 skills used" dashboard)
 *   4. Structured logging so every CLI call is captured in logs/agent.jsonl
 */
import { execa, type ExecaError } from "execa";
import { z } from "zod";
import { getLogger } from "./logger.js";

const log = getLogger("okx-cli");

// --------------------------- Skill usage counter -----------------

export type OkxSkillName =
  | "okx-agentic-wallet"
  | "okx-dex-swap"
  | "okx-defi-invest"
  | "okx-defi-portfolio"
  | "okx-x402-payment"
  | "okx-security"
  | "okx-dex-market"
  | "okx-dex-signal"
  | "okx-onchain-gateway"
  | "okx-wallet-portfolio"
  | "okx-dex-ws";

const skillCounter: Record<string, number> = {};
const commandToSkill: Record<string, OkxSkillName> = {
  wallet: "okx-agentic-wallet",
  swap: "okx-dex-swap",
  defi: "okx-defi-invest", // also defi-portfolio; we split by subcommand below
  payment: "okx-x402-payment",
  security: "okx-security",
  market: "okx-dex-market",
  signal: "okx-dex-signal",
  tracker: "okx-dex-signal",
  leaderboard: "okx-dex-signal",
  gateway: "okx-onchain-gateway",
  portfolio: "okx-wallet-portfolio",
  ws: "okx-dex-ws",
};

export function tallySkill(command: string, subcommand: string): OkxSkillName | null {
  // `defi positions` / `defi position-detail` → portfolio; everything else → invest
  if (command === "defi" && (subcommand === "positions" || subcommand === "position-detail")) {
    skillCounter["okx-defi-portfolio"] = (skillCounter["okx-defi-portfolio"] ?? 0) + 1;
    return "okx-defi-portfolio";
  }
  const skill = commandToSkill[command];
  if (!skill) return null;
  skillCounter[skill] = (skillCounter[skill] ?? 0) + 1;
  return skill;
}

export function getSkillCounts(): Record<string, number> {
  return { ...skillCounter };
}

// --------------------------- Core invoke ------------------------

export interface OkxCliOptions {
  /** Extra env to pass to onchainos (merged with process.env). */
  env?: Record<string, string>;
  /** Abort after this many ms. Defaults to 60s. */
  timeoutMs?: number;
  /** Used only for logging — not passed to the CLI. */
  reason?: string;
}

export interface OkxCliResult<T = unknown> {
  ok: true;
  data: T;
  raw: string;
  stderr: string;
}

export interface OkxCliConfirming {
  ok: false;
  confirming: true;
  message: string;
  next: string;
  raw: string;
}

export interface OkxCliError {
  ok: false;
  confirming: false;
  exitCode: number;
  errorCode?: string | number;
  message: string;
  raw: string;
  stderr: string;
}

export type OkxCliResponse<T = unknown> = OkxCliResult<T> | OkxCliConfirming | OkxCliError;

const confirmingSchema = z.object({
  confirming: z.literal(true),
  message: z.string(),
  next: z.string().optional().default(""),
});

const okSchema = z.object({
  ok: z.literal(true),
  data: z.unknown().optional(),
});

const errSchema = z.object({
  ok: z.literal(false),
  code: z.union([z.string(), z.number()]).optional(),
  msg: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Run an `onchainos` command. Always passes `--json` where applicable.
 *
 * Exit codes from the CLI:
 *   0 → success, JSON body has { ok: true, data: ... }
 *   2 → confirming (high-risk tx needs user OK), JSON body has { confirming: true, ... }
 *   other → failure, JSON body has { ok: false, code, msg }
 */
export async function runOkx<T = unknown>(
  command: string,
  subcommand: string,
  args: string[] = [],
  opts: OkxCliOptions = {},
): Promise<OkxCliResponse<T>> {
  const fullArgs = [command, subcommand, ...args];
  const start = Date.now();
  tallySkill(command, subcommand);
  log.debug({ fullArgs, reason: opts.reason }, "okx invoke");

  try {
    const { stdout, stderr, exitCode } = await execa("onchainos", fullArgs, {
      env: { ...process.env, ...opts.env },
      timeout: opts.timeoutMs ?? 60_000,
      reject: false,
      stripFinalNewline: true,
    });
    const durationMs = Date.now() - start;

    // Try to parse stdout as JSON. The onchainos CLI usually wraps responses in {ok, data} or {confirming, message}.
    let parsed: unknown;
    try {
      parsed = stdout.length > 0 ? JSON.parse(stdout) : {};
    } catch {
      // Non-JSON output — common for --version, --help etc. Treat as raw success if exit 0.
      if (exitCode === 0) {
        return { ok: true, data: stdout as unknown as T, raw: stdout, stderr };
      }
      return {
        ok: false,
        confirming: false,
        exitCode: exitCode ?? -1,
        message: `non-JSON output (${durationMs}ms): ${stdout.slice(0, 200)}`,
        raw: stdout,
        stderr,
      };
    }

    // Exit 2 = confirming
    if (exitCode === 2) {
      const conf = confirmingSchema.safeParse(parsed);
      if (conf.success) {
        log.info({ fullArgs, message: conf.data.message }, "okx confirming");
        return {
          ok: false,
          confirming: true,
          message: conf.data.message,
          next: conf.data.next,
          raw: stdout,
        };
      }
    }

    // Exit 0 with {ok:true}
    if (exitCode === 0) {
      const ok = okSchema.safeParse(parsed);
      if (ok.success) {
        log.debug({ fullArgs, durationMs }, "okx ok");
        return { ok: true, data: (ok.data.data ?? parsed) as T, raw: stdout, stderr };
      }
      // Still exit 0 but shape unknown — return raw
      return { ok: true, data: parsed as T, raw: stdout, stderr };
    }

    // Exit != 0 and != 2 → error body
    const err = errSchema.safeParse(parsed);
    if (err.success) {
      log.warn(
        { fullArgs, code: err.data.code, msg: err.data.msg ?? err.data.error },
        "okx error",
      );
      return {
        ok: false,
        confirming: false,
        exitCode: exitCode ?? -1,
        errorCode: err.data.code,
        message: err.data.msg ?? err.data.error ?? "unknown error",
        raw: stdout,
        stderr,
      };
    }

    return {
      ok: false,
      confirming: false,
      exitCode: exitCode ?? -1,
      message: `unparsed error (exit ${exitCode})`,
      raw: stdout,
      stderr,
    };
  } catch (err) {
    const e = err as ExecaError;
    log.error({ fullArgs, err: e.shortMessage ?? e.message }, "okx spawn failed");
    return {
      ok: false,
      confirming: false,
      exitCode: e.exitCode ?? -1,
      message: e.shortMessage ?? e.message,
      raw: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : "",
    };
  }
}

/**
 * Assert the response is `ok: true` — throws otherwise.
 * Use in hot paths where a failure means aborting the current cycle.
 */
export function mustOk<T>(resp: OkxCliResponse<T>, context: string): T {
  if (!resp.ok) {
    if (resp.confirming) {
      throw new Error(`[${context}] CLI asked for confirmation: ${resp.message}`);
    }
    throw new Error(
      `[${context}] onchainos failed (exit ${resp.exitCode}, code ${resp.errorCode ?? "?"}): ${resp.message}`,
    );
  }
  return resp.data;
}
