import { LaneLine, LaneLineProperties, Exit, JunctionConfig, JunctionStructure } from "./types";

export const defaultLaneProperties: LaneLineProperties = {
    pattern: "solid",
    colour: "white",
    thickness: 0.05,
    glow: 0.3,
};

export const defaultLane: LaneLine = {
    start: [0, 0, 0],
    end: [0, 0, 0],
    properties: { ...defaultLaneProperties },
};

export const defaultExit: Exit = {
    laneLines: [],
    stopLines: [],
}

export const defaultJunctionStructure: JunctionStructure = {
    exitInfo: Array.from({ length: 4 }, () => (defaultExit)),
    edgeTubes: [],
};

export const defaultJunctionConfig: JunctionConfig = {
    numExits: 3,
    exitConfig: Array.from({ length: 3 }, () => ({
        laneCount: 2,
        laneWidth: 1.5,
        exitLength: 400,
    })),
};