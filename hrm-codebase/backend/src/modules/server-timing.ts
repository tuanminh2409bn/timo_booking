import { performance } from "node:perf_hooks";

export type ServerTimingMark = {
  name: string;
  durMs: number;
  desc?: string;
};

/**
 * Collects per-phase latency marks for a single request and renders them both as
 * a standard `Server-Timing` response header and as a flat object for structured logs.
 *
 * Used to break down hot paths (e.g. signin: verify / db / jwt) so optimization work
 * can be measured instead of guessed.
 */
export class ServerTiming {
  private readonly marks: ServerTimingMark[] = [];

  private normalizeName(name: string): string {
    const normalizedName = name.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    return normalizedName || "phase";
  }

  private normalizeDescription(description: string): string {
    return description.replace(/[";,=\r\n]/g, " ").replace(/\s+/g, " ").trim();
  }

  async measure<T>(name: string, fn: () => Promise<T>, desc?: string): Promise<T> {
    const start = performance.now();

    try {
      return await fn();
    } finally {
      this.add(name, performance.now() - start, desc);
    }
  }

  measureSync<T>(name: string, fn: () => T, desc?: string): T {
    const start = performance.now();

    try {
      return fn();
    } finally {
      this.add(name, performance.now() - start, desc);
    }
  }

  add(name: string, durMs: number, desc?: string): void {
    const normalizedDuration = Number.isFinite(durMs) ? Math.max(0, durMs) : 0;
    this.marks.push({
      name: this.normalizeName(name),
      durMs: Math.round(normalizedDuration * 10) / 10,
      ...(desc !== undefined && { desc: this.normalizeDescription(desc) }),
    });
  }

  /** Renders the `Server-Timing` header value, e.g. `verify;dur=520, db;dur=95`. */
  header(): string {
    return this.marks
      .map((mark) => {
        const segments = [mark.name];

        if (mark.desc) {
          segments.push(`desc="${mark.desc}"`);
        }

        segments.push(`dur=${mark.durMs}`);

        return segments.join(";");
      })
      .join(", ");
  }

  /** Flat `{ name: durMs }` map for structured logging. */
  toObject(): Record<string, number> {
    return Object.fromEntries(this.marks.map((mark) => [mark.name, mark.durMs]));
  }
}
