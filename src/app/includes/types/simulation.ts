import { Vehicle } from "../junctionmanagerutils/vehicle";
import { JunctionObjectTypes } from "./types";
import { CarClassOverride } from "./carTypes";


export type Tuple3 = [number, number, number];
export type SegmentPhase = "approach" | "inside" | "exit" | "link";
export type Direction = "in" | "out";

export type Node = {
    structureID: string;
    exitIndex: number;
    direction: Direction;
    laneIndex: number;
};

export type RouteSegment = {
    from: Node;
    to: Node;
    phase: SegmentPhase;
    points: Tuple3[];
};

export type Route = {
    segments: RouteSegment[];
};


export type InternalParts = {
    approach: Tuple3[];
    inside: Tuple3[];
    exit: Tuple3[];
};


export type NodeKey = string;


export type EdgePart = {
    phase: Exclude<SegmentPhase, "link">; // "approach" | "inside" | "exit"
    points: Tuple3[];
};

export type Edge = { kind: "internal"; to: Node; parts: EdgePart[] } | { kind: "link"; to: Node; points: Tuple3[] };

export type Graph = Map<NodeKey, Edge[]>;


export type LightColour = "RED" | "RED_AMBER" | "GREEN" | "AMBER";

export type LevelOfService = "A" | "B" | "C" | "D" | "E" | "F" | "-";

export type JunctionStats = {
    id: string;
    type: JunctionObjectTypes;

    // vehicles "associated" with this junction right now
    approaching: number;     // on approach segments to this junction
    waiting: number;         // stopped/queued at stop lines / give-way
    inside: number;          // crossing/within junction (incl. roundabout ring if you want)
    exiting: number;         // just after leaving the junction (optional)

    // flow counters (optional but useful)
    entered: number;         // cumulative since sim start/reset
    exited: number;          // cumulative since sim start/reset
    avgWaitTime: number;     // average wait time in seconds
    maxWaitTime: number;     // longest individual wait recorded (seconds)
    throughput: number;      // vehicles per minute (based on exited / elapsed)
    maxQueueLength: number;  // peak waiting count observed
    levelOfService: LevelOfService; // HCM-style A-F grade based on avg delay

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
    maxQueueLength: number;  // peak global waiting count observed
    throughput: number;      // global vehicles per minute
};

export type SimulationStats = {
    active: number;
    spawned: number;
    completed: number;
    waiting: number;  // you can keep this as “global waiting at any junction”
    routes: number;
    spawnQueue: number;
    elapsedTime: number; // time elapsed since simulation start in seconds
    spawnQueueByEntry: Record<string, number>; // per-entry spawn queue
    avgSpeed: number;       // average speed of all active vehicles
    avgTravelTime: number;  // average time from spawn to completion (seconds)
    junctions: {
        global: JunctionStatsGlobal;
        byId: Record<string, JunctionStats>;
    };
};


export type SimConfig = {
    spawning: {
        spawnRate: number;  // default vehicles per second per entry
        maxVehicles: number;
        maxSpawnAttemptsPerFrame: number;
        maxSpawnQueue: number;
    };
    
    motion: {
        initialSpeed: number;
        preferredSpeed: number;
        maxAccel: number;
        maxDecel: number;
        comfortDecel: number;
    };

    simSeed: string;

    spacing: {
        minBumperGap: number;
        timeHeadway: number;
        stopLineOffset: number;
    }

    rendering: {
        enabledCarClasses: string[];
        yOffset: number;
    };

    carClassOverrides: Record<string, CarClassOverride>;

    controllers: {
        roundabout: {
            roundaboutMinGap: number;
            roundaboutMinTimeGap: number;
            roundaboutSafeEntryDist: number;
            roundaboutEntryTimeout: number;
            roundaboutMinAngularSep: number;
        };
        intersection: {
            intersectionGreenTime: number;
            intersectionAmberTime: number;
            intersectionRedAmberTime: number;
            intersectionAllRedTime: number;
        };
    }
};



export type FollowedVehicleStats = {
    id: number;
    speed: number;
    preferredSpeed: number;
    accel: number;
    phase: string;
    bodyType: string;
    segment: string;
};

export type LaneOcc = {
    vehicle: Vehicle;
    /** lane coordinate (used for sorting); for "reservation" occupants we pin this to start-of-lane */
    pinnedCoord?: number;
};