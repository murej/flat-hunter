import { NextResponse } from "next/server";
import { ingestAgent } from "./index";
import { buildLlmContextFromParts, runEvaluationsAndNotify } from "./tools";

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
  let isRaw = false;

  // CloudMailin supports either target (see README); both remain valid webhook shapes.
  if (contentType.includes("multipart/form-data")) {
    // Raw RFC 5322 message in `message` field
    const formData = await request.formData();
    const raw = formData.get("message");
    if (!raw) {
      return { response: NextResponse.json({ error: "No message in form data" }, { status: 400 }) };
    }
    content = raw.toString();
    isRaw = true;
  } else {
    // JSON format
    const body = (await request.json()) as Record<string, unknown>;
    const html = (body.html as string) || "";
    const plain = (body.plain as string) || "";
    const subject = (body.subject as string) || "";
    content = buildLlmContextFromParts(html, subject, plain);
  }

  const { newIds } = await ingestAgent(content, isRaw);

  return {
    response: NextResponse.json({ ok: true, newListings: newIds.length }),
    backgroundWork: newIds.length > 0
      ? () => runEvaluationsAndNotify(newIds)
      : undefined,
  };
}
