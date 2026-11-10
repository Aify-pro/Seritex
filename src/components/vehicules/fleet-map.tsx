"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import { ABIDJAN } from "@/components/delivery/place-map";

export interface FleetMapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  detail: string;
  /** en_route (vert), arret (bleu), muet (gris), alerte (rouge) */
  etat: "en_route" | "arret" | "muet" | "alerte";
  href?: string;
}

const COLORS: Record<FleetMapPoint["etat"], string> = {
  en_route: "#16a34a",
  arret: "#2563eb",
  muet: "#9ca3af",
  alerte: "#dc2626",
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * Carte du parc (VEH-5) : dernière position FreeTrack de chaque véhicule,
 * couleur selon son état, fiche au clic. Leaflet est chargé côté navigateur.
 */
export function FleetMap({ points, height = 480 }: { points: FleetMapPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const pointsRef = useRef(points);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView([ABIDJAN.lat, ABIDJAN.lng], 11);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; contributeurs OpenStreetMap" }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      draw(L, map, layerRef.current, pointsRef.current, true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    pointsRef.current = points;
    if (!mapRef.current) return;
    void import("leaflet").then((L) => draw(L, mapRef.current, layerRef.current, points, false));
  }, [points]);

  return <div ref={containerRef} style={{ height }} className="z-0 w-full overflow-hidden rounded-md border border-border" />;
}

function draw(L: typeof import("leaflet"), map: LeafletMap | null, layer: LayerGroup | null, pts: FleetMapPoint[], fit: boolean) {
  if (!map || !layer) return;
  layer.clearLayers();
  for (const p of pts) {
    const html = `<strong>${escapeHtml(p.label)}</strong><br/>${escapeHtml(p.detail)}${p.href ? `<br/><a href="${escapeHtml(p.href)}">Ouvrir la fiche</a>` : ""}`;
    L.circleMarker([p.lat, p.lng], { radius: 9, color: "#ffffff", weight: 2, fillColor: COLORS[p.etat], fillOpacity: 0.95 })
      .bindTooltip(escapeHtml(p.label), { direction: "top", offset: [0, -8] })
      .bindPopup(html)
      .addTo(layer);
  }
  if (fit && pts.length > 0) {
    map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 14 });
  }
}
