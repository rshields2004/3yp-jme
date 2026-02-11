import * as THREE from "three";
import { LightColour, SimConfig } from "../../types/simulation";

/**
 * RoundaboutController with position-based collision detection.
 *
 * Uses actual world positions for gap checking and tracks vehicles
 * per ring lane. Entering vehicles must have a clear gap on ALL
 * circulating lanes, since the entry path crosses every ring lane.
 */
export class RoundaboutController {
    id: string;

    private circulating = new Map<
        number,
        {
            position: THREE.Vector3;
            speed: number;
            laneIndex: number;
            heading: THREE.Vector3;
            entryKey?: string;
            entryTime: number;
        }
    >();

    private committed = new Set<number>();

    private entering = new Map<
        number,
        {
            position: THREE.Vector3;
            time: number;
            entryKey: string;
        }
    >();

    private entryKeys: string[];
    private center = new THREE.Vector3();
    private now = 0;

    // Lane geometry for lane-aware gap checking
    private laneMidRadii: number[] = [];
    private numLanes = 1;
    private laneWidth = 3.0;

    private readonly getCfg: () => SimConfig;

    private get MIN_GAP_DISTANCE() { return this.getCfg().roundaboutMinGap; }
    private get MIN_TIME_GAP() { return this.getCfg().roundaboutMinTimeGap; }
    private get SAFE_ENTRY_DISTANCE() { return this.getCfg().roundaboutSafeEntryDist; }
    private get ENTRY_TIMEOUT() { return this.getCfg().roundaboutEntryTimeout; }
    private get MIN_ANGULAR_SEPARATION() { return this.getCfg().roundaboutMinAngularSep; }

    constructor(id: string, entryKeys: string[], cfgGetter: () => SimConfig) {
        this.id = id;
        this.entryKeys = [...new Set(entryKeys)];
        this.getCfg = cfgGetter;
    }

    setGeometry(center: THREE.Vector3, laneMidRadii?: number[]): void {
        this.center.copy(center);
        if (laneMidRadii && laneMidRadii.length > 0) {
            this.laneMidRadii = [...laneMidRadii];
            this.numLanes = laneMidRadii.length;
            if (laneMidRadii.length >= 2) {
                this.laneWidth = Math.abs(
                    laneMidRadii[laneMidRadii.length - 1] - laneMidRadii[0]
                ) / (laneMidRadii.length - 1);
            }
        }
    }

    /** Determine which ring lane a world position is on based on distance from center */
    getLaneIndexForPosition(position: THREE.Vector3): number {
        if (this.laneMidRadii.length <= 1) return 0;
        const dx = position.x - this.center.x;
        const dz = position.z - this.center.z;
        const distFromCenter = Math.sqrt(dx * dx + dz * dz);
        let bestLane = 0;
        let bestDist = Infinity;
        for (let i = 0; i < this.laneMidRadii.length; i++) {
            const diff = Math.abs(distFromCenter - this.laneMidRadii[i]);
            if (diff < bestDist) {
                bestDist = diff;
                bestLane = i;
            }
        }
        return bestLane;
    }

    /** Get the outermost lane radius (vehicles enter through this lane) */
    getOuterLaneRadius(): number {
        if (this.laneMidRadii.length === 0) return 10;
        return this.laneMidRadii[this.laneMidRadii.length - 1];
    }

    /** Get the outermost lane index */
    getOuterLaneIndex(): number {
        return Math.max(0, this.laneMidRadii.length - 1);
    }

    /** Get lane width */
    getLaneWidth(): number {
        return this.laneWidth;
    }

    update(dt: number): void {
        this.now += dt;
    }

    updateCirculatingVehicle(
        vehicleId: number,
        position: THREE.Vector3,
        speed: number,
        laneIndex: number,
        heading: THREE.Vector3,
        entryKey?: string
    ): void {
        const existing = this.circulating.get(vehicleId);
        this.circulating.set(vehicleId, {
            position: position.clone(),
            speed,
            laneIndex,
            heading: heading.clone().normalize(),
            entryKey: entryKey ?? existing?.entryKey,
            entryTime: existing?.entryTime ?? this.now,
        });
    }

    removeCirculatingVehicle(vehicleId: number): void {
        this.circulating.delete(vehicleId);
        this.entering.delete(vehicleId);
    }

    commitVehicle(vehicleId: number, entryPosition?: THREE.Vector3, entryKey?: string): void {
        this.committed.add(vehicleId);
        if (entryPosition && entryKey) {
            this.entering.set(vehicleId, {
                position: entryPosition.clone(),
                time: this.now,
                entryKey,
            });
        }
    }

    isCommitted(vehicleId: number): boolean {
        return this.committed.has(vehicleId);
    }

    clearCommitment(vehicleId: number): void {
        this.committed.delete(vehicleId);
        this.entering.delete(vehicleId);
    }

    clearVehicle(vehicleId: number): void {
        this.circulating.delete(vehicleId);
        this.committed.delete(vehicleId);
        this.entering.delete(vehicleId);
    }

