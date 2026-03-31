/**
 * routeUtils.ts
 *
 * Route measurement utilities: point extraction, spacing estimation, and
 * per-segment cumulative distance calculation.
 */

import { Tuple3, Route } from "../../types/simulation";
import { polylineLength } from "../helpers/segmentHelpers";
import { pointsEqual } from "./geometryUtils";

// POINT EXTRACTION

/**
 * Concatenates all segment point arrays from a route into a single flat array.
 * Carefully avoids duplicating the shared boundary point between adjacent segments —
 * if the first point of a new segment equals the last point of the previous one, it is skipped.
 *
 * @param route - The route whose points should be extracted.
 * @returns A flat array of all 3-D points in the route, in order.
 */
export const getRoutePoints = (route: Route): Tuple3[] => {
    if (!route.segments || route.segments.length === 0) return [];

    const allPoints: Tuple3[] = [];
    let previousLast: Tuple3 | null = null;

    for (const seg of route.segments) {
        for (let i = 0; i < seg.points.length; i++) {
            const point = seg.points[i];
            // Skip first point if it duplicates the previous segment's last point
            if (i === 0 && previousLast && pointsEqual(previousLast, point)) continue;
            allPoints.push(point);
        }
        if (seg.points.length > 0) {
            previousLast = seg.points[seg.points.length - 1];
        }
    }

    return allPoints;
};

// SPACING ESTIMATION

/**
 * Estimates the average spacing between consecutive points across a whole route.
 * Useful for understanding how densely sampled a route is.
 *
 * @param route - The route to measure.
 * @returns Average distance between consecutive points in world units.
 */
export const estimateRouteSpacing = (route: Route): number => {
    const points = getRoutePoints(route);
    if (points.length < 2) return 1.0;

    const totalLength = polylineLength(points);
    return totalLength / (points.length - 1);
};

// CUMULATIVE DISTANCES

/**
 * Computes the cumulative start and end distance of each segment along the full route.
 * Think of this like mileage markers — segment 0 might span 0 m–15 m,
 * segment 1 from 15 m–32 m, etc. Useful for vehicles that need to know their
 * absolute progress along a route.
 *
 * @param route - The route to measure.
 * @returns An array of `{ s0, s1 }` pairs, one per segment.
 */
export const computeSegmentDistances = (route: Route): Array<{ s0: number; s1: number }> => {
    const result: Array<{ s0: number; s1: number }> = [];

    if (!route.segments || route.segments.length === 0) return result;

    let cumulative = 0;

    for (const seg of route.segments) {
        const s0 = cumulative;
        const segmentLen = polylineLength(seg.points);
        const s1 = s0 + segmentLen;

        result.push({ s0, s1 });
        cumulative = s1;
    }

    return result;
};
