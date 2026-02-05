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
    private readonly SAFE_ENTRY_DISTANCE = 20;   // Check approaching vehicles within this distance
    private readonly ENTRY_TIMEOUT = 2.0;
    private readonly MIN_ANGULAR_SEPARATION = Math.PI / 3;

    constructor(id: string, entryKeys: string[]) {
        this.id = id;
        this.entryKeys = [...new Set(entryKeys)];
    }

    setGeometry(center: THREE.Vector3): void {
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
        
        this.circulating.set(vehicleId, {
            position: position.clone(),
            speed,
            laneIndex,
            heading: heading.clone().normalize(),
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
            return false;
        }

        if (this.circulating.size === 0) {
            return true;
        }

        // When entering a roundabout, the vehicle physically crosses ALL lanes
        // at the entry point, regardless of which lane it will ultimately use.
        // Therefore, we must check ALL circulating vehicles for safety.
        

        // Check ALL circulating vehicles - entry point crosses all lanes
        for (const [vehicleId, info] of this.circulating) {
            const distance = info.position.distanceTo(entryPosition);

           

            if (distance < this.MIN_GAP_DISTANCE) {
               
                return false;
            }

            if (distance < this.SAFE_ENTRY_DISTANCE) {
                const toEntry = new THREE.Vector3().subVectors(entryPosition, info.position);
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

    canEnterSafely(
        entryAngle: number,
        radius: number,
        entryKey?: string
    ): boolean {
        const entryPosition = new THREE.Vector3(
            this.center.x + Math.cos(entryAngle) * radius,
            this.center.y,
            this.center.z + Math.sin(entryAngle) * radius
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
