import { ExitConfig, LaneStructure } from "./types";
import * as THREE from "three";

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