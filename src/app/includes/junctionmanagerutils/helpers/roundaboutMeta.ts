import * as THREE from "three";
import { RingLaneStructure } from "../../types/roundabout";

export interface RoundaboutMeta {
    center: THREE.Vector3;
    laneMidRadii: number[];
    maxStrip: number;
    entryAngles: Map<string, number>;
    avgRadius: number;
}

/**
 * Build roundabout metadata (radii, center, entry angles).
 * Returns null if required geometry is missing.
 */
export function buildRoundaboutMeta(
    junctionKey: string,
    junctionGroup?: THREE.Group
): RoundaboutMeta | null {
    const ringStructure = junctionGroup?.userData?.roundaboutRingStructure as RingLaneStructure[] | undefined;
    if (!ringStructure || ringStructure.length === 0) return null;

    const maxStrip = Math.max(0, ringStructure.length - 2);
    const laneMidRadii: number[] = [];

    for (let i = 0; i <= maxStrip; i++) {
        const inner = ringStructure[i]?.radius ?? 0;
        const outer = ringStructure[i + 1]?.radius ?? inner;
        laneMidRadii[i] = (inner + outer) * 0.5;
    }

    const center = new THREE.Vector3();
    junctionGroup?.getWorldPosition(center);

    const entryAngles = new Map<string, number>();
    const exits = junctionGroup?.userData?.roundaboutExitStructure as { angle: number }[] | undefined;
    if (exits) {
        for (let i = 0; i < exits.length; i++) {
            const entryKey = `entry:${junctionKey}-${i}-in`;
            entryAngles.set(entryKey, exits[i]?.angle ?? 0);
        }
    }

    const avgRadius = laneMidRadii.length > 0
        ? laneMidRadii.reduce((a, b) => a + b, 0) / laneMidRadii.length
        : 10;

    return { center, laneMidRadii, maxStrip, entryAngles, avgRadius };
}

export function isRoundaboutType(junctionKey: string, junctionType?: string): boolean {
    const key = junctionKey.toLowerCase();
    return junctionType === "roundabout" || key.includes("roundabout") || key.includes("rndbt");
}
