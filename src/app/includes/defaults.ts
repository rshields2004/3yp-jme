import { IntersectionConfig } from "./types/intersection";
import { RoundaboutConfig } from "./types/roundabout";
import { JunctionConfig, JunctionObject, LaneLineProperties } from "./types/types";

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
    exitLength: 20,
};

export const defaultIntersectionConfig: IntersectionConfig = {
    numExits: 4,
    exitConfig: Array.from({ length: 4 }, () => (defaultExitConfig)),
};

export const defaultRoundaboutConfig: RoundaboutConfig = {
    numExits: 4,
    exitConfig: Array.from({ length: 4 }, () => (defaultExitConfig)),
};


export const defaultJunctionObject: JunctionObject = {
    id: crypto.randomUUID(),
    type: "roundabout",
    config: defaultRoundaboutConfig,
}

export const defaultJunctionConfig: JunctionConfig = {
    junctionObjects: [defaultJunctionObject],
    junctionLinks: [],
};

export const carTypes = ["coupe", "hatchback", "micro", "microcargo", "microtransport", "minibus", "mpv", "normal", "pickup", "pickup-small", "station", "van"];
export const carColours = ["blue", "citrus", "green", "orange", "red", "silver", "violet"];

export const FLOOR_Y = 0;

