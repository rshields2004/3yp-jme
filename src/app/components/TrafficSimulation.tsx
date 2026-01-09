import { useThree, useFrame } from "@react-three/fiber";
import { useRef, useState, useEffect } from "react";
import { MTLLoader, OBJLoader } from "three/examples/jsm/Addons.js";
import { useJModellerContext } from "../context/JModellerContext";
import { generateAllRoutes } from "../includes/junctionmanagerutils/carRouting";
import { JunctionManager } from "../includes/junctionmanagerutils/junctionManager";
import { VehicleManager } from "../includes/junctionmanagerutils/vehicleManager";
import * as THREE from "three";


export const TrafficSimulation = () => {
    const { simIsRunning, junction, junctionObjectRefs } = useJModellerContext();
    const { scene } = useThree();

    const junctionConfig = junction;

    const vehicleManagerRef = useRef<VehicleManager | null>(null);
    const junctionManagerRef = useRef<JunctionManager | null>(null);
    const carModelsRef = useRef<THREE.Group[]>([]);
    const [isInitialized, setIsInitialized] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState("Initializing...");
    const wasRunningRef = useRef(false);

    useEffect(() => {
    // Detect when simulation stops (transitions from running to not running)
    if (wasRunningRef.current && !simIsRunning) {
        console.log("Simulation stopped - clearing all vehicles");
        
        if (vehicleManagerRef.current) {
            vehicleManagerRef.current.clearAll();
        }
        }
        
        wasRunningRef.current = simIsRunning;
    }, [simIsRunning]);


    // Initialize the simulation
    useEffect(() => {
        if (!junctionConfig || !junctionObjectRefs || junctionObjectRefs.current.length === 0) {
            setLoadingStatus("Waiting for junction data...");
            return;
        }

        const initialize = async () => {
            try {
                setLoadingStatus("Loading car models...");

                // Load car models
                const carModels = await loadCarModels();
                carModelsRef.current = carModels;
                setLoadingStatus(`Loaded ${carModels.length} car models`);

                setLoadingStatus("Generating routes...");

                // Generate routes from your junction configuration
                const { routes } = generateAllRoutes(junctionConfig, junctionObjectRefs.current, {
                    maxSteps: 30,
                    disallowUTurn: true
                });

                setLoadingStatus(`Generated ${routes.length} routes`);

                if (routes.length === 0) {
                    setLoadingStatus("Warning: No routes generated!");
                    return;
                }

                setLoadingStatus("Creating junction manager...");

                // Create junction manager
                const junctionManager = new JunctionManager(junctionConfig, junctionObjectRefs.current);
                junctionManagerRef.current = junctionManager;

                setLoadingStatus("Creating vehicle manager...");

                // Create vehicle manager
                const vehicleManager = new VehicleManager(scene, routes, carModels, {
                    mode: "continuous",
                    spawnInterval: 1.0,
                    maxVehicles: 20,
                    minSpawnGap: 15.0
                });
                vehicleManagerRef.current = vehicleManager;

                setIsInitialized(true);
                setLoadingStatus("Ready! Start simulation to spawn vehicles.");

                console.log("Traffic simulation initialized successfully");
                console.log(`Routes: ${routes.length}, Car models: ${carModels.length}`);

            } catch (error) {
                console.error("Failed to initialize traffic simulation:", error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                setLoadingStatus(`Error: ${errorMessage}`);
            }
        };

        initialize();

        // Cleanup on unmount
        return () => {
            if (vehicleManagerRef.current) {
                vehicleManagerRef.current.dispose();
                vehicleManagerRef.current = null;
            }
            carModelsRef.current = [];
            setIsInitialized(false);
        };
    }, [junctionConfig, junctionObjectRefs, scene]);

    // Update simulation every frame
    useFrame((state, delta) => {
        if (!isInitialized || !simIsRunning) return;

        const vehicleManager = vehicleManagerRef.current;
        const junctionManager = junctionManagerRef.current;

        if (!vehicleManager || !junctionManager) return;

        // Update vehicle manager (spawning, physics, removal)
        vehicleManager.update(delta);

        // Update junction manager (state transitions, traffic rules)
        const vehicles = vehicleManager.getVehicles();
        junctionManager.update(vehicles, delta);

        // Optional: Log stats every few seconds
        if (Math.floor(state.clock.elapsedTime) % 5 === 0 && delta < 0.1) {
            const stats = vehicleManager.getStats();
            console.log(`Traffic stats - Active: ${stats.active}, Spawned: ${stats.totalSpawned}, Completed: ${stats.totalCompleted}`);
        }
    });

    return (
        <>
            {/* Debug info display */}
            {!isInitialized && (
                <mesh position={[0, 10, 0]}>
                    <boxGeometry args={[0.1, 0.1, 0.1]} />
                    <meshBasicMaterial color="yellow" />
                </mesh>
            )}
        </>
    );
}

/**
 * Load car models from OBJ+MTL files
 * Replace these paths with your actual car model files
 */
async function loadCarModels(): Promise<THREE.Group[]> {
    const mtlLoader = new MTLLoader();
    const objLoader = new OBJLoader();

    // Define your car model files here
    const carFiles = [
        { obj: "/models/car-coupe-blue.obj", mtl: "/models/car-coupe-blue.mtl" }
    ];

    const loadedModels: THREE.Group[] = [];

    for (const car of carFiles) {
        try {
            // Load MTL
            const materials = await mtlLoader.loadAsync(car.mtl);
            materials.preload();

            // Load OBJ with materials
            objLoader.setMaterials(materials);
            const model = await objLoader.loadAsync(car.obj);

            // Optional: Scale and position the model if needed
            model.scale.set(1, 1, 1);

            loadedModels.push(model);
            console.log(`Loaded car model: ${car.obj}`);
        } catch (error) {
            console.warn(`Failed to load car model ${car.obj}:`, error);
            // Continue loading other models even if one fails
        }
    }

    // Fallback: If no models loaded, create simple box cars
    if (loadedModels.length === 0) {
        console.warn("No car models loaded, using fallback box cars");
        loadedModels.push(...createFallbackCarModels());
    }

    return loadedModels;
}

/**
 * Create simple box cars as fallback if OBJ models don't load
 */
function createFallbackCarModels(): THREE.Group[] {
    const colors = [
        0xff0000, // red
        0x0000ff, // blue
        0x00ff00, // green
        0xffff00, // yellow
        0xff00ff, // magenta
        0x00ffff, // cyan
    ];

    return colors.map(color => {
        const group = new THREE.Group();

        // Car body
        const bodyGeometry = new THREE.BoxGeometry(2, 1.5, 4.5);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Car roof (slightly smaller)
        const roofGeometry = new THREE.BoxGeometry(1.8, 1, 2.5);
        const roofMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(color).multiplyScalar(0.8)
        });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = 1.25;
        roof.castShadow = true;
        group.add(roof);

        // Windows (dark)
        const windowMaterial = new THREE.MeshStandardMaterial({
            color: 0x222222,
            metalness: 0.8,
            roughness: 0.2
        });

        const windowGeometry = new THREE.BoxGeometry(1.85, 0.9, 2.4);
        const windows = new THREE.Mesh(windowGeometry, windowMaterial);
        windows.position.y = 1.25;
        group.add(windows);

        return group;
    });
};