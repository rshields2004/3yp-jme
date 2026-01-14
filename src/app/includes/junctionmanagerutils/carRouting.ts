import * as THREE from "three";
import { RingLaneStructure } from "../types/roundabout";
import { ExitConfig, JunctionConfig, JunctionObject } from "../types/types";

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

type SegmentPhase = "approach" | "inside" | "exit" | "link";

type InternalParts = {
    approach: [number, number, number][];
    inside: [number, number, number][];
    exit: [number, number, number][];
    full: [number, number, number][];
};

function v3ToTuple(v: THREE.Vector3): [number, number, number] {
    return [v.x, v.y, v.z];
}

/**
 * Generate intersection path split into 3 logical phases:
 * - approach: inbound lane travel up to the stop/give-way line
 * - inside: traversal within the junction area
 * - exit: outbound lane travel away from the junction
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

    function intersect2D(p1: THREE.Vector3, d1: THREE.Vector3, p2: THREE.Vector3, d2: THREE.Vector3): THREE.Vector3 | null {
        // Solve p1 + t*d1 = p2 + s*d2 in XZ plane
        const a = d1.x, b = -d2.x, c = p2.x - p1.x;
        const d = d1.z, e = -d2.z, f = p2.z - p1.z;
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

    // Build full without duplicating joints
    const fullV: THREE.Vector3[] = [
        ...approachV,
        ...insideV.slice(1),
        ...exitV.slice(1),
    ];

    return {
        approach: approachV.map(v3ToTuple),
        inside: insideV.map(v3ToTuple),
        exit: exitV.map(v3ToTuple),
        full: fullV.map(v3ToTuple),
    };
}

export function generateIntersectionPath(
    intersection: THREE.Group,
    entry: { exitIndex: number; laneIndex: number },
    exit: { exitIndex: number; laneIndex: number }
): [number, number, number][] {
    return generateIntersectionPathParts(intersection, entry, exit).full;
}

/**
 * Generate roundabout path split into 3 logical phases:
 * - approach: inbound lane travel up to the give-way line
 * - inside: traversal on the ring + entry/exit connectors
 * - exit: outbound lane travel away from the roundabout
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

    const fullW: THREE.Vector3[] = [
        ...approachW,
        ...insideW.slice(1),
        ...exitW.slice(1),
    ];

    return {
        approach: approachW.map(v3ToTuple),
        inside: insideW.map(v3ToTuple),
        exit: exitW.map(v3ToTuple),
        full: fullW.map(v3ToTuple),
    };
}

export function generateRoundaboutPath(
    roundabout: THREE.Group,
    entry: { exitIndex: number; laneIndex: number },
    exit: { exitIndex: number; laneIndex: number }
): [number, number, number][] {
    return generateRoundaboutPathParts(roundabout, entry, exit).full;
}

export function getMidCurve(
    curveA: [number, number, number][],
    curveB: [number, number, number][]
): [number, number, number][] {
    if (!curveA || !curveB) return [];
    if (curveA.length !== curveB.length) {
        console.warn("Curves have different lengths, using min length");
    }

    const length = Math.min(curveA.length, curveB.length);
    const midCurve: [number, number, number][] = [];

    for (let i = 0; i < length; i++) {
        const [ax, ay, az] = curveA[i];
        const [bx, by, bz] = curveB[i];
        midCurve.push([(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]);
    }

    return midCurve;
}

type Direction = "in" | "out";

export type LaneEndPoint = {
    structureID: string;
    exitIndex: number;
    direction: Direction;
    laneIndex: number;
};

type NodeKey = string;

const keyOf = (n: LaneEndPoint): NodeKey => `${n.structureID}-${n.exitIndex}-${n.direction}-${n.laneIndex}`;

type EdgePart = {
    phase: SegmentPhase;
    points: [number, number, number][];
};

type Edge = {
    to: NodeKey;
    points: [number, number, number][];
    kind: "internal" | "link";
    parts?: EdgePart[]; // internal edges will have approach/inside/exit
};

type Graph = Map<NodeKey, Edge[]>;

const addEdge = (graph: Graph, from: NodeKey, e: Edge) => {
    const arr = graph.get(from);
    if (arr) arr.push(e);
    else graph.set(from, [e]);
};

const outCount = (config: ExitConfig) => config.laneCount - config.numLanesIn;
const inCount = (config: ExitConfig) => config.numLanesIn;

/** Segment-level route data for simulation */
export type RouteSegment = {
    from: NodeKey;
    to: NodeKey;
    kind: "internal" | "link";
    phase: SegmentPhase; // NEW: approach/inside/exit/link

    /** Resampled points for ONLY this segment, fixed spacing */
    points: [number, number, number][];

    /** Distance range along the whole route */
    s0: number;
    s1: number;
};

