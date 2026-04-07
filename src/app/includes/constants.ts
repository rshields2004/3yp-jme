/**
 * constants.ts
 * Central store for all global configuration defaults and magic numbers
 * used throughout the JME application.
 */

import { IntersectionConfig } from "./types/intersection";
import { RoundaboutConfig } from "./types/roundabout";
import { JunctionConfig, LaneLineProperties } from "./types/types";
import { SimConfig } from "./types/simulation";
import { defaultCarClassOverrides } from "./types/carTypes";

// LAYOUT

/**
 * Height of the application header bar in pixels
 */
export const HEADER_HEIGHT = 44;

// SCENE

/**
 * Maximum camera zoom distance
 */
export const MAX_ZOOM = 500;

/**
 * Isometric camera offset used for double-click centring
 */
export const ISO_OFFSET_X = 20;
/**
 * Isometric camera Y offset (height).
 */
export const ISO_OFFSET_Y = 35;
/**
 * Isometric camera Z offset (depth).
 */
export const ISO_OFFSET_Z = 20;

// FLOOR

/**
 * Y-coordinate of the ground plane
 */
export const FLOOR_Y = 0;

/**
 * Slight offset above the floor to prevent z-fighting
 */
export const FLOOR_Y_OFFSET = FLOOR_Y + 1;

// SIMULATION TIMING

/**
 * Fixed simulation timestep (seconds).
 * Guarantees identical results regardless of display frame rate.
 */
export const FIXED_DT = 1 / 144;

/**
 * Maximum ticks to drain per rendered frame.
 * Prevents the "spiral of death" on slow devices whilst keeping the sim
 * from desynchronising when a few frames are expensive (e.g. GC pauses).
 */
export const MAX_TICKS_PER_FRAME = 5;

/**
 * Fixed tick interval for spawn accumulation (seconds).
 * Keeps spawning deterministic regardless of frame rate.
 */
export const SPAWN_TICK = 1 / 60;

// PEER NETWORKING

/**
 * Timeout (ms) for establishing a peer connection
 */
export const PEER_CONNECTION_TIMEOUT = 8000;

/**
 * Interval (ms) between ping messages to peers
 */
export const PEER_PING_INTERVAL = 5000;

/**
 * If a peer has not been seen for this many ms, consider them disconnected
 */
export const PEER_DISCONNECT_THRESHOLD = 8000;

// TUTORIAL

/**
 * LocalStorage key for tracking whether the tutorial has been completed
 */
export const TUTORIAL_STORAGE_KEY = "tutorialCompleted";

/**
 * Padding (px) around the highlighted tutorial element
 */
export const TUTORIAL_HIGHLIGHT_PADDING = 8;

/**
 * Gap (px) between the target element and the tooltip
 */
export const TOOLTIP_GAP = 16;

/**
 * Default tooltip width (px)
 */
export const TOOLTIP_WIDTH = 300;

/**
 * Minimum margin (px) from viewport edges for tooltip placement
 */
export const VIEWPORT_MARGIN = 12;

// ROUTE DEBUG

/**
 * How often (seconds) to poll for transform changes in the debug overlay
 */
export const TRANSFORM_CHECK_INTERVAL = 0.5;

// PDF REPORT

/**
 * A4 landscape page width in mm
 */
export const PDF_PAGE_WIDTH = 297;

/**
 * A4 landscape page height in mm
 */
export const PDF_PAGE_HEIGHT = 210;

/**
 * Page margin for PDF reports in mm
 */
export const PDF_MARGIN = 14;

/**
 * Usable content width for PDF reports in mm
 */
export const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;

/**
 * Colour palette used in PDF report generation (RGB tuples)
 */
export const COLOURS = {
    bg: [9, 9, 11] as const,
    surface: [24, 24, 27] as const,
    border: [63, 63, 70] as const,
    muted: [113, 113, 122] as const,
    dimText: [161, 161, 170] as const,
    text: [228, 228, 231] as const,
    white: [255, 255, 255] as const,
    accent: [99, 102, 241] as const,
    green: [34, 197, 94] as const,
    amber: [245, 158, 11] as const,
    red: [239, 68, 68] as const,
};

// DEFAULTS

/**
 * Default properties for lane line rendering
 */
export const defaultLaneProperties: LaneLineProperties = {
    pattern: "solid",
    colour: "white",
    thickness: 2.5,
    glow: 1.3,
};

/**
 * Default configuration for a single exit arm
 */
export const defaultExitConfig = {
    numLanesIn: 1,
    laneCount: 2,
    exitLength: 30,
};

/**
 * Default simulation configuration
 */
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

    maxSimTime: 3600,
    speedMultiplier: 1,

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

/**
 * Default intersection configuration (3 exits)
 */
export const defaultIntersectionConfig: IntersectionConfig = {
    numExits: 3,
    exitConfig: Array.from({ length: 3 }, () => (defaultExitConfig)),
};

/**
 * Default roundabout configuration (3 exits)
 */
export const defaultRoundaboutConfig: RoundaboutConfig = {
    numExits: 3,
    exitConfig: Array.from({ length: 3 }, () => (defaultExitConfig)),
};

/**
 * Default junction configuration (empty canvas)
 */
export const defaultJunctionConfig: JunctionConfig = {
    junctionObjects: [],
    junctionLinks: [],
    laneWidth: 1.5,
};

