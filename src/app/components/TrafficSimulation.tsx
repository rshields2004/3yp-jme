"use client";

import { useThree, useFrame } from "@react-three/fiber";
import { useRef, useState, useEffect, useCallback, memo } from "react";
import { MTLLoader, OBJLoader } from "three/examples/jsm/Addons.js";
import { useJModellerContext } from "../context/JModellerContext";
import * as THREE from "three";
import { generateAllRoutes, Route } from "../includes/junctionmanagerutils/carRouting";
import { carFiles } from "../includes/types/carTypes";
import { VehicleManager } from "../includes/junctionmanagerutils/vehicleManager";
import { ThickLineHandle } from "./ThickLine";
import { Billboard, Html } from "@react-three/drei";
import { SimulationStats } from "../includes/types/simulation";

// Global cache for car models (persists across simulation restarts)
let cachedCarModels: THREE.Group[] | null = null;
let carModelsLoading: Promise<THREE.Group[]> | null = null;



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

        const stopLineRefsByEntryKey = group.userData.stopLineRefsByEntryKey as Record<string, React.RefObject<ThickLineHandle>> | undefined;

        if (!stopLineRefsByEntryKey) continue;


        
        // Cache last colours so we only update when a light actually changes
        const lastColours = (group.userData._stopLineLastColours ??= {}) as Record<string, string>;

        for (const [entryKey, refObj] of Object.entries(stopLineRefsByEntryKey)) {
            const handle = refObj?.current;
            if (!handle) continue;

            const colour = controller.getLightColour(entryKey);

            if (lastColours[entryKey] === colour) continue; 
            lastColours[entryKey] = colour;

            switch (colour) {
                case "GREEN":
                    handle.setGreen();
                    break;
                case "AMBER":
                    handle.setAmber();
                    break;
                case "RED_AMBER":
                    handle.setRedAmber();
                    break;
                case "RED":
                default:
                    handle.setRed();
                    break;
            }

            
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
    const { junction, junctionObjectRefs, simIsRunning, stats, setStats } = useJModellerContext();
    const { scene } = useThree();

    const [carsReady, setCarsReady] = useState(false);
    const [isInitialised, setisInitialised] = useState(false);
    const [showDebugRoutes, setShowDebugRoutes] = useState(false);

    const statsAccumRef = useRef(0);
    const lastStatsRef = useRef<SimulationStats | null>(null);

    

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
                demandRatePerSec: 10,
                maxVehicles: 100,
                maxSpawnQueue: 200,

                // Kinematics
                maxSpeed: 10,      // target cruising speed
                maxAccel: 100,      // m/s^2-ish
                maxDecel: 100,      // m/s^2-ish (positive number, applied as braking)

                yOffset: 0,

                minBumperGap: 1.5,
                maxSpawnAttemptsPerFrame: 20,
                stopLineOffset: 0.6,

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
                junctions: {
                    global: {
                    count: 0,
                    approaching: 0,
                    waiting: 0,
                    inside: 0,
                    exiting: 0,
                    entered: 0,
                    exited: 0,
                    blockedDownstream: 0,
                    },
                    byId: {},
                },
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
            junctions: {
                global: {
                count: 0,
                approaching: 0,
                waiting: 0,
                inside: 0,
                exiting: 0,
                entered: 0,
                exited: 0,
                blockedDownstream: 0,
                },
                byId: {},
            },
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
        vm.update(delta, junctionObjectRefs);

        // 2) push controller colours into stop lines (visual sync)
        applyIntersectionStopLineColours(junctionObjectRefs.current, vm);

        // 3) stats (unchanged)
        // 3) stats (throttled)
        statsAccumRef.current += delta;

        const s = vm.getStats(); // your full SimulationStats snapshot

        // update React state only 10 times per second
        if (statsAccumRef.current >= 0.1) {
        statsAccumRef.current = 0;

        // optional: avoid updating state if nothing changed
        // (cheap shallow compare for a couple of fields)
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
            setStats(s);
        }
        }

    });



    const JunctionStatsLabels = memo(
        function JunctionStatsLabels({
            junctionGroups,
            stats,
        }: {
            junctionGroups: THREE.Group[];
            stats: SimulationStats;
        }) {
            return (
                <>
                    {junctionGroups
                        .filter((g) => g?.userData?.id && g?.userData?.type && g.userData.type !== "link")
                        .map((g) => {
                            const id = g.userData.id as string;
                            const js = stats.junctions.byId?.[id];
                            if (!js) return null;

                            // position above the object
                            const pos = new THREE.Vector3();
                            g.getWorldPosition(pos);
                            pos.y += 10; // tweak height

                            return (
                                <group key={id} position={pos}>
                                    <Billboard follow lockX={false} lockY={false} lockZ={false}>
                                        <Html center sprite distanceFactor={12} transform>
                                            <div
                                                style={{
                                                    background: "rgba(0,0,0,0.65)",
                                                    color: "white",
                                                    padding: "6px 8px",
                                                    borderRadius: 8,
                                                    fontSize: 12,
                                                    lineHeight: 1.2,
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                <div style={{ fontWeight: 700 }}>
                                                    {js.type} {id.slice(0, 6)}
                                                </div>
                                                <div>Approaching:{js.approaching} W:{js.waiting} I:{js.inside} X:{js.exiting}</div>
                                                <div>in:{js.entered} out:{js.exited} blk:{js.blockedDownstream}</div>
                                                {js.state && <div>sig:{js.state}</div>}
                                            </div>
                                        </Html>
                                    </Billboard>
                                </group>
                            );
                        })}
                </>
            );
        },
        (prevProps, nextProps) => {
            // Custom comparison function to prevent unnecessary re-renders
            // Only re-render if junction stats actually changed
            const prevById = prevProps.stats.junctions.byId;
            const nextById = nextProps.stats.junctions.byId;
            
            // Check if the number of junctions changed
            const prevKeys = Object.keys(prevById);
            const nextKeys = Object.keys(nextById);
            
            if (prevKeys.length !== nextKeys.length) return false;
            
            // Check if any junction stats changed
            for (const id of nextKeys) {
                const prev = prevById[id];
                const next = nextById[id];
                
                if (!prev || !next) return false;
                
                // Compare all relevant fields
                if (
                    prev.approaching !== next.approaching ||
                    prev.waiting !== next.waiting ||
                    prev.inside !== next.inside ||
                    prev.exiting !== next.exiting ||
                    prev.entered !== next.entered ||
                    prev.exited !== next.exited ||
                    prev.blockedDownstream !== next.blockedDownstream ||
                    prev.state !== next.state
                ) {
                    return false; // Stats changed, need to re-render
                }
            }
            
            return true; // No changes, skip re-render
        }
    );


    


    return (
        <>
            {simIsRunning && isInitialised && (
                <JunctionStatsLabels
                    junctionGroups={junctionObjectRefs.current}
                    stats={stats}
                />
            )}
        </>
    );
};