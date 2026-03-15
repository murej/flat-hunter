import { NextRequest, NextResponse } from "next/server";
import { listSavedSearches, setCachedResults } from "@/lib/db";
import { scrapeRightmove } from "@/lib/scrape";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searches = await listSavedSearches();
    for (const search of searches) {
      try {
        const results = await scrapeRightmove(search.url);
        await setCachedResults(search.id, results);
      } catch (e) {
        console.error(`Refresh failed for saved search ${search.id}:`, e);
      }
    }
    return NextResponse.json({ ok: true, count: searches.length });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to refresh saved searches" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
