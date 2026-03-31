/**
 * routeGeneration.ts
 *
 * Routing graph construction and DFS route enumeration. Builds the full graph
 * of lane-to-lane edges across the junction network, then traces every valid
 * path from spawn point to despawn point.
 */

import * as THREE from "three";
import { ExitConfig, JunctionConfig, JunctionObject, LinkStructure } from "../../types/types";
import { Tuple3, NodeKey, Graph, Edge, RouteSegment, EdgePart, Route, Node } from "../../types/simulation";
import { nodeKeyOf } from "../helpers/segmentHelpers";
import { getStructureData } from "../../utils";
import { smoothAndResampleSegment, pointsEqual, getMidCurve } from "./geometryUtils";
import { generateIntersectionPathParts, generateRoundaboutPathParts } from "./junctionPaths";

// GRAPH HELPERS

/**
 * Inserts an edge into the routing graph from a given node.
 *
 * @param graph - the junction graph to add the edge to
 * @param from - source node key
 * @param edge - edge descriptor
 */
const addEdge = (graph: Graph, from: Node, edge: Edge) => {
    const key = nodeKeyOf(from);
    const arr = graph.get(key);
    if (arr) arr.push(edge);
    else graph.set(key, [edge]);
};

/**
 * Returns the number of outbound lanes on an exit.
 *
 * @param config - the exit configuration
 * @returns the number of outbound lanes
 */
const outCount = (config: ExitConfig) => config.laneCount - config.numLanesIn;

/**
 * Returns the number of inbound lanes on an exit.
 *
 * @param config - the exit configuration
 * @returns the number of inbound lanes
 */
const inCount = (config: ExitConfig) => config.numLanesIn;

// ROUTE ASSEMBLY

/**
 * Assembles a final {@link Route} from raw segments, smoothing and resampling
 * each segment independently. Strips any duplicate joining point at segment
 * boundaries.
 *
 * @param buildSegments - Raw segments to process, in order.
 * @param opts - Optional smoothing and spacing settings.
 * @returns A fully processed route ready for vehicle use.
 */
const buildRouteFromSegments = (
    buildSegments: RouteSegment[],
    opts?: { spacing?: number; tension?: number; smoothPerSegment?: boolean },
): Route => {
    const spacing = opts?.spacing ?? 1.0;
    const tension = opts?.tension ?? 0.5;
    const smoothPerSegment = opts?.smoothPerSegment ?? true;

    const outSegments: RouteSegment[] = [];
    let previousLast: Tuple3 | null = null;

    for (const seg of buildSegments) {
        const pts = seg.points;

        // Smooth and resample each segment independently at the configured spacing
        const resampled = smoothPerSegment ? smoothAndResampleSegment(pts, spacing, tension) : pts;

        let finalPts = resampled;

        // Strip the first point if it duplicates the last point of the previous segment
        if (previousLast && finalPts.length && pointsEqual(previousLast, finalPts[0])) {
            finalPts = finalPts.slice(1);
        }
        if (!finalPts.length) continue;

        outSegments.push({ from: seg.from, to: seg.to, phase: seg.phase, points: finalPts });
        previousLast = finalPts[finalPts.length - 1];
    }

    return { segments: outSegments };
};

// ROUTE GENERATION

/**
 * Top-level function that builds the full routing graph for the junction network
 * and enumerates every possible route through it via depth-first search.
 *
 * Runs in four passes:
 *  1. **Internal routing** — edges between every in/out lane pair within each junction.
 *  2. **Link edges** — connects junctions through JunctionLink road segments.
 *  3. **Start/end identification** — finds spawn (unlinked in-lanes) and despawn (unlinked out-lanes) points.
 *  4. **DFS enumeration** — traces every valid path from spawn to despawn, building Route objects.
 *
 * @param junction - The junction configuration containing all objects and links.
 * @param junctionObjectRefs - Three.js group refs for each junction object.
 * @param opts - Optional tuning parameters.
 * @returns All generated routes plus the raw graph, start nodes, and end node keys.
 */
