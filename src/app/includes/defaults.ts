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
    numExits: 3,
    exitConfig: Array.from({ length: 3 }, () => (defaultExitConfig)),
};

export const defaultRoundaboutConfig: RoundaboutConfig = {
    numExits: 3,
    exitConfig: Array.from({ length: 3 }, () => (defaultExitConfig)),
};

export const driverSide: "left" | "right" = "left";


export const defaultJunctionConfig: JunctionConfig = {
    junctionObjects: [],
    junctionLinks: [],
};

export const carTypes = ["coupe", "hatchback", "micro", "microcargo", "microtransport", "minibus", "mpv", "normal", "pickup", "pickup-small", "station", "van"];
export const carColours = ["blue", "citrus", "green", "orange", "red", "silver", "violet"];

export const FLOOR_Y = 0;

