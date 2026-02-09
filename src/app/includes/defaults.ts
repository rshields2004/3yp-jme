import { IntersectionConfig } from "./types/intersection";
import { RoundaboutConfig } from "./types/roundabout";
import { JunctionConfig, LaneLineProperties } from "./types/types";
import { SimConfig } from "./types/simulation";

export const defaultLaneProperties: LaneLineProperties = {
    pattern: "solid",
    colour: "white",
    thickness: 2.5,
    glow: 1.3,
};

export const defaultExitConfig = {
    numLanesIn: 1,
    laneCount: 2,
    laneWidth: 1.5,
    exitLength: 30,
};

export const defaultSimConfig: SimConfig = {
    // Spawning
    spawnRate: 0.5,
    maxVehicles: 100,
    maxSpawnAttemptsPerFrame: 20,
    maxSpawnQueue: 25,

    // Motion
    initialSpeed: 0,
    maxSpeed: 10,
    maxAccel: 4,
    maxDecel: 8,
    comfortDecel: 4,
    maxJerk: 10,

    // Spacing
    minBumperGap: 0.5,
    timeHeadway: 0.5,
    stopLineOffset: 0.01,

    // Rendering
    yOffset: 0.01,

    // Stage 2
    enableLaneQueuing: true,
    debugLaneQueues: false,

    // Roundabout-specific
    roundaboutDecelZone: 20,

    // Roundabout controller
    roundaboutMinGap: 2,
    roundaboutMinTimeGap: 1.5,
    roundaboutSafeEntryDist: 20,
    roundaboutEntryTimeout: 1.0,
    roundaboutMinAngularSep: Math.PI / 6,

    // Intersection controller (traffic light timings)
    intersectionGreenTime: 8,
    intersectionAmberTime: 1,
    intersectionRedAmberTime: 1,
    intersectionAllRedTime: 2,
};

export const defaultIntersectionConfig: IntersectionConfig = {
    numExits: 3,
    exitConfig: Array.from({ length: 3 }, () => (defaultExitConfig)),
};

export const defaultRoundaboutConfig: RoundaboutConfig = {
    numExits: 3,
    exitConfig: Array.from({ length: 3 }, () => (defaultExitConfig)),
};

export const defaultJunctionConfig: JunctionConfig = {
    junctionObjects: [],
    junctionLinks: [],
};

export const FLOOR_Y = 0;

