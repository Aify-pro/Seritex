"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";

/** Centre par défaut : Abidjan (Plateau). */
export const ABIDJAN = { lat: 5.3237, lng: -4.0168 };

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Point mis en avant (lieu en cours d'édition). */
  highlight?: boolean;
}

/**
 * Carte OpenStreetMap (Leaflet) des lieux de livraison. Leaflet touche à
 * `window` : il est chargé dans un effet, côté navigateur uniquement. Les
 * épingles sont des cercles (pas d'images à servir). `onPick` : un clic sur
 * la carte pose l'épingle du lieu en cours d'édition.
 */
export function PlaceMap({
  points,
  onPick,
  height = 280,
}: {
  points: MapPoint[];
  onPick?: (lat: number, lng: number) => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const onPickRef = useRef(onPick);
  const pointsRef = useRef(points);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // Création de la carte, une seule fois.
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView([ABIDJAN.lat, ABIDJAN.lng], 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; contributeurs OpenStreetMap",
      }).addTo(map);
      map.on("click", (e) => onPickRef.current?.(e.latlng.lat, e.latlng.lng));
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      drawPoints(L, map, layerRef.current, pointsRef.current);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Épingles à jour à chaque changement de points.
  useEffect(() => {
    pointsRef.current = points;
    if (!mapRef.current) return;
    void import("leaflet").then((L) => drawPoints(L, mapRef.current, layerRef.current, points));
  }, [points]);

  return <div ref={containerRef} style={{ height }} className="z-0 w-full overflow-hidden rounded-md border border-border" />;
}

function drawPoints(L: typeof import("leaflet"), map: LeafletMap | null, layer: LayerGroup | null, pts: MapPoint[]) {
  if (!map || !layer) return;
  layer.clearLayers();
  for (const p of pts) {
    L.circleMarker([p.lat, p.lng], {
      radius: p.highlight ? 9 : 7,
      color: p.highlight ? "#dc2626" : "#1d4ed8",
      weight: 2,
      fillOpacity: 0.6,
    })
      .bindTooltip(p.label)
      .addTo(layer);
  }
  const focus = pts.find((p) => p.highlight) ?? (pts.length === 1 ? pts[0] : null);
  if (focus) map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 15));
  else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [24, 24] });
}

