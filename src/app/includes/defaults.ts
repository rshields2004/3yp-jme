import { LinkComponent } from "../components/LinkComponent";
import { IntersectionConfig } from "./types/intersection";
import { RoundaboutConfig } from "./types/roundabout";
import { JunctionConfig, JunctionLink, JunctionObject, LaneLineProperties } from "./types/types";

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
    numExits: 5,
    exitConfig: Array.from({ length: 5 }, () => (defaultExitConfig)),
};

export const defaultRoundaboutConfig: RoundaboutConfig = {
    numExits: 5,
    exitConfig: Array.from({ length: 5 }, () => (defaultExitConfig)),
};


export const defaultRoundaboutObject: JunctionObject = {
    id: "r1",
    type: "roundabout",
    config: defaultRoundaboutConfig,
};

export const defaultIntersectionObject: JunctionObject = {
    id: "i1",
    type: "intersection",
    config: defaultRoundaboutConfig,
}

export const defaultLinkObject: JunctionLink = {
    id: "test",
    objectPair: 
    [{
        structureID: "i1",
        exitIndex: 2
    }, 
    {
        structureID: "r1",
        exitIndex: 3
    }]
};


export const defaultJunctionConfig: JunctionConfig = {
    junctionObjects: [defaultRoundaboutObject, defaultIntersectionObject],
    junctionLinks: [defaultLinkObject],
};

export const carTypes = ["coupe", "hatchback", "micro", "microcargo", "microtransport", "minibus", "mpv", "normal", "pickup", "pickup-small", "station", "van"];
export const carColours = ["blue", "citrus", "green", "orange", "red", "silver", "violet"];

export const FLOOR_Y = 0;

