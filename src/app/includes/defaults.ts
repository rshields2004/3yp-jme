import {LaneLineProperties, IntersectionStructure, IntersectionConfig, LaneStructure, ExitStructure } from "./types";
import * as THREE from "three";

export const defaultLaneProperties: LaneLineProperties = {
    pattern: "solid",
    colour: "white",
    thickness: 0.5,
    glow: 1.3,
};


export const defaultIntersectionConfig: IntersectionConfig = {
    numExits: 4,
    origin: new THREE.Vector3(0, 1, 0),
    exitConfig: Array.from({ length: 4 }, () => ({
        laneCount: 2,
        laneWidth: 1.5,
        exitLength: 20,
    })),
};

export const defaultJunctionObject = {
    id: crypto.randomUUID(),
    type: "intersection",
    config: defaultIntersectionConfig,
}

export const defaultJunctionConfig = {
    junctionObjects: [],
    junctionLinks: [],
};

export const carTypes = ["coupe", "hatchback", "micro", "microcargo", "microtransport", "minibus", "mpv", "normal", "pickup", "pickup-small", "station", "van"];
export const carColours = ["blue", "citrus", "green", "orange", "red", "silver", "violet"];

export const FLOOR_Y = 1;

