import * as THREE from "three";
import { RingLaneStructure, RoundaboutExitStructure } from "../types/roundabout";
import { ExitStructure } from "../types/intersection";
import { ExitConfig, JunctionConfig, JunctionObject } from "../types/types";
import { Tuple3, InternalParts, NodeKey, Graph, Edge, RouteSegment, EdgePart, Route, Node } from "../types/simulation";
import { polylineLength } from "./helpers/routeHelpers";


/* =========================================================
   Helper utilities for working with the simplified Route
   ========================================================= */

/**
 * Get all points from a route (concatenates all segment points without duplication)
 */
export function getRoutePoints(route: Route): Tuple3[] {
    if (!route.segments || route.segments.length === 0) return [];
    
    const allPoints: Tuple3[] = [];
    let prevLast: Tuple3 | null = null;
    
    for (const seg of route.segments) {
        for (let i = 0; i < seg.points.length; i++) {
            const pt = seg.points[i];
            // Skip first point if it's duplicate of previous segment's last
            if (i === 0 && prevLast && pointsEqual(prevLast, pt)) continue;
            allPoints.push(pt);
        }
        if (seg.points.length > 0) {
            prevLast = seg.points[seg.points.length - 1];
        }
    }
    
    return allPoints;
}

/**
 * Estimate average spacing between consecutive points in a route
 */
export function estimateRouteSpacing(route: Route): number {
    const points = getRoutePoints(route);
    if (points.length < 2) return 1.0;
    
    const totalLen = polylineLength(points);
    return totalLen / (points.length - 1);
}

/**
 * Get total route length
 */
export function getRouteLength(route: Route): number {
    return polylineLength(getRoutePoints(route));
}

/**
 * Compute cumulative distance info for each segment in a route
 * Returns array with s0 (start distance) and s1 (end distance) for each segment
 */
export function computeSegmentDistances(route: Route): Array<{ s0: number; s1: number }> {
    const result: Array<{ s0: number; s1: number }> = [];
    
    if (!route.segments || route.segments.length === 0) return result;
    
    let cumulative = 0;
    
    for (const seg of route.segments) {
        const s0 = cumulative;
        const segLen = polylineLength(seg.points);
        const s1 = s0 + segLen;
        
        result.push({ s0, s1 });
        cumulative = s1;
    }
    
    return result;
}

/* =========================================================
   Lane point helper (unchanged semantics)
   ========================================================= */

/**
 * Returns the midpoint of a lane strip boundary pair, in WORLD space.
 * For single-lane exits, returns the lane line start/end directly.
 */
export function getLaneWorldPoint(
    group: THREE.Group,
    exitIndex: number,
    laneIndex: number,
    which: "start" | "end",
    dir: "in" | "out"
) {
    let exitInfo: RoundaboutExitStructure | ExitStructure;
    if (group.userData.type === "roundabout") {
        exitInfo = group.userData.roundaboutExitStructure[exitIndex];
    } 
    else {
        exitInfo = group.userData.exitInfo[exitIndex];
    }

    const lanes = exitInfo.laneLines;

    if (lanes.length === 1) {
        const lane = lanes[0];
        return (which === "start" ? lane.line.start : lane.line.end).clone();
    }

    // laneLines are boundaries, so "strips" == boundaries - 1
    const numStrips = lanes.length - 1;
    const clamped = Math.max(0, Math.min(laneIndex, numStrips - 1));

    // Your existing convention: inbound is reversed index order
    const idx = dir === "in" ? numStrips - 1 - clamped : clamped;

    const leftLane = lanes[idx];
    const rightLane = lanes[idx + 1] ?? leftLane;

    const leftPoint = which === "start" ? leftLane.line.start : leftLane.line.end;
    const rightPoint = which === "start" ? rightLane.line.start : rightLane.line.end;

    // midpoint between boundary lines, then convert local -> world
    return group.localToWorld(leftPoint.clone().add(rightPoint.clone()).multiplyScalar(0.5));
}

/* =========================================================
   Internal path generation -> parts (approach/inside/exit)
   ========================================================= */



