import * as THREE from "three";
import { Route, RouteSegment } from "./carRouting";


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
    }
}