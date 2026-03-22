import { NextResponse } from "next/server";
import { ingestAgent } from "./index";
import { buildLlmContextFromParts, runEvaluationsAndNotify } from "./tools";

function checkAuth(request: Request): boolean {
  const secretRaw = process.env.CLOUDMAILIN_SECRET;
  if (!secretRaw) return true; // No auth configured

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    // #region agent log
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b75a44",
      },
      body: JSON.stringify({
        sessionId: "b75a44",
        location: "lib/agents/ingest/handler.ts:checkAuth",
        message: "ingest auth",
        data: {
          hypothesisId: "ingest-H1-H5",
          outcome: "no_auth_header",
          runId: process.env.VERCEL ? "vercel" : "local",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.log(
      JSON.stringify({
        debugSession: "b75a44",
        tag: "cloudmailin-ingest-auth",
        hypothesisId: "ingest-H1-H5",
        outcome: "no_auth_header",
        runId: process.env.VERCEL ? "vercel" : "local",
      }),
    );
    // #endregion
    return false;
  }

  const [scheme, credentials] = authHeader.split(" ");
  if (scheme !== "Basic" || !credentials) {
    // #region agent log
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b75a44",
      },
      body: JSON.stringify({
        sessionId: "b75a44",
        location: "lib/agents/ingest/handler.ts:checkAuth",
        message: "ingest auth",
        data: {
          hypothesisId: "ingest-H1-H5",
          outcome: "not_basic",
          scheme: scheme ?? null,
          runId: process.env.VERCEL ? "vercel" : "local",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.log(
      JSON.stringify({
        debugSession: "b75a44",
        tag: "cloudmailin-ingest-auth",
        hypothesisId: "ingest-H1-H5",
        outcome: "not_basic",
        scheme: scheme ?? null,
        runId: process.env.VERCEL ? "vercel" : "local",
      }),
    );
    // #endregion
    return false;
  }

  let decoded: string;
  try {
    decoded = atob(credentials);
  } catch {
    // #region agent log
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b75a44",
      },
      body: JSON.stringify({
        sessionId: "b75a44",
        location: "lib/agents/ingest/handler.ts:checkAuth",
        message: "ingest auth",
        data: {
          hypothesisId: "ingest-H1-H5",
          outcome: "bad_base64",
          runId: process.env.VERCEL ? "vercel" : "local",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.log(
      JSON.stringify({
        debugSession: "b75a44",
        tag: "cloudmailin-ingest-auth",
        hypothesisId: "ingest-H1-H5",
        outcome: "bad_base64",
        runId: process.env.VERCEL ? "vercel" : "local",
      }),
    );
    // #endregion
    return false;
  }

  const password = decoded.split(":").slice(1).join(":");
  const secret = secretRaw;
  const exactMatch = password === secret;
  const matchIfTrimSecret = password === secret.trim();
  const matchIfTrimBoth = password.trim() === secret.trim();
  // #region agent log
  {
    const payload = {
      hypothesisId: "ingest-H1-H5",
      outcome: exactMatch ? "ok" : "password_mismatch",
      runId: process.env.VERCEL ? "vercel" : "local",
      secretLen: secret.length,
      secretHasOuterWs: secret !== secret.trim(),
      passwordLen: password.length,
      passwordHasOuterWs: password !== password.trim(),
      exactMatch,
      matchIfTrimSecret,
      matchIfTrimBoth,
    };
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b75a44",
      },
      body: JSON.stringify({
        sessionId: "b75a44",
        location: "lib/agents/ingest/handler.ts:checkAuth",
        message: "ingest auth",
        data: payload,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.log(
      JSON.stringify({
        debugSession: "b75a44",
        tag: "cloudmailin-ingest-auth",
        ...payload,
      }),
    );
  }
  // #endregion
  return exactMatch;
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