function v3ToTuple(v: THREE.Vector3): Tuple3 {
    return [v.x, v.y, v.z];
}

/**
 * Intersection path split into 3 phases:
 * - approach: inbound lane up to stop/give-way
 * - inside: traversal within junction area
 * - exit: outbound lane away from junction
 */
function generateIntersectionPathParts(
    intersection: THREE.Group,
    entry: { exitIndex: number; laneIndex: number },
    exit: { exitIndex: number; laneIndex: number }
): InternalParts {
    const startPoint = getLaneWorldPoint(intersection, entry.exitIndex, entry.laneIndex, "end", "in");
    const midStart = getLaneWorldPoint(intersection, entry.exitIndex, entry.laneIndex, "start", "in");

    const midEnd = getLaneWorldPoint(intersection, exit.exitIndex, exit.laneIndex, "start", "out");
    const endPoint = getLaneWorldPoint(intersection, exit.exitIndex, exit.laneIndex, "end", "out");

    // Entry tangent: direction car is traveling when entering junction
    const dirEntry = midStart.clone().sub(startPoint).normalize();
    // Exit tangent: direction car will be traveling when leaving junction
    const dirExit = endPoint.clone().sub(midEnd).normalize();

    const approachV: THREE.Vector3[] = [startPoint, midStart];

    const angle = dirEntry.angleTo(dirExit);
    const dist = midStart.distanceTo(midEnd);
    const MIN_CURVE_ANGLE = 0.05; // ~3 degrees

    let insideV: THREE.Vector3[];
    if (angle < MIN_CURVE_ANGLE) {
        // Nearly straight path - just connect the endpoints
        insideV = [midStart, midEnd];
    } else {
        // For smooth curves, place control points along the tangent directions
        // Scale control distance based on turn sharpness and distance
        // Sharper turns need control points closer to endpoints for tighter arcs
        // Gentler turns can have control points further out for smoother arcs
        const turnFactor = Math.min(1.0, angle / Math.PI); // 0 for straight, 1 for U-turn
        const controlDist = dist * (0.3 + 0.4 * (1 - turnFactor)); // 0.3-0.7 of distance
        
        // P1: continue along entry direction from midStart
        const p1 = midStart.clone().add(dirEntry.clone().multiplyScalar(controlDist));
        // P2: come from exit direction toward midEnd (back along exit tangent)
        const p2 = midEnd.clone().sub(dirExit.clone().multiplyScalar(controlDist));
        
        const curve = new THREE.CubicBezierCurve3(midStart, p1, p2, midEnd);
        insideV = [midStart, ...curve.getPoints(20).slice(1, -1), midEnd];
    }

    const exitV: THREE.Vector3[] = [midEnd, endPoint];

    return {
        approach: approachV.map(v3ToTuple),
        inside: insideV.map(v3ToTuple),
        exit: exitV.map(v3ToTuple),
    };
}

/**
 * Roundabout path split into 3 phases:
 * - approach: inbound lane up to give-way
 * - inside: ring traversal + connectors
 * - exit: outbound lane away from roundabout
 */
