import * as THREE from "three";
import { ExitStructure } from "./types/intersection";
import { RingLaneStructure, RoundaboutExitStructure, RoundaboutObject } from "./types/roundabout";
import { start } from "repl";
import { ExitConfig, JunctionConfig, JunctionObject, LaneStructure } from "./types/types";
import { ThickLineHandle } from "../components/ThickLine";
import { exit } from "process";
import { driverSide } from "./defaults";


function getLaneWorldPoint(
    group: THREE.Group,
    exitIndex: number,
    laneIndex: number,
    which: "start" | "end",
    dir: "in" | "out"
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
        const lane = lanes[0];
        return (which === "start" ? lane.line.start : lane.line.end).clone();
    }

    const numLanes = lanes.length - 1;         // boundaries -> strips
    const clamped = Math.max(0, Math.min(laneIndex, numLanes - 1));


    const idx =
        driverSide === "left"
            ? (dir === "in" ? (numLanes - 1 - clamped) : clamped)
            : (dir === "in" ? clamped : (numLanes - 1 - clamped));

    const leftLane = lanes[idx];
    const rightLane = lanes[idx + 1] ?? leftLane;

    const leftPoint = which === "start" ? leftLane.line.start : leftLane.line.end;
    const rightPoint = which === "start" ? rightLane.line.start : rightLane.line.end;

    return group.localToWorld(leftPoint.clone().add(rightPoint.clone()).multiplyScalar(0.5));
}



