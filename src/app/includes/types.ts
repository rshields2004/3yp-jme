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
}




export type JModellerState = {
    junction: JunctionConfig;
    setJunction: (junction: JunctionConfig | ((prev: JunctionConfig) => JunctionConfig)) => void;
    junctionStructure: JunctionStructure;
    selectedJunctionObjectRef: JunctionObjectRef | null;
    setSelectedJunctionObjectRef: React.Dispatch<React.SetStateAction<JunctionObjectRef | null>>;
};

// This exists for the drag controls to be able to attach themselves to any object
export type JunctionObjectRef = {
    group: THREE.Group;
    type: string;
}