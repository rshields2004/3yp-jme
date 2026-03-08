import { IntersectionConfig } from "./types/intersection";
import { RoundaboutConfig } from "./types/roundabout";
import { JunctionConfig, LaneLineProperties } from "./types/types";
import { SimConfig } from "./types/simulation";
import { defaultCarClassOverrides } from "./types/carTypes";

export const defaultLaneProperties: LaneLineProperties = {
    pattern: "solid",
    colour: "white",
    thickness: 2.5,
    glow: 1.3,
};

export const defaultExitConfig = {
    numLanesIn: 1,
    laneCount: 2,
    exitLength: 30,
};

export const defaultSimConfig: SimConfig = {

    spawning: {
        spawnRate: 0.5,
        maxVehicles: 100,
        maxSpawnAttemptsPerFrame: 20,
        maxSpawnQueue: 25,
    },

    motion: {
        initialSpeed: 0,
        preferredSpeed: 10,
        maxAccel: 4,
        maxDecel: 8,
        comfortDecel: 4,
    },
   
    simSeed: "default",

    spacing: {
        minBumperGap: 0.5,
        timeHeadway: 0.5,
        stopLineOffset: 0.01,
    },


    rendering: {
        enabledCarClasses: [
            "coupe", "hatchback", "micro", "microcargo", "microtransport",
            "minibus", "mpv", "normal", "pickup", "pickup-small", "station", "van"
        ],
        yOffset: 0.01,    
    },

    carClassOverrides: defaultCarClassOverrides(),
    
    controllers: {
        roundabout: {
            roundaboutMinGap: 2,
            roundaboutMinTimeGap: 1.5,
            roundaboutSafeEntryDist: 20,
            roundaboutEntryTimeout: 1.0,
            roundaboutMinAngularSep: Math.PI / 6,
        },
        intersection: {
            intersectionGreenTime: 8,
            intersectionAmberTime: 1,
            intersectionRedAmberTime: 1,
            intersectionAllRedTime: 2,
        },
    },
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
    laneWidth: 1.5,
};

export const FLOOR_Y = 0;
export const FLOOR_Y_OFFSET = FLOOR_Y + 1;