/** Rich Route structure */
export type Route = {
    /** Node keys in visit order */
    nodes: NodeKey[];

    /** Ordered segments: approach/inside/exit/link/... */
    segments: RouteSegment[];

    /** Whole route resampled points (fixed spacing) */
    points: [number, number, number][];

    /** Smoothed path */
    curve: THREE.CatmullRomCurve3;

    /** Sampling spacing in metres */
    spacing: number;

    /** Total route length in metres */
    length: number;
};

// --------------------------
// Helpers for route building
// --------------------------

function toV3(p: [number, number, number]) {
    return new THREE.Vector3(p[0], p[1], p[2]);
}

function polylineLength(pts: [number, number, number][]): number {
    if (!pts || pts.length < 2) return 0;
    let len = 0;
    let prev = toV3(pts[0]);
    for (let i = 1; i < pts.length; i++) {
        const cur = toV3(pts[i]);
        len += cur.distanceTo(prev);
        prev = cur;
    }
    return len;
}

function pointsEqual(a: [number, number, number], b: [number, number, number]) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz < 1e-10;
}

function concatWithoutDuplicateJoints(chunks: [number, number, number][][]): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const pts of chunks) {
        if (!pts || pts.length === 0) continue;
        for (let i = 0; i < pts.length; i++) {
            const v = toV3(pts[i]);
            if (out.length && i === 0) {
                const last = out[out.length - 1];
                if (last.distanceToSquared(v) < 1e-10) continue;
            }
            out.push(v);
        }
    }
    return out;
}

/**
 * Resample a curve into points spaced ~`spacing` metres apart.
 * Uses dense polyline + arc-length interpolation.
 */
function resampleCurveFixedSpacing(
    curve: THREE.CatmullRomCurve3,
    spacing: number,
    denseSegments = 2000
): { points: THREE.Vector3[]; distances: number[]; length: number } {
    const dense = curve.getPoints(denseSegments);
    if (dense.length < 2) return { points: dense, distances: [0], length: 0 };

    const cum: number[] = new Array(dense.length);
    cum[0] = 0;
    for (let i = 1; i < dense.length; i++) {
        cum[i] = cum[i - 1] + dense[i].distanceTo(dense[i - 1]);
    }

    const total = cum[cum.length - 1];
    if (total <= 1e-9) return { points: [dense[0].clone()], distances: [0], length: 0 };

    const targets: number[] = [0];
    for (let s = spacing; s < total; s += spacing) targets.push(s);
    if (targets[targets.length - 1] !== total) targets.push(total);

    const sampled: THREE.Vector3[] = [];
    const sampledS: number[] = [];

    let j = 1;
    for (const s of targets) {
        while (j < cum.length && cum[j] < s) j++;

        if (j >= cum.length) {
            sampled.push(dense[dense.length - 1].clone());
            sampledS.push(total);
            continue;
        }

        const s1 = cum[j];
        const s0 = cum[j - 1];
        const t = (s - s0) / Math.max(1e-9, s1 - s0);

        const p0 = dense[j - 1];
        const p1 = dense[j];
        sampled.push(p0.clone().lerp(p1, t));
        sampledS.push(s);
    }

    return { points: sampled, distances: sampledS, length: total };
}

function lowerBound(arr: number[], x: number) {
    let lo = 0,
        hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] < x) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function upperBound(arr: number[], x: number) {
    let lo = 0,
        hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= x) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

type RouteEdgeForBuild = {
    from: NodeKey;
    to: NodeKey;
    kind: "internal" | "link";
    phase: SegmentPhase;
    points: [number, number, number][];
};

/**
 * Build a Route from ordered edges:
 * - smooth with CatmullRomCurve3 (centripetal to avoid loops)
 * - resample fixed spacing for consistent resolution
 * - partition resampled points back into per-edge segments (ordered)
 */
