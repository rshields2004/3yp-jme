/**
 * roundaboutController.ts
 *
 * Position-based gap-acceptance controller for roundabout junctions. Uses
 * actual world positions for gap checking and tracks vehicles per ring lane.
 * Entering vehicles must have a clear gap on ALL circulating lanes since the
 * entry path crosses every ring lane.
 */

import * as THREE from "three";
import { LightColour, SimConfig } from "../../types/simulation";

/**
 * Position-based gap-acceptance controller for roundabout junctions.
 * Tracks circulating vehicles per ring lane and checks entry clearance.
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
            isExiting?: boolean;
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
    private centre = new THREE.Vector3();
    private now = 0;

    // Lane geometry for lane-aware gap checking
    private laneMidRadii: number[] = [];
    private laneWidth = 3.0;

    private readonly getCfg: () => SimConfig;

    private get MIN_GAP_DISTANCE() { return this.getCfg().controllers.roundabout.roundaboutMinGap; }
    private get MIN_TIME_GAP() { return this.getCfg().controllers.roundabout.roundaboutMinTimeGap; }
    private get SAFE_ENTRY_DISTANCE() { return this.getCfg().controllers.roundabout.roundaboutSafeEntryDist; }
    private get ENTRY_TIMEOUT() { return this.getCfg().controllers.roundabout.roundaboutEntryTimeout; }
    private get MIN_ANGULAR_SEPARATION() { return this.getCfg().controllers.roundabout.roundaboutMinAngularSep; }

    /**
     * Create a new roundabout controller.
     * @param id - unique junction ID matching the Three.js group's userData
     * @param entryKeys - distinct entry-group keys that feed into this roundabout
     * @param cfgGetter - accessor returning the current simulation config
     */
    constructor(id: string, entryKeys: string[], cfgGetter: () => SimConfig) {
        this.id = id;
        this.entryKeys = [...new Set(entryKeys)];
        this.getCfg = cfgGetter;
    }

    /**
     * Sets the roundabout centre and optional per-lane mid-radii for gap detection.
     * @param centre - world-space position of the roundabout centre
     * @param laneMidRadii - mid-radius of each ring lane
     */
    setGeometry(centre: THREE.Vector3, laneMidRadii?: number[]): void {
        this.centre.copy(centre);
        if (laneMidRadii && laneMidRadii.length > 0) {
            this.laneMidRadii = [...laneMidRadii];
            if (laneMidRadii.length >= 2) {
                this.laneWidth = Math.abs(
                    laneMidRadii[laneMidRadii.length - 1] - laneMidRadii[0]
                ) / (laneMidRadii.length - 1);
            }
        }
    }

    /**
     * Determines which ring lane a world position is on based on distance from centre.
     *
     * @param position - position identifier or vector
     * @returns the ring-lane index (0 = innermost)
     */
    getLaneIndexForPosition(position: THREE.Vector3): number {
        if (this.laneMidRadii.length <= 1) return 0;
        const dx = position.x - this.centre.x;
        const dz = position.z - this.centre.z;
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

    /**
     * Get the outermost lane radius (vehicles enter through this lane)
     * @returns the outermost ring-lane radius
     */
    getOuterLaneRadius(): number {
        if (this.laneMidRadii.length === 0) return 10;
        return this.laneMidRadii[this.laneMidRadii.length - 1];
    }

    /**
     * Get the outermost lane index
     * @returns the outermost ring-lane index
     */
    getOuterLaneIndex(): number {
        return Math.max(0, this.laneMidRadii.length - 1);
    }

    /**
     * Get lane width
     * @returns the lane width in world units
     */
    getLaneWidth(): number {
        return this.laneWidth;
    }

    /**
     * Advance the internal clock by `dt` seconds.
     *
     * @param dt - time delta in seconds since last frame
     */
    update(dt: number): void {
        this.now += dt;
    }

    /**
     * Update (or insert) a circulating vehicle's position, speed, lane, and heading.
     * @param vehicleId - numeric vehicle identifier
     * @param position - current world position
     * @param speed - current scalar speed
     * @param laneIndex - ring-lane index the vehicle is on
     * @param heading - normalised forward direction
     * @param entryKey - optional entry-group key the vehicle entered from
     */
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
            isExiting: existing?.isExiting
        });
    }

    /**
     * Remove a vehicle from the circulating and entering tracking maps.
     *
     * @param vehicleId - unique identifier of the vehicle
     */
    removeCirculatingVehicle(vehicleId: number): void {
        this.circulating.delete(vehicleId);
        this.entering.delete(vehicleId);
    }

    /**
     * Mark a vehicle as committed to enter the roundabout.
     * Optionally records the entry position for conflicting-entry detection.
     *
     * @param vehicleId - unique identifier of the vehicle
     * @param entryPosition - world-space position of the entry point
     * @param entryKey - string key identifying an entry point
     */
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

    /**
     * Check whether a vehicle has been committed (cleared to enter).
     *
     * @param vehicleId - unique identifier of the vehicle
     * @returns `true` if the vehicle has been committed to enter
     */
    isCommitted(vehicleId: number): boolean {
        return this.committed.has(vehicleId);
    }

    /**
     * Revoke a vehicle's entry commitment.
     *
     * @param vehicleId - unique identifier of the vehicle
     */
    clearCommitment(vehicleId: number): void {
        this.committed.delete(vehicleId);
        this.entering.delete(vehicleId);
    }

    /**
     * Remove a vehicle from all tracking maps (circulating, committed, entering).
     *
     * @param vehicleId - unique identifier of the vehicle
     */
    clearVehicle(vehicleId: number): void {
        this.circulating.delete(vehicleId);
        this.committed.delete(vehicleId);
        this.entering.delete(vehicleId);
    }

    /**
     * Flag a circulating vehicle as currently exiting the roundabout.
     *
     * @param vehicleId - unique identifier of the vehicle
     * @param isExiting - whether the vehicle is currently exiting
     */
    setVehicleExiting(vehicleId: number, isExiting: boolean) {
        const veh = this.circulating.get(vehicleId);
        if (veh) {
            veh.isExiting = isExiting;
        }
    }

    /**
     * Check whether another vehicle from a different arm is already entering
     * at an angular position too close to `entryPosition`.
     *
     * @param entryKey - string key identifying an entry point
     * @param entryPosition - world-space position of the entry point
     * @returns `true` if a conflicting entry exists
     */
    private hasConflictingEntry(entryKey: string, entryPosition: THREE.Vector3): boolean {


        for (const [, info] of this.entering) {
            if (info.entryKey === entryKey) continue;
            if (this.now - info.time > this.ENTRY_TIMEOUT) continue;

            const angle1 = Math.atan2(
                entryPosition.z - this.centre.z,
                entryPosition.x - this.centre.x
            );
            const angle2 = Math.atan2(
                info.position.z - this.centre.z,
                info.position.x - this.centre.x
            );

            let angularDist = Math.abs(angle1 - angle2);
            if (angularDist > Math.PI) angularDist = 2 * Math.PI - angularDist;

            if (angularDist < this.MIN_ANGULAR_SEPARATION) {
                return true;
            }
        }
        return false;
    }

    /**
     * Determine whether a vehicle may safely enter at the given world position,
     * checking all circulating vehicles across every ring lane and detecting
     * conflicting entries from other arms.
     * @param entryPosition - world position where the vehicle would enter
     * @param entryKey - entry-group key of the approaching arm
     * @returns `true` if the gap is sufficient for safe entry
     */
    canEnterSafelyAtPosition(
        entryPosition: THREE.Vector3,
        entryKey?: string
    ): boolean {
        if (entryKey && this.hasConflictingEntry(entryKey, entryPosition)) {
            return false;
        }

        if (this.circulating.size === 0) {
            return true;
        }

        // Entering vehicles cross ALL ring lanes, so every circulating
        // vehicle - inner or outer - must be checked with the full gap
        // threshold.  We also check proximity at each lane radius so that
        // an inner-lane vehicle approaching from the right is detected
        // even when it is far from the outer-lane entry point.

        for (const [vid, info] of this.circulating) {
            // Skip vehicles that entered from the same arm AND are still
            // near the entry (entered within 2s).  Once they've been
            // circulating longer they may have merged across our path.
            if (entryKey && info.entryKey === entryKey
                && (this.now - info.entryTime) < 2.0) continue;
            if (info.isExiting) continue;
            // Distance from the circulating vehicle to the entry point on
            // its OWN lane radius (more accurate than always using the
            // outer-lane entry point, which under-estimates proximity for
            // inner-lane traffic).
            const laneRadius = this.laneMidRadii[info.laneIndex] ?? this.getOuterLaneRadius();
            const laneEntryPos = new THREE.Vector3(
                this.centre.x + Math.cos(Math.atan2(
                    entryPosition.z - this.centre.z,
                    entryPosition.x - this.centre.x
                )) * laneRadius,
                this.centre.y,
                this.centre.z + Math.sin(Math.atan2(
                    entryPosition.z - this.centre.z,
                    entryPosition.x - this.centre.x
                )) * laneRadius
            );

            const distance = info.position.distanceTo(laneEntryPos);

            // Hard minimum gap - no vehicle may be this close regardless of
            // heading or speed.
            if (distance < this.MIN_GAP_DISTANCE) {
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
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Convenience wrapper around {@link canEnterSafelyAtPosition} that derives
     * the entry position from an angle and the outer-lane radius.
     * @param entryAngle - angle (radians) of the entry arm around the roundabout
     * @param radius - fallback radius when lane geometry is unavailable
     * @param entryKey - entry-group key of the approaching arm
     * @returns `true` if the vehicle may enter without conflict
     */
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
            this.centre.x + Math.cos(entryAngle) * effectiveRadius,
            this.centre.y,
            this.centre.z + Math.sin(entryAngle) * effectiveRadius
        );
        return this.canEnterSafelyAtPosition(entryPosition, entryKey);
    }

    /**
     * Compute the world position of the entry point at the given angle and radius.
     *
     * @param entryAngle - angle of the entry point in radians
     * @param radius - radius in world units
     * @returns the computed position vector
     */
    getEntryPosition(entryAngle: number, radius: number): THREE.Vector3 {
        return new THREE.Vector3(
            this.centre.x + Math.cos(entryAngle) * radius,
            this.centre.y,
            this.centre.z + Math.sin(entryAngle) * radius
        );
    }

    /**
     * Register a vehicle as entering the roundabout (alias for {@link commitVehicle}).
     *
     * @param vehicleId - unique identifier of the vehicle
     */
    registerVehicleEntering(vehicleId: number): void {
        this.commitVehicle(vehicleId);
    }

    /**
     * Register a vehicle as exiting the roundabout (alias for {@link clearVehicle}).
     *
     * @param vehicleId - unique identifier of the vehicle
     */
    registerVehicleExiting(vehicleId: number): void {
        this.clearVehicle(vehicleId);
    }

    /**
     * Returns `true` when no vehicles are circulating.
     * @returns `true` when no vehicles are circulating
     */
    isGreen(): boolean {
        return this.circulating.size === 0;
    }

    /**
     * Return `"GREEN"` when the roundabout is empty, otherwise `"AMBER"`.
     * @returns the signal colour string
     */
    getLightColour(): LightColour {
        return this.circulating.size === 0 ? "GREEN" : "AMBER";
    }

    /**
     * Human-readable summary of the controller's current state.
     * @returns a human-readable state summary
     */
    getState(): string {
        return `ROUNDABOUT (${this.circulating.size} circulating, ${this.committed.size} committed)`;
    }

    /**
     * Return the first entry key that currently has a green signal, or `null`.
     * @returns the first green entry key, or `null` if none
     */
    getCurrentGreen(): string | null {
        for (const k of this.entryKeys) {
            if (this.isGreen()) return k;
        }
        return null;
    }
}