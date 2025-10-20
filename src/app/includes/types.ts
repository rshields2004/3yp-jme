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

export type LanePattern = "solid" | "dashed";

export type LaneColour = "white" | "green" | "red";

export type LaneLineProperties = {
    pattern: "solid" | "dashed";
    colour: "white" | "green" | "red";
    thickness: number;
    glow: number;
};

export type LaneLine = {
    start: [number, number, number];
    end: [number, number, number];
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

export type JunctionStructure = {
    exitInfo: Exit[];
    edgeTubes: THREE.TubeGeometry[];
}

export type JunctionConfig = {
    numExits: number;
    exitConfig: ExitConfig[];
};

export type JunctionState = {
    junctionStructure: JunctionStructure;
    setJunctionStructure: (junctionStructure: JunctionStructure) => void;
    junctionConfig: JunctionConfig,
    setJunctionConfig: (junctionConfig: JunctionConfig) => void;
};