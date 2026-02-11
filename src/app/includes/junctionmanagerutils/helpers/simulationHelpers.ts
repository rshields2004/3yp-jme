import * as THREE from "three";
import { VehicleManager } from "../vehicleManager";
import { ThickLineHandle } from "@/app/components/ThickLine";
import { MTLLoader, OBJLoader } from "three/examples/jsm/Addons.js";
import { carFiles } from "../../types/carTypes";

// Handles changing stopline colours from intersection controller


/**
 * Function that handles changing the lights of the stop lines (traffic lights) on screen
 * @param junctionGroups All junction objects
 * @param vehicleManager Current vehicle manager
 */
export function applyIntersectionStopLineColours(
    junctionGroups: THREE.Group[],
    vehicleManager: VehicleManager
) {
    
    // First we iterate through all possible intersections
    for (const group of junctionGroups) {
        if (!group?.userData) {
            continue;
        }

        // Ensure only intersections are targeted
        if (group.userData.type !== "intersection") {
            continue;
        }

        const junctionId = group.userData.id as string | undefined;
        if (!junctionId) {
            continue;
        }

        // Find the controller associated with the intersection
        const controller = vehicleManager.getIntersectionController?.(junctionId);
        if (!controller) {
            continue;
        }

        // Extract the stop line refs from the group metadata
        const stopLineRefsByEntryKey = group.userData.stopLineRefsByEntryKey as Record<string, React.RefObject<ThickLineHandle>> | undefined;

        if (!stopLineRefsByEntryKey) {
            continue;
        }


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



// Below is concerned with loading the car models from the server

let cachedCarModels: THREE.Group[] | null = null;
let carModelsLoading: Promise<THREE.Group[]> | null = null;


/**
 * Asynchronous function that loads the car models from the server onto the client as three groups
 * 
 * @returns A promise for the car models as a three group
 */
export async function loadCarModels(): Promise<THREE.Group[]> {
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

        for (let i = 0; i < carFiles.length; i++) {
            const car = carFiles[i];
            try {
                const materials = await mtlLoader.loadAsync(car.mtl);
                materials.preload();

                objLoader.setMaterials(materials);
                const model = await objLoader.loadAsync(car.obj);
                model.scale.set(1, 1, 1);
                // Store the original carFiles index so model ↔ carFiles mapping
                // survives even when some models fail to load.
                model.userData.carFileIndex = i;

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