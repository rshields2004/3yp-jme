import { Tuple3 } from "../../types/simulation";

/**
 * Compute polyline length for an array of 3D points.
 */
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
