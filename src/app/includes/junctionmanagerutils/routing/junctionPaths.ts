/**
 * routing/junctionPaths.ts
 *
 * World-space path generation through junction objects.
 * Covers lane endpoint lookup, intersection path planning, and roundabout path
 * planning (including ring-lane selection and lane-change Bézier scheduling).
 */
import * as THREE from "three";
import { RingLaneStructure } from "../../types/roundabout";
import { ExitConfig } from "../../types/types";
import { Tuple3, InternalParts } from "../../types/simulation";
import { getStructureData } from "../../utils";
import { v3ToTuple } from "./geometryUtils";


/**
 * Returns the world-space midpoint of a specific lane strip at a junction exit.
 * Lane lines are boundary lines, so N lanes = N+1 boundary lines, meaning
 * strip `laneIndex` sits between boundary lines `laneIndex` and `laneIndex+1`.
 * Inbound lanes are indexed in reverse order relative to outbound lanes,
 * since they occupy the opposite side of the exit road.
 * @param group The THREE.Group of the junction object (intersection or roundabout)
 * @param exitIndex Which exit arm on the junction
 * @param laneIndex Which lane strip within that exit (0 = leftmost/nearside)
 * @param which Whether to return the "start" (junction-side) or "end" (road-side) of the lane
 * @param dir "in" for inbound lanes, "out" for outbound - affects which side of the road is indexed
 * @returns The world-space midpoint of the requested lane strip endpoint
 */
export function getLaneWorldPoint(
    group: THREE.Group,
    exitIndex: number,
    laneIndex: number,
    which: "start" | "end",
    dir: "in" | "out"
) {
    const infoArray = getStructureData(group)?.type === "roundabout"
        ? group.userData.roundaboutStructure.exitStructures
        : group.userData.intersectionStructure.exitInfo;
    const exitInfo = infoArray[exitIndex];
    const lanes = exitInfo.laneLines;

    // Single-lane exit - just return the one boundary's point directly
    if (lanes.length === 1) {
        const lane = lanes[0];
        return (which === "start" ? lane.line.start : lane.line.end).clone();
    }

    // laneLines are boundaries, so strips = boundaries - 1
    const numStrips = lanes.length - 1;
    const clamped = Math.max(0, Math.min(laneIndex, numStrips - 1));

    // Inbound lanes are on the opposite side of the exit, so reverse the index
    const idx = dir === "in" ? numStrips - 1 - clamped : clamped;

    const leftLane = lanes[idx];
    const rightLane = lanes[idx + 1] ?? leftLane;

    const leftPoint = which === "start" ? leftLane.line.start : leftLane.line.end;
    const rightPoint = which === "start" ? rightLane.line.start : rightLane.line.end;

    // Return the midpoint between the two boundary lines, converted to world space
    return group.localToWorld(leftPoint.clone().add(rightPoint.clone()).multiplyScalar(0.5));
}


/**
 * Builds the three-phase path through an intersection (approach, inside, and exit).
 * @param intersection The intersection group
 * @param entry The entry exit and lane index
 * @param exit The exit exit and lane index
 * @returns Approach, inside, and exit point arrays
 */
export function generateIntersectionPathParts(
    intersection: THREE.Group,
    entry: { exitIndex: number; laneIndex: number },
    exit: { exitIndex: number; laneIndex: number }
): InternalParts {

    // Extract the start and end point of the approach lane
    const startPoint = getLaneWorldPoint(intersection, entry.exitIndex, entry.laneIndex, "end", "in");
    const midStart = getLaneWorldPoint(intersection, entry.exitIndex, entry.laneIndex, "start", "in");

    // Extract the start and end point of the exit lane
    const midEnd = getLaneWorldPoint(intersection, exit.exitIndex, exit.laneIndex, "start", "out");
    const endPoint = getLaneWorldPoint(intersection, exit.exitIndex, exit.laneIndex, "end", "out");

    // Entry tangent: direction car is traveling when entering junction
    const dirEntry = midStart.clone().sub(startPoint).normalize();

    // Exit tangent: direction car will be traveling when leaving junction
    const dirExit = endPoint.clone().sub(midEnd).normalize();

    const approachVector: THREE.Vector3[] = [startPoint, midStart];

    const angle = dirEntry.angleTo(dirExit);
    const dist = midStart.distanceTo(midEnd);
    const MIN_CURVE_ANGLE = 0.05; // ~3 degrees

    let insideV: THREE.Vector3[];
    if (angle < MIN_CURVE_ANGLE) {
        // Nearly straight path so just connect the endpoints
        insideV = [midStart, midEnd];
    }
    else {
        /*
            For smooth curves, place control points along the tangent directions.
            Scale control distance based on turn sharpness and distance:
            - Sharper turns need control points closer to endpoints for tighter arcs
            - Gentler turns can have control points further out for smoother arcs
        */
        const turnFactor = Math.min(1.0, angle / Math.PI); // 0 for straight, 1 for U-turn
        const controlDist = dist * (0.3 + 0.4 * (1 - turnFactor)); // Ranges 0.3-0.7 of chord distance

        // P1: continue along entry direction from midStart
        const p1 = midStart.clone().add(dirEntry.clone().multiplyScalar(controlDist));
        // P2: come from exit direction toward midEnd (back along exit tangent)
        const p2 = midEnd.clone().sub(dirExit.clone().multiplyScalar(controlDist));

        const curve = new THREE.CubicBezierCurve3(midStart, p1, p2, midEnd);
        insideV = [midStart, ...curve.getPoints(20).slice(1, -1), midEnd];
    }

    const exitV: THREE.Vector3[] = [midEnd, endPoint];

    return {
        approach: approachVector.map(v3ToTuple),
        inside: insideV.map(v3ToTuple),
        exit: exitV.map(v3ToTuple),
    };
}


