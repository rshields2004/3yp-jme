/**
 * RouteDebug.tsx
 *
 * Debug visualisation of all computed vehicle routes, rendered as
 * coloured lines with instanced sphere markers at waypoints.
 */

"use client";

import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useJModellerContext } from "../context/JModellerContext";
import { Route, Tuple3 } from "../includes/types/simulation";
import { generateAllRoutes } from "../includes/junctionmanagerutils/routing/routeGeneration";
import { graphToDot, buildNodePositions } from "../includes/junctionmanagerutils/routing/graphDebug";
import { getRoutePoints } from "../includes/junctionmanagerutils/routing/routeUtils";
import { TRANSFORM_CHECK_INTERVAL } from "../includes/constants";

/**
 * Return a deterministic colour for a route index using the golden-ratio hue spread.
 * @param i - route index
 * @returns THREE.Color with distinct hue
 */
const colourForIndex = (i: number): THREE.Color => {
    const c = new THREE.Color();
    c.setHSL((i * 0.61803398875) % 1, 0.7, 0.55);
    return c;
}

/**
 * Dispose the geometry and material(s) of a Three.js Line object.
 * @param line - the Three.js Line object
 */
const disposeLine = (line: THREE.Line) => {
    (line.geometry as THREE.BufferGeometry)?.dispose();
    const mat = line.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
}

/**
 * Dispose the geometry and material(s) of an InstancedMesh.
 * @param mesh - the Three.js InstancedMesh
 */
const disposeInstanced = (mesh: THREE.InstancedMesh) => {
    (mesh.geometry as THREE.BufferGeometry)?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
}

/**
 * Return a stable string key for a Three.js group, falling back to its array index.
 *
 * @param g - the Three.js object/group
 * @param fallbackIdx - index to use if the group has no userData.id
 * @returns a string key for the group
 */
const keyForGroup = (g: THREE.Object3D, fallbackIdx: number) => {
    return (g as THREE.Object3D<THREE.Object3DEventMap>).userData?.id ?? `${fallbackIdx}`;
}

/**
 * Check whether two 4×4 matrices differ by more than a tolerance.
 * @param a - first matrix as a Float32Array (16 elements)
 * @param b - second matrix as an ArrayLike (16 elements)
 * @param eps - per-element tolerance (default 1e-6)
 * @returns `true` if any element differs by more than `eps`
 */
const matrixDifferent = (a: Float32Array, b: ArrayLike<number>, eps = 1e-6) => {
    for (let i = 0; i < 16; i++) {
        if (Math.abs(a[i] - b[i]) > eps) return true;
    }
    return false;
}

/**
 * Debug overlay that visualises all generated routes as coloured lines
 * with instanced cube markers at segment boundaries. Toggle via keyboard.
 * @returns the rendered debug route overlay
 */
