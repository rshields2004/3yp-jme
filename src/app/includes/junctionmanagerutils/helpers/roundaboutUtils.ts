/**
 * Pure string utility helpers for roundabout lane keys.
 * These are stateless and do not depend on controller instances.
 */

/** Returns true when the given lane key refers to a roundabout lane. */
export function isRoundaboutLaneKey(laneKey: string): boolean {
    return laneKey.startsWith("lane:roundabout:");
}

/**
 * Extracts the object ID from a lane key for a roundabout.
 * @example `"lane:roundabout:UUID"` → `"UUID"`
 */
export function roundaboutIdFromLaneKey(laneKey: string): string {
    return laneKey.replace("lane:roundabout:", "");
}
