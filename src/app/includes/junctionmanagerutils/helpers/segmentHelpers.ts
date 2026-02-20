import { Node, NodeKey, RouteSegment, Tuple3 } from "../../types/simulation";
import { RoundaboutController } from "../controllers/roundaboutController";

/**
 * Create a unique segment identifier.
 */
export function segmentId(seg: RouteSegment): string {
    const fromKey = `${seg.from.structureID}-${seg.from.exitIndex}-${seg.from.direction}-${seg.from.laneIndex}`;
    const toKey = `${seg.to.structureID}-${seg.to.exitIndex}-${seg.to.direction}-${seg.to.laneIndex}`;
    return `${seg.phase}|${fromKey}|${toKey}`;
}

/**
 * Compute polyline length of a segment.
 */
export function segmentLen(seg: RouteSegment): number {
    if (!seg.points || seg.points.length < 2) return 0;
    let len = 0;
    for (let i = 1; i < seg.points.length; i++) {
        const dx = seg.points[i][0] - seg.points[i - 1][0];
        const dy = seg.points[i][1] - seg.points[i - 1][1];
        const dz = seg.points[i][2] - seg.points[i - 1][2];
        len += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return len;
}

export function nodeKeyOf(n: Node): NodeKey {
    return `${n.structureID}-${n.exitIndex}-${n.direction}-${n.laneIndex}`;
}

export function polylineLength(pts: Tuple3[]): number {
    if (!pts || pts.length < 2) return 0;
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dy = pts[i][1] - pts[i - 1][1];
        const dz = pts[i][2] - pts[i - 1][2];
        len += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return len;
}

export function laneKeyForSegment(
    seg: RouteSegment,
    roundaboutControllers: Map<string, RoundaboutController>
): string {
    // For roundabouts: single lane key per roundabout. Vehicles cross ring lanes
    // during gradual merges, so per-ring-lane keys don't work.
    if (seg.phase === "inside") {
        const junctionId = seg.to.structureID;
        const isRoundabout = roundaboutControllers.has(junctionId);
        if (isRoundabout) {
            return `lane:roundabout:${junctionId}`;
        }
        return "";  // Normal intersection - ignore inside phase
    }
    const toKey = `${seg.to.structureID}-${seg.to.exitIndex}-${seg.to.direction}-${seg.to.laneIndex}`;
    const fromKey = `${seg.from.structureID}-${seg.from.exitIndex}-${seg.from.direction}-${seg.from.laneIndex}`;
    if (seg.phase === "exit") return `lane:${toKey}`;
    return `lane:${fromKey}`; // link + approach
}