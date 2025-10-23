import { LaneLine, LaneLineProperties, Exit, Intersection, IntersectionStructure, IntersectionConfig } from "./types";
import * as THREE from "three";

export const defaultLaneProperties: LaneLineProperties = {
    pattern: "solid",
    colour: "white",
    thickness: 0.05,
    glow: 0.3,
};

export const defaultLane: LaneLine = {
    line: new THREE.Line3(),
    properties: { ...defaultLaneProperties },
};

export const defaultExit: Exit = {
    laneLines: [],
    stopLines: [],
}

export const defaultIntersectionStructure: IntersectionStructure = {
    exitInfo: Array.from({ length: 4 }, () => (defaultExit)),
    edgeTubes: [],
};

export const defaultIntersectionConfig: IntersectionConfig = {
    numExits: 3,
    origin: new THREE.Vector3(0, 10, 0),
    exitConfig: Array.from({ length: 3 }, () => ({
        laneCount: 2,
        laneWidth: 1.5,
        exitLength: 40,
    })),
};

export const defaultIntersection: Intersection = {
    intersectionStructure: defaultIntersectionStructure,
    intersectionConfig: defaultIntersectionConfig,
};

export const defaultJunction = {
    intersections: [defaultIntersection],
};

export const carTypes = ["coupe", "hatchback", "micro", "microcargo", "microtransport", "minibus", "mpv", "normal", "pickup", "pickup-small", "station", "van"];
export const carColours = ["blue", "citrus", "green", "orange", "red", "silver", "violet"];