export const generateAllRoutes = (
    junction: JunctionConfig,
    junctionObjectRefs: THREE.Group[],
    opts?: {
        maxSteps?: number;
        disallowUTurn?: boolean;
        /**
         * Fixed spacing in metres for per-segment resample.
         */
        spacing?: number;
        /**
         * Catmull-Rom tension for per-segment smoothing (0 = loose, 1 = tight).
         */
        tension?: number;
        /**
         * If `false`, uses raw polylines with no smoothing or resampling.
         */
        smoothPerSegment?: boolean;
    },
) => {
    const maxSteps = opts?.maxSteps ?? 30;
    const disallowUTurn = opts?.disallowUTurn ?? true;
    const spacing = opts?.spacing ?? 1.0;
    const tension = opts?.tension ?? 0.5;
    const smoothPerSegment = opts?.smoothPerSegment ?? true;

    // Build a fast ID -> config lookup to avoid repeated array searches
    const objByID = new Map<string, JunctionObject>();
    for (const obj of junction.junctionObjects) objByID.set(obj.id, obj);

    // The main routing graph: maps NodeKey -> outgoing edges
    const mainG: Graph = new Map();

    // Track which lane endpoints already have a link connected to them
    const hasIncomingLink = new Set<NodeKey>();
    const hasOutgoingLink = new Set<NodeKey>();

    /**
     * Builds the three EdgeParts (approach, inside, exit) for a single in->out lane pair
     * within one junction object, delegating to the appropriate path generator.
     *
     * @param objType - junction object type
     * @param group - the Three.js group for the junction object
     * @param eIN - entry exit index
     * @param lIN - entry lane index
     * @param eOUT - exit exit index
     * @param lOUT - exit lane index
     * @param exitConfigs - per-exit configuration array
     * @returns the generated array
     */
    const buildInternalParts = (
        objType: "intersection" | "roundabout",
        group: THREE.Group,
        eIN: number,
        lIN: number,
        eOUT: number,
        lOUT: number,
        exitConfigs: ExitConfig[]
    ): EdgePart[] => {
        const parts =
            objType === "intersection"
                ? generateIntersectionPathParts(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT })
                : generateRoundaboutPathParts(group, { exitIndex: eIN, laneIndex: lIN }, { exitIndex: eOUT, laneIndex: lOUT }, junction.laneWidth, exitConfigs);

        return [
            { phase: "approach", points: parts.approach },
            { phase: "inside", points: parts.inside },
            { phase: "exit", points: parts.exit },
        ];
    };

    /*
       Pass 1: Internal routing
       For each junction object, for every inbound exit lane, generate edges
       to every valid outbound exit lane. Three mapping cases handle different
       lane count ratios between the inbound and outbound sides.
    */
    for (const obj of junction.junctionObjects) {
        const group = junctionObjectRefs.find((g) => {
            const data = getStructureData ? getStructureData(g) : g.userData;
            return data?.id === obj.id;
        });
        if (!group) continue;
        if (obj.type !== "intersection" && obj.type !== "roundabout") continue;

        const exitConfigs = obj.config.exitConfig;

        for (let eIN = 0; eIN < exitConfigs.length; eIN++) {
            const numIncomingLanes = inCount(exitConfigs[eIN]);

            // Collect the available outbound exits in clockwise order, skipping U-turns
            const availableExitIndices: number[] = [];
            for (let offset = 1; offset < exitConfigs.length; offset++) {
                const e = (eIN + offset) % exitConfigs.length;
                if (disallowUTurn && e === eIN) continue;
                if (outCount(exitConfigs[e]) > 0) availableExitIndices.push(e);
            }
            if (availableExitIndices.length === 0) continue;

            const totalOutgoingLanes = availableExitIndices.reduce((sum, e) => sum + outCount(exitConfigs[e]), 0);

            /**
             * Shorthand to create and register one internal graph edge
             *
             * @param lIN - entry lane index
             * @param eOUT - exit exit index
             * @param lOUT - exit lane index
             */
            const addInternal = (lIN: number, eOUT: number, lOUT: number) => {
                const from: Node = { structureID: obj.id, exitIndex: eIN, direction: "in", laneIndex: lIN };
                const to: Node = { structureID: obj.id, exitIndex: eOUT, direction: "out", laneIndex: lOUT };
                const parts = buildInternalParts(obj.type as "intersection" | "roundabout", group, eIN, lIN, eOUT, lOUT, exitConfigs);
                addEdge(mainG, from, { kind: "internal", to, parts });
            };

            if (numIncomingLanes === totalOutgoingLanes) {
                // Case 1: Strict 1-to-1 mapping
                let globalOutLane = 0;
                for (const eOUT of availableExitIndices) {
                    for (let lOUT = 0; lOUT < outCount(exitConfigs[eOUT]); lOUT++) {
                        addInternal(globalOutLane, eOUT, lOUT);
                        globalOutLane++;
                    }
                }
            }
            else if (numIncomingLanes < totalOutgoingLanes) {
                // Case 2: More outgoing lanes — last incoming lane fans out to remaining outgoing
                let globalOutLane = 0;
                for (const eOUT of availableExitIndices) {
                    for (let lOUT = 0; lOUT < outCount(exitConfigs[eOUT]); lOUT++) {
                        addInternal(Math.min(globalOutLane, numIncomingLanes - 1), eOUT, lOUT);
                        globalOutLane++;
                    }
                }
            } else {
                // Case 3: More incoming lanes — excess carried forward to later exits
                let remainingIncomingLanes = numIncomingLanes;
                let currentIncomingLaneStart = 0;

                for (const eOUT of availableExitIndices) {
                    const numOutLanes = outCount(exitConfigs[eOUT]);
                    if (remainingIncomingLanes === 0) break;

                    if (remainingIncomingLanes <= numOutLanes) {
                        for (let i = 0; i < numOutLanes; i++) {
                            addInternal(currentIncomingLaneStart + Math.min(i, remainingIncomingLanes - 1), eOUT, i);
                        }
                        remainingIncomingLanes = 0;
                    }
                    else {
                        for (let i = 0; i < numOutLanes; i++) {
                            addInternal(currentIncomingLaneStart + i, eOUT, i);
                        }
                        currentIncomingLaneStart += numOutLanes;
                        remainingIncomingLanes -= numOutLanes;
                    }
                }
            }
        }
    }

    /*
       Pass 2: Links between junctions
       Read the pre-computed lane boundary curves from each LinkComponent's userData,
       compute lane centrelines via getMidCurve, and add bidirectional graph edges.
    */
    for (const link of junction.junctionLinks) {
        const linkGroup = junctionObjectRefs.find((g) => getStructureData(g)?.id === link.id);
        if (!linkGroup) {
            console.warn(`[LINK] No link group found for link id: ${link.id}`);
            continue;
        }
        const linkStructure = linkGroup.userData.linkStructure as LinkStructure;
        const laneCurves = linkStructure.laneCurves as Tuple3[][] | undefined;
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

        // Direction A -> B: laneCurves[inA..inA+outA-1] are the AB boundary curves
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
            console.debug(`[LINK AB] fromKey: ${nodeKeyOf(from)}, toKey: ${nodeKeyOf(to)}`);
        }

        // Direction B -> A: laneCurves[0..inA-1] are the BA boundary curves, reversed
        for (let i = 0; i < lanesBA; i++) {
            if (!laneCurves[i] || !laneCurves[i + 1]) {
                console.warn(`Missing boundaries for BA lane ${i}: ${i}, ${i + 1}`);
                continue;
            }
            const points = getMidCurve(laneCurves[i + 1], laneCurves[i]).slice().reverse();
            const from: Node = { structureID: b.structureID, exitIndex: b.exitIndex, direction: "out", laneIndex: i };
            const to: Node = { structureID: a.structureID, exitIndex: a.exitIndex, direction: "in", laneIndex: i };
            addEdge(mainG, from, { kind: "link", to, points });
            hasOutgoingLink.add(nodeKeyOf(from));
            hasIncomingLink.add(nodeKeyOf(to));
            console.debug(`[LINK BA] fromKey: ${nodeKeyOf(from)}, toKey: ${nodeKeyOf(to)}`);
        }
    }

    /*
       Pass 3: Identify spawn and despawn points
       Inbound lane with no incoming link = spawn point (vehicles appear here).
       Outbound lane with no outgoing link = despawn point (vehicles disappear here).
    */
    const starts: Node[] = [];
    const ends = new Set<NodeKey>();

    for (const obj of junction.junctionObjects) {
        const exitConfigs = obj.config.exitConfig;
        for (let e = 0; e < exitConfigs.length; e++) {
            for (let l = 0; l < inCount(exitConfigs[e]); l++) {
                const n: Node = { structureID: obj.id, exitIndex: e, direction: "in", laneIndex: l };
                const kk = nodeKeyOf(n);
                if (!hasIncomingLink.has(kk)) {
                    starts.push(n);
                    console.debug(`[SPAWN] start candidate: ${kk}`);
                }
            }
            for (let l = 0; l < outCount(exitConfigs[e]); l++) {
                const n: Node = { structureID: obj.id, exitIndex: e, direction: "out", laneIndex: l };
                const kk = nodeKeyOf(n);
                if (!hasOutgoingLink.has(kk)) {
                    ends.add(kk);
                    console.debug(`[END] end candidate: ${kk}`);
                }
            }
        }
    }

    /*
       Pass 4: DFS route enumeration
       For each spawn point, run a depth-first search through the graph. When a despawn
       point is reached, build and store the route. The "leftStart" flag prevents routes
       from looping back to the origin junction once they have moved on.
    */
    const routes: Route[] = [];

    for (const sNode of starts) {
        const startStructureID = sNode.structureID;

        const stack: {
            node: Node;
            segments: RouteSegment[];
            visited: Set<NodeKey>;
            leftStart: boolean;
        }[] = [{ node: sNode, segments: [], visited: new Set([nodeKeyOf(sNode)]), leftStart: false }];

        while (stack.length) {
            const current = stack.pop()!;
            const currentKey = nodeKeyOf(current.node);

            if (ends.has(currentKey)) {
                routes.push(buildRouteFromSegments(current.segments, { spacing, tension, smoothPerSegment }));
                continue;
            }
            if (current.segments.length >= maxSteps) continue;

            for (const e of mainG.get(currentKey) ?? []) {
                const toNode = e.to;
                const toKey = nodeKeyOf(toNode);
                if (current.visited.has(toKey)) continue;

                const nextLeftStart = current.leftStart || toNode.structureID !== startStructureID;
                if (disallowUTurn && current.leftStart && toNode.structureID === startStructureID) continue;

                const expanded: RouteSegment[] =
                    e.kind === "internal"
                        ? e.parts.map((p) => ({ from: current.node, to: toNode, phase: p.phase, points: p.points }))
                        : [{ from: current.node, to: toNode, phase: "link" as const, points: e.points }];

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
};