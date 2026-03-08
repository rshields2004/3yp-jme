import * as THREE from "three";
import { IntersectionObject } from "./intersection";
import { RoundaboutObject } from "./roundabout";
import { SimulationStats, SimConfig, Tuple3, FollowedVehicleStats } from "./simulation";


export type LaneLineProperties = {
    pattern: "solid" | "dashed";
    colour: "white" | "green" | "red";
    thickness: number;
    glow: number;
};

export type LaneStructure = {
    line: THREE.Line3;
    properties: LaneLineProperties;
};

export type ExitConfig = {
    numLanesIn: number;
    laneCount: number;
    exitLength: number;
    spawnRate?: number; // optional per-exit override (vehicles per second)
};

/**
 * Plain-serializable world transform for a junction object.
 * Embedded in JunctionObject so clients reconstruct positions
 * without any cross-renderer effect timing dependency.
 */
export type ObjectTransform = {
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
};


export type JunctionObject = IntersectionObject | RoundaboutObject; // Later on a | would go here with the other types of object

export type JunctionObjectTypes = "intersection" | "roundabout" | "link";

export type JunctionLink = {
    id: string;
    objectPair: [ExitRef, ExitRef];
};

export type LinkStructure = {
    id: string;
    laneCurves: Tuple3[][];
}

export type JunctionConfig = {
    junctionObjects: JunctionObject[];
    junctionLinks: JunctionLink[];
    laneWidth: number;
};

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
};



export type ExitRef = {
    structureID: string;
    exitIndex: number;
};

