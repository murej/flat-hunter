import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  computeIdempotencyKey,
  claimIdempotencyKey,
  parseVerificationEmail,
  parseEmailHtml,
  deduplicateAndStore,
  enqueueOneOffMessage,
  runEvaluationsAndNotify,
  type IngestResult,
} from "./tools";

export type { IngestResult, RawListing } from "./tools";
export {
  computeIdempotencyKey,
  claimIdempotencyKey,
  runEvaluationsAndNotify,
} from "./tools";

export async function ingestAgent(
  html: string,
  subject?: string,
  plain?: string,
): Promise<IngestResult> {
  const key = computeIdempotencyKey(html, subject);
  const claimed = await claimIdempotencyKey(key);
  if (!claimed) {
    return { done: true };
  }

  // Check verification first (saves listing-parse call for verification emails)
  const verification = await parseVerificationEmail(html, subject, plain);
  if (verification.isVerification) {
    if (verification.verificationUrl) {
      await enqueueOneOffMessage(
        `📬 New subscription detected. Please click the link below to verify your email:\n\n${verification.verificationUrl}`,
        { parse_mode: false },
      );
    } else if (verification.verificationCode) {
      await enqueueOneOffMessage(
        `📬 New subscription detected. Your verification code is: *${verification.verificationCode}*\n\nEnter it on the verification page to activate your alerts.`,
      );
    } else {
      await enqueueOneOffMessage(
        "📬 This looks like a verification email. Please check your inbox and click the verification link (or enter the code) to activate your alerts.",
      );
    }
    return { done: true };
  }

  const listings = await parseEmailHtml(html);

  if (listings.length === 0) {
    await enqueueOneOffMessage(
      "Couldn't find any listings in this email — it may not be a property alert, or the format wasn't recognized.",
    );
    return { done: true };
  }

  const newIds = await deduplicateAndStore(listings);

  if (newIds.length === 0) {
    await enqueueOneOffMessage(
      "📬 Email alert processed — no new properties (all were duplicates).",
    );
    return { done: true };
  }

  return { done: false, newIds };
}

export async function handleIngestWebhook(
  req: NextRequest,
): Promise<NextResponse> {
  try {
    const body = await req.json();

    if (process.env.CLOUDMAILIN_SECRET) {
      const authHeader = req.headers.get("authorization") ?? "";
      const base64 = authHeader.replace(/^Basic\s+/i, "");
      const decoded = Buffer.from(base64, "base64").toString("utf8");
      const password = decoded.split(":").slice(1).join(":");
      if (password !== process.env.CLOUDMAILIN_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Support both flat and normalized CloudMailin formats
    const html = body.html ?? body.body?.html ?? "";
    const plain = body.plain ?? body.body?.plain ?? "";
    const subject = (body.subject ??
      body.headers?.subject ??
      body.headers?.Subject) as string | undefined;
    const result = await ingestAgent(
      html || plain,
      subject,
      plain || undefined,
    );

    if (result.done) {
      return NextResponse.json({ ok: true });
    }

    waitUntil(runEvaluationsAndNotify(result.newIds));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Ingest webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