    private hasConflictingEntry(entryKey: string, entryPosition: THREE.Vector3): boolean {


        for (const [, info] of this.entering) {
            if (info.entryKey === entryKey) continue;
            if (this.now - info.time > this.ENTRY_TIMEOUT) continue;

            const angle1 = Math.atan2(
                entryPosition.z - this.center.z,
                entryPosition.x - this.center.x
            );
            const angle2 = Math.atan2(
                info.position.z - this.center.z,
                info.position.x - this.center.x
            );

            let angularDist = Math.abs(angle1 - angle2);
            if (angularDist > Math.PI) angularDist = 2 * Math.PI - angularDist;

            if (angularDist < this.MIN_ANGULAR_SEPARATION) {
                return true;
            }
        }
        return false;
    }

    canEnterSafelyAtPosition(
        entryPosition: THREE.Vector3,
        entryKey?: string
    ): boolean {
        if (entryKey && this.hasConflictingEntry(entryKey, entryPosition)) {
            if (this.now < 30) console.log(`[GapCheck] ${entryKey}: BLOCKED by conflictingEntry`);
            return false;
        }

        if (this.circulating.size === 0) {
            return true;
        }

        // Entering vehicles cross ALL ring lanes, so every circulating
        // vehicle — inner or outer — must be checked with the full gap
        // threshold.  We also check proximity at each lane radius so that
        // an inner-lane vehicle approaching from the right is detected
        // even when it is far from the outer-lane entry point.

        for (const [vid, info] of this.circulating) {
            // Skip vehicles that entered from the same arm AND are still
            // near the entry (entered within 2s).  Once they've been
            // circulating longer they may have merged across our path.
            if (entryKey && info.entryKey === entryKey
                && (this.now - info.entryTime) < 2.0) continue;

            // Distance from the circulating vehicle to the entry point on
            // its OWN lane radius (more accurate than always using the
            // outer-lane entry point, which under-estimates proximity for
            // inner-lane traffic).
            const laneRadius = this.laneMidRadii[info.laneIndex] ?? this.getOuterLaneRadius();
            const laneEntryPos = new THREE.Vector3(
                this.center.x + Math.cos(Math.atan2(
                    entryPosition.z - this.center.z,
                    entryPosition.x - this.center.x
                )) * laneRadius,
                this.center.y,
                this.center.z + Math.sin(Math.atan2(
                    entryPosition.z - this.center.z,
                    entryPosition.x - this.center.x
                )) * laneRadius
            );

            const distance = info.position.distanceTo(laneEntryPos);

            // Hard minimum gap — no vehicle may be this close regardless of
            // heading or speed.
            if (distance < this.MIN_GAP_DISTANCE) {
                if (this.now < 30) console.log(`[GapCheck] ${entryKey}: BLOCKED by v${vid} minGap dist=${distance.toFixed(1)} < ${this.MIN_GAP_DISTANCE} lane=${info.laneIndex} speed=${info.speed.toFixed(1)}`);
                return false;
            }

            // Time-gap check: is this vehicle heading toward the crossing
            // point and will arrive within MIN_TIME_GAP seconds?
            if (distance < this.SAFE_ENTRY_DISTANCE) {
                const toEntry = new THREE.Vector3().subVectors(laneEntryPos, info.position);
                const dotProduct = toEntry.dot(info.heading);

                if (dotProduct > 0) {
                    const timeToReach = distance / Math.max(0.5, info.speed);
                    if (timeToReach < this.MIN_TIME_GAP) {
                        if (this.now < 30) console.log(`[GapCheck] ${entryKey}: BLOCKED by v${vid} timeGap dist=${distance.toFixed(1)} ttr=${timeToReach.toFixed(1)} < ${this.MIN_TIME_GAP} speed=${info.speed.toFixed(1)}`);
                        return false;
                    }
                }
            }
        }

        return true;
    }

    canEnterSafely(
        entryAngle: number,
        radius: number,
        entryKey?: string
    ): boolean {
        // Use the outer lane radius for the entry position since that is where
        // the entering vehicle physically crosses circulating traffic.
        const outerRadius = this.getOuterLaneRadius();
        const effectiveRadius = outerRadius > 0 ? outerRadius : radius;
        const entryPosition = new THREE.Vector3(
            this.center.x + Math.cos(entryAngle) * effectiveRadius,
            this.center.y,
            this.center.z + Math.sin(entryAngle) * effectiveRadius
        );
        return this.canEnterSafelyAtPosition(entryPosition, entryKey);
    }

    getEntryPosition(entryAngle: number, radius: number): THREE.Vector3 {
        return new THREE.Vector3(
            this.center.x + Math.cos(entryAngle) * radius,
            this.center.y,
            this.center.z + Math.sin(entryAngle) * radius
        );
    }

    registerVehicleEntering(vehicleId: number): void {
        this.commitVehicle(vehicleId);
    }

    registerVehicleExiting(vehicleId: number): void {
        this.clearVehicle(vehicleId);
    }

    isGreen(): boolean {
        return this.circulating.size === 0;
    }

    getLightColour(): LightColour {
        return this.circulating.size === 0 ? "GREEN" : "AMBER";
    }

    getState(): string {
        return `ROUNDABOUT (${this.circulating.size} circulating, ${this.committed.size} committed)`;
    }

    getCurrentGreen(): string | null {
        for (const k of this.entryKeys) {
            if (this.isGreen()) return k;
        }
        return null;
    }
}
