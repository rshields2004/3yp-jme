/**
 * routing/geometryUtils.ts
 *
 * Low-level geometry and resampling utilities.
 */
import * as THREE from "three";
import { Tuple3 } from "../../types/simulation";

export { polylineLength } from "../helpers/segmentHelpers";


/**
 * Converts THREE.Vector3 to Tuple3 type (array of 3 numbers)
 * @param v The THREE.Vector3 to convert
 * @returns The array of values representing x, y and z
 */
export function v3ToTuple(v: THREE.Vector3): Tuple3 {
    return [v.x, v.y, v.z];
}


/**
 * Converts a Tuple3 [x, y, z] into a THREE.Vector3.
 * Small utility to avoid repetitive constructor calls.
 * @param p Point to convert
 */
export function toV3(p: Tuple3) {
    return new THREE.Vector3(p[0], p[1], p[2]);
}

/**
 * Resamples a polyline so that consecutive output points are all exactly `spacing` apart.
 * Works by walking along each input segment and emitting a new point each time the
 * accumulated distance reaches `spacing`. This ensures vehicles that index into route
 * points by step always advance a consistent physical distance per step, regardless of
 * how the original points were distributed.
 * @param pts Input polyline as an array of THREE.Vector3
 * @param spacing Desired distance between consecutive output points
 * @returns New array of THREE.Vector3 with uniform spacing
 */
export function resamplePolylineFixedSpacing(pts: THREE.Vector3[], spacing: number) {
    if (!pts || pts.length < 2) return pts?.map((p) => p.clone()) ?? [];

    const out: THREE.Vector3[] = [];
    out.push(pts[0].clone());

    // acc tracks how far we've travelled since the last emitted point
    let acc = 0;

    for (let i = 1; i < pts.length; i++) {
        let a = pts[i - 1].clone();
        const b = pts[i].clone();

        let segLen = a.distanceTo(b);
        if (segLen < 1e-9) continue; // Skip degenerate zero-length segments

        // Emit as many evenly-spaced points as fit in this segment
        while (acc + segLen >= spacing) {
            const remain = spacing - acc;
            const t = remain / Math.max(1e-9, segLen);

            const p = a.clone().lerp(b, t);
            out.push(p);

            // Advance the start of the remaining segment to the newly emitted point
            a = p;
            segLen = a.distanceTo(b);
            acc = 0;
        }

        acc += segLen;
    }

    // Always include the last point so the route endpoint is exact
    const last = pts[pts.length - 1];
    if (out[out.length - 1].distanceToSquared(last) > 1e-10) out.push(last.clone());
    return out;
}

/**
 * Smooths a segment's raw control points using a Catmull-Rom spline, then resamples
 * the result to a fixed point spacing. The spline is oversampled at 3× the desired
 * density before resampling to ensure the curve is captured accurately.
 * @param points Raw control points for this segment as Tuple3 array
 * @param spacing Desired distance between consecutive output points in world units
 * @param tension Catmull-Rom tension (0 = loose/loopy, 1 = tight/straight)
 * @returns Smoothed and evenly-spaced Tuple3 array
 */
export function smoothAndResampleSegment(
    points: Tuple3[],
    spacing: number,
    tension: number
): Tuple3[] {
    const control = points.map(toV3);
    if (control.length < 2) return control.map(v3ToTuple);

    // Measure approximate polyline length to calculate how many points we need
    let approxLen = 0;
    for (let i = 1; i < control.length; i++) approxLen += control[i].distanceTo(control[i - 1]);

    // 3× oversampling before resampling keeps the final curve accurate;
    // clamped between 50 and 1500 to avoid degenerate or excessively costly cases
    const targetPoints = Math.ceil(approxLen / Math.max(1e-6, spacing));
    const denseN = Math.max(50, Math.min(1500, targetPoints * 3));

    const curve = new THREE.CatmullRomCurve3(control, false, "centripetal", tension);
    const dense = curve.getPoints(denseN);
    const sampled = resamplePolylineFixedSpacing(dense, spacing);

    return sampled.map(v3ToTuple);
}


/**
 * Epsilon comparison for two Tuple3 points.
 * Returns true if the squared distance between them is less than 1e-10,
 * used to detect duplicate boundary points when joining route segments.
 * @param a First point
 * @param b Second point
 */
export function pointsEqual(a: Tuple3, b: Tuple3) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz < 1e-10;
}


/**
 * Computes the centreline of a lane by averaging two parallel boundary curves point-by-point.
 * Used for link roads where the LinkComponent has pre-computed the two edge curves of each lane.
 * If the arrays are different lengths, only the shorter length is used.
 * @param curveA Left boundary curve as Tuple3 array
 * @param curveB Right boundary curve as Tuple3 array
 * @returns Midpoint curve between curveA and curveB
 */
export function getMidCurve(curveA: Tuple3[], curveB: Tuple3[]): Tuple3[] {
    if (!curveA || !curveB) return [];
    if (curveA.length !== curveB.length) {
        console.warn("Curves have different lengths, using min length");
    }
    const length = Math.min(curveA.length, curveB.length);
    const midCurve: Tuple3[] = [];
    for (let i = 0; i < length; i++) {
        const [ax, ay, az] = curveA[i];
        const [bx, by, bz] = curveB[i];
        midCurve.push([(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]);
    }
    return midCurve;
}
