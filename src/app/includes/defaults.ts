import {LaneLineProperties, IntersectionStructure, IntersectionConfig, LaneStructure, ExitStructure } from "./types";
import * as THREE from "three";

export const defaultLaneProperties: LaneLineProperties = {
    pattern: "solid",
    colour: "white",
    thickness: 0.5,
    glow: 1.3,
};

export const defaultLane: LaneStructure = {
    line: new THREE.Line3(),
    properties: { ...defaultLaneProperties },
};

export const defaultExit: ExitStructure = {
    laneLines: [],
    stopLines: [],
}

export const defaultIntersectionStructure: IntersectionStructure = {
    exitInfo: Array.from({ length: 4 }, () => (defaultExit)),
    edgeTubes: [],
    intersectionFloor: new THREE.ShapeGeometry(),
    maxDistanceToStopLine: 20,
};

export const defaultIntersectionConfig: IntersectionConfig = {
    numExits: 4,
    origin: new THREE.Vector3(0, 1, 0),
    exitConfig: Array.from({ length: 4 }, () => ({
        laneCount: 2,
        laneWidth: 1.5,
        exitLength: 40,
    })),
};


export const defaultJunctionConfig = {
    intersections: [],
};

export const carTypes = ["coupe", "hatchback", "micro", "microcargo", "microtransport", "minibus", "mpv", "normal", "pickup", "pickup-small", "station", "van"];
export const carColours = ["blue", "citrus", "green", "orange", "red", "silver", "violet"];

