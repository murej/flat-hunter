import { NextRequest, NextResponse } from "next/server";
import {
  listSavedSearches,
  createSavedSearch,
  deleteSavedSearch,
} from "@/lib/db";

export async function GET() {
  try {
    const list = await listSavedSearches();
    return NextResponse.json(list);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to list saved searches" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = body?.name as string | undefined;
    const url = body?.url as string | undefined;
    if (!name?.trim() || !url?.trim()) {
      return NextResponse.json(
        { error: "name and url required" },
        { status: 400 }
      );
    }
    const created = await createSavedSearch(name.trim(), url.trim());
    return NextResponse.json(created);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to create saved search" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id == null) {
      return NextResponse.json(
        { error: "id query required" },
        { status: 400 }
      );
    }
    const num = parseInt(id, 10);
    if (Number.isNaN(num)) {
      return NextResponse.json({ error: "id must be a number" }, { status: 400 });
    }
    await deleteSavedSearch(num);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to delete saved search" },
      { status: 500 }
    );
  }
}