function generateRoundaboutPathParts(
    roundabout: THREE.Group,
    entry: { exitIndex: number; laneIndex: number },
    exit: { exitIndex: number; laneIndex: number }
): InternalParts {
    // ---- World-space lane endpoints ----
    const startW = getLaneWorldPoint(roundabout, entry.exitIndex, entry.laneIndex, "end", "in");
    const midStartW = getLaneWorldPoint(roundabout, entry.exitIndex, entry.laneIndex, "start", "in");
    const midEndW = getLaneWorldPoint(roundabout, exit.exitIndex, exit.laneIndex, "start", "out");
    const endW = getLaneWorldPoint(roundabout, exit.exitIndex, exit.laneIndex, "end", "out");

    // ---- Convert to LOCAL space ----
    const startL = roundabout.worldToLocal(startW.clone());
    const midStartL = roundabout.worldToLocal(midStartW.clone());
    const midEndL = roundabout.worldToLocal(midEndW.clone());
    const endL = roundabout.worldToLocal(endW.clone());

    const ringLines: RingLaneStructure[] = roundabout.userData.roundaboutRingStructure;
    const numRingStrips = ringLines.length - 1;
    const outermostStrip = numRingStrips - 1;
    const exitConfigs: ExitConfig[] = roundabout.userData.exitConfig;
    const numExits = exitConfigs.length;

    const TAU = Math.PI * 2;
    const startAngle = Math.atan2(midStartL.z, midStartL.x);
    const endAngle = Math.atan2(midEndL.z, midEndL.x);

    // CW from +Y in Three.js XZ = angles increase
    let deltaCW = THREE.MathUtils.euclideanModulo(endAngle - startAngle, TAU);
    if (entry.exitIndex === exit.exitIndex) deltaCW = TAU;
    if (deltaCW < 0.05 && entry.exitIndex !== exit.exitIndex) deltaCW = TAU;

    // ---- Lane selection based on entry lane ----
    let entryStripIndex: number;
    if (numRingStrips <= 1) {
        entryStripIndex = 0;
    } else {
        const depth = Math.min(entry.laneIndex, numRingStrips - 1);
        entryStripIndex = outermostStrip - depth;
    }
    const exitStripIndex = outermostStrip;
    const lanesCrossed = Math.abs(exitStripIndex - entryStripIndex);

    const getStripMidRadius = (strip: number) =>
        (ringLines[strip].radius + ringLines[strip + 1].radius) / 2;

    const entryRadius = getStripMidRadius(entryStripIndex);
    const exitRadius = getStripMidRadius(exitStripIndex);
    const needsLaneChange = lanesCrossed > 0;
    const y = midStartL.y;

    // ---- Helpers ----
    const ringPoint = (angle: number, radius: number) =>
        new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);

    const cwTangent = (angle: number) =>
        new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));

    const makeArc = (fromAngle: number, toAngle: number, radius: number, segs: number): THREE.Vector3[] => {
        const pts: THREE.Vector3[] = [];
        const delta = toAngle - fromAngle;
        if (Math.abs(delta) < 0.001) return [ringPoint(fromAngle, radius)];
        for (let i = 0; i <= segs; i++) {
            pts.push(ringPoint(fromAngle + delta * (i / segs), radius));
        }
        return pts;
    };

    // ---- Find all intermediate exits in CW travel order ----
    // For each, compute the out→in boundary angle
    type ExitBoundary = { angle: number; delta: number };
    const intermediateBoundaries: ExitBoundary[] = [];

    for (let ei = 0; ei < numExits; ei++) {
        if (ei === entry.exitIndex || ei === exit.exitIndex) continue;

        const config = exitConfigs[ei];
        const numOutLanes = config.laneCount - config.numLanesIn;

        // Find CW-most out-lane
        let outFarDelta = -1;
        let outFarAngle = startAngle;
        for (let li = 0; li < numOutLanes; li++) {
            const ptW = getLaneWorldPoint(roundabout, ei, li, "start", "out");
            const ptL = roundabout.worldToLocal(ptW.clone());
            const ptAngle = Math.atan2(ptL.z, ptL.x);
            const d = THREE.MathUtils.euclideanModulo(ptAngle - startAngle, TAU);
            if (d > outFarDelta) {
                outFarDelta = d;
                outFarAngle = ptAngle;
            }
        }

        // Find CCW-most in-lane (first in-lane after the out-lanes)
        let inNearDelta = Infinity;
        let inNearAngle = outFarAngle;
        for (let li = 0; li < config.numLanesIn; li++) {
            const ptW = getLaneWorldPoint(roundabout, ei, li, "start", "in");
            const ptL = roundabout.worldToLocal(ptW.clone());
            const ptAngle = Math.atan2(ptL.z, ptL.x);
            const d = THREE.MathUtils.euclideanModulo(ptAngle - startAngle, TAU);
            if (d > outFarDelta && d < inNearDelta) {
                inNearDelta = d;
                inNearAngle = ptAngle;
            }
        }

        const outD = THREE.MathUtils.euclideanModulo(outFarAngle - startAngle, TAU);
        const inD = THREE.MathUtils.euclideanModulo(inNearAngle - startAngle, TAU);
        const boundaryDelta = (outD + inD) / 2;

        // Only include if it's between entry and exit
        if (boundaryDelta > 0.05 && boundaryDelta < deltaCW - 0.05) {
            intermediateBoundaries.push({
                angle: startAngle + boundaryDelta,
                delta: boundaryDelta,
            });
        }
    }

    // Sort by CW delta (travel order)
    intermediateBoundaries.sort((a, b) => a.delta - b.delta);

    // ---- Plan lane changes: 1 per exit, using the LAST N exits ----
    const laneWidth = exitConfigs[exit.exitIndex].laneWidth;
    const singleMergeArcLength = (2 * laneWidth) / ((entryRadius + exitRadius) / 2);

    // Pick the last `lanesCrossed` boundaries for lane changes
    const mergePoints: { startAngle: number; fromStrip: number; toStrip: number }[] = [];
    if (needsLaneChange && intermediateBoundaries.length > 0) {
        const usable = intermediateBoundaries.slice(-lanesCrossed);
        for (let i = 0; i < usable.length; i++) {
            mergePoints.push({
                startAngle: usable[i].angle,
                fromStrip: entryStripIndex + i,
                toStrip: entryStripIndex + i + 1,
            });
        }
    }

    // If not enough intermediate exits, merge remaining lanes right at the start
    const lanesHandled = mergePoints.length;
    if (needsLaneChange && lanesHandled < lanesCrossed) {
        const remaining = lanesCrossed - lanesHandled;
        for (let i = 0; i < remaining; i++) {
            // Merge immediately after entry
            mergePoints.unshift({
                startAngle: startAngle + singleMergeArcLength * i,
                fromStrip: entryStripIndex + i,
                toStrip: entryStripIndex + i + 1,
            });
        }
        // Re-sort by angle
        mergePoints.sort((a, b) => a.startAngle - b.startAngle);
    }

    // ---- Build ring points: arc segments with lane changes between them ----
    const exitRingAngle = startAngle + deltaCW;
    const allRingPoints: THREE.Vector3[] = [];

    let currentAngle = startAngle;
    let currentStrip = entryStripIndex;

    for (const mp of mergePoints) {
        const currentRadius = getStripMidRadius(currentStrip);
        const nextRadius = getStripMidRadius(mp.toStrip);
        const mergeEnd = mp.startAngle + singleMergeArcLength;

        // Arc before this merge
        if (mp.startAngle - currentAngle > 0.01) {
            const arc = makeArc(currentAngle, mp.startAngle, currentRadius, 16);
            allRingPoints.push(...(allRingPoints.length > 0 ? arc.slice(1) : arc));
        }

        // Lane change Bézier (1 lane, 2*laneWidth arc distance)
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

    // Final arc to exit
    const finalRadius = getStripMidRadius(currentStrip);
    if (exitRingAngle - currentAngle > 0.01) {
        const arc = makeArc(currentAngle, exitRingAngle, finalRadius, 16);
        allRingPoints.push(...(allRingPoints.length > 0 ? arc.slice(1) : arc));
    }

    // ---- Trim and blend ----
    const TRIM = 5;
    const trimmed = allRingPoints.slice(TRIM, -TRIM || undefined);

    const insidePoints: THREE.Vector3[] = [];
    const entryDir = new THREE.Vector3().subVectors(midStartL, startL).normalize();
    const exitDir = new THREE.Vector3().subVectors(endL, midEndL).normalize();

    if (trimmed.length > 0) {
        // Entry Bézier
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

        // Middle ring points
        insidePoints.push(...trimmed.slice(1));

        // Exit Bézier
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
    } else {
        // Very short path — just Bézier directly
        const chordLen = midStartL.distanceTo(midEndL) * 0.4;
        const directBlend = new THREE.CubicBezierCurve3(
            midStartL,
            midStartL.clone().addScaledVector(entryDir, chordLen),
            midEndL.clone().addScaledVector(exitDir, -chordLen),
            midEndL
        );
        insidePoints.push(midStartL, ...directBlend.getPoints(16).slice(1));
    }

    // ---- Assemble ----
    const approachL: THREE.Vector3[] = [startL, midStartL];
    const exitL: THREE.Vector3[] = [midEndL, endL];

    const toWorld = (arr: THREE.Vector3[]) =>
        arr.map((p) => roundabout.localToWorld(p.clone()));

    return {
        approach: toWorld(approachL).map(v3ToTuple),
        inside: toWorld(insidePoints).map(v3ToTuple),
        exit: toWorld(exitL).map(v3ToTuple),
    };
}
/* =========================================================
   Link lane centreline helper
   ========================================================= */

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

