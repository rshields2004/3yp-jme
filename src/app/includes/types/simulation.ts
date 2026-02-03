import { Segment } from "next/dist/server/app-render/types";
import { Vehicle } from "../junctionmanagerutils/vehicle";
import { JunctionObjectTypes } from "./types";

export type LightColour = "RED" | "RED_AMBER" | "GREEN" | "AMBER";

export type JunctionStats = {
    id: string;
    type: JunctionObjectTypes;

    // vehicles “associated” with this junction right now
    approaching: number;     // on approach segments to this junction
    waiting: number;         // stopped/queued at stop lines / give-way
    inside: number;          // crossing/within junction (incl. roundabout ring if you want)
    exiting: number;         // just after leaving the junction (optional)

    // flow counters (optional but useful)
    entered: number;         // cumulative since sim start/reset
    exited: number;          // cumulative since sim start/reset
    avgWaitTime: number;     // average wait time in seconds

    // signals (optional)
    currentGreenKey?: string | null;
    state?: string;          // e.g. "GREEN" | "AMBER" | ...
};

export type JunctionStatsGlobal = {
    count: number;
    approaching: number;
    waiting: number;
    inside: number;
    exiting: number;
    entered: number;
    exited: number;
    avgWaitTime: number;     // global average wait time in seconds
};

export type SimulationStats = {
    active: number;
    spawned: number;
    completed: number;
    waiting: number;  // you can keep this as “global waiting at any junction”
    routes: number;
    spawnQueue: number;    elapsedTime: number; // time elapsed since simulation start in seconds
    junctions: {
        global: JunctionStatsGlobal;
        byId: Record<string, JunctionStats>;
    };
};

export type SimConfig = {
    // Spawning
    demandRatePerSec: number;
    maxVehicles: number;
    maxSpawnAttemptsPerFrame: number;
    maxSpawnQueue: number;

    // Motion
    initialSpeed: number;
    maxSpeed: number;
    maxAccel: number;
    maxDecel: number;
    comfortDecel: number;
    maxJerk: number;

    // Spacing
    minBumperGap: number;
    timeHeadway: number;
    stopLineOffset: number;

    // Rendering
    yOffset: number;

    // Stage 2
    enableLaneQueuing: boolean;
    debugLaneQueues: boolean;

    // Roundabout-specific
    roundaboutDecelZone: number;  // Distance before stopline to start decelerating
};



export type LaneOcc = {
    v: Vehicle;
    /** lane coordinate (used for sorting); for "reservation" occupants we pin this to start-of-lane */
    pinnedCoord?: number;
};