export function generateIntersectionPath(
    intersection: THREE.Group,
    entry: { exitIndex: number, laneIndex: number },
    exit: { exitIndex: number, laneIndex: number }
): [number, number, number][] {

    const startPoint = getLaneWorldPoint(intersection, entry.exitIndex, entry.laneIndex, "end", "in");
    const midStart = getLaneWorldPoint(intersection, entry.exitIndex, entry.laneIndex, "start", "in");

    const midEnd = getLaneWorldPoint(intersection, exit.exitIndex, exit.laneIndex, "start", "out");
    const endPoint = getLaneWorldPoint(intersection, exit.exitIndex, exit.laneIndex, "end", "out");

    const dirEntry = midStart.clone().sub(startPoint).normalize();
    const dirExit = endPoint.clone().sub(midEnd).normalize();

    function intersect2D(p1: THREE.Vector3, d1: THREE.Vector3, p2: THREE.Vector3, d2: THREE.Vector3): THREE.Vector3 | null {
        // Solve p1 + t*d1 = p2 + s*d2
        const a = d1.x, b = -d2.x, c = p2.x - p1.x;
        const d = d1.z, e = -d2.z, f = p2.z - p1.z;
        const denom = a * e - b * d;
        if (Math.abs(denom) < 1e-6) return null; // parallel
        const t = (c * e - b * f) / denom;
        const intersection = p1.clone().add(d1.clone().multiplyScalar(t));
        intersection.y = (p1.y + p2.y) / 2;
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

    // Ensure matrixWorld is correct
    roundabout.updateWorldMatrix(true, false);

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

    const maxStrip = Math.max(0, ringLines.length - 2); // strips = boundaries-1
    const ringStripIndex = Math.min(maxStrip, Math.max(0, (maxStrip - entry.laneIndex)));

    const innerRadius = ringLines[ringStripIndex].radius;
    const outerRadius = ringLines[ringStripIndex + 1].radius;
    const midRadius = (innerRadius + outerRadius) / 2;

    const startAngle = Math.atan2(midStartL.z, midStartL.x);
    const endAngle = Math.atan2(midEndL.z, midEndL.x);

    const anticlockwise = driverSide !== "left";

    const TAU = Math.PI * 2;

    const deltaCCW = THREE.MathUtils.euclideanModulo(endAngle - startAngle, TAU);
    const deltaCW = deltaCCW - TAU;

    let deltaAngle: number;

    if (anticlockwise) {
        deltaAngle = deltaCW;
    }
    else {
        deltaAngle = deltaCCW;
    }

    const segments = 40;

    // ---- Circle points in LOCAL space ----
    const circleL: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const a = startAngle + deltaAngle * t;
        circleL.push(
            new THREE.Vector3(
                Math.cos(a) * midRadius,
                midStartL.y,
                Math.sin(a) * midRadius
            )
        );
    }

    // ---- Entry/exit Beziers in LOCAL space ----
    const curveEntryL = new THREE.CubicBezierCurve3(
        midStartL,
        circleL[1],
        circleL[2],
        circleL[3]
    );

    const curveExitL = new THREE.CubicBezierCurve3(
        circleL[circleL.length - 4],
        circleL[circleL.length - 3],
        circleL[circleL.length - 2],
        midEndL
    );

    // ---- Assemble LOCAL path ----
    const localPts: THREE.Vector3[] = [];
    localPts.push(startL, midStartL);
    localPts.push(...curveEntryL.getPoints(10).slice(1));
    localPts.push(...circleL.slice(3, -3));
    localPts.push(...curveExitL.getPoints(10).slice(1));
    localPts.push(midEndL, endL);

    // ---- Convert to WORLD once ----
    const worldPts = localPts.map(p => roundabout.localToWorld(p.clone()));

    return worldPts.map(v => [v.x, v.y, v.z] as [number, number, number]);
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


type Direction = "in" | "out";

export type LaneEndPoint = {
    structureID: string;
    exitIndex: number;
    direction: Direction;
    laneIndex: number;
};

type NodeKey = string;

const keyOf = (n: LaneEndPoint): NodeKey => `${n.structureID}-${n.exitIndex}-${n.direction}-${n.laneIndex}`;

type Edge = {
    to: NodeKey;
    points: [number, number, number][];
    kind: "internal" | "link";
};

type Graph = Map<NodeKey, Edge[]>;

const addEdge = (graph: Graph, from: NodeKey, e: Edge) => {
    const arr = graph.get(from);
    if (arr) {
        arr.push(e);
    }
    else {
        graph.set(from, [e]);
    }
};

const outCount = (config: ExitConfig) => config.laneCount - config.numLanesIn;

const inCount = (config: ExitConfig) => config.numLanesIn;

const getGroupById = (refs: THREE.Group[], id: string) => refs.find(g => g.userData?.id === id);

const getLinkGroupById = (refs: THREE.Group[], id: string) => refs.find(g => g.userData?.type === "link" && g.userData?.id === id);

function outboundBoundaryStart(outA: number, inA: number, driverSide: "left" | "right") {
    // laneCurves are boundary lines; strips are between boundary[i] and boundary[i+1]
    // Convention: laneCurves[0..inA] = one carriageway, laneCurves[inA..inA+outA] = the other
    return driverSide === "left" ? inA : 0;
}

function inboundBoundaryStart(outA: number, inA: number, driverSide: "left" | "right") {
    return driverSide === "left" ? 0 : outA;
}

export function generateAllRoutes(junction: JunctionConfig, junctionObjectRefs: THREE.Group[], opts?: {
    maxSteps?: number;
    disallowUTurn?: boolean;
}) {
    const maxSteps = opts?.maxSteps ?? 30;
    const disallowUTurn = opts?.disallowUTurn ?? true;

    // First we map structure IDs to object configs

    const objByID = new Map<string, JunctionObject>();
    for (const obj of junction.junctionObjects) {
        objByID.set(obj.id, obj);
    }

    // Build route graph

    const mainG: Graph = new Map();


    // Trac which lane endpoints are connected by links

    const hasIncomingLink = new Set<NodeKey>();
    const hasOutgoingLink = new Set<NodeKey>();

    // First we look at internal routing for structures


    for (const obj of junction.junctionObjects) {
        const group = getGroupById(junctionObjectRefs, obj.id);
        if (!group) {
            continue;
        }

        const exitConfigs = obj.config.exitConfig;


        // Enumerate possible exits into an object
        for (let eIN = 0; eIN < exitConfigs.length; eIN++) {

            const numIncomingLanes = inCount(exitConfigs[eIN]);

            // Get available exit indices (excluding U-turn) in clockwise order from entry
            const availableExitIndices: number[] = [];
            for (let offset = 1; offset < exitConfigs.length; offset++) {
                const e = (eIN + offset) % exitConfigs.length;
                if (disallowUTurn && e === eIN) continue;
                if (outCount(exitConfigs[e]) > 0) {
                    availableExitIndices.push(e);
                }
            }

            if (availableExitIndices.length === 0) continue;


            // Calculate total outgoing lanes across ALL exits
            const totalOutgoingLanes = availableExitIndices.reduce(
                (sum, e) => sum + outCount(exitConfigs[e]),
                0
            );


            // Apply your logic based on incoming vs total outgoing
            if (numIncomingLanes === totalOutgoingLanes) {
                // Case 1: Equal - strict 1-to-1 mapping

                let globalOutLane = 0;
                for (const eOUT of availableExitIndices) {
                    const numOutLanes = outCount(exitConfigs[eOUT]);
                    for (let lOUT = 0; lOUT < numOutLanes; lOUT++) {
                        const lIN = globalOutLane;

                        const from: LaneEndPoint = {
                            structureID: obj.id,
                            exitIndex: eIN,
                            direction: "in",
                            laneIndex: lIN
                        };

                        const to: LaneEndPoint = {
                            structureID: obj.id,
                            exitIndex: eOUT,
                            direction: "out",
                            laneIndex: lOUT
                        };

                        const points = obj.type === "intersection"
                            ? generateIntersectionPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT })
                            : generateRoundaboutPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT });

                        addEdge(mainG, keyOf(from), { to: keyOf(to), points, kind: "internal" });
                        globalOutLane++;
                    }
                }

            }
            else if (numIncomingLanes < totalOutgoingLanes) {
                // Case 2: More outgoing - 1-to-1 then last lane gets remaining

                let globalOutLane = 0;
                for (const eOUT of availableExitIndices) {
                    const numOutLanes = outCount(exitConfigs[eOUT]);
                    for (let lOUT = 0; lOUT < numOutLanes; lOUT++) {
                        const lIN = Math.min(globalOutLane, numIncomingLanes - 1);

                        const from: LaneEndPoint = {
                            structureID: obj.id,
                            exitIndex: eIN,
                            direction: "in",
                            laneIndex: lIN
                        };

                        const to: LaneEndPoint = {
                            structureID: obj.id,
                            exitIndex: eOUT,
                            direction: "out",
                            laneIndex: lOUT
                        };

                        const points = obj.type === "intersection"
                            ? generateIntersectionPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT })
                            : generateRoundaboutPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT });

                        addEdge(mainG, keyOf(from), { to: keyOf(to), points, kind: "internal" });
                        globalOutLane++;
                    }
                }

            }
            else {
                // Case 3: More incoming - 1-to-1 with surplus carrying over (recursive logic)

                let remainingIncomingLanes = numIncomingLanes;
                let currentIncomingLaneStart = 0;

                for (const eOUT of availableExitIndices) {
                    const numOutLanes = outCount(exitConfigs[eOUT]);

                    if (remainingIncomingLanes === 0) break;


                    // Apply the same logic recursively for this sub-problem
                    if (remainingIncomingLanes === numOutLanes) {
                        // Sub-case 1: Equal
                        for (let i = 0; i < numOutLanes; i++) {
                            const lIN = currentIncomingLaneStart + i;

                            const from: LaneEndPoint = {
                                structureID: obj.id,
                                exitIndex: eIN,
                                direction: "in",
                                laneIndex: lIN
                            };

                            const to: LaneEndPoint = {
                                structureID: obj.id,
                                exitIndex: eOUT,
                                direction: "out",
                                laneIndex: i
                            };

                            const points = obj.type === "intersection"
                                ? generateIntersectionPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: i })
                                : generateRoundaboutPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: i });

                            addEdge(mainG, keyOf(from), { to: keyOf(to), points, kind: "internal" });
                        }
                        remainingIncomingLanes = 0;

                    }
                    else if (remainingIncomingLanes < numOutLanes) {
                        // Sub-case 2: More out lanes
                        for (let i = 0; i < numOutLanes; i++) {
                            const lIN = currentIncomingLaneStart + Math.min(i, remainingIncomingLanes - 1);

                            const from: LaneEndPoint = {
                                structureID: obj.id,
                                exitIndex: eIN,
                                direction: "in",
                                laneIndex: lIN
                            };

                            const to: LaneEndPoint = {
                                structureID: obj.id,
                                exitIndex: eOUT,
                                direction: "out",
                                laneIndex: i
                            };

                            const points = obj.type === "intersection"
                                ? generateIntersectionPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: i })
                                : generateRoundaboutPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: i });

                            addEdge(mainG, keyOf(from), { to: keyOf(to), points, kind: "internal" });
                        }
                        remainingIncomingLanes = 0;

                    }
                    else {
                        // Sub-case 3: More in lanes - carry over
                        for (let i = 0; i < numOutLanes; i++) {
                            const lIN = currentIncomingLaneStart + i;

                            const from: LaneEndPoint = {
                                structureID: obj.id,
                                exitIndex: eIN,
                                direction: "in",
                                laneIndex: lIN
                            };

                            const to: LaneEndPoint = {
                                structureID: obj.id,
                                exitIndex: eOUT,
                                direction: "out",
                                laneIndex: i
                            };

                            const points = obj.type === "intersection"
                                ? generateIntersectionPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: i })
                                : generateRoundaboutPath(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: i });

                            addEdge(mainG, keyOf(from), { to: keyOf(to), points, kind: "internal" });
                        }
                        currentIncomingLaneStart += numOutLanes;
                        remainingIncomingLanes -= numOutLanes;
                    }
                }
            }
        }
    }


    // Next we look at links between components

    for (const link of junction.junctionLinks) {
        const linkGroup = getLinkGroupById(junctionObjectRefs, link.id);
        if (!linkGroup) {
            continue;
        }

        const laneCurves = linkGroup.userData?.laneCurves as [number, number, number][][] | undefined;
        if (!laneCurves || laneCurves.length < 2) {
            continue;
        }


        const [a, b] = link.objectPair;
        const objA = objByID.get(a.structureID);
        const objB = objByID.get(b.structureID);
        if (!objA || !objB) {
            continue;
        }


        const configA = objA.config.exitConfig[a.exitIndex];
        const configB = objB.config.exitConfig[b.exitIndex];

        const outA = outCount(configA);
        const inA = inCount(configA);

        const outB = outCount(configB);
        const inB = inCount(configB);

        const lanesAB = Math.min(outA, inB);
        const lanesBA = Math.min(outB, inA);


        const outStartA = outboundBoundaryStart(outA, inA, driverSide);
        const inStartA = inboundBoundaryStart(outA, inA, driverSide);

        // AB
        for (let i = 0; i < lanesAB; i++) {
            const flippedI = lanesAB - 1 - i;
            const leftBoundary = outStartA + flippedI;
            const rightBoundary = outStartA + flippedI + 1;

            if (!laneCurves[leftBoundary] || !laneCurves[rightBoundary]) {
                console.warn(`Missing boundaries for lane ${i}: ${leftBoundary}, ${rightBoundary}`);
                continue;
            }

            const points = getMidCurve(laneCurves[leftBoundary], laneCurves[rightBoundary]);

            const from: LaneEndPoint = { structureID: a.structureID, exitIndex: a.exitIndex, direction: "out", laneIndex: i };
            const to: LaneEndPoint = { structureID: b.structureID, exitIndex: b.exitIndex, direction: "in", laneIndex: i };

            addEdge(mainG, keyOf(from), { to: keyOf(to), points, kind: "link" });
            hasOutgoingLink.add(keyOf(from));
            hasIncomingLink.add(keyOf(to));
        }

        // BA
        for (let i = 0; i < lanesBA; i++) {
            const leftBoundary = inStartA + i;
            const rightBoundary = inStartA + i + 1;

            if (!laneCurves[leftBoundary] || !laneCurves[rightBoundary]) {
                console.warn(`Missing boundaries for lane ${i}: ${leftBoundary}, ${rightBoundary}`);
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


    // Indetify world points i.e., unlinked exits

    const starts: NodeKey[] = [];
    const ends = new Set<NodeKey>();

    for (const obj of junction.junctionObjects) {
        const exitConfigs = obj.config.exitConfig;


        for (let e = 0; e < exitConfigs.length; e++) {


            // Start points where inbound lanes that nothing links into
            for (let l = 0; l < inCount(exitConfigs[e]); l++) {

                const n: LaneEndPoint = {
                    structureID: obj.id,
                    exitIndex: e,
                    direction: "in",
                    laneIndex: l
                };

                const kk = keyOf(n);
                if (!hasIncomingLink.has(kk)) {
                    starts.push(kk);
                }

            }

            // End points where outbound lanes that nothing links from
            for (let l = 0; l < outCount(exitConfigs[e]); l++) {

                const n: LaneEndPoint = {
                    structureID: obj.id,
                    exitIndex: e,
                    direction: "out",
                    laneIndex: l
                };

                const kk = keyOf(n);

                if (!hasOutgoingLink.has(kk)) {
                    ends.add(kk);
                }
            }
        }
    }


    // Now we enumerate the routes with DFS

    type Route = {
        nodes: NodeKey[];
        points: [number, number, number][];
    };

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
            points: [number, number, number][];
            visited: Set<NodeKey>;
            leftStart: boolean; // NEW
        }[] = [{
            node: s,
            nodes: [s],
            points: [],
            visited: new Set([s]),
            leftStart: false,
        }];

        while (stack.length) {
            const current = stack.pop()!;

            if (ends.has(current.node)) {
                // If you want to exclude only "true loops" (left then came back), this is enough:
                // current.leftStart could still be false for routes that never leave start object (that's fine).
                routes.push({ nodes: current.nodes, points: current.points });
                continue;
            }

            if (current.nodes.length >= maxSteps) continue;

            for (const e of (mainG.get(current.node) ?? [])) {
                if (current.visited.has(e.to)) continue;

                const toStructureID = structureIdOf(e.to);
                const nextLeftStart =
                    current.leftStart || (toStructureID !== startStructureID);

                if (
                    disallowUTurn &&
                    current.leftStart &&
                    toStructureID === startStructureID
                ) {
                    continue;
                }

                stack.push({
                    node: e.to,
                    nodes: [...current.nodes, e.to],
                    points: [...current.points, ...e.points],
                    visited: new Set([...current.visited, e.to]),
                    leftStart: nextLeftStart,
                });
            }

        }
    }


    return { routes, graph: mainG, starts, ends }

}