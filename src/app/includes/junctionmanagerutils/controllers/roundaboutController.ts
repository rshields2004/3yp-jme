import { LightColour } from "../../types/simulation";

export class RoundaboutController {
  id: string;

  private entryKeys: string[];
  private entryIndexByKey = new Map<string, number>();

  private circulatingByEntry = new Map<string, Set<number>>();

  private now = 0;
  private lastEnteredAtByEntry = new Map<string, number>();
  private lastGrantedEntry: string | null = null; // Track which entry was last granted

  // Tuneables
  private entryClearanceSec = 0.5; // Time to wait after a vehicle enters before allowing another
  private minCirculationTime = 0.3; // Minimum time a vehicle should spend circulating before yielding

  constructor(id: string, entryKeys: string[]) {
    this.id = id;
    this.entryKeys = [...new Set(entryKeys)];

    for (const k of this.entryKeys) this.circulatingByEntry.set(k, new Set());
    this.buildEntryOrder();
  }

  update(dt: number) {
    this.now += dt;
  }

  registerVehicleEntering(vehicleId: number, entryKey: string) {
    const set = this.circulatingByEntry.get(entryKey);
    if (set) set.add(vehicleId);

    // record recent feed-in (for clearance window)
    this.lastEnteredAtByEntry.set(entryKey, this.now);
  }

  registerVehicleExiting(vehicleId: number, entryKey: string) {
    const set = this.circulatingByEntry.get(entryKey);
    if (set) set.delete(vehicleId);
  }

  clearVehicle(vehicleId: number) {
    for (const set of this.circulatingByEntry.values()) set.delete(vehicleId);
  }

  getTotalCirculating(): number {
    let total = 0;
    for (const s of this.circulatingByEntry.values()) total += s.size;
    return total;
  }

  /**
   * Simplified entry check: basic right-of-way with entry throttling
   */
  canEnter(entryKey: string, vehicleId?: number): boolean {
    // Single entry or no other traffic - always allow
    if (this.entryKeys.length <= 1 || this.getTotalCirculating() === 0) {
      return true;
    }

    // Throttle entries: don't allow if someone just entered recently
    const timeSinceLastEntry = this.now - Math.max(...Array.from(this.lastEnteredAtByEntry.values() ?? []));
    if (timeSinceLastEntry < this.entryClearanceSec) {
      return false;
    }

    // Multiple entries with traffic: basic right-of-way check
    const rightKey = this.getImmediateRightEntry(entryKey);
    if (rightKey) {
      const rightCirculating = this.circulatingByEntry.get(rightKey)?.size ?? 0;
      if (rightCirculating > 0) {
        return false; // Yield to right
      }
    }

    return true; // Allow
  }

  /**
   * For vehicle manager: calls canEnter with vehicleId
   */
  canEnterWithVehicle(entryKey: string, vehicleId: number): boolean {
    return this.canEnter(entryKey, vehicleId);
  }

  isGreen(entryKey: string): boolean {
    // for compatibility; for correct behaviour use canEnter(entryKey, vehicleId) from VehicleManager
    return this.canEnter(entryKey);
  }

  canNewVehicleEnter(entryKey: string): boolean {
    return this.canEnter(entryKey);
  }

  getLightColour(entryKey: string): LightColour {
    return this.canEnter(entryKey) ? "GREEN" : "AMBER";
  }

  getState(): string {
    return `ROUNDABOUT (${this.getTotalCirculating()} circulating)`;
  }

  getCurrentGreen(): string | null {
    for (const k of this.entryKeys) if (this.canEnter(k)) return k;
    return null;
  }

  getEntryLanes(): string[] {
    return [...this.entryKeys];
  }

  private maybeGrant(entryKey: string, vehicleId?: number) {
    // No longer used
  }

  private buildEntryOrder() {
    const withExit = this.entryKeys
      .map((k) => ({ k, exit: this.parseExitIndex(k) }))
      .sort((a, b) => {
        const ae = a.exit, be = b.exit;
        if (ae === null && be === null) return 0;
        if (ae === null) return 1;
        if (be === null) return -1;
        return ae - be;
      });

    this.entryKeys = withExit.map((x) => x.k);
    this.entryIndexByKey.clear();
    this.entryKeys.forEach((k, i) => this.entryIndexByKey.set(k, i));
  }

  private getImmediateRightEntry(entryKey: string): string | null {
    const i = this.entryIndexByKey.get(entryKey);
    if (i === undefined) return null;
    const n = this.entryKeys.length;
    const rightIndex = (i - 1 + n) % n;
    return this.entryKeys[rightIndex] ?? null;
  }

  private parseExitIndex(entryKey: string): number | null {
    const raw = entryKey.startsWith("entry:") ? entryKey.slice(6) : entryKey;
    const parts = raw.split("-");
    if (parts.length < 7) return null;
    const exitStr = parts[5];
    const exitNum = Number(exitStr);
    return Number.isFinite(exitNum) ? exitNum : null;
  }
}