function buildRouteFromEdges(
    nodes: NodeKey[],
    edges: RouteEdgeForBuild[],
    opts?: { spacing?: number; tension?: number; denseSegments?: number }
): Route {
    const spacing = opts?.spacing ?? 1.0;
    const tension = opts?.tension ?? 0.5;
    const denseSegments = opts?.denseSegments ?? 2000;

    const control = concatWithoutDuplicateJoints(edges.map((e) => e.points));

    const curve = new THREE.CatmullRomCurve3(control, false, "centripetal", tension);

    if (control.length < 2) {
        return {
            nodes,
            segments: [],
            points: control.map(v3ToTuple),
            curve,
            spacing,
            length: 0,
        };
    }

    const { points: sampledV, distances: sampledS, length: totalLen } = resampleCurveFixedSpacing(
        curve,
        spacing,
        denseSegments
    );

    const sampled = sampledV.map(v3ToTuple);

    // Partition per edge using the original polyline-length proportions as stable boundaries.
    const edgePolyLens = edges.map((e) => polylineLength(e.points));
    const polyTotal = edgePolyLens.reduce((a, b) => a + b, 0);

    if (polyTotal <= 1e-9 || edges.length === 0) {
        return {
            nodes,
            segments: edges.map((e) => ({
                from: e.from,
                to: e.to,
                kind: e.kind,
                phase: e.phase,
                points: sampled,
                s0: 0,
                s1: totalLen,
            })),
            points: sampled,
            curve,
            spacing,
            length: totalLen,
        };
    }

    const polyCum: number[] = [0];
    for (let i = 0; i < edgePolyLens.length; i++) {
        polyCum.push(polyCum[polyCum.length - 1] + edgePolyLens[i]);
    }

    const segBoundsS = polyCum.map((d) => (d / polyTotal) * totalLen);

    const segments: RouteSegment[] = [];
    for (let i = 0; i < edges.length; i++) {
        const e = edges[i];

        const s0 = segBoundsS[i];
        const s1 = segBoundsS[i + 1];

        const i0 = lowerBound(sampledS, s0 - 1e-6);
        const i1 = Math.max(i0, upperBound(sampledS, s1 + 1e-6) - 1);

        let segPts = sampled.slice(i0, i1 + 1);

        // avoid duplicating the join point between consecutive segments
        if (segments.length && segPts.length) {
            const prevLast = segments[segments.length - 1].points.at(-1);
            const curFirst = segPts[0];
            if (prevLast && pointsEqual(prevLast, curFirst)) {
                segPts = segPts.slice(1);
            }
        }

        segments.push({
            from: e.from,
            to: e.to,
            kind: e.kind,
            phase: e.phase,
            points: segPts,
            s0,
            s1,
        });
    }

    return {
        nodes,
        segments,
        points: sampled,
        curve,
        spacing,
        length: totalLen,
    };
}

// --------------------------
// Route generation (graph+DFS)
// --------------------------

