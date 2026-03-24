import { NextResponse } from "next/server";
import { ingestAgent } from "./index";
import { runEvaluationsAndNotify, runReEvaluationsAndNotify } from "./tools";

function checkAuth(request: Request): boolean {
  const secret = process.env.CLOUDMAILIN_SECRET;
  if (!secret) return true; // No auth configured

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const [scheme, credentials] = authHeader.split(" ");
  if (scheme !== "Basic") return false;

  const decoded = atob(credentials);
  const password = decoded.split(":").slice(1).join(":");
  return password === secret;
}

export async function handleIngestWebhook(
  request: Request,
): Promise<{ response: NextResponse; backgroundWork?: () => Promise<void> }> {
  if (!checkAuth(request)) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
      return { response: NextResponse.json({ error: "No message in form data" }, { status: 400 }) };
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

  const { newIds, updatedIds, changes } = await ingestAgent(content, isRaw, rawEmail);
  const totalProcessed = newIds.length + updatedIds.length;

  return {
    response: NextResponse.json({ ok: true, newListings: newIds.length, updatedListings: updatedIds.length }),
    backgroundWork: totalProcessed > 0
      ? async () => {
          await Promise.all([
            runEvaluationsAndNotify(newIds),
            runReEvaluationsAndNotify(updatedIds, changes),
          ]);
        }
      : undefined,
  };
}
