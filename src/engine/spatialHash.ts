/**
 * Uniform-grid broadphase. Entities are re-inserted every frame; queries return
 * candidates whose cells overlap the query circle. O(n) build, ~O(1) query.
 */
export interface HashItem {
  x: number;
  y: number;
  radius: number;
  /** Scratch field used for query de-duplication. */
  hashMark: number;
}

export class SpatialHash<T extends HashItem> {
  private readonly cells = new Map<number, T[]>();
  private readonly pool: T[][] = [];
  private readonly result: T[] = [];
  private stamp = 0;

  constructor(private readonly cellSize: number) {}

  private key(cx: number, cy: number): number {
    // Pack two signed 16-bit cell coords into one int.
    return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);
  }

  clear(): void {
    for (const bucket of this.cells.values()) {
      bucket.length = 0;
      this.pool.push(bucket);
    }
    this.cells.clear();
  }

  insert(item: T): void {
    const cs = this.cellSize;
    const x0 = Math.floor((item.x - item.radius) / cs);
    const x1 = Math.floor((item.x + item.radius) / cs);
    const y0 = Math.floor((item.y - item.radius) / cs);
    const y1 = Math.floor((item.y + item.radius) / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = this.pool.pop() ?? [];
          this.cells.set(k, bucket);
        }
        bucket.push(item);
      }
    }
  }

  /** Returns a shared array — copy it if you need to keep it. */
  query(x: number, y: number, radius: number): readonly T[] {
    const out = this.result;
    out.length = 0;
    this.stamp++;
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const y0 = Math.floor((y - radius) / cs);
    const y1 = Math.floor((y + radius) / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const item of bucket) {
          if (item.hashMark === this.stamp) continue;
          item.hashMark = this.stamp;
          out.push(item);
        }
      }
    }
    return out;
  }
}
