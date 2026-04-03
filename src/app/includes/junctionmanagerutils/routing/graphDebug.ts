/**
 * graphDebug.ts
 *
 * Temporary debug utility that converts the routing graph to Graphviz DOT
 * format for 2D visualisation. When node positions are supplied the output
 * uses the `neato` engine with pinned coordinates so the layout mirrors the
 * physical junction geometry. Nodes are grouped into subgraph clusters by
 * junction object so it is clear which structure each node belongs to.
 *
 * Paste the output into https://dreampuf.github.io/GraphvizOnline/ (select
 * the **neato** engine) to produce SVG/PNG for a report.
 *
 * Usage:
 *   const positions = buildNodePositions(junction, junctionObjectRefs.current);
 *   console.log(graphToDot(graph, starts, ends, positions, junction));
 */

import * as THREE from "three";
import { Graph, Node, NodeKey } from "../../types/simulation";
import { JunctionConfig, JunctionObject, ExitConfig } from "../../types/types";
import { nodeKeyOf } from "../helpers/segmentHelpers";
import { getLaneWorldPoint } from "./junctionPaths";
import { getStructureData } from "../../utils";

/**
 * Shorten a node key for readability: strips the long UUID prefix from the
 * structure ID and keeps exit/direction/lane info intact.
 */
const shortKey = (key: NodeKey): string => {
    const parts = key.split("-");
    if (parts.length >= 4) {
        const structID = parts.slice(0, parts.length - 3).join("-");
        const suffix = parts.slice(parts.length - 3).join("-");
        return `${structID.slice(-4)}-${suffix}`;
    }
    return key;
};

/**
 * Extracts the structure ID from a full node key.
 */
const structureIDFromKey = (key: NodeKey): string => {
    const parts = key.split("-");
    if (parts.length >= 4) {
        return parts.slice(0, parts.length - 3).join("-");
    }
    return key;
};

/**
 * Produces a human-readable label from a node key, using the object name map.
 */
const labelFromKey = (key: NodeKey, nameMap: Map<string, string>): string => {
    const parts = key.split("-");
    if (parts.length >= 4) {
        const structID = parts.slice(0, parts.length - 3).join("-");
        const [exitIdx, dir, lane] = parts.slice(parts.length - 3);
        const objName = nameMap.get(structID) ?? structID.slice(-4);
        return `E${exitIdx} ${dir} L${lane}`;
    }
    return key;
};

/**
 * Builds a map from NodeKey → [x, z] world position for every lane endpoint
 * in the junction. Uses the road-side ("end") point for in-lanes and the
 * junction-side ("start") point for out-lanes so that spawn/despawn nodes
 * sit at the road tips and internal nodes sit near the junction centre.
 */
export const buildNodePositions = (
    junction: JunctionConfig,
    junctionObjectRefs: THREE.Group[],
): Map<NodeKey, [number, number]> => {
    const positions = new Map<NodeKey, [number, number]>();

    const inCount = (c: ExitConfig) => c.numLanesIn;
    const outCount = (c: ExitConfig) => c.laneCount - c.numLanesIn;

    for (const obj of junction.junctionObjects) {
        const group = junctionObjectRefs.find((g) => {
            const data = getStructureData ? getStructureData(g) : g.userData;
            return data?.id === obj.id;
        });
        if (!group) continue;
        if (obj.type !== "intersection" && obj.type !== "roundabout") continue;

        const exitConfigs = obj.config.exitConfig;
        for (let e = 0; e < exitConfigs.length; e++) {
            for (let l = 0; l < inCount(exitConfigs[e]); l++) {
                const n: Node = { structureID: obj.id, exitIndex: e, direction: "in", laneIndex: l };
                const pt = getLaneWorldPoint(group, e, l, "end", "in");
                positions.set(nodeKeyOf(n), [pt.x, pt.z]);
            }
            for (let l = 0; l < outCount(exitConfigs[e]); l++) {
                const n: Node = { structureID: obj.id, exitIndex: e, direction: "out", laneIndex: l };
                const pt = getLaneWorldPoint(group, e, l, "end", "out");
                positions.set(nodeKeyOf(n), [pt.x, pt.z]);
            }
        }
    }
    return positions;
};

// Cluster fill colours (pastel, one per junction object)
const CLUSTER_COLOURS = [
    "#EBF5FB", "#FDEDEC", "#F9EBEA", "#E8F8F5",
    "#FEF9E7", "#F4ECF7", "#EAFAF1", "#FDF2E9",
];

