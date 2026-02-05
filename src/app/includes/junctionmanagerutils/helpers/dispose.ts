import * as THREE from "three";

/**
 * Dispose geometries/materials in an Object3D tree.
 */
export function disposeObjectTree(root: THREE.Object3D): void {
    root.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
                child.material.forEach((m) => m?.dispose());
            } else {
                child.material?.dispose();
            }
        }
    });
}
