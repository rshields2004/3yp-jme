/**
 * segmentHelpers.ts
 *
 * Pure utility functions for working with route segments: building unique
 * identifiers, computing polyline lengths, and deriving lane keys for the
 * lane-occupancy tracker.
 */

import { Node, NodeKey, RouteSegment, Tuple3 } from "../../types/simulation";
import { RoundaboutController } from "../controllers/roundaboutController";

// SEGMENT IDENTIFICATION

/**
 * Creates a unique string identifier for a route segment by combining
 * its phase, origin node, and destination node.
 *
 * @param seg - The route segment to identify.
 * @returns A deterministic `phase|from|to` key string.
 */
export const segmentId = (seg: RouteSegment): string => {
    const fromKey = `${seg.from.structureID}-${seg.from.exitIndex}-${seg.from.direction}-${seg.from.laneIndex}`;
    const toKey = `${seg.to.structureID}-${seg.to.exitIndex}-${seg.to.direction}-${seg.to.laneIndex}`;
    return `${seg.phase}|${fromKey}|${toKey}`;
};

/**
 * Computes the polyline length of a segment's point list.
 *
 * @param seg - The route segment whose points to measure.
 * @returns Total Euclidean length along the polyline, or `0` if fewer than 2 points.
 */
export const segmentLength = (seg: RouteSegment): number => {
    if (!seg.points || seg.points.length < 2) return 0;
    let length = 0;
    for (let i = 1; i < seg.points.length; i++) {
        const dx = seg.points[i][0] - seg.points[i - 1][0];
        const dy = seg.points[i][1] - seg.points[i - 1][1];
        const dz = seg.points[i][2] - seg.points[i - 1][2];
        length += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return length;
};

// NODE KEYS

/**
 * Builds a canonical {@link NodeKey} string from a {@link Node}.
 *
 * @param node - The graph node.
 * @returns A hyphen-separated key: `structureID-exitIndex-direction-laneIndex`.
 */
export const nodeKeyOf = (node: Node): NodeKey => {
    return `${node.structureID}-${node.exitIndex}-${node.direction}-${node.laneIndex}`;
};

// POLYLINE LENGTH

/**
 * Computes the total Euclidean length of an arbitrary 3-D polyline.
 *
 * @param points - Ordered array of `[x, y, z]` tuples.
 * @returns Cumulative distance along the polyline, or `0` if fewer than 2 points.
 */
export const polylineLength = (points: Tuple3[]): number => {
    if (!points || points.length < 2) return 0;
    let length = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i][0] - points[i - 1][0];
        const dy = points[i][1] - points[i - 1][1];
        const dz = points[i][2] - points[i - 1][2];
        length += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return length;
};

// LANE KEYS

/**
 * Derives the lane-occupancy key for a given route segment.
 *
 * Roundabout `"inside"` segments share a single key per roundabout because
 * vehicles cross ring lanes during gradual merges, so per-ring-lane keys
 * would be inaccurate. Normal intersection `"inside"` segments return an
 * empty string (ignored by the occupancy tracker).
 *
 * @param seg - The route segment.
 * @param roundaboutControllers - Map of active roundabout controllers, keyed by junction ID.
 * @returns A lane key string, or `""` if the segment should be ignored.
 */
export const laneKeyForSegment = (
    seg: RouteSegment,
    roundaboutControllers: Map<string, RoundaboutController>,
): string => {
    if (seg.phase === "inside") {
        const junctionId = seg.to.structureID;
        const isRoundabout = roundaboutControllers.has(junctionId);
        if (isRoundabout) {
            return `lane:roundabout:${junctionId}`;
        }
        return ""; // Normal intersection - ignore inside phase
    }
    const toKey = `${seg.to.structureID}-${seg.to.exitIndex}-${seg.to.direction}-${seg.to.laneIndex}`;
    const fromKey = `${seg.from.structureID}-${seg.from.exitIndex}-${seg.from.direction}-${seg.from.laneIndex}`;
    if (seg.phase === "exit") return `lane:${toKey}`;
    return `lane:${fromKey}`; // link + approach
};