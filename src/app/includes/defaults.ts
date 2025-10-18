import { Lane, LaneProperties, Exit } from "./types";

export const defaultLaneProperties: LaneProperties = {
    pattern: "solid",
    colour: "white",
    thickness: 0.1,
};

export const defaultLane: Lane = {
    start: [0, 0, 0],
    end: [0, 0, 5],
    properties: { ...defaultLaneProperties },
};

export const defaultJunction: Exit[] = Array.from({ length: 5 }, () => ({
    lanes: [ { ...defaultLane }, { ...defaultLane } ]
}));