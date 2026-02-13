import { Node, NodeKey, RouteSegment } from "../../types/simulation";

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
