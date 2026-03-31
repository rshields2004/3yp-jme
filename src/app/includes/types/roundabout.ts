/**
 * roundabout.ts
 * Type definitions for roundabout junction objects, their geometric
 * structures, and configuration.
 */

import * as THREE from "three";
import { ExitConfig, LaneLineProperties, LaneStructure, ObjectTransform } from "./types";
import { Tuple3 } from "./simulation";

// STRUCTURES

/**
 * Geometry and lane data for a single roundabout exit arm
 */
export type RoundaboutExitStructure = {
    /**
     * Angle of this exit arm in radians
     */
    angle: number;
    /**
     * Lane dividing lines for this arm
     */
    laneLines: LaneStructure[];
    /**
     * Stop line (give-way line) at the entry to the roundabout
     */
    stopLine: RingLaneStructure;
};

/**
 * A single ring lane on the roundabout (used for both ring lines and stop lines)
 */
export type RingLaneStructure = {
    radius: number;
    points: Tuple3[];
    properties: LaneLineProperties;
};

/**
 * Pre-computed geometric structure for an entire roundabout
 */
export type RoundaboutStructure = {
    id: string;
    islandGeometry: THREE.CircleGeometry;
    floorCircle: THREE.RingGeometry;
    ringLines: RingLaneStructure[];
    roundaboutFloor: THREE.ShapeGeometry;
    exitStructures: RoundaboutExitStructure[];
    edgeTubes: THREE.TubeGeometry[];
    maxDistanceToStopLine: number;     
    islandRadius: number;
    outerRadius: number;       
    avgRadius: number;         
    laneMidRadii: number[];       
};

// CONFIGURATION

/**
 * User-facing configuration for a roundabout (number of exits and their properties)
 */
export type RoundaboutConfig = {
    numExits: number;
    exitConfig: ExitConfig[];
};

/**
 * A roundabout junction object as stored in the junction configuration
 */
export type RoundaboutObject = {
    id: string;
    name: string;
    type: "roundabout";
    config: RoundaboutConfig;
    /**
     * World transform set by the host and consumed by the client on mount.
     */
    transform?: ObjectTransform;
};