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

export type LaneLine = {
    line: THREE.Line3;
    properties: LaneLineProperties;
};

export type ExitConfig = {
    laneCount: number;
    laneWidth: number;
    exitLength: number;
};

export type Exit = {
    laneLines: LaneLine[];
    stopLines: LaneLine[];
};

export type IntersectionStructure = {
    exitInfo: Exit[];
    edgeTubes: THREE.TubeGeometry[];
}

export type IntersectionConfig = {
    numExits: number;
    origin: THREE.Vector3;
    exitConfig: ExitConfig[];
};

export type Intersection = {
    intersectionStructure: IntersectionStructure;
    intersectionConfig: IntersectionConfig;
};

export type Junction = {
    intersections: Intersection[];
}

export type JModellerState = {
    junction: Junction;
    setJunction: (junction: Junction | ((prev: Junction) => Junction)) => void;
};

