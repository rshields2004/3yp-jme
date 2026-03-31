/**
 * roundaboutUtils.ts
 *
 * Pure string utility helpers for roundabout lane keys. These are stateless
 * and do not depend on controller instances.
 *
 * @param laneKey - string key identifying a specific lane
 * @returns `true` if the condition holds
 */

// LANE KEY UTILITIES

/**
 * Returns `true` when the given lane key refers to a shared roundabout lane.
 *
 * @param laneKey - The lane-occupancy key to test.
 * @returns `true` if the condition holds
 */
export const isRoundaboutLaneKey = (laneKey: string): boolean => {
    return laneKey.startsWith("lane:roundabout:");
};

/**
 * Extracts the junction ID from a roundabout lane key.
 *
 * @param laneKey - A lane key in the form `"lane:roundabout:<UUID>"`.
 * @returns The UUID portion of the key.
 * @example roundaboutIdFromLaneKey("lane:roundabout:abc-123") // "abc-123"
 */
export const roundaboutIdFromLaneKey = (laneKey: string): string => {
    return laneKey.replace("lane:roundabout:", "");
};
