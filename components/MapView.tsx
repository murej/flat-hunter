"use client";

import { useEffect, useRef, useState } from "react";
import type { Listing } from "@/lib/types";

type MapViewProps = {
  listings: Listing[];
  centre?: [number, number];
  zoom?: number;
  highlightedId?: string | number | null;
  onHighlight?: (id: string | number | null) => void;
};

const UK_CENTRE: [number, number] = [51.5, -0.12];
const DEFAULT_ZOOM = 10;

function getCoords(listing: Listing): [number, number] | null {
  const lat = listing.latitude ?? listing.lat;
  const lon = listing.longitude ?? listing.lon ?? listing.lng;
  if (typeof lat === "number" && typeof lon === "number") {
    return [lat, lon];
  }
  return null;
}

export function MapView({
  listings,
  centre = UK_CENTRE,
  zoom = DEFAULT_ZOOM,
  onHighlight,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<import("leaflet").Marker[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || typeof window === "undefined" || !mapRef.current) return;
    import("leaflet").then((L) => {
      if (mapInstanceRef.current) return;
      const map = L.default.map(mapRef.current!).setView(centre, zoom);
      L.default.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
      }).addTo(map);
      mapInstanceRef.current = map;
    });
  }, [mounted, centre, zoom]);

  useEffect(() => {
    if (!mounted) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    void import("leaflet").then((L) => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const points: [number, number][] = [];
      listings.forEach((listing) => {
        const coords = getCoords(listing);
        if (!coords) return;
        points.push(coords);
        const id = String(listing.id ?? listing.url ?? "");
        const marker = L.default
          .marker(coords)
          .addTo(map)
          .on("click", () => onHighlight?.(id))
          .bindPopup(
            `<strong>${listing.price ?? ""}</strong><br/>${(listing.address as string) ?? ""}`
          );
        markersRef.current.push(marker);
      });

      if (points.length > 0) {
        const bounds = L.default.latLngBounds(points);
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 14 });
      }
    });
  }, [mounted, listings, onHighlight]);

  if (!mounted) {
    return (
      <div className="w-full h-[400px] rounded-md border bg-muted animate-pulse" aria-label="Map loading" />
    );
  }

  return (
    <div
      ref={mapRef}
      className="w-full h-[400px] rounded-md border bg-muted"
      aria-label="Map"
    />
  );
}