/* =========================================================
   Graph internals (NOT exported)
   ========================================================= */



const nodeKeyOf = (n: Node): NodeKey => `${n.structureID}-${n.exitIndex}-${n.direction}-${n.laneIndex}`;



const addEdge = (graph: Graph, from: Node, e: Edge) => {
    const k = nodeKeyOf(from);
    const arr = graph.get(k);
    if (arr) arr.push(e);
    else graph.set(k, [e]);
};

const outCount = (config: ExitConfig) => config.laneCount - config.numLanesIn;
const inCount = (config: ExitConfig) => config.numLanesIn;

/* =========================================================
   Per-segment smoothing + fixed-spacing resample
   (simple + fast, avoids whole-route partitioning)
   ========================================================= */

function toV3(p: Tuple3) {
    return new THREE.Vector3(p[0], p[1], p[2]);
}

function resamplePolylineFixedSpacing(pts: THREE.Vector3[], spacing: number) {
    if (!pts || pts.length < 2) return pts?.map((p) => p.clone()) ?? [];

    const out: THREE.Vector3[] = [];
    out.push(pts[0].clone());

    let acc = 0;

    for (let i = 1; i < pts.length; i++) {
        let a = pts[i - 1].clone();
        const b = pts[i].clone();

        let segLen = a.distanceTo(b);
        if (segLen < 1e-9) continue;

        while (acc + segLen >= spacing) {
            const remain = spacing - acc;
            const t = remain / Math.max(1e-9, segLen);

            const p = a.clone().lerp(b, t);
            out.push(p);

            a = p;
            segLen = a.distanceTo(b);
            acc = 0;
        }

        acc += segLen;
    }

    const last = pts[pts.length - 1];
    if (out[out.length - 1].distanceToSquared(last) > 1e-10) out.push(last.clone());
    return out;
}

