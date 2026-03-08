"use client";

import { OrbitControls, Html, Grid } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useJModellerContext } from "../context/JModellerContext";
import { usePeer } from "../context/PeerContext";
import { FLOOR_Y } from "../includes/defaults";
import { JunctionComponents } from "./JunctionComponents";
import { TrafficSimulation } from "./TrafficSimulation";
import { RouteDebug } from "./RouteDebug";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { lerp } from "three/src/math/MathUtils.js";

export type SceneHandle = {
    zoom: (factor: number) => void;
};

const Scene = forwardRef<SceneHandle>(function Scene(_, ref) {
    const { selectedObjects, setSelectedObjects, selectedExits, setSelectedExits, followedVehicleId, junction, setJunction, simIsRunning, isConfigConfirmed, junctionObjectRefs, toolMode, objectCounter, setObjectCounter } = useJModellerContext();
    const { isHost, connections } = usePeer();
    const { camera, gl } = useThree();
    const isClientConnected = !isHost && connections.length > 0;
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const isEmpty = junction.junctionObjects.length === 0 && !simIsRunning;

    useImperativeHandle(ref, () => ({
        zoom: (factor: number) => {
            const controls = controlsRef.current;
            if (!controls) return;
            const dir = new THREE.Vector3().subVectors(camera.position, (controls as any).target).normalize();
            const dist = camera.position.distanceTo((controls as any).target);
            const newDist = Math.max(5, Math.min(200, dist * factor));
            camera.position.copy((controls as any).target).addScaledVector(dir, newDist);
            controls.update();
        },
    }), [camera]);

    // Adding functionality for double click camera centring

    const lerpTargetRef = useRef<THREE.Vector3 | null>(null);
    const isLerpingRef = useRef(false);
    const lerpCamRef = useRef<THREE.Vector3 | null>(null);
    const isTopDownRef = useRef(false);

    // Isometric offset used for double-click centering (OrbitControls re-enables after)
    const ISO_OFFSET = new THREE.Vector3(20, 35, 20);

    // Helper: compute the top-down camera height needed to fit a given radius.
    // Reads live canvas dimensions so it works even inside a stale closure (e.g. setTimeout).
    const getTopDownHeight = (radius: number) => {
        const fovV = (60 * Math.PI) / 180;
        const w = gl.domElement.clientWidth;
        const h = gl.domElement.clientHeight;
        const aspect = w / h;
        const halfFovH = Math.atan(Math.tan(fovV / 2) * aspect);
        const fittingHalfFov = Math.min(fovV / 2, halfFovH);
        return radius / Math.tan(fittingHalfFov);
    };

    // Helper: restore from top-down to isometric view.
    // If junction objects exist, focus on the first one; otherwise use origin.
    const restoreIsometric = () => {
        if (isTopDownRef.current) {
            isTopDownRef.current = false;
            camera.up.set(0, 1, 0);
        }
        const focusTarget = new THREE.Vector3(0, 0, 0);
        const first = junctionObjectRefs.current.find(
            g => g.userData.intersectionStructure || g.userData.roundaboutStructure
        );
        if (first) first.getWorldPosition(focusTarget);
        lerpTargetRef.current = focusTarget;
        lerpCamRef.current = focusTarget.clone().add(ISO_OFFSET);
        isLerpingRef.current = true;
    };

    // Pending top-down target: set by the selection effect, consumed by useFrame
    // once the canvas has finished resizing after the panel transition.
    const pendingTopDownRef = useRef<{ id: string } | null>(null);
    const pendingFrameCount = useRef<number>(0);

    // ── Build mode: top-down view centered on origin (or selected object).
    //    When an object is selected via right-click, zoom to it;
    //    when deselected, return to top-down overview.
    useEffect(() => {
        if (toolMode !== "build") return;

        if (controlsRef.current) controlsRef.current.enabled = false;

        if (selectedObjects.length > 0) {
            pendingFrameCount.current = 0;
            pendingTopDownRef.current = { id: selectedObjects[0] };
        } else {
            pendingTopDownRef.current = null;
            const height = getTopDownHeight(80);
            camera.up.set(0, 0, -1);
            isTopDownRef.current = true;
            lerpTargetRef.current = new THREE.Vector3(0, 0, 0);
            lerpCamRef.current = new THREE.Vector3(0.001, height, 0);
            isLerpingRef.current = true;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedObjects, toolMode]);

    // ── View mode: restore isometric orbit view
    useEffect(() => {
        if (toolMode === "view") {
            if (isTopDownRef.current) {
                restoreIsometric();
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toolMode]);

    // Double click to centre on a junction object (view mode only)

    useEffect(() => {

        const handleDoubleClick = (e: MouseEvent) => {
            if (toolMode !== "view") return;

            const rect = gl.domElement.getBoundingClientRect();
            const mouse =  new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, camera);
            
            const meshes: THREE.Object3D[] = [];

            junctionObjectRefs.current.forEach(g => {
                if (g.userData.intersectionStructure || g.userData.roundaboutStructure) {
                    g.traverse(child => {
                        if (child instanceof THREE.Mesh) {
                            meshes.push(child);
                        }
                    });
                }
            });

            const hits = raycaster.intersectObjects(meshes, false);
            if (hits.length === 0) {
                return;
            }

            let object: THREE.Object3D | null = hits[0].object;
            while (object && !junctionObjectRefs.current.includes(object as THREE.Group)) {
                object = object.parent;
            }
            if (!object) {
                return;
            }

            const worldPosition = new THREE.Vector3();
            (object as THREE.Group).getWorldPosition(worldPosition);
            lerpTargetRef.current = worldPosition;
            lerpCamRef.current = worldPosition.clone().add(ISO_OFFSET);

            isLerpingRef.current = true;
            if (controlsRef.current) controlsRef.current.enabled = false; //
        };

        gl.domElement.addEventListener("dblclick", handleDoubleClick);
        return () => {
            gl.domElement.removeEventListener("dblclick", handleDoubleClick);
        };
    }, [camera, gl, junctionObjectRefs, toolMode]);

    // ── Build mode: right-click on an object to select it (camera zoom handled by selection effect)
    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            if (toolMode !== "build") return;
            if (simIsRunning) return;
            if (isConfigConfirmed) return;

            const rect = gl.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, camera);

            const meshes: THREE.Object3D[] = [];
            junctionObjectRefs.current.forEach(g => {
                if (g.userData.intersectionStructure || g.userData.roundaboutStructure) {
                    g.traverse(child => {
                        if (child instanceof THREE.Mesh) meshes.push(child);
                    });
                }
            });

            const hits = raycaster.intersectObjects(meshes, false);
            if (hits.length === 0) return;

            let object: THREE.Object3D | null = hits[0].object;
            while (object && !junctionObjectRefs.current.includes(object as THREE.Group)) {
                object = object.parent;
            }
            if (!object) return;

            const data = object.userData.intersectionStructure ?? object.userData.roundaboutStructure;
            if (!data?.id) return;

            setSelectedObjects(prev => {
                if (prev.includes(data.id)) return prev;
                return [data.id];
            });
        };

        gl.domElement.addEventListener("contextmenu", handleContextMenu);
        return () => {
            gl.domElement.removeEventListener("contextmenu", handleContextMenu);
        };
    }, [camera, gl, junctionObjectRefs, toolMode, simIsRunning, isConfigConfirmed, setSelectedObjects]);


    useFrame((_, delta) => {
        // ── Pending top-down: wait for the CSS panel transition to finish
        //    before computing camera position (transition is 300ms).
        if (pendingTopDownRef.current) {
            pendingFrameCount.current++;
            const ready = pendingFrameCount.current > 30; // ~500ms at 60fps, exceeds 300ms transition

            if (ready) {
                // Canvas has resized — now compute the camera position
                const pending = pendingTopDownRef.current;
                pendingTopDownRef.current = null;

                const group = junctionObjectRefs.current.find(g => {
                    const d = g.userData.intersectionStructure ?? g.userData.roundaboutStructure;
                    return d && d.id === pending.id;
                });
                if (group) {
                    const d = group.userData.intersectionStructure ?? group.userData.roundaboutStructure;
                    const radius = ((d?.maxDistanceToStopLine as number) ?? 25);
                    const height = getTopDownHeight(radius);

                    const worldPosition = new THREE.Vector3();
                    group.getWorldPosition(worldPosition);

                    camera.up.set(0, 0, -1);
                    camera.updateProjectionMatrix();
                    isTopDownRef.current = true;

                    lerpTargetRef.current = worldPosition.clone();
                    lerpCamRef.current = new THREE.Vector3(worldPosition.x + 0.001, worldPosition.y + height, worldPosition.z);
                    isLerpingRef.current = true;
                }
            }
        }

        if (!isLerpingRef.current || !lerpTargetRef.current || !lerpCamRef.current || !controlsRef.current) {
            // Still orient the camera in top-down even when not lerping
            if (isTopDownRef.current && controlsRef.current) {
                camera.lookAt(controlsRef.current.target);
            }
            return;
        }

        const controls = controlsRef.current;
        const speed = Math.min(1, delta * 6);

        controls.target.lerp(lerpTargetRef.current, speed);
        camera.position.lerp(lerpCamRef.current, speed);

        const targetDone = controls.target.distanceTo(lerpTargetRef.current) < 0.05;
        const camDone = camera.position.distanceTo(lerpCamRef.current) < 0.05;

        if (targetDone && camDone) {                                            
            controls.target.copy(lerpTargetRef.current);
            camera.position.copy(lerpCamRef.current);
            if (isTopDownRef.current && toolMode === "build") {
                // In top-down build/select: enable controls for zoom + pan only
                controls.enableRotate = false;
                controls.enableZoom = true;
                controls.enablePan = true;
                controls.enabled = true;
            } else if (!isTopDownRef.current) {
                controls.enableRotate = true;
                controls.enableZoom = true;
                controls.enablePan = true;
                controls.enabled = toolMode === "view" && followedVehicleId === null;
            }
            isLerpingRef.current = false;
            lerpTargetRef.current = null;
            lerpCamRef.current = null;
        }

        // In top-down mode, maintain straight-down orientation.
        // When controls are enabled (zoom/pan), update them but lock the polar angle.
        if (isTopDownRef.current) {
            if (controls.enabled) {
                // Keep camera directly above target during zoom/pan
                camera.position.x = controls.target.x + 0.001;
                camera.position.z = controls.target.z;
                controls.update();
            }
            camera.lookAt(controls.target);
        } else {
            controls.update();
        }

    });


    return (
        <>
            

            <ambientLight intensity={1} />

            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 1, 0]} receiveShadow>
                <planeGeometry args={[500, 500]} />
                <meshStandardMaterial color="#09090b" polygonOffset polygonOffsetFactor={4} polygonOffsetUnits={4} />
            </mesh>

            {!isConfigConfirmed && (
                <>
                    <Grid
                        position={[0, 0, 0]}
                        args={[1000, 1000]}
                        cellSize={1}
                        cellThickness={0.6}
                        cellColor="#27272a"
                        sectionSize={10}
                        sectionThickness={1.0}
                        sectionColor="#3f3f46"
                        fadeDistance={400}
                        fadeStrength={3}
                        infiniteGrid
                    />
                    <mesh position={[0, 0, 0]}>
                        <sphereGeometry args={[0.12, 16, 16]} />
                        <meshBasicMaterial color="#ffffff" />
                    </mesh>
                </>
            )}

            <EffectComposer>
                <Bloom intensity={1.5} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
            </EffectComposer>

            <OrbitControls
                enabled={toolMode === "view" && followedVehicleId === null}
                ref={controlsRef}
                minPolarAngle={Math.PI / 6}
                maxPolarAngle={Math.PI / 2}
                minDistance={5}
                maxDistance={200}
            />



            <JunctionComponents />

            {isEmpty && (
                <>
                    <Html center position={[0, 1, 0]} zIndexRange={[10, 0]}>
                        <div style={{
                            background: "rgba(9,9,11,0.93)",
                            border: "1px solid rgba(161,161,170,0.15)",
                            borderRadius: 8,
                            padding: "12px 18px",
                            fontFamily: "var(--font-mono), 'Courier New', monospace",
                            whiteSpace: "nowrap",
                            boxShadow: "0 4px 24px rgba(0,0,0,0.65)",
                            textAlign: "center",
                            pointerEvents: "none",
                        }}>
                            <div style={{
                                fontSize: 13, fontWeight: 700, letterSpacing: "0.12em",
                                color: "rgba(255,255,255,0.95)", textTransform: "uppercase",
                                marginBottom: 6,
                            }}>
                                No objects placed
                            </div>
                            {!isClientConnected && (
                                <div style={{ fontSize: 12, color: "rgba(225,225,230,0.75)", lineHeight: 1.6 }}>
                                    Switch to{" "}
                                    <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>Build</span>
                                    {" "}mode to add a roundabout or intersection
                                </div>
                            )}
                        </div>
                    </Html>
                </>
            )}

            <TrafficSimulation />
            <RouteDebug enabled />

        </>
    );
});

export default Scene;
