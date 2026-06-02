import fs from "node:fs";
import path from "node:path";

interface WatermarkFile {
  lastRunIso: string;
}

export class Watermark {
  private file: string;

  constructor(stateDir: string) {
    this.file = path.join(stateDir, "watermark.json");
  }

  /** Returns the last successful run time, or null on first run. */
  read(): Date | null {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw) as WatermarkFile;
      const d = new Date(parsed.lastRunIso);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }

  /** Persist only AFTER a fully successful write phase. */
  write(when: Date): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const payload: WatermarkFile = { lastRunIso: when.toISOString() };
    fs.writeFileSync(this.file, JSON.stringify(payload, null, 2), "utf8");
  }
}
