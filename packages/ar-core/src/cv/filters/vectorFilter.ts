import { EmaFilter } from "./ema";

export class Vector2Filter {
  private xFilter: EmaFilter;
  private yFilter: EmaFilter;

  constructor(alpha: number) {
    this.xFilter = new EmaFilter(alpha);
    this.yFilter = new EmaFilter(alpha);
  }

  update(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: this.xFilter.update(point.x),
      y: this.yFilter.update(point.y)
    };
  }

  reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
  }
}