/**
 * Converts the routing graph to a Graphviz DOT string.
 *
 * @param graph - The routing graph from generateAllRoutes.
 * @param starts - Spawn nodes (coloured green).
 * @param ends - Despawn node keys (coloured red).
 * @param positions - Optional world-space positions for spatial layout.
 * @param junction - Optional junction config; when provided, nodes are grouped
 *                   into labelled subgraph clusters by junction object.
 * @returns A DOT-language string ready for rendering.
 */
export const graphToDot = (
    graph: Graph,
    starts: Node[],
    ends: Set<NodeKey>,
    positions?: Map<NodeKey, [number, number]>,
    junction?: JunctionConfig,
): string => {
    const hasPositions = positions && positions.size > 0;
    const startKeys = new Set(starts.map(nodeKeyOf));
    const lines: string[] = [];

    // Build structureID → object name lookup
    const nameMap = new Map<string, string>();
    if (junction) {
        for (const obj of junction.junctionObjects) {
            nameMap.set(obj.id, obj.name);
        }
    }

    lines.push("digraph RoutingGraph {");
    if (hasPositions) {
        lines.push("  layout=neato;");
        lines.push("  overlap=false;");
        lines.push("  splines=true;");
    } else {
        lines.push("  rankdir=LR;");
    }
    lines.push("  node [shape=box, style=filled, fontsize=10, fontname=\"Helvetica\"];");
    lines.push("  edge [fontsize=8, fontname=\"Helvetica\"];");
    lines.push("");

    // Collect all nodes
    const allNodes = new Set<NodeKey>();
    for (const [from, edges] of graph.entries()) {
        allNodes.add(from);
        for (const e of edges) allNodes.add(nodeKeyOf(e.to));
    }

    // Scale factor for neato positions
    let scale = 1;
    if (hasPositions) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [, [x, z]] of positions) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        const span = Math.max(maxX - minX, maxZ - minZ, 1);
        scale = 15 / span;
    }

    // Helper: emit a single node declaration
    const nodeDecl = (key: NodeKey): string => {
        const sk = shortKey(key);
        const label = labelFromKey(key, nameMap);
        let colour = "#D6EAF8";
        if (startKeys.has(key)) colour = "#ABEBC6";
        if (ends.has(key)) colour = "#F5B7B1";

        let posAttr = "";
        if (hasPositions && positions!.has(key)) {
            const [x, z] = positions!.get(key)!;
            posAttr = `, pos="${(x * scale).toFixed(2)},${(-z * scale).toFixed(2)}!"`;
        }
        return `    "${sk}" [label="${label}", fillcolor="${colour}"${posAttr}];`;
    };

    // Group nodes by structure ID for clusters
    const nodesByStructure = new Map<string, NodeKey[]>();
    for (const key of allNodes) {
        const sid = structureIDFromKey(key);
        const arr = nodesByStructure.get(sid) ?? [];
        arr.push(key);
        nodesByStructure.set(sid, arr);
    }

    // Emit nodes inside subgraph clusters (one per junction object)
    let clusterIdx = 0;
    for (const [sid, keys] of nodesByStructure.entries()) {
        const objName = nameMap.get(sid);
        const objType = junction?.junctionObjects.find((o) => o.id === sid)?.type;
        const clusterLabel = objName
            ? `${objName} (${objType ?? "unknown"})`
            : sid.slice(-8);
        const bg = CLUSTER_COLOURS[clusterIdx % CLUSTER_COLOURS.length];

        lines.push(`  subgraph cluster_${clusterIdx} {`);
        lines.push(`    label="${clusterLabel}";`);
        lines.push(`    style=filled;`);
        lines.push(`    color="#AAAAAA";`);
        lines.push(`    fillcolor="${bg}";`);
        lines.push(`    fontsize=12;`);
        lines.push(`    fontname="Helvetica Bold";`);
        lines.push("");
        for (const key of keys) {
            lines.push(nodeDecl(key));
        }
        lines.push("  }");
        lines.push("");
        clusterIdx++;
    }

    // Emit edges
    for (const [from, edges] of graph.entries()) {
        const fromSk = shortKey(from);
        for (const e of edges) {
            const toSk = shortKey(nodeKeyOf(e.to));
            const edgeLabel = e.kind === "link" ? "link" : "int";
            const style = e.kind === "link" ? "dashed" : "solid";
            lines.push(`  "${fromSk}" -> "${toSk}" [label="${edgeLabel}", style=${style}];`);
        }
    }

    lines.push("}");

    return lines.join("\n");
};
