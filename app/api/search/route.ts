import { NextRequest, NextResponse } from "next/server";
import { scrapeRightmove } from "@/lib/scrape";
import {
  getCachedResults,
  setCachedResults,
} from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rightmoveUrl = body?.rightmoveUrl as string | undefined;
    const savedSearchId = body?.savedSearchId as number | undefined;

    if (savedSearchId != null) {
      const cached = await getCachedResults(savedSearchId);
      if (cached != null && Array.isArray(cached)) {
        return NextResponse.json({ results: cached });
      }
      // Need the URL for this saved search to scrape
      const { listSavedSearches } = await import("@/lib/db");
      const searches = await listSavedSearches();
      const search = searches.find((s) => s.id === savedSearchId);
      if (!search) {
        return NextResponse.json(
          { error: "Saved search not found" },
          { status: 404 }
        );
      }
      const results = await scrapeRightmove(search.url);
      await setCachedResults(savedSearchId, results);
      return NextResponse.json({ results });
    }

    if (!rightmoveUrl || typeof rightmoveUrl !== "string") {
      return NextResponse.json(
        { error: "Provide rightmoveUrl or savedSearchId" },
        { status: 400 }
      );
    }

    const results = await scrapeRightmove(rightmoveUrl);
    return NextResponse.json({ results });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
