import { NextResponse } from "next/server";
import { ingestAgent } from "./index";
import { runAgent } from "@/lib/core/agent";
import { reportError } from "@/lib/core/reporting";
import { getIngestNotificationModel } from "@/lib/config/agent-models";
import { sendMarkdown } from "@/lib/telegram";
import { INGEST_NOTIFICATION_SYSTEM } from "./prompts";
import { TELEMETRY_TAG_NOTIFICATION } from "./config";

function checkAuth(request: Request): boolean {
  const secret = process.env.CLOUDMAILIN_SECRET;
  if (!secret) return true; // No auth configured

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const [scheme, credentials] = authHeader.split(" ");
  if (scheme !== "Basic" || !credentials) return false;

  try {
    const decoded = atob(credentials);
    const password = decoded.split(":").slice(1).join(":");
    return password === secret;
  } catch {
    return false;
  }
}

/** Derive the base URL for internal API calls.
 *  In dev the request may arrive via a tunnel (HTTPS), but the dev server
 *  only accepts plain HTTP on localhost — use that directly to avoid SSL errors.
 *  In production the request URL origin is the correct public host. */
function internalBaseUrl(requestUrl: string): string {
  if (process.env.NODE_ENV === "development") {
    const port = process.env.PORT ?? "3000";
    return `http://localhost:${port}`;
  }
  return new URL(requestUrl).origin;
}

/** Fire-and-forget: trigger the evaluate cron on the same server that handled this request. */
function triggerEvaluationCron(requestUrl: string): void {
  const base = internalBaseUrl(requestUrl);
  const cronSecret = process.env.CRON_SECRET;
  fetch(`${base}/api/cron/evaluate`, {
    method: "GET",
    headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {},
  }).catch((err) => console.error("[cron-trigger]", err));
}

export async function handleIngestWebhook(
  request: Request,
): Promise<{ response: NextResponse; backgroundWork?: () => Promise<void> }> {
  if (!checkAuth(request)) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const contentType = request.headers.get("content-type") || "";
  let content: string;
  let rawEmail: string;
  let isRaw = false;

  if (contentType.includes("multipart/form-data")) {
    // CloudMailin raw format — RFC 5322
    const formData = await request.formData();
    const raw = formData.get("message");
    if (!raw) {
      return {
        response: NextResponse.json(
          { error: "No message in form data" },
          { status: 400 },
        ),
      };
    }
    content = raw.toString();
    rawEmail = content;
    isRaw = true;
  } else {
    // JSON format — build LLM context from parts
    const body = (await request.json()) as Record<string, unknown>;
    const html = (body.html as string) || "";
    const plain = (body.plain as string) || "";
    const subject = (body.subject as string) || "";
    content = JSON.stringify({ html, plain, subject });
    rawEmail = html || plain;
    isRaw = false;
  }

  const { newIds, updatedIds } = await ingestAgent(content, isRaw, rawEmail);
  const totalProcessed = newIds.length + updatedIds.length;
  const requestUrl = request.url;

  return {
    response: NextResponse.json({
      ok: true,
      newListings: newIds.length,
      updatedListings: updatedIds.length,
    }),
    backgroundWork:
      totalProcessed > 0
        ? async () => {
            // Send intro notification (fast: 1 LLM call + Telegram send)
            if (newIds.length > 0) {
              try {
                const intro = await runAgent({
                  systemPrompt: INGEST_NOTIFICATION_SYSTEM,
                  prompt: `Write one message to the buyer: their app received ${newIds.length} new property listing(s) and scoring is starting. Excited Stath tone.`,
                  model: getIngestNotificationModel(),
                  maxSteps: 1,
                  telemetryTag: TELEMETRY_TAG_NOTIFICATION,
                });
                await sendMarkdown(intro.message);
              } catch (err) {
                await reportError(err, { source: "ingest/intro-notification" });
              }
            }
            // Trigger evaluation on the same server that handled this request
            triggerEvaluationCron(requestUrl);
          }
        : undefined,
  };
}
