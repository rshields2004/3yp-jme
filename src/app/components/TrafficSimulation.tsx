"use client";

import { useThree, useFrame } from "@react-three/fiber";
import { useRef, useState, useEffect, useCallback } from "react";
import { MTLLoader, OBJLoader } from "three/examples/jsm/Addons.js";
import { useJModellerContext } from "../context/JModellerContext";
import * as THREE from "three";
import { generateAllRoutes, Route } from "../includes/junctionmanagerutils/carRouting";
import { carFiles } from "../includes/types/carTypes";
import { VehicleManager } from "../includes/junctionmanagerutils/vehicleManager";
import { ThickLineHandle } from "./ThickLine";

// Global cache for car models (persists across simulation restarts)
let cachedCarModels: THREE.Group[] | null = null;
let carModelsLoading: Promise<THREE.Group[]> | null = null;

type SimulationStats = {
    active: number;
    spawned: number;
    completed: number;
    waiting: number;   // reserved for later
    routes: number;
    spawnQueue: number;
};


function applyIntersectionStopLineColours(
    junctionGroups: THREE.Group[],
    vehicleManager: VehicleManager
) {
    for (const group of junctionGroups) {
        if (!group?.userData) continue;
        if (group.userData.type !== "intersection") continue;

        const junctionId = group.userData.id as string | undefined;
        if (!junctionId) continue;

        const controller = vehicleManager.getIntersectionController?.(junctionId);
        if (!controller) continue;

        // Added in step 3: entryKey -> React ref object
        const stopLineRefsByEntryKey = group.userData.stopLineRefsByEntryKey as
            | Record<string, React.RefObject<ThickLineHandle>>
            | undefined;

        if (!stopLineRefsByEntryKey) continue;

        for (const [entryKey, refObj] of Object.entries(stopLineRefsByEntryKey)) {
            const handle = refObj?.current;
            if (!handle) continue;

            // Step 4: controller.getLightColour(entryKey) returns "GREEN" | "RED"
            const colour = controller.getLightColour(entryKey);

            if (colour === "GREEN") handle.setGreen();
            else handle.setRed();
        }
    }
}


/**
 * Load car models with caching
 * Only loads once, then reuses cached models
 */
async function loadCarModels(): Promise<THREE.Group[]> {
    if (cachedCarModels && cachedCarModels.length > 0) {
        return cachedCarModels;
    }

    if (carModelsLoading) {
        return carModelsLoading;
    }

    carModelsLoading = (async () => {
        const mtlLoader = new MTLLoader();
        const objLoader = new OBJLoader();
        const loadedModels: THREE.Group[] = [];

        console.log("Loading car models...");

        for (const car of carFiles) {
            try {
                const materials = await mtlLoader.loadAsync(car.mtl);
                materials.preload();

                objLoader.setMaterials(materials);
                const model = await objLoader.loadAsync(car.obj);
                model.scale.set(1, 1, 1);

                loadedModels.push(model);
            } catch (error) {
                console.warn(`Failed to load car model ${car.obj}:`, error);
            }
        }

        if (loadedModels.length === 0) {
            console.warn("No car models loaded, using fallback boxes");
            loadedModels.push(...createFallbackCarModels());
        }

        console.log(`Loaded ${loadedModels.length} car models`);
        cachedCarModels = loadedModels;
        return loadedModels;
    })();

    return carModelsLoading;
}

/**
 * Create fallback box cars when OBJ models can't be loaded
 */
function createFallbackCarModels(): THREE.Group[] {
    const colors = [0xff0000, 0x0000ff, 0x00ff00, 0xffff00, 0xff00ff, 0x00ffff];

    return colors.map((color) => {
        const group = new THREE.Group();

        const bodyGeometry = new THREE.BoxGeometry(2, 1.5, 4.5);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        body.position.y = 0.75;
        group.add(body);

        const roofGeometry = new THREE.BoxGeometry(1.8, 1, 2.5);
        const roofMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(color).multiplyScalar(0.8),
        });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = 2;
        roof.castShadow = true;
        group.add(roof);

        return group;
    });
}

/**
 * Traffic Simulation Component
 * Drop this into your Scene component to enable traffic simulation
 */
