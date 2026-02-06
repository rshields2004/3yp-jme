import * as THREE from "three";
import { IntersectionObject } from "./intersection";
import { RoundaboutObject } from "./roundabout";
import { ThickLineHandle } from "@/app/components/ThickLine";
import { SimulationStats, SimConfig } from "./simulation";


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
    laneWidth: number;
    exitLength: number;
    spawnRate: number; // vehicles per second
};


export type JunctionObject = IntersectionObject | RoundaboutObject; // Later on a | would go here with the other types of object

export type JunctionObjectTypes = "intersection" | "roundabout" | "link";

export type JunctionLink = {
    id: string;
    objectPair: [ExitRef, ExitRef];
};

export type JunctionConfig = {
    junctionObjects: JunctionObject[];
    junctionLinks: JunctionLink[];
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
    
    isConfigConfirmed: boolean;
    confirmConfig: () => void;
    resetConfig: () => void;

    simConfig: SimConfig;
    setSimConfig: React.Dispatch<React.SetStateAction<SimConfig>>;
};



export type ExitRef = {
    structureID: string;
    exitIndex: number;
};

// Simulation stuff


export type IntersectionTrafficController = {
    stopLinesQueue: { ref: React.RefObject<ThickLineHandle | null>, exitIndex: number }[];
    currentIndex: number;
    currentStep: number;
    intervalId: NodeJS.Timeout | null;
    sequence: string[];
};
