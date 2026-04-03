/**
 * vehicle.ts
 *
 * Core vehicle entity used by the traffic simulation. Each vehicle holds a
 * Three.js model, a route, kinematic state (`s`, `speed`), and per-vehicle
 * driving characteristics that provide natural variation between drivers.
 */

import * as THREE from "three";
import { Route, RouteSegment } from "../types/simulation";

/**
 * Represents a single simulated vehicle travelling along a pre-computed route.
 * Holds kinematic state (position, speed, s-coordinate) and per-vehicle driving characteristics.
 */
export class Vehicle {
    id: number;
    model: THREE.Group;
    route: Route;

    /**
     * Roundabout the vehicle is currently inside (if any).
     */
    roundaboutId?: string;
    roundaboutEntryKey?: string;
    roundaboutEntryCoord?: number;

    /**
     * Distance travelled along the route (world units).
     */
    s = 0;

    /**
     * Current index into the route point array.
     */
    routeIndex = 0;
    /**
     * Interpolation parameter between `routeIndex` and `routeIndex + 1`.
     */
    t = 0;

    speed: number;
    length: number;

    // SEGMENT TRACKING

    segmentIndex = 0;
    currentSegment: RouteSegment | null = null;
    laneKey = "";

    /**
     * Stable start-lane identifier for spawn spacing (NOT route-dependent).
     */
    spawnKey = "";

    /**
     * Simulation elapsed time when this vehicle was spawned.
     */
    spawnTime = 0;

    // PER-VEHICLE DRIVING CHARACTERISTICS

    maxAccel: number;
    maxDecel: number;
    preferredSpeed: number;
    reactionTime: number;
    timeHeadway: number;

    /**
     * @param id - unique numeric vehicle identifier
     * @param model - Three.js group (car mesh) placed in the scene
     * @param route - pre-computed route the vehicle will follow
     * @param length - bumper-to-bumper length of this vehicle
     * @param initialSpeed - speed at spawn (default 0)
     */
    constructor(id: number, model: THREE.Group, route: Route, length: number, initialSpeed = 0) {
        this.id = id;
        this.model = model;
        this.route = route;
        this.length = length;
        this.speed = initialSpeed;

        if (route.segments?.length) {
            this.segmentIndex = 0;
            this.currentSegment = route.segments[0];
        }

        // Placeholder defaults - always overwritten by VehicleManager
        // using the seeded RNG so behaviour is reproducible.
        this.maxAccel = 3.0;
        this.maxDecel = 6.0;
        this.preferredSpeed = 10.0;
        this.reactionTime = 0.25;
        this.timeHeadway = 1.5;
    }
}