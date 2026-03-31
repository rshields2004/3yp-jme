/**
 * geometryUtils.ts
 *
 * Low-level geometry and resampling utilities used by the routing subsystem:
 * type conversions, fixed-spacing polyline resampling, Catmull-Rom smoothing,
 * point equality checks, and lane centreline computation.
 */

import * as THREE from "three";
import { Tuple3 } from "../../types/simulation";

export { polylineLength } from "../helpers/segmentHelpers";

// TYPE CONVERSIONS

/**
 * Converts a {@link THREE.Vector3} to a {@link Tuple3} `[x, y, z]` array.
 *
 * @param vector - The vector to convert.
 * @returns A three-element numeric array.
 */
export const v3ToTuple = (vector: THREE.Vector3): Tuple3 => {
    return [vector.x, vector.y, vector.z];
};

/**
 * Converts a {@link Tuple3} `[x, y, z]` into a {@link THREE.Vector3}.
 *
 * @param point - The tuple to convert.
 * @returns the computed position vector
 */
export const toV3 = (point: Tuple3): THREE.Vector3 => {
    return new THREE.Vector3(point[0], point[1], point[2]);
};

// POLYLINE RESAMPLING

/**
 * Resamples a polyline so that consecutive output points are all exactly
 * `spacing` apart. Works by walking along each input segment and emitting a
 * new point each time the accumulated distance reaches `spacing`.
 *
 * This ensures vehicles that index into route points by step always advance a
 * consistent physical distance per step, regardless of how the original points
 * were distributed.
 *
 * @param points - Input polyline as an array of {@link THREE.Vector3}.
 * @param spacing - Desired distance between consecutive output points.
 * @returns New array of {@link THREE.Vector3} with uniform spacing.
 */
export const resamplePolylineFixedSpacing = (
    points: THREE.Vector3[],
    spacing: number,
): THREE.Vector3[] => {
    if (!points || points.length < 2) return points?.map((p) => p.clone()) ?? [];

    const output: THREE.Vector3[] = [];
    output.push(points[0].clone());

    // accumulated tracks how far we've travelled since the last emitted point
    let accumulated = 0;

    for (let i = 1; i < points.length; i++) {
        let current = points[i - 1].clone();
        const target = points[i].clone();

        let segmentLen = current.distanceTo(target);
        if (segmentLen < 1e-9) continue; // Skip degenerate zero-length segments

        // Emit as many evenly-spaced points as fit in this segment
        while (accumulated + segmentLen >= spacing) {
            const remaining = spacing - accumulated;
            const t = remaining / Math.max(1e-9, segmentLen);

            const emitted = current.clone().lerp(target, t);
            output.push(emitted);

            // Advance the start of the remaining segment to the newly emitted point
            current = emitted;
            segmentLen = current.distanceTo(target);
            accumulated = 0;
        }

        accumulated += segmentLen;
    }

    // Always include the last point so the route endpoint is exact
    const last = points[points.length - 1];
    if (output[output.length - 1].distanceToSquared(last) > 1e-10) output.push(last.clone());
    return output;
};

// SMOOTHING

/**
 * Smooths a segment's raw control points using a Catmull-Rom spline, then
 * resamples the result to a fixed point spacing. The spline is oversampled at
 * 3× the desired density before resampling to ensure the curve is captured
 * accurately.
 *
 * @param points - Raw control points for this segment.
 * @param spacing - Desired distance between consecutive output points (world units).
 * @param tension - Catmull-Rom tension (0 = loose/loopy, 1 = tight/straight).
 * @returns Smoothed and evenly-spaced {@link Tuple3} array.
 */
export const smoothAndResampleSegment = (
    points: Tuple3[],
    spacing: number,
    tension: number,
): Tuple3[] => {
    const control = points.map(toV3);
    if (control.length < 2) return control.map(v3ToTuple);

    // Measure approximate polyline length to calculate how many points we need
    let approximateLength = 0;
    for (let i = 1; i < control.length; i++) {
        approximateLength += control[i].distanceTo(control[i - 1]);
    }

    // 3× oversampling before resampling keeps the final curve accurate;
    // clamped between 50 and 1 500 to avoid degenerate or excessively costly cases
    const targetPoints = Math.ceil(approximateLength / Math.max(1e-6, spacing));
    const denseCount = Math.max(50, Math.min(1500, targetPoints * 3));

    const curve = new THREE.CatmullRomCurve3(control, false, "centripetal", tension);
    const dense = curve.getPoints(denseCount);
    const sampled = resamplePolylineFixedSpacing(dense, spacing);

    return sampled.map(v3ToTuple);
};

// POINT COMPARISON

/**
 * Epsilon comparison for two {@link Tuple3} points. Returns `true` if the
 * squared distance between them is less than 1e-10, used to detect duplicate
 * boundary points when joining route segments.
 *
 * @param a - First point.
 * @param b - Second point.
 * @returns `true` if the condition holds
 */
export const pointsEqual = (a: Tuple3, b: Tuple3): boolean => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz < 1e-10;
};

// LANE CENTRELINE

/**
 * Computes the centreline of a lane by averaging two parallel boundary curves
 * point-by-point. Used for link roads where the {@link LinkComponent} has
 * pre-computed the two edge curves of each lane.
 *
 * If the arrays are different lengths, only the shorter length is used.
 *
 * @param curveA - Left boundary curve.
 * @param curveB - Right boundary curve.
 * @returns Midpoint curve between `curveA` and `curveB`.
 */
export const getMidCurve = (curveA: Tuple3[], curveB: Tuple3[]): Tuple3[] => {
    if (!curveA || !curveB) return [];
    if (curveA.length !== curveB.length) {
        console.warn("Curves have different lengths, using minimum length");
    }
    const length = Math.min(curveA.length, curveB.length);
    const midCurve: Tuple3[] = [];
    for (let i = 0; i < length; i++) {
        const [ax, ay, az] = curveA[i];
        const [bx, by, bz] = curveB[i];
        midCurve.push([(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]);
    }
    return midCurve;
};
