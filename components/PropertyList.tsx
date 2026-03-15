"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Star } from "lucide-react";
import type { Listing } from "@/lib/types";

type PropertyListProps = {
  listings: Listing[];
  loading?: boolean;
  onAddFavourite?: (listing: Listing) => void;
  isFavourite?: (url: string) => boolean;
  onRemoveFavourite?: (url: string) => void;
  highlightedId?: string | number | null;
  onHighlight?: (id: string | number | null) => void;
};

function formatPrice(p: unknown): string {
  if (p == null) return "—";
  if (typeof p === "number") return `£${p.toLocaleString()}`;
  return String(p);
}

export function PropertyList({
  listings,
  loading,
  onAddFavourite,
  isFavourite,
  onRemoveFavourite,
  highlightedId,
  onHighlight,
}: PropertyListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!listings.length) {
    return (
      <p className="text-muted-foreground text-sm">No properties. Run a search or pick a saved search.</p>
    );
  }

  return (
    <ul className="space-y-3 list-none p-0 m-0">
      {listings.map((listing) => {
        const url = listing.url || (listing.id ? `https://www.rightmove.co.uk/properties/${listing.id}` : "");
        const id = String(listing.id ?? url);
        const highlighted = highlightedId != null && String(highlightedId) === id;
        const fav = url ? isFavourite?.(url) : false;

        return (
          <li key={id}>
            <Card
              className={highlighted ? "ring-2 ring-primary" : ""}
              onMouseEnter={() => onHighlight?.(id)}
              onMouseLeave={() => onHighlight?.(null)}
            >
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start gap-2">
                  <span className="font-semibold text-lg">
                    {formatPrice(listing.price)}
                  </span>
                  {url && (
                    <>
                      {fav && onRemoveFavourite ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemoveFavourite(url)}
                          title="Remove from favourites"
                        >
                          <Star className="h-4 w-4 fill-primary text-primary" />
                        </Button>
                      ) : onAddFavourite ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onAddFavourite(listing)}
                          title="Add to favourites"
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {(listing.address as string) || "—"} · {String(listing.number_of_bedrooms ?? listing.bedrooms ?? "—")} bed
                  {(listing.type as string) ? ` · ${listing.type}` : ""}
                </p>
              </CardHeader>
              <CardContent className="pb-2">
                {url ? (
                  <Link
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    View on Rightmove
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
