"use client";

import { useThree, useFrame } from "@react-three/fiber";
import { useRef, useState, useEffect, useCallback, startTransition } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import * as THREE from "three";
import { generateAllRoutes, getRoutePoints } from "../includes/junctionmanagerutils/carRouting";
import { VehicleManager } from "../includes/junctionmanagerutils/vehicleManager";
import { Route, SimulationStats, Tuple3 } from "../includes/types/simulation";
import { applyIntersectionStopLineColours, loadCarModels } from "../includes/junctionmanagerutils/helpers/simulationHelpers";
import { JunctionStatsLabels } from "./JunctionStatsLabels";
import { SpawnRateLabels } from "./SpawnRateLabels";


/**
 * Traffic Simulation Component
 * Drop this into your Scene component to enable traffic simulation
 */
export const TrafficSimulation = () => {
    const { junction, junctionObjectRefs, simIsRunning, stats, setStats, carsReady, setCarsReady, followedVehicleId, setFollowedVehicleId, simIsPaused, simConfig } = useJModellerContext();
    const { scene, camera, gl } = useThree();
    const simIsPausedRef = useRef(simIsPaused);
    const [isInitialised, setisInitialised] = useState(false);
    const [showDebugRoutes] = useState(false);

    const statsAccumRef = useRef(0);
    const lastStatsRef = useRef<SimulationStats | null>(null);
    const statsRef = useRef<SimulationStats | null>(null);
    const raycasterRef = useRef(new THREE.Raycaster());
    const simAccumulatorRef = useRef(0);

    

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
        }
    }, [simIsRunning, setFollowedVehicleId]);

    /**
     * Main update loop - runs every frame
     */
    useFrame((_, delta) => {
        if (!simIsRunning || !isInitialised) return;
        const vm = vehicleManagerRef.current;
        if (!vm) return;
        if (followedVehicleId !== null) {
            const vehicle = vm.getVehicleById(followedVehicleId);
            if (vehicle) {
                // Position camera on roof of car, slightly forward
                const carPos = vehicle.model.position.clone();
                const carRotation = vehicle.model.rotation.y;
                
                // Camera height above car (roof level)
                const cameraHeight = 1.1;
                
                // Forward offset on the car (positive = toward front, negative = toward back)
                const forwardOffset = -0.4;
                
                // Horizontal offset (positive = right, negative = left)
                const horizontalOffset = 0;
                
                // Look ahead distance
                const lookAheadDistance = 15;
                
                // Calculate forward direction based on car's rotation
                const forward = new THREE.Vector3(
                    Math.sin(carRotation),
                    0,
                    Math.cos(carRotation)
                );
                
                // Calculate right direction (perpendicular to forward)
                const right = new THREE.Vector3(
                    Math.cos(carRotation),
                    0,
                    -Math.sin(carRotation)
                );
                
                // Set camera position on top of car, offset forward and horizontally
                camera.position.set(
                    carPos.x + forward.x * forwardOffset + right.x * horizontalOffset,
                    carPos.y + cameraHeight,
                    carPos.z + forward.z * forwardOffset + right.z * horizontalOffset
                );
                
                // Look ahead in the direction the car is facing
                const lookAt = carPos.clone().add(forward.multiplyScalar(lookAheadDistance));
                lookAt.y = carPos.y + 1; // Look slightly ahead and level
                camera.lookAt(lookAt);
            } else {
                // Vehicle no longer exists, exit follow mode
                setFollowedVehicleId(null);
            }
        }
        
        if (simIsPausedRef.current) return;

        // 1) advance sim + controller state (variable timestep, clamped for stability)
        const maxDelta = 0.05;
        const clamped = Math.min(delta, maxDelta);

        vm.update(clamped, junctionObjectRefs);

        // 2) push controller colours into stop lines (visual sync)
        applyIntersectionStopLineColours(junctionObjectRefs.current, vm);

        

        // 4) stats (throttled, stored in ref)
        statsAccumRef.current += delta;
        if (statsAccumRef.current >= 0.1) {
            statsAccumRef.current = 0;
            const s = vm.getStats();

            // optional: avoid updating ref if nothing changed
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



    // Cache junction positions to avoid recalculating every frame
    const junctionPositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
    const spawnRatePositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());

    return (
        <>
            {simIsRunning && isInitialised && (
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