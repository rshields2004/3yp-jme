import * as THREE from "three";
import { Route, RouteSegment } from "../types/simulation";


export class Vehicle {
    id: number;
    model: THREE.Group;
    route: Route;

    roundaboutId?: string;
    roundaboutEntryKey?: string;
    roundaboutEntryCoord?: number;

    // Route distance (world-ish units)
    s = 0;

    // Pose interpolation on route.points
    routeIndex = 0;
    t = 0;

    speed: number;
    length: number;

    // Segment semantics
    segmentIndex = 0;
    currentSegment: RouteSegment | null = null;
    laneKey = "";

    // stable start-lane identifier for spawn spacing (NOT route-dependent)
    spawnKey = "";

    // Per-vehicle driving characteristics (adds natural variation)
    maxAccel: number;
    maxDecel: number;
    preferredSpeed: number;
    reactionTime: number;
    timeHeadway: number;
    
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

        // Random variation for natural behavior (±20% variation)
        const random = () => 0.85 + Math.random() * 0.3;
        
        // Base values will be set by VehicleManager from config
        this.maxAccel = 3.0 * random();
        this.maxDecel = 6.0 * random();
        this.preferredSpeed = 10.0 * random();
        this.reactionTime = 0.15 + Math.random() * 0.25; // 0.15-0.4s
        this.timeHeadway = 1.2 + Math.random() * 0.8; // 1.2-2.0s
        
    }
}