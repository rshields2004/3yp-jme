import * as THREE from "three";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";

export type CarProperties = {
    key: number;
    position: [number, number, number];
    scale: number,
    selected: boolean;
    colour: string;
    type: string;
    onSelect: () => void;
};

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

export type ExitStructure = {
    laneLines: LaneStructure[];
    stopLines: LaneStructure[];
};

export type IntersectionStructure = {
    exitInfo: ExitStructure[];
    edgeTubes: THREE.TubeGeometry[];
    intersectionFloor: THREE.ShapeGeometry;
    maxDistanceToStopLine: number;
}

export type JunctionStructure = {
    intersectionStructures: IntersectionStructure[];
}




export type ExitConfig = {
    laneCount: number;
    laneWidth: number;
    exitLength: number;
};

export type IntersectionConfig = {
    numExits: number;
    origin: THREE.Vector3;
    exitConfig: ExitConfig[];
};

export type JunctionConfig = {
    intersections: IntersectionConfig[];
    junctionLinks: [ExitRef, ExitRef][];
}


export type JModellerState = {
    junction: JunctionConfig;
    setJunction: (junction: JunctionConfig | ((prev: JunctionConfig) => JunctionConfig)) => void;
    junctionStructure: JunctionStructure;
    selectedJunctionObjectRefs: JunctionObjectRef[];
    setSelectedJunctionObjectRefs: React.Dispatch<React.SetStateAction<JunctionObjectRef[]>>;
    junctionObjectRefs: React.RefObject<JunctionObjectRef[]>;
    registerJunctionObject: (group: THREE.Group<THREE.Object3DEventMap>, type: string) => void;
    unregisterJunctionObject: (group: THREE.Group<THREE.Object3DEventMap>) => void;
    selectedExits: ExitRef[];
    setSelectedExits: React.Dispatch<React.SetStateAction<ExitRef[]>>;
};

// This exists for the drag controls to be able to attach themselves to any object
export type JunctionObjectRef = {
    group: THREE.Group;
    type: string;
};

export type ExitRef = {
    junctionGroup: THREE.Group;
    exitIndex: number;
    structureType: string;
    structureIndex: number;
};