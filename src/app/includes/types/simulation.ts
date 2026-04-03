/**
 * simulation.ts
 * Types for the traffic simulation including routes, segments, nodes,
 * statistics, configuration, and vehicle lane occupancy.
 */

import { Vehicle } from "../junctionmanagerutils/vehicle";
import { JunctionObjectTypes } from "./types";
import { CarClassOverride } from "./carTypes";

// PRIMITIVES

/**
 * A 3D coordinate tuple [x, y, z]
 */
export type Tuple3 = [number, number, number];

/**
 * Phase of a route segment through a junction
 */
export type SegmentPhase = "approach" | "inside" | "exit" | "link";

/**
 * Traffic direction relative to a junction exit
 */
export type Direction = "in" | "out";

// ROUTING

/**
 * A node in the junction graph representing a specific lane endpoint
 */
export type Node = {
    structureID: string;
    exitIndex: number;
    direction: Direction;
    laneIndex: number;
};

/**
 * A single segment of a vehicle's route through the junction network
 */
export type RouteSegment = {
    from: Node;
    to: Node;
    phase: SegmentPhase;
    points: Tuple3[];
};

/**
 * A complete route composed of ordered segments
 */
export type Route = {
    segments: RouteSegment[];
};

/**
 * Internal sub-paths within a junction (approach, inside, exit)
 */
export type InternalParts = {
    approach: Tuple3[];
    inside: Tuple3[];
    exit: Tuple3[];
};

// GRAPH

/**
 * String key uniquely identifying a node in the junction graph
 */
export type NodeKey = string;

/**
 * A portion of an edge within a junction
 */
export type EdgePart = {
    /**
     * Phase of this edge portion
     */
    phase: Exclude<SegmentPhase, "link">;
    points: Tuple3[];
};

/**
 * An edge in the junction graph - either internal (within a junction) or a link (between junctions)
 */
export type Edge = { kind: "internal"; to: Node; parts: EdgePart[] } | { kind: "link"; to: Node; points: Tuple3[] };

/**
 * The full junction graph mapping each node to its outgoing edges
 */
export type Graph = Map<NodeKey, Edge[]>;

// TRAFFIC SIGNALS

/**
 * Possible traffic light colours following UK sequencing
 */
export type LightColour = "RED" | "RED_AMBER" | "GREEN" | "AMBER";

// STATISTICS

/**
 * Highway Capacity Manual level-of-service grade (A–F)
 */
export type LevelOfService = "A" | "B" | "C" | "D" | "E" | "F" | "-";

/**
 * Per-junction statistics snapshot
 */
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
    dos: number;             // degree of saturation (demand / capacity ratio)
    prc: number;             // practical reserve capacity (%)
    mmq: number;             // mean maximum queue (avg of per-arm peak queues)

    // signals (optional)
    currentGreenKey?: string | null;
    state?: string;          // e.g. "GREEN" | "AMBER" | ...
};

/**
 * Aggregated statistics across all junctions
 */
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
    prc: number;             // practical reserve capacity (%) from max DoS across junctions
    mmq: number;             // mean maximum queue (avg of per-junction peak queues)
};

/**
 * Complete simulation statistics snapshot
 */
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


// CONFIGURATION

/**
 * Full simulation configuration covering spawning, motion, spacing, rendering, and controllers
 */
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

// VEHICLE TRACKING

/**
 * Live statistics for the vehicle currently being followed by the camera
 */
export type FollowedVehicleStats = {
    id: number;
    speed: number;
    preferredSpeed: number;
    accel: number;
    phase: string;
    bodyType: string;
    segment: string;
};

// LANE OCCUPANCY

/**
 * An entry in a lane's occupancy list, used for collision / gap checks
 */
export type LaneOcc = {
    vehicle: Vehicle;
    /**
     * lane coordinate (used for sorting); for "reservation" occupants we pin this to start-of-lane
     */
    pinnedCoord?: number;
};