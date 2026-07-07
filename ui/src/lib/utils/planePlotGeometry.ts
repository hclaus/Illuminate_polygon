/**
 * Plane-zone plot geometry: axis bounds, display size, and orientation.
 * Shared by CalcPlanePlotModal (interactive view) and ExportModal (headless
 * PNG rendering for ZIP export) so the two never compute this differently.
 */

import type { CalcZone, RoomConfig } from '$lib/types/project';

export interface PlaneBounds {
  u1: number;
  u2: number;
  v1: number;
  v2: number;
  fixed: number;
  uLabel: string;
  vLabel: string;
  fixedLabel: string;
}

export interface DisplayDims {
  width: number;
  height: number;
}

const MAX_DISPLAY_WIDTH = 550;
const MAX_DISPLAY_HEIGHT = 400;

/** Whether the V axis should be flipped so positive points up on screen. */
export function computeShouldFlipV(zone: CalcZone): boolean {
  if (zone.v_positive_direction != null) {
    return zone.v_positive_direction;
  }
  const direction = zone.direction ?? 1;
  const refSurface = zone.ref_surface || 'xy';
  if (refSurface === 'xz') {
    return direction < 0;
  }
  return direction > 0;
}

/** Plane bounds in room-unit coordinates, based on the zone's reference surface. */
export function computePlaneBounds(zone: CalcZone, room: RoomConfig): PlaneBounds {
  const refSurface = zone.ref_surface || 'xy';
  const height = zone.height ?? 0;
  switch (refSurface) {
    case 'xz':
      return {
        u1: zone.x1 ?? 0,
        u2: zone.x2 ?? room.x,
        v1: zone.z_min ?? 0,
        v2: zone.z_max ?? room.z,
        fixed: height,
        uLabel: 'X',
        vLabel: 'Z',
        fixedLabel: 'Y'
      };
    case 'yz':
      return {
        u1: zone.y1 ?? 0,
        u2: zone.y2 ?? room.y,
        v1: zone.z_min ?? 0,
        v2: zone.z_max ?? room.z,
        fixed: height,
        uLabel: 'Y',
        vLabel: 'Z',
        fixedLabel: 'X'
      };
    case 'xy':
    default:
      return {
        u1: zone.x1 ?? 0,
        u2: zone.x2 ?? room.x,
        v1: zone.y1 ?? 0,
        v2: zone.y2 ?? room.y,
        fixed: height,
        uLabel: 'X',
        vLabel: 'Y',
        fixedLabel: 'Z'
      };
  }
}

/** Display pixel size fitting the plane's physical aspect ratio within a max box. */
export function computeDisplayDims(bounds: PlaneBounds): DisplayDims {
  const aspectRatio = (bounds.u2 - bounds.u1) / (bounds.v2 - bounds.v1);
  let width = MAX_DISPLAY_WIDTH;
  let height = width / aspectRatio;
  if (height > MAX_DISPLAY_HEIGHT) {
    height = MAX_DISPLAY_HEIGHT;
    width = height * aspectRatio;
  }
  return { width, height };
}

/** Value units string for a zone (dose vs. instantaneous irradiance). */
export function computeValueUnits(zone: CalcZone): string {
  return zone.dose ? 'mJ/cm²' : 'µW/cm²';
}
