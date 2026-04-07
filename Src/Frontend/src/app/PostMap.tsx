"use client";

import { useEffect, useRef } from "react";

export type MapPost = {
  id: string;
  text: string;
  latitude: number;
  longitude: number;
  location?: string | null;
  created_at: string;
};

interface PostMapProps {
  posts: MapPost[];
  highlightId?: string;
}

export default function PostMap({ posts, highlightId }: PostMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Dynamically import leaflet to avoid SSR issues
    import("leaflet").then((L) => {
      // Fix default icon paths broken by webpack
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [20, 0],
        zoom: 2,
        scrollWheelZoom: true,
      });

      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      const highlightIcon = new L.Icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
        className: "hue-rotate-[120deg]",
      });

      const bounds: [number, number][] = [];

      for (const post of posts) {
        const icon = post.id === highlightId ? highlightIcon : undefined;
        const marker = icon
          ? L.marker([post.latitude, post.longitude], { icon })
          : L.marker([post.latitude, post.longitude]);

        const when = new Date(post.created_at);
        const whenLabel = Number.isFinite(when.getTime()) ? when.toLocaleString() : post.created_at;
        const snippet = post.text.length > 120 ? post.text.slice(0, 120) + "…" : post.text;

        marker.bindPopup(
          `<div style="max-width:220px;font-size:13px;line-height:1.5">
            <div style="margin-bottom:4px">${snippet}</div>
            ${post.location ? `<div style="color:#6b7280;font-size:11px">${post.location}</div>` : ""}
            <div style="color:#9ca3af;font-size:11px;margin-top:2px">${whenLabel}</div>
          </div>`
        );

        marker.addTo(map);
        bounds.push([post.latitude, post.longitude]);
      }

      if (bounds.length === 1) {
        map.setView(bounds[0], 10);
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers when posts change after initial mount
  useEffect(() => {
    if (!mapRef.current || posts.length === 0) return;
    // Map is already initialized; markers added on init are sufficient for MVP.
    // Full re-render would require tracking marker refs, out of scope here.
  }, [posts]);

  return (
    <>
      {/* Leaflet CSS */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <div
        ref={containerRef}
        style={{ height: "400px", width: "100%", borderRadius: "1rem", overflow: "hidden" }}
      />
    </>
  );
}
