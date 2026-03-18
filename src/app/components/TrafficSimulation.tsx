"use client";

import { useThree, useFrame } from "@react-three/fiber";
import { useRef, useState, useEffect, useCallback, startTransition } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import * as THREE from "three";
import { VehicleManager } from "../includes/junctionmanagerutils/vehicleManager";
import { Route, SimulationStats, Tuple3, FollowedVehicleStats, RouteSegment } from "../includes/types/simulation";
import { bodyTypeForModelIndex } from "../includes/types/carTypes";
import { applyIntersectionStopLineColours } from "../includes/junctionmanagerutils/helpers/simulationHelpers";
import { JunctionStatsLabels } from "./JunctionStatsLabels";
import { SpawnRateLabels } from "./SpawnRateLabels";
import { loadCarModels } from "../includes/junctionmanagerutils/helpers/carModelLoaders";
import { getRoutePoints } from "../includes/junctionmanagerutils/routing/routeUtils";
import { generateAllRoutes } from "../includes/junctionmanagerutils/routing/routeGeneration";

function buildSegmentLabel(
    seg: RouteSegment,
    junctionObjects: { id: string; name: string; type: string }[]
): string {
    const findName = (id: string) => {
        const obj = junctionObjects.find(o => o.id === id);
        return obj ? `${obj.type} ${obj.name}` : id.slice(0, 8);
    };
    switch (seg.phase) {
        case "approach":
            return `approaching ${findName(seg.to.structureID)} exit ${seg.to.exitIndex + 1}`;
        case "inside":
            return `inside ${findName(seg.from.structureID)}`;
        case "exit":
            return `exiting ${findName(seg.from.structureID)} exit ${seg.to.exitIndex + 1}`;
        case "link":
            return `link ${findName(seg.from.structureID)} exit ${seg.from.exitIndex + 1} to ${findName(seg.to.structureID)} exit ${seg.to.exitIndex + 1}`;
        default:
            return seg.phase;
    }
}

/**
 * Fixed simulation timestep in seconds.
 * Every device advances the simulation by exactly this amount per tick,
 * guaranteeing identical results regardless of display frame rate.
 */
export const FIXED_DT = 1 / 144;

/**
 * Maximum ticks to drain per rendered frame.
 * Prevents the "spiral of death" on slow devices while keeping the sim
 * from desynchronising when a few frames are expensive (e.g. GC pauses).
 */
const MAX_TICKS_PER_FRAME = 5;

/**
 * Traffic Simulation Component
 * Drop this into your Scene component to enable traffic simulation
 */
