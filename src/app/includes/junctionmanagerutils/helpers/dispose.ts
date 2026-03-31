/**
 * dispose.ts
 *
 * Recursively disposes Three.js geometry and material resources within an
 * Object3D tree to prevent GPU memory leaks.
 */

import * as THREE from "three";

// DISPOSAL

/**
 * Traverses an {@link THREE.Object3D} hierarchy and disposes every
 * {@link THREE.Mesh}'s geometry and material(s).
 *
 * @param root - The root object whose descendants should be disposed.
 */
export const disposeObjectTree = (root: THREE.Object3D): void => {
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
};