function smoothAndResampleSegment(
    points: Tuple3[],
    spacing: number,
    tension: number
): Tuple3[] {
    const control = points.map(toV3);
    if (control.length < 2) return control.map(v3ToTuple);

    // Calculate approximate length
    let approxLen = 0;
    for (let i = 1; i < control.length; i++) approxLen += control[i].distanceTo(control[i - 1]);

    // Calculate the number of points needed based on spacing
    // Use 3x oversampling for smooth curve interpolation before resampling
    const targetPoints = Math.ceil(approxLen / Math.max(1e-6, spacing));
    const denseN = Math.max(50, Math.min(1500, targetPoints * 3));

    const curve = new THREE.CatmullRomCurve3(control, false, "centripetal", tension);
    const dense = curve.getPoints(denseN);
    const sampled = resamplePolylineFixedSpacing(dense, spacing);

    return sampled.map(v3ToTuple);
}

function pointsEqual(a: Tuple3, b: Tuple3) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz < 1e-10;
}

function buildRouteFromSegments(
    buildSegments: RouteSegment[],
    opts?: { spacing?: number; tension?: number; smoothPerSegment?: boolean }
): Route {
    const spacing = opts?.spacing ?? 1.0;
    const tension = opts?.tension ?? 0.5;
    const smoothPerSegment = opts?.smoothPerSegment ?? true;

    const outSegments: RouteSegment[] = [];
    let prevLast: Tuple3 | null = null;

    for (const seg of buildSegments) {
        const pts = seg.points;

        // smooth+resample each segment independently
        const resampled = smoothPerSegment ? smoothAndResampleSegment(pts, spacing, tension) : pts;

        let finalPts = resampled;

        // de-dupe joint vs previous segment
        if (prevLast && finalPts.length && pointsEqual(prevLast, finalPts[0])) {
            finalPts = finalPts.slice(1);
        }
        if (!finalPts.length) continue;

        outSegments.push({
            from: seg.from,
            to: seg.to,
            phase: seg.phase,
            points: finalPts,
        });

        prevLast = finalPts[finalPts.length - 1];
    }

    return { segments: outSegments };
}

