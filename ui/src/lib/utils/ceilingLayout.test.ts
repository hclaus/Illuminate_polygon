/**
 * Tests for ceiling tile grid generation and room-polygon clipping.
 */

import { describe, it, expect } from 'vitest';
import {
  getTileDimsMeters,
  generateTileGrid,
  clipPolygonToRect,
  clipTileToRoom,
  type Point,
} from './ceilingLayout';

// Same L-shaped/notched room polygon as "new test polygon w ceiling1.guv":
// excludes the region x in (1.5, 2.5], y in [0, 1.5).
const NOTCHED_ROOM: Point[] = [
  [1.5, 0],
  [1.5, 1.5],
  [2.5, 1.5],
  [2.5, 4],
  [0, 4],
  [0, 0],
];

function shoelaceArea(poly: Point[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

describe('getTileDimsMeters', () => {
  it('returns square tile dims for 2x2 regardless of direction', () => {
    expect(getTileDimsMeters({ tileSize: '2x2', tileDirection: 'x' }, 'feet')).toEqual({ w: 2, h: 2 });
    expect(getTileDimsMeters({ tileSize: '2x2', tileDirection: 'y' }, 'feet')).toEqual({ w: 2, h: 2 });
  });

  it('orients 4x2 tiles by tileDirection', () => {
    expect(getTileDimsMeters({ tileSize: '4x2', tileDirection: 'x' }, 'feet')).toEqual({ w: 4, h: 2 });
    expect(getTileDimsMeters({ tileSize: '4x2', tileDirection: 'y' }, 'feet')).toEqual({ w: 2, h: 4 });
  });

  it('converts feet to meters', () => {
    const dims = getTileDimsMeters({ tileSize: '2x2', tileDirection: 'x' }, 'meters');
    expect(dims.w).toBeCloseTo(0.6096, 4);
    expect(dims.h).toBeCloseTo(0.6096, 4);
  });
});

describe('generateTileGrid', () => {
  it('covers a rectangular room bounding box, anchored at the start corner', () => {
    const polygonPoints: Point[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const tiles = generateTileGrid(
      { tileSize: '2x2', startCorner: 'top-left' },
      { w: 2, h: 2 },
      polygonPoints,
      4,
      4
    );
    // cols = ceil(4/2)+1 = 3, rows = ceil(4/2)+1 = 3
    expect(tiles.length).toBe(9);
    // top-left: x starts at minX (0), y anchored so the grid's top aligns with maxY
    expect(tiles).toContainEqual({ x: 0, y: -2, w: 2, h: 2 });
    expect(tiles).toContainEqual({ x: 2, y: 2, w: 2, h: 2 });
  });

  it('returns an empty grid when tileSize is none', () => {
    const tiles = generateTileGrid(
      { tileSize: 'none', startCorner: 'top-left' },
      { w: 2, h: 2 },
      [[0, 0], [4, 0], [4, 4], [0, 4]],
      4,
      4
    );
    expect(tiles).toEqual([]);
  });
});

describe('clipPolygonToRect', () => {
  it('clips a concave subject polygon against a convex rectangle', () => {
    const clipped = clipPolygonToRect(NOTCHED_ROOM, { x: 0, y: 0, w: 1, h: 1 });
    // Fully inside the non-notched part of the room -> unclipped area is the full 1x1 rect
    expect(shoelaceArea(clipped)).toBeCloseTo(1, 6);
  });
});

describe('clipTileToRoom', () => {
  it('returns the full tile with all 4 edges when there is no room polygon (rectangular room)', () => {
    const result = clipTileToRoom({ x: 1, y: 1, w: 2, h: 2 }, undefined);
    expect(result).not.toBeNull();
    expect(result!.edges.bottom).toEqual([[1, 3]]);
    expect(result!.edges.top).toEqual([[1, 3]]);
    expect(result!.edges.left).toEqual([[1, 3]]);
    expect(result!.edges.right).toEqual([[1, 3]]);
  });

  it('returns null for a tile fully inside the notch (fully outside the room)', () => {
    // x in (1.5,2.5], y in [0,1.5) is excluded from NOTCHED_ROOM
    const result = clipTileToRoom({ x: 1.6, y: 0.2, w: 0.2, h: 0.2 }, NOTCHED_ROOM);
    expect(result).toBeNull();
  });

  it('trims a tile straddling the notch boundary instead of dropping or keeping it whole', () => {
    // Centroid (1.55, 1.45) falls inside the excluded notch, so the old
    // whole-tile centroid test would have dropped this tile entirely — but
    // most of the tile (the y >= 1.5 sliver) is actually inside the room.
    const tile = { x: 1.4, y: 1.3, w: 0.3, h: 0.3 };
    const result = clipTileToRoom(tile, NOTCHED_ROOM);
    expect(result).not.toBeNull();
    const area = shoelaceArea(result!.poly);
    // Valid area = full tile (0.09) minus the notch overlap (0.2*0.2=0.04) = 0.05
    expect(area).toBeCloseTo(0.05, 6);
    expect(area).toBeLessThan(tile.w * tile.h);
    expect(area).toBeGreaterThan(0);
  });

  it('fully includes a tile entirely within the non-notched area', () => {
    const tile = { x: 0.2, y: 2, w: 1, h: 1 };
    const result = clipTileToRoom(tile, NOTCHED_ROOM);
    expect(result).not.toBeNull();
    expect(shoelaceArea(result!.poly)).toBeCloseTo(1, 6);
    expect(result!.edges.bottom).toEqual([[0.2, 1.2]]);
    expect(result!.edges.top).toEqual([[0.2, 1.2]]);
    expect(result!.edges.left).toEqual([[2, 3]]);
    expect(result!.edges.right).toEqual([[2, 3]]);
  });
});
