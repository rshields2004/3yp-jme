import * as THREE from "three";
import { ExitStructure } from "./types/intersection";
import { RingLaneStructure, RoundaboutExitStructure, RoundaboutObject } from "./types/roundabout";
import { start } from "repl";
import { LaneStructure } from "./types/types";
import { ThickLineHandle } from "../components/ThickLine";


function getLaneWorldPoint
(
    group: THREE.Group,
    exitIndex: number,
    laneIndex: number,
    which: "start" | "end"
) {
    let exitInfo;
    if (group.userData.type === "roundabout") {
        exitInfo = group.userData.roundaboutExitStructure[exitIndex];
    }
    else {
        exitInfo = group.userData.exitInfo[exitIndex];
    }

    const lanes = exitInfo.laneLines;

    if (lanes.length === 1) {
        // Only one lane, center = line itself
        const lane = lanes[0];
        return (which === "start" ? lane.line.start : lane.line.end).clone();
    }


    const leftLane = lanes[laneIndex];
    const rightLane = lanes[laneIndex + 1] ?? leftLane; // if last lane, use left lane only

    // Compute midpoint between left and right lane line at start or end
    const leftPoint = which === "start" ? leftLane.line.start : leftLane.line.end;
    const rightPoint = which === "start" ? rightLane.line.start : rightLane.line.end;

    return leftPoint.clone().add(rightPoint.clone()).multiplyScalar(0.5);
}


export function generateIntersectionPath(
    intersection: THREE.Group,
    entry: { exitIndex: number, laneIndex: number },
    exit: { exitIndex: number, laneIndex: number }
): [number, number, number][] {

    const startPoint = getLaneWorldPoint(intersection, entry.exitIndex, entry.laneIndex, "end");
    const midStart = getLaneWorldPoint(intersection, entry.exitIndex, entry.laneIndex, "start");
    const midEnd = getLaneWorldPoint(intersection, exit.exitIndex, exit.laneIndex, "start");
    const endPoint = getLaneWorldPoint(intersection, exit.exitIndex, exit.laneIndex, "end");

    const dirEntry = midStart.clone().sub(startPoint).normalize();
    const dirExit = endPoint.clone().sub(midEnd).normalize();

    function intersect2D(p1: THREE.Vector3, d1: THREE.Vector3, p2: THREE.Vector3, d2: THREE.Vector3): THREE.Vector3 | null {
        // Solve p1 + t*d1 = p2 + s*d2
        const a = d1.x, b = -d2.x, c = p2.x - p1.x;
        const d = d1.z, e = -d2.z, f = p2.z - p1.z;
        const denom = a*e - b*d;
        if (Math.abs(denom) < 1e-6) return null; // parallel
        const t = (c*e - b*f) / denom;
        const intersection = p1.clone().add(d1.clone().multiplyScalar(t));
        intersection.y = (p1.y + p2.y)/2;
        return intersection;
    }

    const centrePoint = intersect2D(startPoint, dirEntry, endPoint, dirExit) || intersection.position.clone().applyMatrix4(intersection.matrixWorld);

    const points: THREE.Vector3[] = [];

    // Compute angle between entry and exit directions
    const angle = dirEntry.angleTo(dirExit); // radians
    const MIN_CURVE_ANGLE = 0.01; // ~0.5 degrees, tweak as needed

    if (angle < MIN_CURVE_ANGLE) {
        // Almost straight → just linearly interpolate
        points.push(startPoint, midStart, midEnd, endPoint);
    } 
    else {
        // Create a cubic Bézier curve through the centre
        points.push(startPoint, midStart);
        const curve = new THREE.CubicBezierCurve3(midStart, centrePoint, centrePoint, midEnd);
        points.push(...curve.getPoints(20));
        points.push(midEnd, endPoint);
    }

    return points.map(v => [v.x, v.y, v.z] as [number, number, number]);
}


export function generateRoundaboutPath(
    roundabout: THREE.Group,
    entry: { exitIndex: number, laneIndex: number },
    exit: { exitIndex: number, laneIndex: number }
): [number, number, number][] {


    const startPoint = getLaneWorldPoint(roundabout, entry.exitIndex, entry.laneIndex, "end");
    const midStart = getLaneWorldPoint(roundabout, entry.exitIndex, entry.laneIndex, "start");
    const midEnd = getLaneWorldPoint(roundabout, exit.exitIndex, exit.laneIndex, "start");
    const endPoint = getLaneWorldPoint(roundabout, exit.exitIndex, exit.laneIndex, "end");

    const ringLines: RingLaneStructure[] = roundabout.userData.roundaboutRingStructure;

    const points: THREE.Vector3[] = [];

    points.push(startPoint);
    
    points.push(midStart);

    const innerRingIndex = Math.min(ringLines.length - 2, entry.laneIndex);

    const innerRadius = ringLines[innerRingIndex].radius;
    const outerRadius = ringLines[innerRingIndex + 1].radius;
    
    // Compute middle radius of the lane: average distance from origin
    const midRadius = (innerRadius + outerRadius) / 2;

    // Compute angles for the circular segment
    const startAngle = Math.atan2(midStart.z, midStart.x);
    const endAngle = Math.atan2(midEnd.z, midEnd.x);

    // Determine shortest rotation direction
    const clockwise = false; // set true if your roundabout moves clockwise
    const segments = 40;
    let deltaAngle = endAngle - startAngle;
    if (clockwise) {
        if (deltaAngle >= 0) deltaAngle -= 2 * Math.PI;
    } 
    else {
        if (deltaAngle <= 0) deltaAngle += 2 * Math.PI;
    }
    
    
    const circlePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = startAngle + deltaAngle * t;
        const x = Math.cos(angle) * midRadius;
        const z = Math.sin(angle) * midRadius;
        circlePoints.push(new THREE.Vector3(x, 0, z));
    }

    // Ensure at least 4 points for Bezier curves
    const entryCurvePoints = [midStart, circlePoints[1], circlePoints[2], circlePoints[3]];
    const exitCurvePoints = [
        circlePoints[circlePoints.length - 4],
        circlePoints[circlePoints.length - 3],
        circlePoints[circlePoints.length - 2],
        midEnd
    ];

    // Create cubic Bezier curves for smooth entry/exit
    const curveEntry = new THREE.CubicBezierCurve3(...entryCurvePoints);
    const curveExit = new THREE.CubicBezierCurve3(...exitCurvePoints);

    // Assemble points
    points.push(startPoint);
    points.push(...curveEntry.getPoints(10));           // smooth entry
    points.push(...circlePoints.slice(3, -3));          // middle of the roundabout
    points.push(...curveExit.getPoints(10));            // smooth exit
    points.push(midEnd);
    points.push(endPoint);

    return points.map(v => [v.x, v.y, v.z] as [number, number, number]);
};


export function getMidCurve(
    curveA: [number, number, number][],
    curveB: [number, number, number][]
): [number, number, number][] {
    if (!curveA || !curveB) return [];
    if (curveA.length !== curveB.length) {
        console.warn("Curves have different lengths, interpolating to match");
        // Optionally, you could interpolate points here
    }

    const length = Math.min(curveA.length, curveB.length);
    const midCurve: [number, number, number][] = [];

    for (let i = 0; i < length; i++) {
        const [ax, ay, az] = curveA[i];
        const [bx, by, bz] = curveB[i];
        midCurve.push([
            (ax + bx) / 2,
            (ay + by) / 2,
            (az + bz) / 2,
        ]);
    }

    return midCurve;
}