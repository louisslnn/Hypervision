import { describe, expect, it } from "vitest";

import { applyHomography, computeHomography, invertHomography } from "./homography";

describe("homography", () => {
  it("maps unit square to scaled square", () => {
    const src = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 }
    ];

    const H = computeHomography(src, dst);
    const mid = applyHomography(H, { x: 0.5, y: 0.5 });

    expect(mid.x).toBeCloseTo(1, 5);
    expect(mid.y).toBeCloseTo(1, 5);
  });

  it("inverts correctly", () => {
    const src = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ];
    const dst = [
      { x: 10, y: 20 },
      { x: 110, y: 15 },
      { x: 120, y: 120 },
      { x: 5, y: 100 }
    ];

    const H = computeHomography(src, dst);
    const inv = invertHomography(H);
    const point = applyHomography(H, { x: 0.2, y: 0.7 });
    const back = applyHomography(inv, point);

    expect(back.x).toBeCloseTo(0.2, 3);
    expect(back.y).toBeCloseTo(0.7, 3);
  });
});
