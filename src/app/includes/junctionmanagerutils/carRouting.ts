import * as THREE from "three";
import { RingLaneStructure } from "../types/roundabout";
import { ExitConfig, JunctionConfig, JunctionObject } from "../types/types";



export type Tuple3 = [number, number, number];
export type SegmentPhase = "approach" | "inside" | "exit" | "link";
export type Direction = "in" | "out";

export type Node = {
    structureID: string;
    exitIndex: number;
    direction: Direction;
    laneIndex: number;
};

export type RouteSegment = {
    from: Node;
    to: Node;
    phase: SegmentPhase;
    points: Tuple3[];
};

export type Route = {
    segments: RouteSegment[];
};

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
 * Compute polyline length for an array of points
 */
function polylineLength(pts: Tuple3[]): number {
    if (!pts || pts.length < 2) return 0;
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i-1][0];
        const dy = pts[i][1] - pts[i-1][1];
        const dz = pts[i][2] - pts[i-1][2];
        len += Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    return len;
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
    let exitInfo: any;
    if (group.userData.type === "roundabout") {
        exitInfo = group.userData.roundaboutExitStructure[exitIndex];
    } else {
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

type InternalParts = {
    approach: Tuple3[];
    inside: Tuple3[];
    exit: Tuple3[];
};

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

    const dirEntry = midStart.clone().sub(startPoint).normalize();
    const dirExit = midEnd.clone().sub(endPoint).normalize();

    function intersect2D(
        p1: THREE.Vector3,
        d1: THREE.Vector3,
        p2: THREE.Vector3,
        d2: THREE.Vector3
    ): THREE.Vector3 | null {
        // Solve p1 + t*d1 = p2 + s*d2 in XZ plane
        const a = d1.x,
            b = -d2.x,
            c = p2.x - p1.x;
        const d = d1.z,
            e = -d2.z,
            f = p2.z - p1.z;
        const denom = a * e - b * d;
        if (Math.abs(denom) < 1e-6) return null;
        const t = (c * e - b * f) / denom;
        const ip = p1.clone().add(d1.clone().multiplyScalar(t));
        ip.y = (p1.y + p2.y) / 2;
        return ip;
    }

    const centrePoint =
        intersect2D(startPoint, dirEntry, endPoint, dirExit) ||
        intersection.position.clone().applyMatrix4(intersection.matrixWorld);

    const approachV: THREE.Vector3[] = [startPoint, midStart];

    const angle = dirEntry.angleTo(dirExit);
    const MIN_CURVE_ANGLE = 0.01;

    let insideV: THREE.Vector3[];
    if (angle < MIN_CURVE_ANGLE) {
        insideV = [midStart, midEnd];
    } else {
        const curve = new THREE.CubicBezierCurve3(midStart, centrePoint, centrePoint, midEnd);
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

    const maxStrip = Math.max(0, ringLines.length - 2);
    const ringStripIndex = Math.min(maxStrip, Math.max(0, maxStrip - entry.laneIndex));

    const innerRadius = ringLines[ringStripIndex].radius;
    const outerRadius = ringLines[ringStripIndex + 1].radius;
    const midRadius = (innerRadius + outerRadius) / 2;

    const startAngle = Math.atan2(midStartL.z, midStartL.x);
    const endAngle = Math.atan2(midEndL.z, midEndL.x);

    const TAU = Math.PI * 2;
    const deltaCCW = THREE.MathUtils.euclideanModulo(endAngle - startAngle, TAU);

    const segments = 40;

    // ---- Circle points in LOCAL space ----
    const circleL: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const a = startAngle + deltaCCW * t;
        circleL.push(new THREE.Vector3(Math.cos(a) * midRadius, midStartL.y, Math.sin(a) * midRadius));
    }

    // ---- Entry/exit Beziers in LOCAL space ----
    const curveEntryL = new THREE.CubicBezierCurve3(midStartL, circleL[1], circleL[2], circleL[3]);
    const curveExitL = new THREE.CubicBezierCurve3(
        circleL[circleL.length - 4],
        circleL[circleL.length - 3],
        circleL[circleL.length - 2],
        midEndL
    );

    const approachL: THREE.Vector3[] = [startL, midStartL];

    const insideL: THREE.Vector3[] = [
        midStartL,
        ...curveEntryL.getPoints(10).slice(1, -1),
        ...circleL.slice(3, -3),
        ...curveExitL.getPoints(10).slice(1, -1),
        midEndL,
    ];

    const exitL: THREE.Vector3[] = [midEndL, endL];

    const toWorld = (arr: THREE.Vector3[]) => arr.map((p) => roundabout.localToWorld(p.clone()));

    const approachW = toWorld(approachL);
    const insideW = toWorld(insideL);
    const exitW = toWorld(exitL);

    return {
        approach: approachW.map(v3ToTuple),
        inside: insideW.map(v3ToTuple),
        exit: exitW.map(v3ToTuple),
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

type NodeKey = string;

const nodeKeyOf = (n: Node): NodeKey =>
    `${n.structureID}-${n.exitIndex}-${n.direction}-${n.laneIndex}`;

type EdgePart = {
    phase: Exclude<SegmentPhase, "link">; // "approach" | "inside" | "exit"
    points: Tuple3[];
};

type Edge =
    | { kind: "internal"; to: Node; parts: EdgePart[] }
    | { kind: "link"; to: Node; points: Tuple3[] };

type Graph = Map<NodeKey, Edge[]>;

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
        let pts = seg.points;

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

            if (numIncomingLanes === totalOutgoingLanes) {
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