export const TrafficSimulation = () => {
    const { junction, junctionObjectRefs, simIsRunning, stats, setStats, carsReady, setCarsReady, followedVehicleId, setFollowedVehicleId, setFollowedVehicleStats, simIsPaused, simConfig, showOverlayLabels } = useJModellerContext();
    const { scene, camera, gl } = useThree();
    const simIsPausedRef = useRef(simIsPaused);
    const [isInitialised, setisInitialised] = useState(false);
    const [showDebugRoutes] = useState(false);

    const statsAccumRef = useRef(0);
    const lastStatsRef = useRef<SimulationStats | null>(null);
    const statsRef = useRef<SimulationStats | null>(null);
    const vehicleStatsRef = useRef<FollowedVehicleStats | null>(null);
    const prevSpeedRef = useRef(0);
    const prevDtRef = useRef(FIXED_DT);
    const raycasterRef = useRef(new THREE.Raycaster());
    const smoothedYawRef = useRef<number | null>(null);

    /**
     * Fixed-step accumulator.
     * Real elapsed time is added each rendered frame; we drain it in
     * FIXED_DT chunks so the simulation always advances by the same
     * increment regardless of display frame rate or micro-lag.
     */
    const fixedAccRef = useRef(0);

    const carModelsRef = useRef<THREE.Group[]>([]);
    const [routes, setRoutes] = useState<Route[]>([]);
    const debugRoutesGroupRef = useRef<THREE.Group | null>(null);
    const wasRunningRef = useRef(false);
    const vehicleManagerRef = useRef<VehicleManager | null>(null);

    useEffect(() => {
        simIsPausedRef.current = simIsPaused;
    }, [simIsPaused]);

    // Load car models on mount
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const models = await loadCarModels();
                if (cancelled) return;


                carModelsRef.current = models;
                setCarsReady(true);
            } catch (error) {
                console.error("Failed to load car models:", error);
            }
        })();
        

        return () => {
            cancelled = true;
        };
    }, [setCarsReady, setStats]);

    /**
     * Create debug route visualizations
     */
    const createDebugRoutes = useCallback(() => {
        if (debugRoutesGroupRef.current) {
            scene.remove(debugRoutesGroupRef.current);
        }

        const group = new THREE.Group();
        const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];

        routes.forEach((route, i) => {
            const color = colors[i % colors.length];
            const routePoints = getRoutePoints(route);
            const points = routePoints.map((p: Tuple3) => new THREE.Vector3(p[0], p[1] + 0.1, p[2]));
            if (points.length < 2) return;

            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({
                color,
                opacity: 0.5,
                transparent: true,
            });
            const line = new THREE.Line(geometry, material);
            group.add(line);
        });

        debugRoutesGroupRef.current = group;
        scene.add(group);
    }, [scene, routes]);

    /**
     * Initialize the simulation when it starts
     */
    const initialiseSimulation = useCallback(() => {
        if (!carsReady || !carModelsRef.current.length) {
            console.warn("Car models not ready");
            return;
        }

        if (!junction || !junctionObjectRefs?.current?.length) {
            console.warn("Junction data not ready");
            return;
        }

        try {
            console.log("Initializing traffic simulation...");

            junctionObjectRefs.current.forEach((g) => g.updateWorldMatrix(true, true));

            const { routes: generatedRoutes } = generateAllRoutes(junction, junctionObjectRefs.current, {
                maxSteps: 30,
                disallowUTurn: true,
                spacing: 0.01,
            });

            setRoutes(generatedRoutes);
            console.log(`Generated ${generatedRoutes.length} routes`);

            if (generatedRoutes.length === 0) {
                console.warn("No routes generated - check junction connections!");
                return;
            }

            // Reset previous sim (if any)
            vehicleManagerRef.current?.reset();

            vehicleManagerRef.current = new VehicleManager(scene, carModelsRef.current, generatedRoutes, junction, simConfig);

            // Reset the fixed-step accumulator so the new simulation starts cleanly
            fixedAccRef.current = 0;

            // Create debug route visualization if enabled
            if (showDebugRoutes) {
                createDebugRoutes();
            }

            setisInitialised(true);
            setStats((prev) => ({
                ...prev,
                routes: routes.length,
                spawnQueue: 0,
                spawnQueueByEntry: {},
                active: 0,
                spawned: 0,
                completed: 0,
                waiting: 0,
                avgSpeed: 0,
                avgTravelTime: 0,
                junctions: {
                    global: {
                        count: 0,
                        approaching: 0,
                        waiting: 0,
                        inside: 0,
                        exiting: 0,
                        entered: 0,
                        exited: 0,
                        avgWaitTime: 0,
                        maxQueueLength: 0,
                        throughput: 0,
                        prc: 0,
                        mmq: 0,
                    },
                    byId: {},
                },
            }));

            console.log("Traffic simulation initialized!");
        } catch (error) {
            console.error("Failed to initialize simulation:", error);
        }
    }, [carsReady, junction, junctionObjectRefs, scene, showDebugRoutes, createDebugRoutes, setStats, simConfig]);

    /**
     * Clean up the simulation when it stops
     */
    const cleanupSimulation = useCallback(() => {
        console.log("Cleaning up traffic simulation...");

        if (debugRoutesGroupRef.current) {
            scene.remove(debugRoutesGroupRef.current);
            debugRoutesGroupRef.current.traverse((child) => {
                if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
                    child.geometry?.dispose();
                    const material = (child as THREE.Mesh | THREE.Line).material;
                    if (Array.isArray(material)) {
                        material.forEach((m) => m.dispose());
                    } else {
                        material?.dispose();
                    }
                }
            });
            debugRoutesGroupRef.current = null;
        }

        vehicleManagerRef.current?.reset();
        vehicleManagerRef.current = null;

        // Reset the accumulator so stale time doesn't bleed into the next run
        fixedAccRef.current = 0;

        setRoutes([]);
        setisInitialised(false);
        setStats({
            active: 0,
            spawned: 0,
            completed: 0,
            waiting: 0,
            routes: 0,
            spawnQueue: 0,
            spawnQueueByEntry: {},
            elapsedTime: 0,
            avgSpeed: 0,
            avgTravelTime: 0,
            junctions: {
                global: {
                    count: 0,
                    approaching: 0,
                    waiting: 0,
                    inside: 0,
                    exiting: 0,
                    entered: 0,
                    exited: 0,
                    avgWaitTime: 0,
                    maxQueueLength: 0,
                    throughput: 0,
                    prc: 0,
                    mmq: 0,
                },
                byId: {},
            },
        });

        console.log("Traffic simulation cleaned up");
    }, [scene, setStats]);

    // Handle simulation start/stop
    useEffect(() => {
        if (simIsRunning && !wasRunningRef.current) {
            initialiseSimulation();
        } else if (!simIsRunning && wasRunningRef.current) {
            cleanupSimulation();
        }

        wasRunningRef.current = simIsRunning;
    }, [simIsRunning, initialiseSimulation, cleanupSimulation]);

    // Toggle debug routes visibility
    useEffect(() => {
        if (debugRoutesGroupRef.current) {
            debugRoutesGroupRef.current.visible = showDebugRoutes;
        } else if (showDebugRoutes && isInitialised) {
            createDebugRoutes();
        }
    }, [showDebugRoutes, isInitialised, createDebugRoutes]);

    // Update simulation config when it changes in the UI
    useEffect(() => {
        if (vehicleManagerRef.current) {
            vehicleManagerRef.current.updateConfig(simConfig);
        }
    }, [simConfig]);

    // Double-click handler for selecting a vehicle to follow
    useEffect(() => {
        if (!simIsRunning) return;

        const handleDoubleClick = (event: MouseEvent) => {
            const vm = vehicleManagerRef.current;
            if (!vm) return;

            // Get mouse position in normalized device coordinates
            const rect = gl.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1
            );

            // Raycast to find clicked vehicle
            raycasterRef.current.setFromCamera(mouse, camera);
            
            const vehicles = vm.getVehicles();
            const vehicleModels = vehicles.map(v => v.model);
            const intersects = raycasterRef.current.intersectObjects(vehicleModels, true);

            if (intersects.length > 0) {
                // Find which vehicle was clicked
                const clickedObject = intersects[0].object;
                let vehicleModel: THREE.Object3D | null = clickedObject;
                
                // Traverse up to find the root vehicle model
                while (vehicleModel && !vehicles.some(v => v.model === vehicleModel)) {
                    vehicleModel = vehicleModel.parent;
                }

                if (vehicleModel) {
                    const vehicle = vehicles.find(v => v.model === vehicleModel);
                    if (vehicle) {
                        setFollowedVehicleId(vehicle.id);
                        console.log(`Following vehicle ${vehicle.id}`);
                    }
                }
            }
        };

        gl.domElement.addEventListener("dblclick", handleDoubleClick);
        return () => {
            gl.domElement.removeEventListener("dblclick", handleDoubleClick);
        };
    }, [simIsRunning, camera, gl, setFollowedVehicleId]);

    // Keyboard handler for exiting first-person view (Backspace)
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Backspace" && followedVehicleId !== null) {
                event.preventDefault();
                setFollowedVehicleId(null);
                console.log("Exited first-person view");
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [followedVehicleId, setFollowedVehicleId]);

    // Clear followed vehicle when simulation stops
    useEffect(() => {
        if (!simIsRunning) {
            setFollowedVehicleId(null);
            vehicleStatsRef.current = null;
            smoothedYawRef.current = null;
        }
    }, [simIsRunning, setFollowedVehicleId]);

    /**
     * Main update loop — runs every rendered frame.
     *
     * DETERMINISM NOTE:
     * The simulation is advanced in fixed-size FIXED_DT ticks rather than
     * using the raw frame delta. This means two devices with different frame
     * rates (e.g. 60 Hz vs 144 Hz) process exactly the same sequence of
     * numerical updates and produce identical simulation state.
     *
     * Only the camera-follow and display-side work (stop-line colours,
     * stats sampling) remain frame-rate dependent — they are purely visual
     * and do not influence simulation state.
     */
    useFrame((_, delta) => {
        if (!simIsRunning || !isInitialised) return;
        const vm = vehicleManagerRef.current;
        if (!vm) return;

        // ── Camera follow (visual only, not part of sim state) ─────────────
        if (followedVehicleId !== null) {
            const vehicle = vm.getVehicleById(followedVehicleId);
            if (vehicle) {
                const carPos = vehicle.model.position.clone();

                // Derive heading from a point 8 m ahead on the route rather
                // than from model.rotation.y, which jumps at sharp waypoint
                // corners inside intersections.
                const lookAheadPt = vm.getPositionAhead(vehicle, 8);
                let rawYaw: number | null = null;
                if (lookAheadPt) {
                    const dx = lookAheadPt.x - carPos.x;
                    const dz = lookAheadPt.z - carPos.z;
                    if (dx * dx + dz * dz > 1e-6) {
                        rawYaw = Math.atan2(dx, dz);
                    }
                }

                // Seed smoothed yaw on first frame only
                if (smoothedYawRef.current === null) {
                    smoothedYawRef.current = rawYaw ?? vehicle.model.rotation.y;
                }

                // Smooth the yaw with angular interpolation.
                // Only update when we have a valid rawYaw AND the vehicle is
                // moving.  Otherwise hold the last stable heading.
                if (rawYaw !== null && vehicle.speed >= 0.3) {
                    let diff = rawYaw - smoothedYawRef.current;
                    diff = ((diff + Math.PI) % (2 * Math.PI) + (2 * Math.PI)) % (2 * Math.PI) - Math.PI;
                    const alpha = 1 - Math.exp(-4 * delta);
                    smoothedYawRef.current += diff * alpha;
                }

                const carRotation = smoothedYawRef.current;

                const cameraHeight = 1.1;
                const forwardOffset = -0.4;
                const lookAheadDistance = 15;

                const forward = new THREE.Vector3(
                    Math.sin(carRotation),
                    0,
                    Math.cos(carRotation)
                );

                camera.position.set(
                    carPos.x + forward.x * forwardOffset,
                    carPos.y + cameraHeight,
                    carPos.z + forward.z * forwardOffset
                );

                const lookAt = carPos.clone().add(forward.multiplyScalar(lookAheadDistance));
                lookAt.y = carPos.y + 1;
                camera.lookAt(lookAt);

                // Sample vehicle telemetry (throttled with main stats sampler)
                const accel = delta > 0 ? (vehicle.speed - prevSpeedRef.current) / delta : 0;
                prevSpeedRef.current = vehicle.speed;
                prevDtRef.current = delta;
                const phaseRaw = (vehicle.currentSegment as { phase?: string } | null)?.phase ?? "—";
                const rawIdx: number = vehicle.model.userData?.carFileIndex ?? 0;
                const segLabel = vehicle.currentSegment
                    ? buildSegmentLabel(vehicle.currentSegment, junction.junctionObjects)
                    : "—";
                vehicleStatsRef.current = {
                    id: vehicle.id,
                    speed: vehicle.speed,
                    preferredSpeed: vehicle.preferredSpeed,
                    accel,
                    phase: phaseRaw,
                    bodyType: bodyTypeForModelIndex(rawIdx),
                    segment: segLabel,
                };
            } else {
                vehicleStatsRef.current = null;
                setFollowedVehicleId(null);
                smoothedYawRef.current = null;
            }
        }

        if (simIsPausedRef.current) return;

        // ── Fixed-step simulation advance ───────────────────────────────────
        // Accumulate real elapsed time, then drain it in exact FIXED_DT steps.
        // Both a 60 Hz and a 144 Hz device will execute the same integer number
        // of ticks over any given simulated time period, producing bit-identical
        // vehicle positions, controller states, and spawn sequences.
        fixedAccRef.current += delta;

        let ticks = 0;
        while (fixedAccRef.current >= FIXED_DT && ticks < MAX_TICKS_PER_FRAME) {
            vm.update(FIXED_DT, junctionObjectRefs);
            fixedAccRef.current -= FIXED_DT;
            ticks++;
        }

        // ── Visual-only updates (after all ticks for this frame) ────────────
        // Colouring stop lines is purely cosmetic — done once per rendered
        // frame rather than once per sim tick for performance.
        applyIntersectionStopLineColours(junctionObjectRefs.current, vm);

        // Stats throttle (display only, does not affect sim state)
        statsAccumRef.current += delta;
        if (statsAccumRef.current >= 0.1) {
            statsAccumRef.current = 0;
            const s = vm.getStats();

            const prev = lastStatsRef.current;
            if (
                !prev ||
                prev.active !== s.active ||
                prev.spawnQueue !== s.spawnQueue ||
                prev.spawned !== s.spawned ||
                prev.completed !== s.completed ||
                prev.junctions.global.waiting !== s.junctions.global.waiting ||
                prev.junctions.global.inside !== s.junctions.global.inside
            ) {
                lastStatsRef.current = s;
                statsRef.current = s;
            }
        }
    });

    // Sync stats to React state outside the render loop
    useEffect(() => {
        const id = window.setInterval(() => {
            const s = statsRef.current;
            if (!s) return;
            startTransition(() => {
                setStats(s);
            });
        }, 100);

        return () => window.clearInterval(id);
    }, [setStats]);

    // Sync followed vehicle stats to React state outside the render loop
    useEffect(() => {
        const id = window.setInterval(() => {
            startTransition(() => {
                setFollowedVehicleStats(vehicleStatsRef.current);
            });
        }, 100);

        return () => window.clearInterval(id);
    }, [setFollowedVehicleStats]);



    // Cache junction positions to avoid recalculating every frame
    const junctionPositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
    const spawnRatePositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());

    return (
        <>
            {simIsRunning && isInitialised && showOverlayLabels && (
                <>
                    <JunctionStatsLabels
                        junctionGroups={junctionObjectRefs.current}
                        stats={stats}
                        positionsCache={junctionPositionsRef.current}
                    />
                    <SpawnRateLabels
                        junctionGroups={junctionObjectRefs.current}
                        stats={stats}
                        positionsCache={spawnRatePositionsRef.current}
                        routes={routes}
                        simConfig={simConfig}
                    />
                </>
            )}
        </>
    );
};