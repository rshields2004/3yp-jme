"use client";

import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useJModellerContext } from "../context/JModellerContext";
import { generateAllRoutes, Route, getRoutePoints } from "../includes/junctionmanagerutils/carRouting";

function colorForIndex(i: number): THREE.Color {
    const c = new THREE.Color();
    c.setHSL((i * 0.61803398875) % 1, 0.7, 0.55);
    return c;
}

function disposeLine(line: THREE.Line) {
    (line.geometry as THREE.BufferGeometry)?.dispose();
    const mat = line.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
}

function disposeInstanced(mesh: THREE.InstancedMesh) {
    (mesh.geometry as THREE.BufferGeometry)?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
}

function keyForGroup(g: THREE.Object3D, fallbackIdx: number) {
    return (g as any).userData?.id ?? `${fallbackIdx}`;
}

function matrixDifferent(a: Float32Array, b: ArrayLike<number>, eps = 1e-6) {
    for (let i = 0; i < 16; i++) {
        if (Math.abs(a[i] - b[i]) > eps) return true;
    }
    return false;
}

export function RouteDebug({
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
}) {
    const { scene } = useThree();
    const { junction, junctionObjectRefs } = useJModellerContext();

    const routesRef = useRef<Route[]>([]);
    const idxRef = useRef(0);
    const visibleRef = useRef(false);

    const groupRef = useRef<THREE.Group | null>(null);
    const lineRef = useRef<THREE.Line | null>(null);

    // instanced boxes for segment-end markers
    const boxesRef = useRef<THREE.InstancedMesh | null>(null);
    const tempObjRef = useRef(new THREE.Object3D());

    // matrix snapshots to detect transform changes
    const lastMatricesRef = useRef<Map<string, Float32Array>>(new Map());
    // Throttle transform checking to avoid performance issues
    const transformCheckAccumRef = useRef(0);
    const TRANSFORM_CHECK_INTERVAL = 0.5; // Check only twice per second

    const setBoxesFromRoute = (route: Route, color: THREE.Color) => {
        const inst = boxesRef.current;
        if (!inst) return;

        const mat = inst.material as THREE.MeshBasicMaterial;
        mat.color.copy(color);

        const dummy = tempObjRef.current;

        const segs = route.segments ?? [];
        const ends: [number, number, number][] = [];
        ends.push(segs[0].points[0]);
        // box at end of each segment
        for (const s of segs) {
            const pts = s.points;
            if (pts && pts.length) ends.push(pts[pts.length - 1]);
        }

        const count = Math.min(ends.length, inst.count);

        for (let i = 0; i < count; i++) {
            const [x, y, z] = ends[i];
            dummy.position.set(x, y + yLift, z);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
        }

        // hide remaining instances
        for (let i = count; i < inst.count; i++) {
            dummy.position.set(1e9, 1e9, 1e9);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
        }

        inst.instanceMatrix.needsUpdate = true;
    };

    const rebuildRoutes = (opts?: { keepIndex?: boolean }) => {
        if (!enabled) return;
        if (!junction || !junctionObjectRefs?.current?.length) return;

        junctionObjectRefs.current.forEach((g) => g.updateWorldMatrix(true, true));

        const { routes } = generateAllRoutes(junction, junctionObjectRefs.current, {
            maxSteps,
            disallowUTurn,
            spacing: 0.1,
            tension: 0.5,
            smoothPerSegment: true,
        });

        const filtered = routes.filter((r) => {
            const pts = getRoutePoints(r);
            return pts && pts.length >= 2;
        });
        routesRef.current = filtered;

        if (!opts?.keepIndex) {
            idxRef.current = 0;
        } else {
            if (filtered.length === 0) idxRef.current = 0;
            else idxRef.current = Math.min(idxRef.current, filtered.length - 1);
        }

        // reset transform snapshots so we don't immediately "change-detect" our own rebuild
        lastMatricesRef.current.clear();

        // create group if needed
        if (!groupRef.current) {
            const g = new THREE.Group();
            g.name = "RouteDebugPressToCycleGroup";
            g.visible = false;
            scene.add(g);
            groupRef.current = g;
        }

        // create line if needed
        if (!lineRef.current) {
            const dummyGeom = new THREE.BufferGeometry();
            const dummyMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
            const line = new THREE.Line(dummyGeom, dummyMat);
            line.frustumCulled = false;
            line.name = "RouteDebugLine";
            groupRef.current.add(line);
            lineRef.current = line;
        }

        // create instanced boxes if needed
        if (!boxesRef.current) {
            const geom = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
            const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
            const inst = new THREE.InstancedMesh(geom, mat, maxBoxes);
            inst.name = "RouteDebugSegmentEndBoxes";
            inst.frustumCulled = false;
            groupRef.current.add(inst);
            boxesRef.current = inst;

            // start hidden until a route is shown
            const dummy = tempObjRef.current;
            for (let i = 0; i < maxBoxes; i++) {
                dummy.position.set(1e9, 1e9, 1e9);
                dummy.updateMatrix();
                inst.setMatrixAt(i, dummy.matrix);
            }
            inst.instanceMatrix.needsUpdate = true;
        }
    };

    const showRouteAtIndex = (i: number) => {
        const routes = routesRef.current;
        const line = lineRef.current;
        const group = groupRef.current;
        if (!routes.length || !line || !group) return;

        const idx = ((i % routes.length) + routes.length) % routes.length;
        idxRef.current = idx;

        const r = routes[idx];
        const routePoints = getRoutePoints(r);

        // Build line geometry (WORLD points)
        const positions = new Float32Array(routePoints.length * 3);
        for (let p = 0; p < routePoints.length; p++) {
            positions[p * 3 + 0] = routePoints[p][0];
            positions[p * 3 + 1] = routePoints[p][1] + yLift;
            positions[p * 3 + 2] = routePoints[p][2];
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

        const col = colorForIndex(idx);

        const newMat = new THREE.LineBasicMaterial({
            color: col,
            transparent: true,
            opacity: 0.95,
            depthTest: true,
        });

        disposeLine(line);
        line.geometry = geom;
        line.material = newMat;

        // place boxes at segment ends
        setBoxesFromRoute(r, col);

        group.visible = true;
        visibleRef.current = true;
    };

    // Initial build + rebuild on config changes
    useEffect(() => {
        if (!enabled) return;
        rebuildRoutes();

        if (visibleRef.current && routesRef.current.length) {
            showRouteAtIndex(idxRef.current);
        }

        return () => {
            if (lineRef.current) {
                disposeLine(lineRef.current);
                lineRef.current = null;
            }
            if (boxesRef.current) {
                disposeInstanced(boxesRef.current);
                boxesRef.current = null;
            }
            if (groupRef.current) {
                scene.remove(groupRef.current);
                groupRef.current = null;
            }
            routesRef.current = [];
            idxRef.current = 0;
            visibleRef.current = false;
            lastMatricesRef.current.clear();
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
                prev.set(elements as any);
                changed = true;
            }
        }

        if (changed) {
            rebuildRoutes({ keepIndex: true });
            if (routesRef.current.length) {
                showRouteAtIndex(idxRef.current);
            }
        }
    });

    // Press D to toggle/show first, then advance each press
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            const tag = el?.tagName?.toLowerCase();
            const isTyping = tag === "input" || tag === "textarea" || (el as any)?.isContentEditable;
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
                showRouteAtIndex(idxRef.current);
                return;
            }

            showRouteAtIndex(idxRef.current + 1);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    return null;
}
