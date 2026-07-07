/**
 * Headlessly renders PNGs for zones displayed in "contours" mode, reusing the
 * exact ContourPlot rendering used in the live app -- instead of having the
 * server approximate it in matplotlib -- for inclusion in the ZIP export.
 * Used by both ExportModal and ZoneStatsPanel's export-all action.
 */

import { mount, unmount } from 'svelte';
import ContourPlot from '$lib/components/ContourPlot.svelte';
import type { CalcZone, RoomConfig, ZoneResult } from '$lib/types/project';
import { doseConversionFactor, totalHours } from './calculations';
import { computeShouldFlipV, computePlaneBounds, computeDisplayDims, computeValueUnits } from './planePlotGeometry';

/**
 * Renders one PNG per enabled, calculated Plane zone with display_mode
 * "contours". Returns a map of zone name -> PNG blob, matching the filename
 * convention (`${zone.name}.png`) the server's ZIP export already uses.
 */
export async function renderContourZonePngs(
  zones: CalcZone[],
  zoneResults: Record<string, ZoneResult> | undefined,
  room: RoomConfig,
  units: string
): Promise<Record<string, Blob>> {
  const pngs: Record<string, Blob> = {};
  if (!zoneResults) return pngs;

  const contourZones = zones.filter(
    (z) => z.type === 'plane' && z.enabled !== false && z.display_mode === 'contours'
  );
  if (contourZones.length === 0) return pngs;

  // Off-screen container -- rendered so canvas/layout math works normally,
  // but invisible and out of the tab order.
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '0';
  container.style.width = '0';
  container.style.height = '0';
  container.style.overflow = 'hidden';
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';
  document.body.appendChild(container);

  try {
    for (const zone of contourZones) {
      const result = zoneResults[zone.id];
      if (!result?.values) continue;

      const zoneName = zone.name || zone.id;
      const factor = doseConversionFactor(
        zone.dose ?? false,
        totalHours(zone.hours ?? 8, zone.minutes ?? 0, zone.seconds ?? 0),
        result.doseAtCalcTime,
        result.hoursAtCalcTime
      );
      const bounds = computePlaneBounds(zone, room);

      let instance: Record<string, unknown> | null = null;
      try {
        instance = mount(ContourPlot, {
          target: container,
          props: {
            values: result.values as number[][],
            zone,
            room,
            valueFactor: factor,
            units,
            valueUnits: computeValueUnits(zone),
            displayDims: computeDisplayDims(bounds),
            bounds,
            shouldFlipV: computeShouldFlipV(zone)
          }
        }) as unknown as Record<string, unknown>;

        const getPNGBlob = instance.getPNGBlob as (() => Promise<Blob>) | undefined;
        if (getPNGBlob) {
          pngs[zoneName] = await getPNGBlob();
        }
      } catch (e) {
        console.error(`Failed to render contour PNG for zone "${zoneName}":`, e);
      } finally {
        if (instance) unmount(instance as never);
      }
    }
  } finally {
    container.remove();
  }

  return pngs;
}

/** Converts a Blob to a base64 string (no data: URI prefix) for JSON transport. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
