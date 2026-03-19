import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { ingestAgent } from "./index";
import { runEvaluationsAndNotify } from "./tools";

export async function handleIngestWebhook(
  req: NextRequest,
): Promise<NextResponse> {
  const t0 = Date.now();
  // #region agent log
  (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/handler.ts:handleIngestWebhook',message:'webhook entry',data:{t0},hypothesisId:'H1',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
  // #endregion
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
    const t1 = Date.now();
    // #region agent log
    (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/handler.ts:afterIngestAgent',message:'ingestAgent completed',data:{t1,ingestMs:t1-t0,done:result.done,newIdsLen:result.done?0:result.newIds.length},hypothesisId:'H1,H2',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
    // #endregion

    if (result.done) {
      return NextResponse.json({ ok: true });
    }

    waitUntil(runEvaluationsAndNotify(result.newIds));
    // #region agent log
    (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/handler.ts:beforeReturn',message:'returning 200, waitUntil scheduled',data:{t2:Date.now(),totalMs:Date.now()-t0},hypothesisId:'H2',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
    // #endregion
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Ingest webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
