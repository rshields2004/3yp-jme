import * as THREE from "three";

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
    id: string;
    exitInfo: ExitStructure[];
    edgeTubes: THREE.TubeGeometry[];
    intersectionFloor: THREE.ShapeGeometry;
    maxDistanceToStopLine: number;
}

export type JunctionStructure = {
    intersectionStructures: IntersectionStructure[];
}


export type ExitConfig = {
    numLanesIn: number;
    laneCount: number;
    laneWidth: number;
    exitLength: number;
};

export type IntersectionConfig = {
    numExits: number;
    exitConfig: ExitConfig[];
};

export type IntersectionObject = {
    id: string;
    type: "intersection"
    config: IntersectionConfig;
};

export type JunctionObject = IntersectionObject; // Later on a | would go here with the other types of object

export type JunctionObjectTypes = "intersection" | "roundabout";

export type JunctionLink = {
    id: string;
    objectPair: [ExitRef, ExitRef];
}

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

    setBestRotation: () => void;
};



export type ExitRef = {
    structureID: string;
    exitIndex: number;
};