/**
 * laneCoordinates.ts
 *
 * Builds a lane-based coordinate system for collision detection. Each unique
 * lane is assigned a monotonically increasing base distance so that vehicles
 * sharing a lane can be compared on a single linear axis regardless of which
 * route they are following.
 */

import { Route, RouteSegment } from "../../types/simulation";
import { RoundaboutController } from "../controllers/roundaboutController";
import { laneKeyForSegment, nodeKeyOf, segmentId, segmentLength } from "../helpers/segmentHelpers";

// LANE BASE CONSTRUCTION

/**
 * Builds the lane base coordinate system used for collision detection.
 *
 * For each unique lane (identified by lane key), performs a topological sort of
 * route segments that share that key. Each segment is assigned a monotonically
 * increasing base distance so that all vehicles on that lane can be compared
 * using a single linear coordinate regardless of which route they are on.
 *
 * @param routes - All routes in the simulation.
 * @param roundaboutControllers - Used by {@link laneKeyForSegment} to classify roundabout lanes.
 * @returns A nested `Map`: `laneKey → (segmentId → base distance)`.
 */
export const buildLaneBases = (
    routes: Route[],
    roundaboutControllers: Map<string, RoundaboutController>,
): Map<string, Map<string, number>> => {
    const laneBases = new Map<string, Map<string, number>>();

    const perLane = new Map<string, Map<string, RouteSegment>>();

    for (const r of routes) {
        for (const seg of r.segments ?? []) {
            const laneKey = laneKeyForSegment(seg, roundaboutControllers);
            if (!laneKey) continue;
            const id = segmentId(seg);

            const laneMap = perLane.get(laneKey) ?? new Map<string, RouteSegment>();
            if (!laneMap.has(id)) laneMap.set(id, seg);
            perLane.set(laneKey, laneMap);
        }
    }

    for (const [laneKey, segMap] of perLane.entries()) {
        const segs = Array.from(segMap.values());
        const ids = segs.map((s) => segmentId(s));

        const next = new Map<string, string[]>();
        const indeg = new Map<string, number>();
        for (const id of ids) {
            next.set(id, []);
            indeg.set(id, 0);
        }

        for (const a of segs) {
            for (const b of segs) {
                if (a === b) continue;
                if (nodeKeyOf(a.to) === nodeKeyOf(b.from)) {
                    const aid = segmentId(a);
                    const bid = segmentId(b);
                    next.get(aid)!.push(bid);
                    indeg.set(bid, (indeg.get(bid) ?? 0) + 1);
                }
            }
        }

        const bases = new Map<string, number>();
        const q: string[] = [];

        for (const [id, d] of indeg.entries()) {
            if (d === 0) {
                bases.set(id, 0);
                q.push(id);
            }
        }

        while (q.length) {
            const id = q.shift()!;
            const seg = segMap.get(id)!;
            const base = bases.get(id) ?? 0;
            const len = segmentLength(seg);

            for (const nid of next.get(id) ?? []) {
                if (!bases.has(nid)) {
                    bases.set(nid, base + len);
                    q.push(nid);
                }
            }
        }

        for (const id of ids) {
            if (!bases.has(id)) {
                bases.set(id, 0);
            }
        }

        laneBases.set(laneKey, bases);
    }

    return laneBases;
};