/* =========================================================
   Route generation (graph + DFS)
   ========================================================= */

export function generateAllRoutes(
    junction: JunctionConfig,
    junctionObjectRefs: THREE.Group[],
    opts?: {
        maxSteps?: number;
        disallowUTurn?: boolean;

        /** fixed spacing in metres for per-segment resample */
        spacing?: number;

        /** Catmull-Rom tension for per-segment smoothing */
        tension?: number;

        /** if false, uses raw polylines (no smoothing/resample) */
        smoothPerSegment?: boolean;
    }
) {
    const maxSteps = opts?.maxSteps ?? 30;
    const disallowUTurn = opts?.disallowUTurn ?? true;

    const spacing = opts?.spacing ?? 1.0;
    const tension = opts?.tension ?? 0.5;
    const smoothPerSegment = opts?.smoothPerSegment ?? true;

    // Map structure IDs -> object configs
    const objByID = new Map<string, JunctionObject>();
    for (const obj of junction.junctionObjects) objByID.set(obj.id, obj);

    // Build route graph
    const mainG: Graph = new Map();

    // Track which lane endpoints are connected by links
    const hasIncomingLink = new Set<NodeKey>();
    const hasOutgoingLink = new Set<NodeKey>();

    const buildInternalParts = (
        objType: "intersection" | "roundabout",
        group: THREE.Group,
        eIN: number,
        lIN: number,
        eOUT: number,
        lOUT: number
    ): EdgePart[] => {
        const parts =
            objType === "intersection"
                ? generateIntersectionPathParts(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT })
                : generateRoundaboutPathParts(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT });

        return [
            { phase: "approach", points: parts.approach },
            { phase: "inside", points: parts.inside },
            { phase: "exit", points: parts.exit },
        ];
    };

    /* --------------------------
       1) Internal routing
       -------------------------- */
    for (const obj of junction.junctionObjects) {
        const group = junctionObjectRefs.find((g) => g.userData?.id === obj.id);
        if (!group) continue;

        if (obj.type !== "intersection" && obj.type !== "roundabout") continue;

        const exitConfigs = obj.config.exitConfig;

        for (let eIN = 0; eIN < exitConfigs.length; eIN++) {
            const numIncomingLanes = inCount(exitConfigs[eIN]);

            // available exits clockwise from entry (excluding u-turn)
            const availableExitIndices: number[] = [];
            for (let offset = 1; offset < exitConfigs.length; offset++) {
                const e = (eIN + offset) % exitConfigs.length;
                if (disallowUTurn && e === eIN) continue;
                if (outCount(exitConfigs[e]) > 0) availableExitIndices.push(e);
            }
            if (availableExitIndices.length === 0) continue;

            const totalOutgoingLanes = availableExitIndices.reduce((sum, e) => sum + outCount(exitConfigs[e]), 0);

            const addInternal = (lIN: number, eOUT: number, lOUT: number) => {
                const from: Node = { structureID: obj.id, exitIndex: eIN, direction: "in", laneIndex: lIN };
                const to: Node = { structureID: obj.id, exitIndex: eOUT, direction: "out", laneIndex: lOUT };

                const parts = buildInternalParts(obj.type as "intersection" | "roundabout", group, eIN, lIN, eOUT, lOUT);
                addEdge(mainG, from, { kind: "internal", to, parts });
            };

            if (obj.type === "roundabout") {
                // Roundabout: each incoming lane maps 1:1 to an exit in CW order
                // Lane 0 (left/nearside) → 1st exit, lane 1 → 2nd exit, etc.
                // Last lane → full loop back to same exit (U-turn)
                // Always exit on out lane 0
                const roundaboutExits = [...availableExitIndices, eIN]; // add self as last (full loop)
                for (let lIN = 0; lIN < numIncomingLanes; lIN++) {
                    if (lIN < roundaboutExits.length) {
                        const eOUT = roundaboutExits[lIN];
                        addInternal(lIN, eOUT, 0);
                    }
                }
            } else if (numIncomingLanes === totalOutgoingLanes) {
                // Case 1: strict 1-to-1 mapping
                let globalOutLane = 0;
                for (const eOUT of availableExitIndices) {
                    const numOutLanes = outCount(exitConfigs[eOUT]);
                    for (let lOUT = 0; lOUT < numOutLanes; lOUT++) {
                        const lIN = globalOutLane;
                        addInternal(lIN, eOUT, lOUT);
                        globalOutLane++;
                    }
                }
            } else if (numIncomingLanes < totalOutgoingLanes) {
                // Case 2: more outgoing - last inbound lane receives remaining
                let globalOutLane = 0;
                for (const eOUT of availableExitIndices) {
                    const numOutLanes = outCount(exitConfigs[eOUT]);
                    for (let lOUT = 0; lOUT < numOutLanes; lOUT++) {
                        const lIN = Math.min(globalOutLane, numIncomingLanes - 1);
                        addInternal(lIN, eOUT, lOUT);
                        globalOutLane++;
                    }
                }
            } else {
                // Case 3: more incoming - carry over to later exits
                let remainingIncomingLanes = numIncomingLanes;
                let currentIncomingLaneStart = 0;

                for (const eOUT of availableExitIndices) {
                    const numOutLanes = outCount(exitConfigs[eOUT]);
                    if (remainingIncomingLanes === 0) break;

                    if (remainingIncomingLanes <= numOutLanes) {
                        for (let i = 0; i < numOutLanes; i++) {
                            const lIN = currentIncomingLaneStart + Math.min(i, remainingIncomingLanes - 1);
                            addInternal(lIN, eOUT, i);
                        }
                        remainingIncomingLanes = 0;
                    } else {
                        for (let i = 0; i < numOutLanes; i++) {
                            const lIN = currentIncomingLaneStart + i;
                            addInternal(lIN, eOUT, i);
                        }
                        currentIncomingLaneStart += numOutLanes;
                        remainingIncomingLanes -= numOutLanes;
                    }
                }
            }
        }
    }

    /* --------------------------
       2) Links between components
       -------------------------- */
    for (const link of junction.junctionLinks) {
        const linkGroup = junctionObjectRefs.find((g) => g.userData?.type === "link" && g.userData?.id === link.id);
        if (!linkGroup) continue;

        const laneCurves = linkGroup.userData?.laneCurves as Tuple3[][] | undefined;
        if (!laneCurves || laneCurves.length < 2) continue;

        const [a, b] = link.objectPair;
        const objA = objByID.get(a.structureID);
        const objB = objByID.get(b.structureID);
        if (!objA || !objB) continue;

        const configA = objA.config.exitConfig[a.exitIndex];
        const configB = objB.config.exitConfig[b.exitIndex];

        const outA = outCount(configA);
        const inA = inCount(configA);

        const outB = outCount(configB);
        const inB = inCount(configB);

        const lanesAB = Math.min(outA, inB);
        const lanesBA = Math.min(outB, inA);

        // AB (A out -> B in)
        for (let i = 0; i < lanesAB; i++) {
            const flippedI = lanesAB - 1 - i;
            const leftBoundary = inA + flippedI;
            const rightBoundary = inA + flippedI + 1;

            if (!laneCurves[leftBoundary] || !laneCurves[rightBoundary]) {
                console.warn(`Missing boundaries for AB lane ${i}: ${leftBoundary}, ${rightBoundary}`);
                continue;
            }

            const points = getMidCurve(laneCurves[leftBoundary], laneCurves[rightBoundary]);

            const from: Node = { structureID: a.structureID, exitIndex: a.exitIndex, direction: "out", laneIndex: i };
            const to: Node = { structureID: b.structureID, exitIndex: b.exitIndex, direction: "in", laneIndex: i };

            addEdge(mainG, from, { kind: "link", to, points });
            hasOutgoingLink.add(nodeKeyOf(from));
            hasIncomingLink.add(nodeKeyOf(to));
        }

        // BA (B out -> A in)
        for (let i = 0; i < lanesBA; i++) {
            const leftBoundary = i;
            const rightBoundary = i + 1;

            if (!laneCurves[leftBoundary] || !laneCurves[rightBoundary]) {
                console.warn(`Missing boundaries for BA lane ${i}: ${leftBoundary}, ${rightBoundary}`);
                continue;
            }

            const points = getMidCurve(laneCurves[rightBoundary], laneCurves[leftBoundary]).slice().reverse();

            const from: Node = { structureID: b.structureID, exitIndex: b.exitIndex, direction: "out", laneIndex: i };
            const to: Node = { structureID: a.structureID, exitIndex: a.exitIndex, direction: "in", laneIndex: i };

            addEdge(mainG, from, { kind: "link", to, points });
            hasOutgoingLink.add(nodeKeyOf(from));
            hasIncomingLink.add(nodeKeyOf(to));
        }
    }

    /* --------------------------
       3) World start/end identification (unlinked endpoints)
       -------------------------- */
    const starts: Node[] = [];
    const ends = new Set<NodeKey>();

    for (const obj of junction.junctionObjects) {
        const exitConfigs = obj.config.exitConfig;

        for (let e = 0; e < exitConfigs.length; e++) {
            // inbound lanes with nothing linking into them
            for (let l = 0; l < inCount(exitConfigs[e]); l++) {
                const n: Node = { structureID: obj.id, exitIndex: e, direction: "in", laneIndex: l };
                const kk = nodeKeyOf(n);
                if (!hasIncomingLink.has(kk)) starts.push(n);
            }

            // outbound lanes with nothing linking out of them
            for (let l = 0; l < outCount(exitConfigs[e]); l++) {
                const n: Node = { structureID: obj.id, exitIndex: e, direction: "out", laneIndex: l };
                const kk = nodeKeyOf(n);
                if (!hasOutgoingLink.has(kk)) ends.add(kk);
            }
        }
    }

    /* --------------------------
       4) DFS enumerate routes
       -------------------------- */
    const routes: Route[] = [];

    for (const sNode of starts) {
        const startStructureID = sNode.structureID;

        const stack: {
            node: Node;
            segments: RouteSegment[];
            visited: Set<NodeKey>;
            leftStart: boolean;
        }[] = [
                {
                    node: sNode,
                    segments: [],
                    visited: new Set([nodeKeyOf(sNode)]),
                    leftStart: false,
                },
            ];

        while (stack.length) {
            const current = stack.pop()!;
            const currentKey = nodeKeyOf(current.node);

            if (ends.has(currentKey)) {
                routes.push(
                    buildRouteFromSegments(current.segments, {
                        spacing,
                        tension,
                        smoothPerSegment,
                    })
                );
                continue;
            }

            if (current.segments.length >= maxSteps) continue;

            for (const e of mainG.get(currentKey) ?? []) {
                const toNode = e.to;
                const toKey = nodeKeyOf(toNode);

                if (current.visited.has(toKey)) continue;

                const nextLeftStart = current.leftStart || toNode.structureID !== startStructureID;

                // Your existing “no loop back to start object once left” behaviour
                if (disallowUTurn && current.leftStart && toNode.structureID === startStructureID) {
                    continue;
                }

                const expanded: RouteSegment[] =
                    e.kind === "internal"
                        ? e.parts.map((p) => ({
                            from: current.node,
                            to: toNode,
                            phase: p.phase,
                            points: p.points,
                        }))
                        : [
                            {
                                from: current.node,
                                to: toNode,
                                phase: "link",
                                points: e.points,
                            },
                        ];

                stack.push({
                    node: toNode,
                    segments: [...current.segments, ...expanded],
                    visited: new Set([...current.visited, toKey]),
                    leftStart: nextLeftStart,
                });
            }
        }
    }

    return { routes, graph: mainG, starts, ends };
}
