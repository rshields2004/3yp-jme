/**
 * types.ts
 * Core shared types used across the JME application including junction
 * configuration, lane properties, application state, and exit references.
 */

import * as THREE from "three";
import { IntersectionObject } from "./intersection";
import { RoundaboutObject } from "./roundabout";
import { SimulationStats, SimConfig, Tuple3, FollowedVehicleStats } from "./simulation";

// LANE PROPERTIES

/**
 * Visual properties for a lane dividing line
 */
export type LaneLineProperties = {
    /**
     * Line pattern — solid or dashed
     */
    pattern: "solid" | "dashed";
    /**
     * Line colour
     */
    colour: "white" | "green" | "red";
    /**
     * Line thickness in world units
     */
    thickness: number;
    /**
     * Glow intensity multiplier
     */
    glow: number;
};

/**
 * A lane divider line in 3D space together with its visual properties
 */
export type LaneStructure = {
    line: THREE.Line3;
    properties: LaneLineProperties;
};

// EXIT CONFIGURATION

/**
 * Configuration for a single exit arm of a junction
 */
export type ExitConfig = {
    /**
     * Number of inbound lanes on this arm
     */
    numLanesIn: number;
    /**
     * Total lane count (inbound + outbound)
     */
    laneCount: number;
    /**
     * Length of the exit arm in world units
     */
    exitLength: number;
    /**
     * Optional per-exit spawn rate override (vehicles per second)
     */
    spawnRate?: number;
};

// JUNCTION OBJECTS

/**
 * Plain-serialisable world transform for a junction object.
 * Embedded in JunctionObject so clients reconstruct positions
 * without any cross-renderer effect timing dependency.
 */
export type ObjectTransform = {
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
};


/**
 * Union of all supported junction object types
 */
export type JunctionObject = IntersectionObject | RoundaboutObject;

/**
 * Discriminator string for junction object types
 */
export type JunctionObjectTypes = "intersection" | "roundabout" | "link";

// LINKS

/**
 * A link connecting two exit arms across different junctions
 */
export type JunctionLink = {
    id: string;
    objectPair: [ExitRef, ExitRef];
};

/**
 * Pre-computed lane curves for a rendered link
 */
export type LinkStructure = {
    id: string;
    laneCurves: Tuple3[][];
}

// JUNCTION CONFIGURATION

/**
 * Top-level configuration describing the entire junction layout
 */
export type JunctionConfig = {
    /**
     * All junction objects (roundabouts, intersections)
     */
    junctionObjects: JunctionObject[];
    /**
     * All links between exit arms
     */
    junctionLinks: JunctionLink[];
    /**
     * Default lane width in world units
     */
    laneWidth: number;
};

// APPLICATION STATE

/**
 * Central application state provided by JModellerContext
 */
export type JModellerState = {
    junction: JunctionConfig;
    setJunction: (junction: JunctionConfig | ((prev: JunctionConfig) => JunctionConfig)) => void;

    selectedObjects: string[];
    setSelectedObjects: React.Dispatch<React.SetStateAction<string[]>>;

    junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>;
    registerJunctionObject: (group: THREE.Group) => void;
    unregisterJunctionObject: (group: THREE.Group<THREE.Object3DEventMap>) => void;

    selectedExits: ExitRef[];
    setSelectedExits: React.Dispatch<React.SetStateAction<ExitRef[]>>;

    snapToValidPosition: (draggedGroup: THREE.Group<THREE.Object3DEventMap>) => void;
    removeObject: (objID: string) => void;
    objectCounter: number;
    setObjectCounter: React.Dispatch<React.SetStateAction<number>>;

    simIsRunning: boolean;
    simIsPaused: boolean;
    pauseSim: () => void;
    resumeSim: () => void;
    startSim: () => void;
    haltSim: () => void;

    stats: SimulationStats;
    setStats: React.Dispatch<React.SetStateAction<SimulationStats>>;

    carsReady: boolean;
    setCarsReady: React.Dispatch<React.SetStateAction<boolean>>;

    followedVehicleId: number | null;
    setFollowedVehicleId: React.Dispatch<React.SetStateAction<number | null>>;
    followedVehicleStats: FollowedVehicleStats | null;
    setFollowedVehicleStats: React.Dispatch<React.SetStateAction<FollowedVehicleStats | null>>;
    
    isConfigConfirmed: boolean;
    confirmConfig: () => void;
    resetConfig: () => void;

    simConfig: SimConfig;
    setSimConfig: React.Dispatch<React.SetStateAction<SimConfig>>;

    toolMode: "view" | "build";
    setToolMode: React.Dispatch<React.SetStateAction<"view" | "build">>;

    showOverlayLabels: boolean;
    setShowOverlayLabels: React.Dispatch<React.SetStateAction<boolean>>;
};



// EXIT REFERENCES

/**
 * Reference to a specific exit arm on a specific junction object
 */
export type ExitRef = {
    structureID: string;
    exitIndex: number;
};

