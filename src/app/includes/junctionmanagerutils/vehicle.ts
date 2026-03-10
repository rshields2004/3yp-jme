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

    // Timestamp when this vehicle was spawned (simulation elapsed time)
    spawnTime = 0;

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

        // Placeholder defaults — always overwritten by VehicleManager
        // using the seeded RNG so behaviour is reproducible.
        this.maxAccel = 3.0;
        this.maxDecel = 6.0;
        this.preferredSpeed = 10.0;
        this.reactionTime = 0.25;
        this.timeHeadway = 1.5;
        
    }
}