/**
 * Builds the three-phase path through a roundabout, including ring-lane selection
 * and Bézier-based lane-change scheduling.
 * @param roundabout The roundabout group
 * @param entry The entry exit and lane index
 * @param exit The exit exit and lane index
 * @param laneWidth Lane width in world units, used for lane-change arc length
 * @param exitConfigs Exit configs for all arms of the roundabout
 * @returns Approach, inside, and exit point arrays
 */
export function generateRoundaboutPathParts(
    roundabout: THREE.Group,
    entry: { exitIndex: number; laneIndex: number },
    exit: { exitIndex: number; laneIndex: number },
    laneWidth: number,
    exitConfigs: ExitConfig[]
): InternalParts {
    // Get approach and exit information same as intersection function
    const startW = getLaneWorldPoint(roundabout, entry.exitIndex, entry.laneIndex, "end", "in");
    const midStartW = getLaneWorldPoint(roundabout, entry.exitIndex, entry.laneIndex, "start", "in");
    const midEndW = getLaneWorldPoint(roundabout, exit.exitIndex, exit.laneIndex, "start", "out");
    const endW = getLaneWorldPoint(roundabout, exit.exitIndex, exit.laneIndex, "end", "out");

    // Convert points to local space to prevent issues with calculations from userData
    const startL = roundabout.worldToLocal(startW.clone());
    const midStartL = roundabout.worldToLocal(midStartW.clone());
    const midEndL = roundabout.worldToLocal(midEndW.clone());
    const endL = roundabout.worldToLocal(endW.clone());

    // Extract important information from the userData
    const ringLines: RingLaneStructure[] = roundabout.userData.roundaboutStructure.ringLines;
    const numRingStrips = ringLines.length - 1;
    const outermostStrip = numRingStrips - 1;
    const numExits = exitConfigs.length;

    const TAU = Math.PI * 2;
    const startAngle = Math.atan2(midStartL.z, midStartL.x);
    const endAngle = Math.atan2(midEndL.z, midEndL.x);

    // UK so clockwise rotation from +Y in Three.js XZ = angles increase
    let deltaCW = THREE.MathUtils.euclideanModulo(endAngle - startAngle, TAU);
    // Same exit as entry means a full loop
    if (entry.exitIndex === exit.exitIndex) {
        deltaCW = TAU;
    }
    // Angles nearly identical but different exits means we wrapped around - treat as full loop
    if (deltaCW < 0.05 && entry.exitIndex !== exit.exitIndex) {
        deltaCW = TAU;
    }

    /*
        Lane selection based on exit ordinal position (CW from entry).
        - 1st exit (nearest CW) -> outermost lane
        - 2nd exit -> next lane inward
        - last / same-exit -> innermost available lane
    */
    const exitOrdinal = (() => {
        const orderedExits: number[] = [];
        for (let offset = 1; offset < numExits; offset++) {
            const e = (entry.exitIndex + offset) % numExits;
            const numOutLanes = exitConfigs[e].laneCount - exitConfigs[e].numLanesIn;
            if (numOutLanes > 0) orderedExits.push(e);
        }
        orderedExits.push(entry.exitIndex); // full-loop U-turn is last
        const idx = orderedExits.indexOf(exit.exitIndex);
        return idx >= 0 ? idx : orderedExits.length - 1;
    })();

    let entryStripIndex: number;
    if (numRingStrips <= 1) {
        entryStripIndex = 0;
    }
    else {
        const depth = Math.min(exitOrdinal, numRingStrips - 1);
        entryStripIndex = outermostStrip - depth;
    }
    // Vehicles always exit from the outermost lane strip
    const exitStripIndex = outermostStrip;
    const lanesCrossed = Math.abs(exitStripIndex - entryStripIndex);

    const getStripMidRadius = (strip: number) =>
        (ringLines[strip].radius + ringLines[strip + 1].radius) / 2;

    const entryRadius = getStripMidRadius(entryStripIndex);
    const exitRadius = getStripMidRadius(exitStripIndex);
    const needsLaneChange = lanesCrossed > 0;
    const y = midStartL.y; // Y coordinate stays flat - all ring travel is at road height

    const ringPoint = (angle: number, radius: number) =>
        new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);

    const cwTangent = (angle: number) =>
        new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));

    const makeArc = (fromAngle: number, toAngle: number, radius: number, segs: number): THREE.Vector3[] => {
        const delta = toAngle - fromAngle;
        if (Math.abs(delta) < 0.001) return [ringPoint(fromAngle, radius)];
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= segs; i++) pts.push(ringPoint(fromAngle + delta * (i / segs), radius));
        return pts;
    };

    // For each exit between entry and target, find the angular boundary between its
    // out-lanes and in-lanes. These are the decision points where lane changes are scheduled.
    type ExitBoundary = { angle: number; delta: number };
    const intermediateBoundaries: ExitBoundary[] = [];

    for (let exitIndex = 0; exitIndex < numExits; exitIndex++) {
        if (exitIndex === entry.exitIndex || exitIndex === exit.exitIndex) continue;

        const config = exitConfigs[exitIndex];
        const numOutLanes = config.laneCount - config.numLanesIn;

        // Clockwise-most out-lane boundary angle
        let outFarDelta = -1;
        let outFarAngle = startAngle;
        for (let li = 0; li < numOutLanes; li++) {
            const ptL = roundabout.worldToLocal(getLaneWorldPoint(roundabout, exitIndex, li, "start", "out").clone());
            const d = THREE.MathUtils.euclideanModulo(Math.atan2(ptL.z, ptL.x) - startAngle, TAU);
            if (d > outFarDelta) { outFarDelta = d; outFarAngle = Math.atan2(ptL.z, ptL.x); }
        }

        // Counter-clockwise-most in-lane boundary angle
        let inNearDelta = Infinity;
        let inNearAngle = outFarAngle;
        for (let li = 0; li < config.numLanesIn; li++) {
            const ptL = roundabout.worldToLocal(getLaneWorldPoint(roundabout, exitIndex, li, "start", "in").clone());
            const d = THREE.MathUtils.euclideanModulo(Math.atan2(ptL.z, ptL.x) - startAngle, TAU);
            if (d > outFarDelta && d < inNearDelta) { inNearDelta = d; inNearAngle = Math.atan2(ptL.z, ptL.x); }
        }

        const outD = THREE.MathUtils.euclideanModulo(outFarAngle - startAngle, TAU);
        const inD = THREE.MathUtils.euclideanModulo(inNearAngle - startAngle, TAU);
        const boundaryDelta = (outD + inD) / 2;

        if (boundaryDelta > 0.05 && boundaryDelta < deltaCW - 0.05) {
            intermediateBoundaries.push({ angle: startAngle + boundaryDelta, delta: boundaryDelta });
        }
    }

    intermediateBoundaries.sort((a, b) => a.delta - b.delta);

    // Each lane change occupies an arc equivalent to 2 lane-widths of road distance
    const singleMergeArcLength = (2 * laneWidth) / ((entryRadius + exitRadius) / 2);

    // Schedule lane changes at the LAST N intermediate exit boundaries (mirrors real driving)
    const mergePoints: { startAngle: number; fromStrip: number; toStrip: number }[] = [];
    if (needsLaneChange && intermediateBoundaries.length > 0) {
        intermediateBoundaries.slice(-lanesCrossed).forEach((b, i) => {
            mergePoints.push({ startAngle: b.angle, fromStrip: entryStripIndex + i, toStrip: entryStripIndex + i + 1 });
        });
    }

    // If not enough intermediate exits, insert forced early merges immediately after entry
    const lanesHandled = mergePoints.length;
    if (needsLaneChange && lanesHandled < lanesCrossed) {
        for (let i = 0; i < lanesCrossed - lanesHandled; i++) {
            mergePoints.unshift({
                startAngle: startAngle + singleMergeArcLength * i,
                fromStrip: entryStripIndex + i,
                toStrip: entryStripIndex + i + 1,
            });
        }
        mergePoints.sort((a, b) => a.startAngle - b.startAngle);
    }

    // BUILD THE RING POINT SEQUENCE: arcs + Bézier lane-change segments
    const exitRingAngle = startAngle + deltaCW;
    const allRingPoints: THREE.Vector3[] = [];
    let currentAngle = startAngle;
    let currentStrip = entryStripIndex;

    for (const mp of mergePoints) {
        const currentRadius = getStripMidRadius(currentStrip);
        const nextRadius = getStripMidRadius(mp.toStrip);
        const mergeEnd = mp.startAngle + singleMergeArcLength;

        if (mp.startAngle - currentAngle > 0.01) {
            const arc = makeArc(currentAngle, mp.startAngle, currentRadius, 16);
            allRingPoints.push(...(allRingPoints.length > 0 ? arc.slice(1) : arc));
        }

        const lcStartPt = ringPoint(mp.startAngle, currentRadius);
        const clampedMergeEnd = Math.min(mergeEnd, exitRingAngle);
        const lcEndPt = ringPoint(clampedMergeEnd, nextRadius);
        const lcChordLen = lcStartPt.distanceTo(lcEndPt) * 0.4;

        const lc = new THREE.CubicBezierCurve3(
            lcStartPt,
            lcStartPt.clone().addScaledVector(cwTangent(mp.startAngle), lcChordLen),
            lcEndPt.clone().addScaledVector(cwTangent(clampedMergeEnd), -lcChordLen),
            lcEndPt
        );
        const lcPts = lc.getPoints(10);
        allRingPoints.push(...(allRingPoints.length > 0 ? lcPts.slice(1) : lcPts));

        currentAngle = clampedMergeEnd;
        currentStrip = mp.toStrip;
    }

    const finalRadius = getStripMidRadius(currentStrip);
    if (exitRingAngle - currentAngle > 0.01) {
        const arc = makeArc(currentAngle, exitRingAngle, finalRadius, 16);
        allRingPoints.push(...(allRingPoints.length > 0 ? arc.slice(1) : arc));
    }

    // TRIM AND BLEND: remove edge points to make room for smooth entry/exit Béziers
    const TRIM = 3;
    const trimmed = allRingPoints.slice(TRIM, -TRIM || undefined);

    const insidePoints: THREE.Vector3[] = [];
    const entryDir = new THREE.Vector3().subVectors(midStartL, startL).normalize();
    const exitDir = new THREE.Vector3().subVectors(endL, midEndL).normalize();

    if (trimmed.length > 0) {
        const entryTarget = trimmed[0];
        const entryTargetAngle = Math.atan2(entryTarget.z, entryTarget.x);
        const entryChordLen = midStartL.distanceTo(entryTarget) * 0.6;
        const entryBlend = new THREE.CubicBezierCurve3(
            midStartL,
            midStartL.clone().addScaledVector(entryDir, entryChordLen),
            entryTarget.clone().addScaledVector(cwTangent(entryTargetAngle), -entryChordLen),
            entryTarget
        );
        insidePoints.push(midStartL, ...entryBlend.getPoints(12).slice(1));
        insidePoints.push(...trimmed.slice(1));

        const exitSource = trimmed[trimmed.length - 1];
        const exitSourceAngle = Math.atan2(exitSource.z, exitSource.x);
        const exitChordLen = midEndL.distanceTo(exitSource) * 0.6;
        const exitBlend = new THREE.CubicBezierCurve3(
            exitSource,
            exitSource.clone().addScaledVector(cwTangent(exitSourceAngle), exitChordLen),
            midEndL.clone().addScaledVector(exitDir, -exitChordLen),
            midEndL
        );
        insidePoints.push(...exitBlend.getPoints(12).slice(1));
    }
    else {
        // Very short path (e.g. adjacent exits) — direct Bézier
        const chordLen = midStartL.distanceTo(midEndL) * 0.4;
        const directBlend = new THREE.CubicBezierCurve3(
            midStartL,
            midStartL.clone().addScaledVector(entryDir, chordLen),
            midEndL.clone().addScaledVector(exitDir, -chordLen),
            midEndL
        );
        insidePoints.push(midStartL, ...directBlend.getPoints(16).slice(1));
    }

    const toWorld = (arr: THREE.Vector3[]) => arr.map((p) => roundabout.localToWorld(p.clone()));

    return {
        approach: toWorld([startL, midStartL]).map(v3ToTuple),
        inside: toWorld(insidePoints).map(v3ToTuple),
        exit: toWorld([midEndL, endL]).map(v3ToTuple),
    };
}
