import { reportError, type ReportContext } from "./reporting";

/**
 * Parse JSON from a successful `runAgent` message. Failures here bypass `runAgent`'s
 * catch (the LLM call succeeded), so we report explicitly.
 */
export async function parseAgentJsonMessage(
  message: string,
  ctx: ReportContext,
): Promise<unknown> {
  try {
    return JSON.parse(message) as unknown;
  } catch (err) {
    await reportError(err, { ...ctx, source: `${ctx.source}/parse` });
    throw err;
  }
}
