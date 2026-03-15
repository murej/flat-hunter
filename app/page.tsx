"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchForm } from "@/components/SearchForm";
import { PropertyList } from "@/components/PropertyList";
import { MapView } from "@/components/MapView";
import { toast } from "sonner";
import type { Listing, SavedSearch } from "@/lib/types";

type FavouriteWithId = { id: number; property_url: string; snapshot_json: unknown };

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("search");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [favourites, setFavourites] = useState<FavouriteWithId[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | number | null>(null);

  const loadSavedSearches = useCallback(() => {
    fetch("/api/saved-searches")
      .then((r) => r.json())
      .then(setSavedSearches)
      .catch(() => {});
  }, []);

  const loadFavourites = useCallback(() => {
    fetch("/api/favourites")
      .then((r) => r.json())
      .then(setFavourites)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSavedSearches();
    loadFavourites();
  }, [loadSavedSearches, loadFavourites]);

  const handleSearch = useCallback((url: string) => {
    setLoading(true);
    setListings([]);
    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rightmoveUrl: url }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setListings(data.results ?? []);
        setActiveTab("search");
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Search failed");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSearchBySaved = useCallback((savedSearchId: number) => {
    setLoading(true);
    setListings([]);
    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ savedSearchId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setListings(data.results ?? []);
        setActiveTab("search");
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Search failed");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSaveSearch = useCallback(
    (name: string, url: string) => {
      fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      })
        .then((r) => r.json())
        .then(() => {
          toast.success("Search saved");
          loadSavedSearches();
        })
        .catch(() => toast.error("Failed to save search"));
    },
    [loadSavedSearches]
  );

  const handleAddFavourite = useCallback(
    (listing: Listing) => {
      const url = listing.url || (listing.id ? `https://www.rightmove.co.uk/properties/${listing.id}` : "");
      if (!url) return;
      fetch("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_url: url, snapshot: listing }),
      })
        .then((r) => r.json())
        .then(() => {
          toast.success("Added to favourites");
          loadFavourites();
        })
        .catch(() => toast.error("Failed to add favourite"));
    },
    [loadFavourites]
  );

  const handleRemoveFavourite = useCallback(
    (propertyUrl: string) => {
      fetch(`/api/favourites?url=${encodeURIComponent(propertyUrl)}`, {
        method: "DELETE",
      })
        .then((r) => r.json())
        .then(() => {
          toast.success("Removed from favourites");
          loadFavourites();
        })
        .catch(() => toast.error("Failed to remove"));
    },
    [loadFavourites]
  );

  const favouriteUrls = new Set(favourites.map((f) => f.property_url));
  const favouriteListings: Listing[] = favourites.map((f) => ({
    ...(typeof f.snapshot_json === "object" && f.snapshot_json != null
      ? (f.snapshot_json as Listing)
      : {}),
    url: f.property_url,
    favouriteId: f.id,
  }));

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Flat Hunter</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="saved">Saved searches</TabsTrigger>
          <TabsTrigger value="favourites">Favourites</TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Search Rightmove</CardTitle>
            </CardHeader>
            <CardContent>
              <SearchForm
                onSearch={handleSearch}
                onSaveSearch={handleSaveSearch}
                loading={loading}
              />
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h2 className="font-semibold">Results</h2>
              <PropertyList
                listings={listings}
                loading={loading}
                onAddFavourite={handleAddFavourite}
                isFavourite={(url) => favouriteUrls.has(url)}
                onRemoveFavourite={handleRemoveFavourite}
                highlightedId={highlightedId}
                onHighlight={setHighlightedId}
              />
            </div>
            <div className="space-y-2">
              <h2 className="font-semibold">Map</h2>
              <MapView
                listings={listings}
                highlightedId={highlightedId}
                onHighlight={setHighlightedId}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="saved" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Saved searches</CardTitle>
            </CardHeader>
            <CardContent>
              {savedSearches.length === 0 ? (
                <p className="text-muted-foreground text-sm">No saved searches. Run a search and click &quot;Save this search&quot;.</p>
              ) : (
                <ul className="space-y-2 list-none p-0">
                  {savedSearches.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={() => handleSearchBySaved(s.id)}
                      >
                        {s.name}
                      </button>
                      <span className="text-muted-foreground text-sm truncate max-w-xs">{s.url}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="favourites" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h2 className="font-semibold">Favourites</h2>
              <PropertyList
                listings={favouriteListings}
                isFavourite={() => true}
                onRemoveFavourite={handleRemoveFavourite}
                highlightedId={highlightedId}
                onHighlight={setHighlightedId}
              />
            </div>
            <div className="space-y-2">
              <h2 className="font-semibold">Map</h2>
              <MapView
                listings={favouriteListings}
                highlightedId={highlightedId}
                onHighlight={setHighlightedId}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
