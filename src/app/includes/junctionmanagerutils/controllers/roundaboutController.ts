import { LightColour } from "../../types/simulation";

export class RoundaboutController {
  id: string;

  private entryKeys: string[];
  private entryIndexByKey = new Map<string, number>();

  private circulatingByEntry = new Map<string, Set<number>>();

  // --- NEW: time + gap acceptance-ish ---
  private now = 0;
  private lastEnteredAtByEntry = new Map<string, number>();

  // --- NEW: grant reservation to avoid jitter/creep ---
  private grantedVehicleByEntry = new Map<string, { vehicleId: number; until: number }>();

  // Tuneables (good starting points)
  private entryClearanceSec = 1.2; // yield if right-entry fed in very recently
  private grantHoldSec = 0.8;      // once granted, hold permission briefly

  constructor(id: string, entryKeys: string[]) {
    this.id = id;
    this.entryKeys = [...new Set(entryKeys)];

    for (const k of this.entryKeys) this.circulatingByEntry.set(k, new Set());
    this.buildEntryOrder();
  }

  update(dt: number) {
    this.now += dt;

    // expire old grants
    for (const [k, g] of this.grantedVehicleByEntry.entries()) {
      if (g.until <= this.now) this.grantedVehicleByEntry.delete(k);
    }
  }

  registerVehicleEntering(vehicleId: number, entryKey: string) {
    const set = this.circulatingByEntry.get(entryKey);
    if (set) set.add(vehicleId);

    // record recent feed-in (for clearance window)
    this.lastEnteredAtByEntry.set(entryKey, this.now);

    // once it entered, release grant for that entry
    const granted = this.grantedVehicleByEntry.get(entryKey);
    if (granted?.vehicleId === vehicleId) this.grantedVehicleByEntry.delete(entryKey);
  }

  registerVehicleExiting(vehicleId: number, entryKey: string) {
    const set = this.circulatingByEntry.get(entryKey);
    if (set) set.delete(vehicleId);
  }

  clearVehicle(vehicleId: number) {
    for (const set of this.circulatingByEntry.values()) set.delete(vehicleId);

    // clear any grants held by this vehicle
    for (const [k, g] of this.grantedVehicleByEntry.entries()) {
      if (g.vehicleId === vehicleId) this.grantedVehicleByEntry.delete(k);
    }
  }

  getTotalCirculating(): number {
    let total = 0;
    for (const s of this.circulatingByEntry.values()) total += s.size;
    return total;
  }

  /**
   * Key change: vehicleId is used for "grant hold"
   */
  canEnter(entryKey: string, vehicleId?: number): boolean {
    if (this.entryKeys.length <= 1) return true;

    // if granted recently for this entry, keep it granted for same vehicle
    if (vehicleId !== undefined) {
      const g = this.grantedVehicleByEntry.get(entryKey);
      if (g && g.vehicleId === vehicleId && g.until > this.now) return true;
    }

    // If nobody circulating, allow
    if (this.getTotalCirculating() === 0) {
      this.maybeGrant(entryKey, vehicleId);
      return true;
    }

    const rightKey = this.getImmediateRightEntry(entryKey);
    if (rightKey) {
      // 1) classic yield: if right entry has circulating vehicles
      const rightCirculating = this.circulatingByEntry.get(rightKey)?.size ?? 0;
      if (rightCirculating > 0) return false;

      // 2) clearance window: if right entry fed a vehicle recently, still yield
      const t = this.lastEnteredAtByEntry.get(rightKey);
      if (typeof t === "number" && (this.now - t) < this.entryClearanceSec) return false;
    }

    // allowed
    this.maybeGrant(entryKey, vehicleId);
    return true;
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
    if (vehicleId === undefined) return;
    // Only set if none exists (avoid ping-pong granting)
    if (!this.grantedVehicleByEntry.has(entryKey)) {
      this.grantedVehicleByEntry.set(entryKey, { vehicleId, until: this.now + this.grantHoldSec });
    }
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
