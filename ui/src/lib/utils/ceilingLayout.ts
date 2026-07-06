/**
 * Ceiling tile grid generation and room-polygon clipping.
 * Shared by the 2D Ceiling Designer (routes/ceiling) and the 3D room view
 * (Room3D.svelte) so the two stay in agreement for non-rectangular rooms.
 */

import type { CeilingLayout } from '$lib/types/project';

export type Point = [number, number];

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** X-ranges (bottom/top) or Y-ranges (left/right) of tile-boundary segments that survive clipping to the room polygon. */
export interface ClippedTileEdges {
  bottom: [number, number][]; // along y = tile.y
  top: [number, number][];    // along y = tile.y + tile.h
  left: [number, number][];   // along x = tile.x
  right: [number, number][];  // along x = tile.x + tile.w
}

export interface ClippedTile {
  poly: Point[];
  edges: ClippedTileEdges;
}

const METERS_PER_FOOT = 0.3048;
const EPS = 1e-6;

/** Tile width/height in room units, derived from tile size + direction + unit system. */
export function getTileDimsMeters(
  layout: Pick<CeilingLayout, 'tileSize' | 'tileDirection'>,
  units: 'meters' | 'feet'
): { w: number; h: number } {
  let w_ft = 2;
  let h_ft = 2;
  if (layout.tileSize === '4x2') {
    if (layout.tileDirection === 'x') {
      w_ft = 4;
      h_ft = 2;
    } else {
      w_ft = 2;
      h_ft = 4;
    }
  }
  const factor = units === 'meters' ? METERS_PER_FOOT : 1;
  return { w: w_ft * factor, h: h_ft * factor };
}

/**
 * Full rectangular tile grid covering the room's bounding box, anchored at
 * the configured start corner. Not clipped to the (possibly concave) room
 * polygon — callers are responsible for clipping/masking as appropriate.
 */
export function generateTileGrid(
  layout: Pick<CeilingLayout, 'tileSize' | 'startCorner'>,
  tileDims: { w: number; h: number },
  polygonPoints: Point[],
  roomX: number,
  roomY: number
): Tile[] {
  if (layout.tileSize === 'none') return [];
  const tw = tileDims.w;
  const th = tileDims.h;
  if (tw <= 0 || th <= 0) return [];

  const xs = polygonPoints.map((p) => p[0]);
  const ys = polygonPoints.map((p) => p[1]);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, roomX);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, roomY);

  const roomWidth = maxX - minX;
  const roomHeight = maxY - minY;

  const cols = Math.ceil(roomWidth / tw) + 1;
  const rows = Math.ceil(roomHeight / th) + 1;

  let startX = minX;
  let startY = minY;

  if (layout.startCorner === 'top-right' || layout.startCorner === 'bottom-right') {
    const totalWidth = cols * tw;
    startX = maxX - totalWidth;
  }
  if (layout.startCorner === 'top-left' || layout.startCorner === 'top-right') {
    const totalHeight = rows * th;
    startY = maxY - totalHeight;
  }

  const list: Tile[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      list.push({ x: startX + c * tw, y: startY + r * th, w: tw, h: th });
    }
  }
  return list;
}

function lerpX(a: Point, b: Point, x: number): Point {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}

function lerpY(a: Point, b: Point, y: number): Point {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

function clipHalfPlane(poly: Point[], inside: (p: Point) => boolean, intersect: (a: Point, b: Point) => Point): Point[] {
  if (poly.length === 0) return [];
  const result: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const currIn = inside(curr);
    const prevIn = inside(prev);
    if (currIn) {
      if (!prevIn) result.push(intersect(prev, curr));
      result.push(curr);
    } else if (prevIn) {
      result.push(intersect(prev, curr));
    }
  }
  return result;
}

/**
 * Sutherland-Hodgman clip of `subject` against the rectangle `rect`.
 * `rect` (the clip window) must be convex, which an axis-aligned rectangle
 * always is; `subject` (the room polygon) may be concave as long as it's a
 * simple polygon.
 */
export function clipPolygonToRect(subject: Point[], rect: Tile): Point[] {
  if (!subject || subject.length < 3) return [];
  const x0 = rect.x;
  const x1 = rect.x + rect.w;
  const y0 = rect.y;
  const y1 = rect.y + rect.h;

  let poly = subject;
  poly = clipHalfPlane(poly, (p) => p[0] >= x0 - EPS, (a, b) => lerpX(a, b, x0));
  poly = clipHalfPlane(poly, (p) => p[0] <= x1 + EPS, (a, b) => lerpX(a, b, x1));
  poly = clipHalfPlane(poly, (p) => p[1] >= y0 - EPS, (a, b) => lerpY(a, b, y0));
  poly = clipHalfPlane(poly, (p) => p[1] <= y1 + EPS, (a, b) => lerpY(a, b, y1));
  return poly;
}

/**
 * Clips one tile to the room polygon boundary. Returns `null` if the tile
 * has no overlap with the room at all. When `roomPolygon` is absent (plain
 * rectangular room), the tile is returned whole with its 4 full edges.
 */
export function clipTileToRoom(tile: Tile, roomPolygon: Point[] | undefined): ClippedTile | null {
  const x0 = tile.x;
  const x1 = tile.x + tile.w;
  const y0 = tile.y;
  const y1 = tile.y + tile.h;

  if (!roomPolygon || roomPolygon.length < 3) {
    return {
      poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
      edges: {
        bottom: [[x0, x1]],
        top: [[x0, x1]],
        left: [[y0, y1]],
        right: [[y0, y1]],
      },
    };
  }

  const clipped = clipPolygonToRect(roomPolygon, tile);
  if (clipped.length < 3) return null;

  const edges: ClippedTileEdges = { bottom: [], top: [], left: [], right: [] };
  const n = clipped.length;
  for (let i = 0; i < n; i++) {
    const a = clipped[i];
    const b = clipped[(i + 1) % n];
    if (Math.abs(a[1] - y0) < EPS && Math.abs(b[1] - y0) < EPS) {
      edges.bottom.push([Math.min(a[0], b[0]), Math.max(a[0], b[0])]);
    } else if (Math.abs(a[1] - y1) < EPS && Math.abs(b[1] - y1) < EPS) {
      edges.top.push([Math.min(a[0], b[0]), Math.max(a[0], b[0])]);
    } else if (Math.abs(a[0] - x0) < EPS && Math.abs(b[0] - x0) < EPS) {
      edges.left.push([Math.min(a[1], b[1]), Math.max(a[1], b[1])]);
    } else if (Math.abs(a[0] - x1) < EPS && Math.abs(b[0] - x1) < EPS) {
      edges.right.push([Math.min(a[1], b[1]), Math.max(a[1], b[1])]);
    }
    // else: segment runs along the room's actual wall inside this tile — the
    // wall/room outline mesh already draws it, so it's intentionally skipped here.
  }

  return { poly: clipped, edges };
}
