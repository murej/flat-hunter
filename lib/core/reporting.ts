/**
 * Central runtime error reporting (console + optional Telegram when verbose).
 * Lives here instead of `lib/core/tools.ts` because `@/lib/core/tools` is the
 * directory entrypoint (`lib/core/tools/index.ts`); a sibling `tools.ts` would
 * conflict with that import path.
 */
import { sendPlainText } from "@/lib/telegram";
import { envBool } from "@/lib/utils/env-utils";

const REPORTED = Symbol.for("flatHunter.errorReported");

export type ReportContext = {
  source: string;
  telemetryTag?: string;
  toolName?: string;
  stepNumber?: number;
  rawFinishReason?: string;
};

function formatErrorForConsole(
  err: unknown,
  ctx: ReportContext,
): { headline: string; stack?: string } {
  const bits = [ctx.source];
  if (ctx.telemetryTag) bits.push(`tag=${ctx.telemetryTag}`);
  if (ctx.toolName) bits.push(`tool=${ctx.toolName}`);
  if (ctx.stepNumber != null) bits.push(`step=${ctx.stepNumber}`);
  if (ctx.rawFinishReason) bits.push(`rawFinish=${ctx.rawFinishReason}`);
  const prefix = bits.join(" ");

  if (err instanceof Error) {
    return { headline: `${prefix}: ${err.message}`, stack: err.stack };
  }
  return { headline: `${prefix}: ${String(err)}` };
}

function formatErrorForTelegram(err: unknown, ctx: ReportContext): string {
  const { headline, stack } = formatErrorForConsole(err, ctx);
  const body = stack ? `${headline}\n\n${stack}` : headline;
  return body.slice(0, 4096);
}

export function isErrorReported(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Record<symbol, boolean>)[REPORTED] === true
  );
}

export function markErrorReported(err: unknown): void {
  if (typeof err === "object" && err !== null) {
    (err as Record<symbol, boolean>)[REPORTED] = true;
  }
}

/** Console always; Telegram diagnostic when TELEGRAM_VERBOSE_MODE. Idempotent per error object. */
export async function reportError(
  err: unknown,
  ctx: ReportContext,
): Promise<void> {
  if (isErrorReported(err)) return;

  const { headline, stack } = formatErrorForConsole(err, ctx);
  console.error(stack ? `${headline}\n${stack}` : headline);

  if (envBool("TELEGRAM_VERBOSE_MODE")) {
    try {
      await sendPlainText(formatErrorForTelegram(err, ctx));
    } catch (sendErr) {
      console.error("Failed to send error to Telegram:", sendErr);
    }
  }

  markErrorReported(err);
}