export function generateAllRoutes(
    junction: JunctionConfig,
    junctionObjectRefs: THREE.Group[],
    opts?: {
        maxSteps?: number;
        disallowUTurn?: boolean;

        /** resampling spacing in metres */
        spacing?: number;

        /** Catmull-Rom tension */
        tension?: number;

        /** density used for resampling */
        denseSegments?: number;
    }
) {
    const maxSteps = opts?.maxSteps ?? 30;
    const disallowUTurn = opts?.disallowUTurn ?? true;

    const spacing = opts?.spacing ?? 1.0;
    const tension = opts?.tension ?? 0.5;
    const denseSegments = opts?.denseSegments ?? 2000;

    // Map structure IDs -> object configs
    const objByID = new Map<string, JunctionObject>();
    for (const obj of junction.junctionObjects) objByID.set(obj.id, obj);

    // Build route graph
    const mainG: Graph = new Map();

    // Track which lane endpoints are connected by links
    const hasIncomingLink = new Set<NodeKey>();
    const hasOutgoingLink = new Set<NodeKey>();

    const buildInternalEdge = (
        objType: "intersection" | "roundabout",
        group: THREE.Group,
        eIN: number,
        lIN: number,
        eOUT: number,
        lOUT: number
    ): { full: [number, number, number][]; parts: EdgePart[] } => {
        const parts =
            objType === "intersection"
                ? generateIntersectionPathParts(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT })
                : generateRoundaboutPathParts(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT });

        return {
            full: parts.full,
            parts: [
                { phase: "approach", points: parts.approach },
                { phase: "inside", points: parts.inside },
                { phase: "exit", points: parts.exit },
            ],
        };
    };

    // 1) Internal routing for structures
    for (const obj of junction.junctionObjects) {
        const group = junctionObjectRefs.find((g) => g.userData?.id === obj.id);
        if (!group) continue;

        // Defensive: only junction structures (not links) have internal routing
        if (obj.type !== "intersection" && obj.type !== "roundabout") continue;

        const exitConfigs = obj.config.exitConfig;

        // For each incoming exit index
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

            if (numIncomingLanes === totalOutgoingLanes) {
                // Case 1: strict 1-to-1 mapping
                let globalOutLane = 0;
                for (const eOUT of availableExitIndices) {
                    const numOutLanes = outCount(exitConfigs[eOUT]);
                    for (let lOUT = 0; lOUT < numOutLanes; lOUT++) {
                        const lIN = globalOutLane;

                        const from: LaneEndPoint = { structureID: obj.id, exitIndex: eIN, direction: "in", laneIndex: lIN };
                        const to: LaneEndPoint = { structureID: obj.id, exitIndex: eOUT, direction: "out", laneIndex: lOUT };

                        const built = buildInternalEdge(obj.type as "intersection" | "roundabout", group, eIN, lIN, eOUT, lOUT);

                        addEdge(mainG, keyOf(from), { to: keyOf(to), points: built.full, kind: "internal", parts: built.parts });

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

                        const from: LaneEndPoint = { structureID: obj.id, exitIndex: eIN, direction: "in", laneIndex: lIN };
                        const to: LaneEndPoint = { structureID: obj.id, exitIndex: eOUT, direction: "out", laneIndex: lOUT };

                        const built = buildInternalEdge(obj.type as "intersection" | "roundabout", group, eIN, lIN, eOUT, lOUT);

                        addEdge(mainG, keyOf(from), { to: keyOf(to), points: built.full, kind: "internal", parts: built.parts });

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

                    if (remainingIncomingLanes === numOutLanes) {
                        for (let i = 0; i < numOutLanes; i++) {
                            const lIN = currentIncomingLaneStart + i;

                            const from: LaneEndPoint = { structureID: obj.id, exitIndex: eIN, direction: "in", laneIndex: lIN };
                            const to: LaneEndPoint = { structureID: obj.id, exitIndex: eOUT, direction: "out", laneIndex: i };

                            const built = buildInternalEdge(obj.type as "intersection" | "roundabout", group, eIN, lIN, eOUT, i);

                            addEdge(mainG, keyOf(from), { to: keyOf(to), points: built.full, kind: "internal", parts: built.parts });
                        }
                        remainingIncomingLanes = 0;
                    } else if (remainingIncomingLanes < numOutLanes) {
                        for (let i = 0; i < numOutLanes; i++) {
                            const lIN = currentIncomingLaneStart + Math.min(i, remainingIncomingLanes - 1);

                            const from: LaneEndPoint = { structureID: obj.id, exitIndex: eIN, direction: "in", laneIndex: lIN };
                            const to: LaneEndPoint = { structureID: obj.id, exitIndex: eOUT, direction: "out", laneIndex: i };

                            const built = buildInternalEdge(obj.type as "intersection" | "roundabout", group, eIN, lIN, eOUT, i);

                            addEdge(mainG, keyOf(from), { to: keyOf(to), points: built.full, kind: "internal", parts: built.parts });
                        }
                        remainingIncomingLanes = 0;
                    } else {
                        for (let i = 0; i < numOutLanes; i++) {
                            const lIN = currentIncomingLaneStart + i;

                            const from: LaneEndPoint = { structureID: obj.id, exitIndex: eIN, direction: "in", laneIndex: lIN };
                            const to: LaneEndPoint = { structureID: obj.id, exitIndex: eOUT, direction: "out", laneIndex: i };

                            const built = buildInternalEdge(obj.type as "intersection" | "roundabout", group, eIN, lIN, eOUT, i);

                            addEdge(mainG, keyOf(from), { to: keyOf(to), points: built.full, kind: "internal", parts: built.parts });
                        }
                        currentIncomingLaneStart += numOutLanes;
                        remainingIncomingLanes -= numOutLanes;
                    }
                }
            }
        }
    }

    // 2) Links between components
    for (const link of junction.junctionLinks) {
        const linkGroup = junctionObjectRefs.find((g) => g.userData?.type === "link" && g.userData?.id === link.id);
        if (!linkGroup) continue;

        const laneCurves = linkGroup.userData?.laneCurves as [number, number, number][][] | undefined;
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

            const from: LaneEndPoint = { structureID: a.structureID, exitIndex: a.exitIndex, direction: "out", laneIndex: i };
            const to: LaneEndPoint = { structureID: b.structureID, exitIndex: b.exitIndex, direction: "in", laneIndex: i };

            addEdge(mainG, keyOf(from), { to: keyOf(to), points, kind: "link" });
            hasOutgoingLink.add(keyOf(from));
            hasIncomingLink.add(keyOf(to));
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

            const from: LaneEndPoint = { structureID: b.structureID, exitIndex: b.exitIndex, direction: "out", laneIndex: i };
            const to: LaneEndPoint = { structureID: a.structureID, exitIndex: a.exitIndex, direction: "in", laneIndex: i };

            addEdge(mainG, keyOf(from), { to: keyOf(to), points, kind: "link" });
            hasOutgoingLink.add(keyOf(from));
            hasIncomingLink.add(keyOf(to));
        }
    }

    // 3) World start/end identification (unlinked endpoints)
    const starts: NodeKey[] = [];
    const ends = new Set<NodeKey>();

    for (const obj of junction.junctionObjects) {
        const exitConfigs = obj.config.exitConfig;

        for (let e = 0; e < exitConfigs.length; e++) {
            // inbound lanes with nothing linking into them
            for (let l = 0; l < inCount(exitConfigs[e]); l++) {
                const n: LaneEndPoint = { structureID: obj.id, exitIndex: e, direction: "in", laneIndex: l };
                const kk = keyOf(n);
                if (!hasIncomingLink.has(kk)) starts.push(kk);
            }

            // outbound lanes with nothing linking out of them
            for (let l = 0; l < outCount(exitConfigs[e]); l++) {
                const n: LaneEndPoint = { structureID: obj.id, exitIndex: e, direction: "out", laneIndex: l };
                const kk = keyOf(n);
                if (!hasOutgoingLink.has(kk)) ends.add(kk);
            }
        }
    }

    // 4) DFS enumerate routes (store ordered edges, expand internal edges into approach/inside/exit, then build smooth+resampled route)
    const routes: Route[] = [];

    const structureIdOf = (k: NodeKey): string => {
        const parts = k.split("-");
        // keyOf = `${structureID}-${exitIndex}-${direction}-${laneIndex}`
        // structureID may contain '-' so it's everything except the last 3 parts
        return parts.slice(0, -3).join("-");
    };

    for (const s of starts) {
        const startStructureID = structureIdOf(s);

        const stack: {
            node: NodeKey;
            nodes: NodeKey[];
            edges: RouteEdgeForBuild[];
            visited: Set<NodeKey>;
            leftStart: boolean;
        }[] = [
            {
                node: s,
                nodes: [s],
                edges: [],
                visited: new Set([s]),
                leftStart: false,
            },
        ];

        while (stack.length) {
            const current = stack.pop()!;

            if (ends.has(current.node)) {
                routes.push(
                    buildRouteFromEdges(current.nodes, current.edges, {
                        spacing,
                        tension,
                        denseSegments,
                    })
                );
                continue;
            }

            if (current.nodes.length >= maxSteps) continue;

            for (const e of mainG.get(current.node) ?? []) {
                if (current.visited.has(e.to)) continue;

                const toStructureID = structureIdOf(e.to);
                const nextLeftStart = current.leftStart || toStructureID !== startStructureID;

                // This is your existing "no loop back to start object once left" behaviour
                if (disallowUTurn && current.leftStart && toStructureID === startStructureID) {
                    continue;
                }

                const expandedEdges: RouteEdgeForBuild[] =
                    e.kind === "internal" && e.parts?.length
                        ? e.parts.map((p) => ({
                              from: current.node,
                              to: e.to,
                              kind: "internal" as const,
                              phase: p.phase,
                              points: p.points,
                          }))
                        : [
                              {
                                  from: current.node,
                                  to: e.to,
                                  kind: "link" as const,
                                  phase: "link",
                                  points: e.points,
                              },
                          ];

                stack.push({
                    node: e.to,
                    nodes: [...current.nodes, e.to],
                    edges: [...current.edges, ...expandedEdges],
                    visited: new Set([...current.visited, e.to]),
                    leftStart: nextLeftStart,
                });
            }
        }
    }

    return { routes, graph: mainG, starts, ends };
}