export const TrafficSimulation = () => {
    const { junction, junctionObjectRefs, simIsRunning } = useJModellerContext();
    const { scene } = useThree();

    const [carsReady, setCarsReady] = useState(false);
    const [isInitialised, setisInitialised] = useState(false);
    const [showDebugRoutes, setShowDebugRoutes] = useState(false);
    const [showDebugInfo, setShowDebugInfo] = useState(true);

    const [stats, setStats] = useState<SimulationStats>({
        active: 0,
        spawned: 0,
        completed: 0,
        waiting: 0,
        routes: 0,
        spawnQueue: 0,
    });

    const carModelsRef = useRef<THREE.Group[]>([]);
    const routesRef = useRef<Route[]>([]);
    const debugRoutesGroupRef = useRef<THREE.Group | null>(null);
    const wasRunningRef = useRef(false);
    const vehicleManagerRef = useRef<VehicleManager | null>(null);

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
    }, []);

    /**
     * Create debug route visualizations
     */
    const createDebugRoutes = useCallback(() => {
        if (debugRoutesGroupRef.current) {
            scene.remove(debugRoutesGroupRef.current);
        }

        const group = new THREE.Group();
        const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];

        routesRef.current.forEach((route, i) => {
            const color = colors[i % colors.length];
            const points = route.points.map((p) => new THREE.Vector3(p[0], p[1] + 0.1, p[2]));
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
    }, [scene]);

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

            const { routes } = generateAllRoutes(junction, junctionObjectRefs.current, {
                maxSteps: 30,
                disallowUTurn: true,
                spacing: 0.5,
            });

            routesRef.current = routes;
            console.log(`Generated ${routes.length} routes`);

            if (routes.length === 0) {
                console.warn("No routes generated - check junction connections!");
                return;
            }

            // Reset previous sim (if any)
            vehicleManagerRef.current?.reset();

            vehicleManagerRef.current = new VehicleManager(scene, carModelsRef.current, routesRef.current, {
                demandRatePerSec: 3,
                maxVehicles: 100,

                // Kinematics
                maxSpeed: 15,      // target cruising speed
                maxAccel: 4,      // m/s^2-ish
                maxDecel: 8,      // m/s^2-ish (positive number, applied as braking)

                yOffset: 0,

                minBumperGap: 1.5,
                maxSpawnAttemptsPerFrame: 6,

                enableLaneQueuing: true,
                debugLaneQueues: true,
            });

            // Create debug route visualization if enabled
            if (showDebugRoutes) {
                createDebugRoutes();
            }

            setisInitialised(true);
            setStats((prev) => ({
                ...prev,
                routes: routes.length,
                spawnQueue: 0,
                active: 0,
                spawned: 0,
                completed: 0,
                waiting: 0,
            }));

            console.log("Traffic simulation initialized!");
        } catch (error) {
            console.error("Failed to initialize simulation:", error);
        }
    }, [carsReady, junction, junctionObjectRefs, scene, showDebugRoutes, createDebugRoutes]);

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
                    if (Array.isArray((child as any).material)) {
                        (child as any).material.forEach((m: THREE.Material) => m.dispose());
                    } else if ((child as any).material) {
                        ((child as any).material as THREE.Material).dispose();
                    }
                }
            });
            debugRoutesGroupRef.current = null;
        }

        vehicleManagerRef.current?.reset();
        vehicleManagerRef.current = null;

        routesRef.current = [];
        setisInitialised(false);
        setStats({
            active: 0,
            spawned: 0,
            completed: 0,
            waiting: 0,
            routes: 0,
            spawnQueue: 0,
        });

        console.log("Traffic simulation cleaned up");
    }, [scene]);

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

    /**
     * Main update loop - runs every frame
     */
    useFrame((state, delta) => {
        if (!simIsRunning || !isInitialised) return;
        const vm = vehicleManagerRef.current;
        if (!vm) return;

        // 1) advance sim + controller state
        vm.update(delta);

        // 2) push controller colours into stop lines (visual sync)
        applyIntersectionStopLineColours(junctionObjectRefs.current, vm);

        // 3) stats (unchanged)
        const s = vm.getStats();
        setStats((prev) => ({
            ...prev,
            active: s.active,
            spawned: s.spawned,
            completed: s.completed,
            spawnQueue: s.spawnQueue,
            waiting: 0,
        }));
    });


    return (
        <>
            {simIsRunning && !isInitialised && (
                <mesh position={[0, 5, 0]}>
                    <sphereGeometry args={[0.5, 16, 16]} />
                    <meshBasicMaterial color="yellow" />
                </mesh>
            )}
        </>
    );
};
