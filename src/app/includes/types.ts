export type CarProperties = {
    key: number;
    position: [number, number, number];
    scale: number,
    selected: boolean;
    colour: string;
    type: string;
    onSelect: () => void;
};

export type LanePattern = "solid" | "dashed";

export type LaneColour = "white" | "green" | "red";

export type LaneProperties = {
    pattern: "solid" | "dashed";
    colour: "white" | "green" | "red";
    thickness: number;
};

export type Lane = {
    start: [number, number, number];
    end: [number, number, number];
    properties: LaneProperties;
};

export type Exit = {
    lanes: Lane[];
};

export type JunctionState = {
    junctionConfig: Exit[];
    setJunctionConfig: (exits: Exit[]) => void;
};