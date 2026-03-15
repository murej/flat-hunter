import { NextRequest, NextResponse } from "next/server";
import {
  listFavourites,
  addFavourite,
  removeFavourite,
  removeFavouriteByUrl,
} from "@/lib/db";

export async function GET() {
  try {
    const list = await listFavourites();
    return NextResponse.json(list);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to list favourites" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const property_url = body?.property_url as string | undefined;
    const snapshot = body?.snapshot;
    if (!property_url?.trim()) {
      return NextResponse.json(
        { error: "property_url required" },
        { status: 400 }
      );
    }
    const created = await addFavourite(property_url.trim(), snapshot ?? {});
    return NextResponse.json(created);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to add favourite" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const url = searchParams.get("url");
    if (id != null) {
      const num = parseInt(id, 10);
      if (Number.isNaN(num)) {
        return NextResponse.json(
          { error: "id must be a number" },
          { status: 400 }
        );
      }
      await removeFavourite(num);
    } else if (url != null) {
      await removeFavouriteByUrl(url);
    } else {
      return NextResponse.json(
        { error: "id or url query required" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to remove favourite" },
      { status: 500 }
    );
  }
}
