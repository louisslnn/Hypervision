export class EmaFilter {
  private alpha: number;
  private current: number | undefined;

  constructor(alpha: number) {
    this.alpha = alpha;
  }

  update(value: number): number {
    if (this.current === undefined) {
      this.current = value;
      return value;
    }
    this.current = this.current + this.alpha * (value - this.current);
    return this.current;
  }

  reset(): void {
    this.current = undefined;
  }
}
