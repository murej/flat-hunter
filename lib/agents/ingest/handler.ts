import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { ingestAgent } from "./index";
import { runEvaluationsAndNotify } from "./tools";
import { extractMimeParts } from "@/lib/utils/email-llm-input";

export async function handleIngestWebhook(
  req: NextRequest,
): Promise<NextResponse> {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    // Authentication is the same for both JSON and raw multipart formats
    if (process.env.CLOUDMAILIN_SECRET) {
      const authHeader = req.headers.get("authorization") ?? "";
      const base64 = authHeader.replace(/^Basic\s+/i, "");
      const decoded = Buffer.from(base64, "base64").toString("utf8");
      const password = decoded.split(":").slice(1).join(":");
      if (password !== process.env.CLOUDMAILIN_SECRET) {
        // #region agent log
        fetch(
          "http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "80f195",
            },
            body: JSON.stringify({
              sessionId: "80f195",
              runId: "pre-fix",
              hypothesisId: "B",
              location: "handler.ts:ingest-auth",
              message: "ingest webhook unauthorized",
              data: { hasAuthHeader: Boolean(authHeader) },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
        // #endregion
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    let html: string;
    let plain: string;
    let subject: string | undefined;
    let rawMessage: string | undefined;

    if (contentType.startsWith("multipart/form-data")) {
      // CloudMailin raw message format — full RFC 5322 in the `message` field
      const formData = await req.formData();
      rawMessage = (formData.get("message") as string | null) ?? "";
      // Extract MIME parts for idempotency/storage (LLM context built later inside the agent)
      const mimeResult = await extractMimeParts(rawMessage);
      html = mimeResult.html;
      plain = mimeResult.plain;
      subject = mimeResult.subject || undefined;
    } else {
      // Support both flat and normalized CloudMailin JSON formats
      const body = await req.json();
      html = body.html ?? body.body?.html ?? "";
      plain = body.plain ?? body.body?.plain ?? "";
      subject = (body.subject ??
        body.headers?.subject ??
        body.headers?.Subject) as string | undefined;
    }

    // #region agent log
    fetch(
      "http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "80f195",
        },
        body: JSON.stringify({
          sessionId: "80f195",
          runId: "pre-fix",
          hypothesisId: "C",
          location: "handler.ts:payload",
          message: "ingest payload shape",
          data: {
            isRaw: Boolean(rawMessage),
            htmlLen: html.length,
            plainLen: plain.length,
            subjectLen: subject?.length ?? 0,
          },
          timestamp: Date.now(),
        }),
      },
    ).catch(() => {});
    // #endregion
    const result = await ingestAgent(html, subject, plain || undefined, rawMessage);

    if (result.done) {
      return NextResponse.json({ ok: true });
    }

    waitUntil(runEvaluationsAndNotify(result.newIds));
    return NextResponse.json({ ok: true });
  } catch (error) {
    // #region agent log
    fetch(
      "http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "80f195",
        },
        body: JSON.stringify({
          sessionId: "80f195",
          runId: "pre-fix",
          hypothesisId: "E",
          location: "handler.ts:catch",
          message: "ingest webhook threw",
          data: {
            errName: error instanceof Error ? error.name : "unknown",
            errMsg: error instanceof Error ? error.message.slice(0, 200) : "",
          },
          timestamp: Date.now(),
        }),
      },
    ).catch(() => {});
    // #endregion
    console.error("Ingest webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
