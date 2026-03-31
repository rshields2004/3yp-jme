/**
 * intersection.ts
 * Type definitions for signalised intersection objects, their geometric
 * structures, and configuration.
 */

import { ExitConfig, LaneStructure, ObjectTransform } from "./types";
import * as THREE from "three";

// STRUCTURES

/**
 * Geometry for a single exit arm of an intersection
 */
export type ExitStructure = {
    /**
     * Lane dividing lines for this arm
     */
    laneLines: LaneStructure[];
    /**
     * The stop line (traffic light line) for this arm
     */
    stopLine: LaneStructure;
};

/**
 * Pre-computed geometric structure for an entire intersection
 */
export type IntersectionStructure = {
    id: string;
    exitInfo: ExitStructure[];
    edgeTubes: THREE.TubeGeometry[];
    intersectionFloor: THREE.ShapeGeometry;
    maxDistanceToStopLine: number;
};

// CONFIGURATION

/**
 * User-facing configuration for an intersection
 */
export type IntersectionConfig = {
    numExits: number;
    exitConfig: ExitConfig[];
};

/**
 * An intersection junction object as stored in the junction configuration
 */
export type IntersectionObject = {
    id: string;
    name: string;
    type: "intersection";
    config: IntersectionConfig;
    transform?: ObjectTransform;
};