export const RouteDebug = ({
    enabled = true,
    maxSteps = 30,
    disallowUTurn = true,
    yLift = 0.03,
    boxSize = 0.25,
    maxBoxes = 256,
}: {
    enabled?: boolean;
    maxSteps?: number;
    disallowUTurn?: boolean;
    yLift?: number;
    boxSize?: number;
    maxBoxes?: number;
}) => {
    const { scene } = useThree();
    const { junction, junctionObjectRefs } = useJModellerContext();

    const routesRef = useRef<Route[]>([]);
    const visibleRef = useRef(false);

    const groupRef = useRef<THREE.Group | null>(null);
    const linesRef = useRef<THREE.Line[]>([]);

    // matrix snapshots to detect transform changes
    const lastMatricesRef = useRef<Map<string, Float32Array>>(new Map());
    // Throttle transform checking to avoid performance issues
    const transformCheckAccumRef = useRef(0);

    const clearLines = () => {
        for (const line of linesRef.current) {
            disposeLine(line);
            groupRef.current?.remove(line);
        }
        linesRef.current = [];
    };

    const rebuildRoutes = (opts?: { keepIndex?: boolean }) => {
        if (!enabled) return;
        if (!junction || !junctionObjectRefs?.current?.length) return;

        junctionObjectRefs.current.forEach((g) => g.updateWorldMatrix(true, true));

        const { routes, graph, starts, ends } = generateAllRoutes(junction, junctionObjectRefs.current, {
            maxSteps,
            disallowUTurn,
            spacing: 0.1,
            tension: 0.5,
            smoothPerSegment: true,
        });

        // DEBUG: copy DOT output from console, paste into https://dreampuf.github.io/GraphvizOnline/ (select neato engine)
        const positions = buildNodePositions(junction, junctionObjectRefs.current);
        console.log("[GraphDebug DOT]\n" + graphToDot(graph, starts, ends, positions, junction));

        const filtered = routes.filter((r) => {
            const pts = getRoutePoints(r);
            return pts && pts.length >= 2;
        });
        routesRef.current = filtered;

        // reset transform snapshots so we don't immediately "change-detect" our own rebuild
        lastMatricesRef.current.clear();

        // create group if needed
        if (!groupRef.current) {
            const g = new THREE.Group();
            g.name = "RouteDebugAllRoutesGroup";
            g.visible = false;
            scene.add(g);
            groupRef.current = g;
        }
    };

    const showAllRoutes = () => {
        const routes = routesRef.current;
        const group = groupRef.current;
        if (!routes.length || !group) return;

        clearLines();

        for (let i = 0; i < routes.length; i++) {
            const r = routes[i];
            const routePoints = getRoutePoints(r);
            if (routePoints.length < 2) continue;

            const positions = new Float32Array(routePoints.length * 3);
            for (let p = 0; p < routePoints.length; p++) {
                positions[p * 3 + 0] = routePoints[p][0];
                positions[p * 3 + 1] = routePoints[p][1] + yLift;
                positions[p * 3 + 2] = routePoints[p][2];
            }
            const geom = new THREE.BufferGeometry();
            geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

            const col = colourForIndex(i);
            const mat = new THREE.LineBasicMaterial({
                color: col,
                transparent: true,
                opacity: 0.95,
                depthTest: true,
            });

            const line = new THREE.Line(geom, mat);
            line.frustumCulled = false;
            line.name = `RouteDebugLine_${i}`;
            group.add(line);
            linesRef.current.push(line);
        }

        group.visible = true;
        visibleRef.current = true;
    };

    // Initial build + rebuild on config changes
    useEffect(() => {
        if (!enabled) return;
        rebuildRoutes();

        if (visibleRef.current && routesRef.current.length) {
            showAllRoutes();
        }

        const lastMatrices = lastMatricesRef.current;

        return () => {
            clearLines();
            if (groupRef.current) {
                scene.remove(groupRef.current);
                groupRef.current = null;
            }
            routesRef.current = [];
            visibleRef.current = false;

            lastMatrices.clear();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, junction, junctionObjectRefs, scene, maxSteps, disallowUTurn, yLift, boxSize, maxBoxes]);

    // Detect transform changes while debug is visible, and rebuild routes so WORLD points stay correct
    // Throttled to avoid performance issues
    useFrame((state, delta) => {
        if (!enabled) return;
        if (!visibleRef.current) return;

        // Throttle the check to avoid running every frame
        transformCheckAccumRef.current += delta;
        if (transformCheckAccumRef.current < TRANSFORM_CHECK_INTERVAL) return;
        transformCheckAccumRef.current = 0;

        const refs = junctionObjectRefs?.current;
        if (!refs || refs.length === 0) return;

        let changed = false;

        for (let i = 0; i < refs.length; i++) {
            const g = refs[i];
            g.updateWorldMatrix(true, true);

            const k = keyForGroup(g, i);
            const prev = lastMatricesRef.current.get(k);
            const elements = g.matrixWorld.elements; // number[]

            if (!prev) {
                lastMatricesRef.current.set(k, new Float32Array(elements));
                changed = true;
                continue;
            }

            if (matrixDifferent(prev, elements)) {
                prev.set(elements as THREE.Matrix4Tuple);
                changed = true;
            }
        }

        if (changed) {
            rebuildRoutes({ keepIndex: true });
            if (routesRef.current.length) {
                showAllRoutes();
            }
        }
    });

    // Press D to toggle/show first, then advance each press
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            const tag = el?.tagName?.toLowerCase();
            const isTyping = tag === "input" || tag === "textarea" || (el as HTMLElement | null)?.isContentEditable;
            if (isTyping) return;

            if (e.key !== "d" && e.key !== "D") return;

            if (!routesRef.current.length) {
                rebuildRoutes();
            }
            if (!routesRef.current.length) {
                console.warn("[RouteDebug] No routes to display.");
                return;
            }

            if (!visibleRef.current) {
                showAllRoutes();
            } else {
                clearLines();
                if (groupRef.current) groupRef.current.visible = false;
                visibleRef.current = false;
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    return null;
}
