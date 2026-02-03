import * as THREE from "three";
import { LightColour } from "../../types/simulation";

/**
 * RoundaboutController with position-based collision detection.
 *
 * Uses actual world positions for gap checking and tracks vehicles
 * entering from different entry points to prevent simultaneous entry
 * from adjacent entries while allowing opposite entries to proceed.
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

    private readonly MIN_GAP_DISTANCE = 2;       // Minimum distance to any circulating vehicle
    private readonly MIN_TIME_GAP = 2.0;         // Seconds buffer for approaching vehicles
    private readonly SAFE_ENTRY_DISTANCE = 10;   // Check approaching vehicles within this distance
    private readonly DEBUG = false;              // Disable debug logging
    private readonly COLLISION_THRESHOLD = 3.0;  // Distance below which we consider it a collision

    constructor(id: string, entryKeys: string[]) {
        this.id = id;
        this.entryKeys = [...new Set(entryKeys)];
    }

    setGeometry(center: THREE.Vector3, _radius: number): void {
        this.center.copy(center);
    }

    update(dt: number): void {
        this.now += dt;
    }

    updateCirculatingVehicle(
        vehicleId: number,
        position: THREE.Vector3,
        speed: number,
        laneIndex: number,
        heading: THREE.Vector3
    ): void {
        const isNew = !this.circulating.has(vehicleId);
        
        this.circulating.set(vehicleId, {
            position: position.clone(),
            speed,
            laneIndex,
            heading: heading.clone().normalize(),
        });

        if (this.DEBUG && isNew) {
            console.log(`🚗 Vehicle ${vehicleId} ENTERED roundabout ${this.id}`, {
                laneIndex,
                position: { x: position.x.toFixed(2), z: position.z.toFixed(2) },
                speed: speed.toFixed(2),
                totalCirculating: this.circulating.size,
            });
        }
    }

    removeCirculatingVehicle(vehicleId: number): void {
        if (this.DEBUG && this.circulating.has(vehicleId)) {
            const info = this.circulating.get(vehicleId);
            console.log(`🚗 Vehicle ${vehicleId} EXITED roundabout ${this.id}`, {
                laneIndex: info?.laneIndex,
                totalCirculating: this.circulating.size - 1,
            });
        }
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
        const ENTRY_TIMEOUT = 2.0;
        const MIN_ANGULAR_SEPARATION = Math.PI / 2;

        for (const [, info] of this.entering) {
            if (info.entryKey === entryKey) continue;
            if (this.now - info.time > ENTRY_TIMEOUT) continue;

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

            if (angularDist < MIN_ANGULAR_SEPARATION) {
                return true;
            }
        }
        return false;
    }

    canEnterSafelyAtPosition(
        entryPosition: THREE.Vector3,
        entryLaneIndex: number,
        _entrySpeed: number,
        entryKey?: string,
        totalCirculatingLanes: number = 2
    ): boolean {
        if (entryKey && this.hasConflictingEntry(entryKey, entryPosition)) {
            if (this.DEBUG) {
                console.log(`⛔ Entry blocked: conflicting entry from ${entryKey}`);
            }
            return false;
        }

        if (this.circulating.size === 0) {
            if (this.DEBUG) {
                console.log(`✅ Entry allowed: no circulating vehicles`);
            }
            return true;
        }

        // When entering a roundabout, the vehicle physically crosses ALL lanes
        // at the entry point, regardless of which lane it will ultimately use.
        // Therefore, we must check ALL circulating vehicles for safety.
        if (this.DEBUG) {
            console.log(`🔍 Entry check: entryLane=${entryLaneIndex}, totalCircLanes=${totalCirculatingLanes}, checking ALL lanes`);
            console.log(`   Circulating vehicles:`, Array.from(this.circulating.entries()).map(([id, info]) => ({
                id,
                laneIndex: info.laneIndex,
                pos: { x: info.position.x.toFixed(1), z: info.position.z.toFixed(1) }
            })));
        }

        // Check ALL circulating vehicles - entry point crosses all lanes
        for (const [vehicleId, info] of this.circulating) {
            const distance = info.position.distanceTo(entryPosition);

            if (this.DEBUG) {
                console.log(`   🚗 Checking vehicle ${vehicleId}: lane=${info.laneIndex}, distance=${distance.toFixed(2)}`);
            }

            if (distance < this.MIN_GAP_DISTANCE) {
                if (this.DEBUG) {
                    console.log(`   ⛔ Entry blocked: vehicle ${vehicleId} too close (${distance.toFixed(2)} < ${this.MIN_GAP_DISTANCE})`);
                }
                return false;
            }

            if (distance < this.SAFE_ENTRY_DISTANCE) {
                const toEntry = new THREE.Vector3().subVectors(entryPosition, info.position);
                const dotProduct = toEntry.dot(info.heading);

                if (dotProduct > 0) {
                    const timeToReach = distance / Math.max(0.5, info.speed);
                    if (timeToReach < this.MIN_TIME_GAP) {
                        if (this.DEBUG) {
                            console.log(`   ⛔ Entry blocked: vehicle ${vehicleId} approaching (timeToReach=${timeToReach.toFixed(2)} < ${this.MIN_TIME_GAP})`);
                        }
                        return false;
                    }
                }
            }
        }

        if (this.DEBUG) {
            console.log(`   ✅ Entry allowed`);
        }
        return true;
    }

    canEnterSafely(
        entryAngle: number,
        entryLaneIndex: number,
        entrySpeed: number,
        radius: number,
        entryKey?: string,
        totalCirculatingLanes: number = 2
    ): boolean {
        const entryPosition = new THREE.Vector3(
            this.center.x + Math.cos(entryAngle) * radius,
            this.center.y,
            this.center.z + Math.sin(entryAngle) * radius
        );
        return this.canEnterSafelyAtPosition(entryPosition, entryLaneIndex, entrySpeed, entryKey, totalCirculatingLanes);
    }

    getEntryPosition(entryAngle: number, radius: number): THREE.Vector3 {
        return new THREE.Vector3(
            this.center.x + Math.cos(entryAngle) * radius,
            this.center.y,
            this.center.z + Math.sin(entryAngle) * radius
        );
    }

    registerVehicleEntering(vehicleId: number, _entryKey: string): void {
        this.commitVehicle(vehicleId);
    }

    registerVehicleExiting(vehicleId: number, _entryKey: string): void {
        this.clearVehicle(vehicleId);
    }

    isGreen(_entryKey: string): boolean {
        return this.circulating.size === 0;
    }

    getLightColour(_entryKey: string): LightColour {
        return this.circulating.size === 0 ? "GREEN" : "AMBER";
    }

    getState(): string {
        return `ROUNDABOUT (${this.circulating.size} circulating, ${this.committed.size} committed)`;
    }

    getCurrentGreen(): string | null {
        for (const k of this.entryKeys) {
            if (this.isGreen(k)) return k;
        }
        return null;
    }
}
