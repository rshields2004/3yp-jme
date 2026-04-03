/**
 * carModelLoaders.ts
 *
 * Asynchronously loads OBJ/MTL car models from the public assets folder and
 * caches them for reuse. Falls back to simple box geometry when models cannot
 * be fetched.
 */

import * as THREE from "three";
import { MTLLoader, OBJLoader } from "three/examples/jsm/Addons.js";
import { carFiles } from "../../types/carTypes";

// MODULE-LEVEL CACHE

/**
 * Resolved car model groups, populated after the first successful load.
 */
let cachedCarModels: THREE.Group[] | null = null;

/**
 * In-flight loading promise - prevents duplicate parallel fetches.
 */
let carModelsLoading: Promise<THREE.Group[]> | null = null;

// MODEL LOADING

/**
 * Loads every car model listed in {@link carFiles} using MTL + OBJ loaders.
 * Results are cached so subsequent calls return immediately.
 *
 * Each loaded group stores its original `carFiles` index in
 * `model.userData.carFileIndex` so the mapping survives even when some
 * models fail to load.
 *
 * @returns A promise resolving to an array of Three.js groups.
 */
export const loadCarModels = async (): Promise<THREE.Group[]> => {
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
                // Store the original carFiles index so model-to-carFiles mapping
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
};

// FALLBACK GEOMETRY

/**
 * Creates simple coloured box-car groups as a fallback when the OBJ/MTL
 * assets cannot be loaded.
 *
 * @returns An array of Six box-car groups in distinct colours.
 */
const createFallbackCarModels = (): THREE.Group[] => {
    const colours = [0xff0000, 0x0000ff, 0x00ff00, 0xffff00, 0xff00ff, 0x00ffff];

    return colours.map((colour) => {
        const group = new THREE.Group();

        const bodyGeometry = new THREE.BoxGeometry(2, 1.5, 4.5);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: colour });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        body.position.y = 0.75;
        group.add(body);

        const roofGeometry = new THREE.BoxGeometry(1.8, 1, 2.5);
        const roofMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(colour).multiplyScalar(0.8),
        });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = 2;
        roof.castShadow = true;
        group.add(roof);

        return group;
    });
};