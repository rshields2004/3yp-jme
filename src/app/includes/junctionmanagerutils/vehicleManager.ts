/**
 * vehicleManager.ts
 *
 * Core simulation engine. Orchestrates vehicle spawning, movement via the
 * Intelligent Driver Model (IDM), junction controller updates, lane-based
 * leader detection (including roundabout ring logic), and per-frame
 * statistics collection.
 */

import * as THREE from "three";
import { getRoutePoints, computeSegmentDistances } from "./routing/routeUtils";
import { IntersectionController } from "./controllers/intersectionController";
import { Vehicle } from "./vehicle";
import { JunctionConfig } from "../types/types";
import { SimConfig, SimulationStats, LaneOcc, Route, RouteSegment, Tuple3 } from "../types/simulation";
import { RoundaboutController } from "./controllers/roundaboutController";
import { disposeObjectTree } from "./helpers/dispose";
import { nodeKeyOf, segmentId, laneKeyForSegment } from "./helpers/segmentHelpers";
import { computeIdmAccel } from "./physics/idm";
import { buildLaneBases } from "./routing/laneCoordinates";
import { isRoundaboutLaneKey, roundaboutIdFromLaneKey } from "./helpers/roundaboutUtils";
import { defaultSimConfig } from "../constants";
import { SpawnState, createSpawnState, resetSpawnState, spawnTick } from "./vehicleSpawner";
import { RoundaboutStructure } from "../types/roundabout";
import { collectStats, defaultJunctionCounter, JunctionCounter } from "./statsCollector";



// VEHICLE MANAGER

/**
 * Core simulation engine. Owns all active vehicles, manages route assignment,
 * IDM car-following, traffic-light/roundabout entry logic, and per-tick updates.
 */
export class VehicleManager {


    // CORE SIMULATION STATE

    private scene: THREE.Scene; // Reference to THREE.js scene

    private carModels: THREE.Group[]; // Array of loaded 3D car models for use
    
    private routes: Route[]; // Complete list of all possible routes

    private vehicles: Vehicle[] = []; // Currently active vehicles

    private junction: JunctionConfig; // Stores information about the junction

    private nextId = 0; // Auto incrementing counter to assign unique ID for vehicles

    private cfg: SimConfig; // Current configuration settings for simulation

    private elapsedTime = 0; // Total time elapsed in the simulation


    // SPAWNING SYSTEM

    private spawnState!: SpawnState; // Mutable spawning state managed by vehicleSpawner functions


    // SPATIAL & ROUTING CACHES

    private routePointsCache = new Map<Route, Tuple3[]>(); // Caches the raw 3D points of a route so they don't have to be re-extracted every frame

    private routeSegmentDistances = new Map<Route, Array<{ s0: number; s1: number }>>(); // Caches the start and end distances for every segment in a route, used to calculate which segment vehicle on

    private routeCumulativeDistances = new Map<Route, number[]>(); // Caches the cumulative length along the route, used to efficiently calculate a 3D position given a distance "s"

    private laneBases = new Map<string, Map<string, number>>(); // Coordinate system map, helps linearise positions across multiple segments - used for collision detection
    
    private laneBasesBuilt = false; // A flag to ensure laneBases is calculated only once


    // JUNCTION CONTROL

    private intersectionControllers = new Map<string, IntersectionController>(); // Manages traffic light states

    private roundaboutControllers = new Map<string, RoundaboutController>(); // Manages roundabout logic

    private roundaboutGroups = new Map<string, THREE.Group>(); // Reference to roundabout groups for accessing pre-computed structure data

    private controllersBuilt = false; // A flag to ensure controllers are initialised once


    // STATISTICS & TRACKING

    private completed = 0; // Total count of vehicles that have completed their route

    private statsSnapshot: SimulationStats | null = null; // A cached object containing the latest statistics

    private junctionCounters = new Map<string, JunctionCounter>(); // Tracks stats per junction object

    private lastVehJunctionTag = new Map<number, { jid: string | null; phase: string | null }>(); // Remembers last junction and phase a vehicle was in, used to detect x entered y

    private vehicleWaitStart = new Map<number, { jid: string; startTime: number }>(); // Tracks timestamp when a specific vehicle started waiting at a stop line

    private totalTravelTime = 0;  // Cumulative travel time of all completed vehicles
    private travelCount = 0;      // Number of completed vehicles with tracked travel time
    private globalMaxQueueLength = 0; // Peak global waiting count observed


    
    /**
     * Constructor that sets up the vehicle manager instance
     * @param scene Scene access point
     * @param carModels Loaded models
     * @param routes Routes that cars can take
     * @param cfg Simulation config options
     * @param junction - the junction configuration
     */
    constructor(scene: THREE.Scene, carModels: THREE.Group[], routes: Route[], junction: JunctionConfig, cfg?: Partial<SimConfig>) {
        
        // Assign key variables
        this.scene = scene;
        this.carModels = carModels;
        this.routes = routes;
        this.junction = junction;

        this.cfg = { ...defaultSimConfig, ...cfg };

        // Build spawn state - must come after cfg is set
        this.spawnState = createSpawnState(this.routes);
    }

    
    /**
     * Allows simulation config changes to be reflected in simulation
     * @param cfg New config
     */
    public updateConfig(cfg: Partial<SimConfig>): void {
        
        const oldSeed = this.cfg.simSeed;
        this.cfg = { ...this.cfg, ...cfg };
        
        // Reset per-entry RNGs when the seed changes so the next run is reproducible
        if (cfg.simSeed !== undefined && cfg.simSeed !== oldSeed) {
            this.spawnState.entryRNGs.clear();
        }
    }

    
    /**
     * Returns the current sim config in vehicle manager instance
     * @returns Simulation Config
     */
    public getConfig(): SimConfig {
        return { ...this.cfg };
    }


    /**
     * Extract structure metadata (id, type, max stop-line distance) from a
     * junction group's userData, checking both intersection and roundabout formats.
     * @param group - Three.js group to inspect
     * @returns structure data or `null` if the group holds neither type
     */
    private getStructureData(group: THREE.Group): {
        id: string;
        type: string;
        maxDistanceToStopLine: number;
    } | null {
        if (group.userData.intersectionStructure) {
            return {
                id: group.userData.intersectionStructure.id,
                type: "intersection",
                maxDistanceToStopLine: group.userData.intersectionStructure.maxDistanceToStopLine
            };
        } else if (group.userData.roundaboutStructure) {
            return {
                id: group.userData.roundaboutStructure.id,
                type: "roundabout",
                maxDistanceToStopLine: group.userData.roundaboutStructure.maxDistanceToStopLine
            };
        }
        return null;
    }


    /**
     * Extract the structure ID from a junction group, handling both the legacy
     * flat format (group.userData.id) and the current nested format
     * (group.userData.roundaboutStructure.id / group.userData.intersectionStructure.id).
     *
     * @param group - the Three.js group for the junction object
     * @returns the structure ID, or `null` if no ID could be resolved
     */
    private getGroupId(group: THREE.Group): string | null {
        // New nested format - checked via getStructureData which already handles both types
        const data = this.getStructureData(group);
        if (data) return data.id;

        // Legacy flat format fallback
        const legacyId = group.userData?.id;
        if (typeof legacyId === "string" && legacyId.length > 0) return legacyId;

        return null;
    }

    /**
     * Find a group in the refs array by its structure ID.
     *
     * @param groups - the groups value
     * @param id - unique identifier for the junction object
     * @returns the matching group, or `undefined` if not found
     */
    private findGroupById(
        groups: THREE.Group[],
        id: string
    ): THREE.Group | undefined {
        return groups.find((g) => {
            if (g.userData?.id === id) return true;
            const data = this.getStructureData(g);
            return data !== null && data.id === id;
        });
    }

    /**
     * Get roundabout data directly from the group's userData.
     * Returns both the world-position centre and the pre-computed structure.
     *
     * @param junctionKey - string key identifying a junction
     * @returns the centre position and structure data, or `null` if not available
     */
    private getRoundaboutData(junctionKey: string): {
        centre: THREE.Vector3;
        structure: RoundaboutStructure;
    } | null {
        const group = this.roundaboutGroups.get(junctionKey);
        if (!group) return null;
        
        const structure = group.userData.roundaboutStructure;
        if (!structure) return null;
        
        const centre = new THREE.Vector3();
        group.getWorldPosition(centre);
        
        return { centre, structure };
    }

    /**
     * Get the lane width for a roundabout from its structure.
     *
     * @param junctionId - the junctionId value
     * @returns the lane width in world units
     */
    private roundaboutLaneWidth(junctionId: string): number {
        const data = this.getRoundaboutData(junctionId);
        if (!data || data.structure.ringLines.length === 0) {
            return this.junction.laneWidth; // fallback
        }
        
        // Calculate lane width from the difference between consecutive ring radii
        if (data.structure.ringLines.length >= 2) {
            return data.structure.ringLines[1].radius - data.structure.ringLines[0].radius;
        }
        
        // Single lane - use default
        return this.junction.laneWidth;
    }

    /**
     * Helper to get cached segment distances
     * @param route The route you want the segment distances from
     * @returns The cached segment distances for a route
     */
    private getSegmentDistances(route: Route): Array<{ s0: number; s1: number }> {
        let cached = this.routeSegmentDistances.get(route);
        
        // If not cached yet perform calculation once
        if (!cached) {
            cached = computeSegmentDistances(route);
            this.routeSegmentDistances.set(route, cached);
        }
        return cached;
    }

    
    /**
     * Helper to get the points on a route
     * @param route The route you want points from
     * @returns The array of points [x, y, z] for that route
     */
    private getRoutePointsCached(route: Route): Tuple3[] {
        let cached = this.routePointsCache.get(route);
        
        // If not cached yet perform calculation once
        if (!cached) {
            cached = getRoutePoints(route);
            this.routePointsCache.set(route, cached);
        }
        return cached;
    }

    
    /**
     * Calculates and caches the total distance from the start of a route to each point on that route
     * @param route Route for calculation
     * @returns The cumulative distances at each point
     */
    private getRouteCumulativeDistances(route: Route): number[] {
        const cached = this.routeCumulativeDistances.get(route);
        if (cached) return cached;

        const pts = this.getRoutePointsCached(route);
        const cumDist: number[] = [0];
        
        // Iterate through each point and calculate sqr distance between and sum
        for (let i = 1; i < pts.length; i++) {
            const [ax, ay, az] = pts[i - 1];
            const [bx, by, bz] = pts[i];
            const d = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
            cumDist.push(cumDist[i - 1] + d);
        }

        this.routeCumulativeDistances.set(route, cumDist);
        return cumDist;
    }

    /**
     * Finds where within a cumulative distance array a vehicle is given a distance along the route
     * @param cumDist The array of cumulative distances
     * @param s Distance travelled along route
     * @returns An object that contains the starting point of the line segment and how far along that segment
     */
    private findIndexAtS(cumDist: number[], s: number): { idx: number; t: number } {
        const maxS = cumDist[cumDist.length - 1];
        const clamped = Math.max(0, Math.min(s, maxS));

        // Binary search for the interval
        let low = 0;
        let high = cumDist.length - 1;
        while (low < high - 1) {
            const mid = (low + high) >> 1;
            if (cumDist[mid] <= clamped) {
                low = mid;
            }
            else {
                high = mid;
            }
        }

        const segLength = cumDist[low + 1] - cumDist[low];
        const t = segLength > 1e-9 ? (clamped - cumDist[low]) / segLength : 0;
        return { idx: low, t };
    }

    /**
     * Returns the controller for a junction object
     * @param junctionId ID of the junction object
     * @returns Either an intersection or roundabout controller ot neither if not exists
     */
    public getController(junctionId: string): IntersectionController | RoundaboutController | null {
        return this.intersectionControllers.get(junctionId) ?? this.roundaboutControllers.get(junctionId) ?? null;
    }


    /**
     * Returns a specific vehicle class via ID
     * @param id ID of vehicle to find
     * @returns The Vehicle class instance
     */
    public getVehicleById(id: number): Vehicle | undefined {
        return this.vehicles.find(v => v.id === id);
    }

    /**
     * Returns all vehicles active for raycasting (double click feature)
     * @returns An array of all active vehicles
     */
    public getVehicles(): Vehicle[] {
        return this.vehicles;
    }

    /**
     * Returns a world-space position that lies `distance` metres ahead of
     * vehicle `v` along its route.  Returns null when the route is too
     * short or the vehicle has no route points.
     * @param v - the vehicle instance
     * @param distance - distance ahead in world units
     * @returns the computed position vector
     */
    public getPositionAhead(v: Vehicle, distance: number): THREE.Vector3 | null {
        const cumDist = this.getRouteCumulativeDistances(v.route);
        if (cumDist.length < 2) return null;
        const maxS = cumDist[cumDist.length - 1];
        return this.getPointAtS(v.route, Math.min(v.s + distance, maxS));
    }

    /**
     * Resets the simulation back to the beginning ready to be played again
     */
    public reset() {
        for (const v of this.vehicles) {
            this.scene.remove(v.model);
            disposeObjectTree(v.model);
        }

        this.vehicles = [];
        this.nextId = 0;

        // SPAWNING SYSTEM
        resetSpawnState(this.spawnState, this.routes);

        // SPATIAL & ROUTING CACHES
        this.routePointsCache.clear();
        this.routeSegmentDistances.clear();
        this.routeCumulativeDistances.clear();
        this.laneBases.clear();
        this.laneBasesBuilt = false;

        // JUNCTION CONTROL
        this.intersectionControllers.clear();
        this.roundaboutControllers.clear();
        this.roundaboutGroups.clear();
        this.controllersBuilt = false;

        // STATISTICS & TRACKING
        this.completed = 0;
        this.statsSnapshot = null;
        this.junctionCounters.clear();
        this.lastVehJunctionTag.clear();
        this.vehicleWaitStart.clear();
        this.totalTravelTime = 0;
        this.travelCount = 0;
        this.globalMaxQueueLength = 0;
    }


    /**
     * Main update loop of the simulation, handles all car movements.
     * @param dt Time delta - change in time since last call
     * @param junctionObjectRefs The refs of junction objects for controller construction
     */
    public update(dt: number, junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>): void {
        
        // If there are no routes available, don't bother
        if (!this.routes.length) {
            return;
        }

        // Update the time elapsed
        this.elapsedTime += dt;

        // We build lane bases so cars can detect each other in the simulation
        if (!this.laneBasesBuilt) {
            this.buildLaneBases();
        }

        this.buildControllersIfNeeded(junctionObjectRefs);
        for (const c of this.intersectionControllers.values()) {
            c.update(dt);
        }

        for (const c of this.roundaboutControllers.values()) {
            c.update(dt);
        }

        // Run the spawning system (rate updates, demand accumulation, vehicle creation)
        const vehicleCountBefore = this.vehicles.length;
        spawnTick(
            this.spawnState, dt, junctionObjectRefs,
            this.cfg, this.vehicles, this.carModels, this.scene, this.junction,
            this.roundaboutControllers,
            () => this.nextId++,
            (r) => this.getRoutePointsCached(r),
            (gs, id) => this.findGroupById(gs, id),
            (g) => this.getStructureData(g),
            (g) => this.getGroupId(g),
            (v) => this.updateVehicleSegment(v),
        );

        // Stamp spawnTime on newly created vehicles
        for (let i = vehicleCountBefore; i < this.vehicles.length; i++) {
            this.vehicles[i].spawnTime = this.elapsedTime;
        }


        // Refresh segment/laneKey before lane logic
        for (const v of this.vehicles) {
            this.updateVehicleSegment(v);
        }

        // Compute new s value (distance from start in route) that vehicle tries to achieve in this update cycle
        const desiredS = new Map<Vehicle, number>();

        // BULK OF THE LOGIC IS DONE HERE - calculates where vehicles need to be this frame
        this.applyMovement(dt, desiredS);
       

        // Actions the new desired "s", moves the vehicles
        for (let i = this.vehicles.length - 1; i >= 0; i--) {
            const v = this.vehicles[i];
            const target = desiredS.get(v) ?? v.s;
            
            // Move the vehicle
            const done = this.applySAndPose(v, target);

            // If applySandPose returns true, vehicle is done so despawn and remove
            if (done) {
                // Clean up roundabout tracking
                for (const roundabout of this.roundaboutControllers.values()) {
                    roundabout.clearVehicle(v.id);
                }

                // Track travel time before removing
                const travelTime = this.elapsedTime - v.spawnTime;
                this.totalTravelTime += travelTime;
                this.travelCount += 1;

                this.scene.remove(v.model);
                this.vehicles.splice(i, 1);
                this.completed += 1;
            }
        }
        

        // Performs telemetry tracking for stats e.g., wait times
        for (const v of this.vehicles) {
            const seg = v.currentSegment;
            
            const junctionID = seg?.to?.structureID ?? seg?.from?.structureID;
            
            // Check if vehicle is currently waiting (approach phase, stopped, near stopline)
            let isWaiting = false;
            let waitJunctionID: string | null = null;
            if (seg && seg.phase === "approach" && junctionID) {
                // Considers vehicle waiting if its within this distance to stop line and less than 0.2 speed
                const nearStop = this.getDistToSegmentEnd(v) < 5.0;
                const stopped = v.speed < 0.2;
                isWaiting = nearStop && stopped;
                waitJunctionID = junctionID;
            }
            
            const existing = this.vehicleWaitStart.get(v.id);
            
            if (isWaiting && waitJunctionID) {
                
                // Vehicle is waiting - start tracking if not already
                if (!existing) {
                    this.vehicleWaitStart.set(v.id, { jid: waitJunctionID, startTime: this.elapsedTime });
                }
            } 
            else {
                // Vehicle is not waiting - if it was waiting before, record the wait duration
                if (existing) {
                    const waitDuration = this.elapsedTime - existing.startTime;
                    const c = this.junctionCounters.get(existing.jid) ?? defaultJunctionCounter();
                    c.totalWaitTime += waitDuration;
                    c.waitCount += 1;
                    if (waitDuration > c.maxWaitTime) c.maxWaitTime = waitDuration;
                    this.junctionCounters.set(existing.jid, c);
                    this.vehicleWaitStart.delete(v.id);
                }
            }
        }
        
        // Clean up tracking maps for despawned vehicles
        const activeIds = new Set(this.vehicles.map(v => v.id));
        for (const [vid] of this.vehicleWaitStart) {
            if (!activeIds.has(vid)) this.vehicleWaitStart.delete(vid);
        }
        for (const [vid] of this.lastVehJunctionTag) {
            if (!activeIds.has(vid)) this.lastVehJunctionTag.delete(vid);
        }
        
        this.updateStats();
    }


    /**
     * Calculates the stopping distance of a vehicle
     * @param speed Current speed of the vehicle
     * @param vehicle Current vehicle (needed for accel values)
     * @returns Stopping distance
     */
    private stoppingDistance(speed: number, vehicle?: Vehicle): number {
        const decel = vehicle ? vehicle.maxDecel : this.cfg.motion.maxDecel;
        return (speed * speed) / (2 * decel);
    }


    /**
     * Helper that calculates the distance remaining in the current segment
     * @param v Vehicle to perform calculation on
     * @returns Remaining distance in segment
     */
    private getDistToSegmentEnd(v: Vehicle): number {
        const segInfo = this.getSegmentDistances(v.route)[v.segmentIndex];
        return Math.max(0, (segInfo?.s1 ?? 0) - v.s);
    }

    
    /**
     * Helper checks if a vehicle just entered the roundabout and from where
     * @param v The vehicle to check
     * @returns Returns entrance and from where
     */
    private getRoundaboutEntryStatus(v: Vehicle): { recentlyEntered: boolean, entryKey?: string } {
        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        const distFromStart = segInfo ? (v.s - segInfo.s0) : Infinity;
        
        // Threshold: X units from start is considered "recently entered"
        if (distFromStart >= 5) {
            return { recentlyEntered: false };
        }

        const segs = v.route.segments;
        if (segs && v.segmentIndex > 0) {
            const prevSeg = segs[v.segmentIndex - 1];
            if (prevSeg?.phase === "approach") {
                return { 
                    recentlyEntered: true, 
                    entryKey: this.entryGroupKeyFromNodeKey(nodeKeyOf(prevSeg.from)) 
                };
            }
        }
        return { recentlyEntered: true };
    }

    /**
     * This is main logic of the simulation: determines how fast each car should go this frame and where it should end up
     * @param dt The time delta
     * @param desiredS The desired positions of the vehicles
     */
    private applyMovement(dt: number, desiredS: Map<Vehicle, number>) {
        
        // Need to know where everyone is relative to everyone else in terms of routes
        const vehiclesByRoute = new Map<Route, Vehicle[]>();
        for (const vehicle of this.vehicles) {
            const arr = vehiclesByRoute.get(vehicle.route) ?? [];
            arr.push(vehicle);
            vehiclesByRoute.set(vehicle.route, arr);
        }

        for (const vehicles of vehiclesByRoute.values()) {
            vehicles.sort((a, b) => b.s - a.s);
        }

        // Same for each lane
        const lanes = new Map<string, LaneOcc[]>();
        
        for (const vehicle of this.vehicles) {
            if (vehicle.laneKey) {
                const arr = lanes.get(vehicle.laneKey) ?? [];
                arr.push({ vehicle });
                lanes.set(vehicle.laneKey, arr);
            }

            // This step prevents gridlocks by pinning a ghost copy at the start of the inside segment whilst a car is moving through it
            if (vehicle.currentSegment?.phase === "inside") {
                const exitLaneKey = this.getExitLaneKeyForVehicle(vehicle);
                if (exitLaneKey && this.shouldReserveExitLane(vehicle) && !isRoundaboutLaneKey(vehicle.laneKey)) {
                    const arr = lanes.get(exitLaneKey) ?? [];
                    arr.push({ vehicle, pinnedCoord: this.laneStartCoordForExitLane(exitLaneKey, vehicle) });
                    lanes.set(exitLaneKey, arr);
                }
            }
        }

        // Sort the vehicles in each lane front to back so we know the order, more efficient as only done once this frame
        for (const [laneKey, laneOccs] of lanes.entries()) {
            laneOccs.sort((a, b) => this.occCoord(b, laneKey, desiredS) - this.occCoord(a, laneKey, desiredS));
        }

        // Main leader detection part, for each route find different leaders for different bits
        for (const [, routeVehicles] of vehiclesByRoute.entries()) {
            
            // For each vehicle within a route
            for (let i = 0; i < routeVehicles.length; i++) {
                const vehicle = routeVehicles[i];
                
                // Roundabout has slightly different logic so we need to check
                const isRoundaboutInside = vehicle.currentSegment?.phase === "inside" && isRoundaboutLaneKey(vehicle.laneKey);
                
                // Update whether a vehicle is exiting inside a roundabout
                if (isRoundaboutInside && vehicle.laneKey) {
                    const jId = roundaboutIdFromLaneKey(vehicle.laneKey);
                    const ctrl = this.roundaboutControllers.get(jId);

                    if (ctrl) {
                        const nextSeg = vehicle.route.segments[vehicle.segmentIndex + 1];
                        let isExiting = false;

                        // Check if we are physically close to the exit
                        if (nextSeg && nextSeg.phase === "exit") {
                            const dist = this.getDistToSegmentEnd(vehicle);
                            if (dist < 15) {
                                isExiting = true;
                            }
                        }

                        // Notify the controller so waiting cars know we are leaving
                        // (Make sure you added setVehicleExiting to RoundaboutController class!)
                        ctrl.setVehicleExiting(vehicle.id, isExiting);
                    }
                }
                let leader: Vehicle | null = null;
                let leaderGap = Infinity;

                if (i > 0) {
                    const sameRouteLead = routeVehicles[i - 1];
                    if (isRoundaboutInside && sameRouteLead.currentSegment?.phase === "exit") {
                        
                        // Find how far in front the next car is from within a roundabout using euclidean distance as cant use desiredS
                        const worldDist = vehicle.model.position.distanceTo(sameRouteLead.model.position);
                        const worldGap = worldDist - 0.5 * (sameRouteLead.length + vehicle.length);

                        const leadS = desiredS.get(sameRouteLead) ?? sameRouteLead.s;
                        const sGap = (leadS - vehicle.s) - 0.5 * (sameRouteLead.length + vehicle.length);

                        const gap = Math.max(worldGap, sGap);
                        if (gap < leaderGap && gap > -vehicle.length) {
                            leaderGap = gap;
                            leader = sameRouteLead;
                        }
                    } 
                    else {
                        
                        // Find how far in front next car is from outside a roundabout using desiredS as geometry is ok
                        const leadS = desiredS.get(sameRouteLead) ?? sameRouteLead.s;
                        const gap = (leadS - vehicle.s) - 0.5 * (sameRouteLead.length + vehicle.length);
                        if (gap < leaderGap && gap > -vehicle.length) {
                            leaderGap = gap;
                            leader = sameRouteLead;
                        }
                    }
                }

                // Find leader for same lane but different route

                // As above, leader detection is done differently in roundabout
                const distToSegEnd = this.getDistToSegmentEnd(vehicle);
                const nearingExit = isRoundaboutInside && distToSegEnd < 5;

                // If vehicles share same lane key
                if (vehicle.laneKey) {
                    const laneOccs = lanes.get(vehicle.laneKey) ?? [];

                    if (isRoundaboutLaneKey(vehicle.laneKey) && !nearingExit) {
                        
                        // Use roundabout leader function instead of below
                        const roundaboutLeader = this.findRoundaboutLeader(vehicle, laneOccs);
                        if (roundaboutLeader && roundaboutLeader.gap < leaderGap) {
                            leaderGap = roundaboutLeader.gap;
                            leader = roundaboutLeader.leader;
                        }
                    } 
                    else if (!isRoundaboutLaneKey(vehicle.laneKey)) {
                        const myCoord = this.laneCoordFromS(vehicle, vehicle.s);

                        for (const occ of laneOccs) {
                            const other = occ.vehicle;
                            
                            // Filter out self and same route vehicles (done already)
                            if (other === vehicle || other.route === vehicle.route) {
                                continue;
                            }

                            // Skip cars behind
                            const otherCoord = this.occCoord(occ, vehicle.laneKey, desiredS);
                            if (otherCoord <= myCoord) {
                                continue;
                            }

                            // Same logic as same route leader
                            const gap = (otherCoord - myCoord) - 0.5 * (other.length + vehicle.length);
                            if (gap < leaderGap) {
                                leaderGap = gap;
                                leader = other;
                            }
                        }
                    }
                }

                // Nearing end of segment, need to check for space in next segment
                let lookaheadResult: { leader: Vehicle; gap: number } | null = null;
                if (!isRoundaboutInside || nearingExit) {
                    
                    // Use standard lookup if not in a roundabout
                    lookaheadResult = this.findLeaderInUpcomingSegments(vehicle, lanes, desiredS);
                    if (lookaheadResult && lookaheadResult.gap < leaderGap) {
                        leaderGap = lookaheadResult.gap;
                        leader = lookaheadResult.leader;
                    }
                }

                // If car nearing end of segment, get appropriate speed for next segment e.g., corner speed
                let desiredSpeedCap = vehicle.preferredSpeed;
                if (!isRoundaboutInside && lookaheadResult && lookaheadResult.gap < this.stoppingDistance(vehicle.speed, vehicle) + 5) {
                    const boundarySpeedCap = this.getSegmentBoundarySpeedCap(vehicle);
                    desiredSpeedCap = Math.min(desiredSpeedCap, boundarySpeedCap);
                }

                // Look ahead and see what speed we need to go at to stop in time for obstacle
                const stoplineSpeed = this.applyStoplineAndDownstreamCap(vehicle, desiredSpeedCap, lanes, desiredS);

                // If we are approaching an object then apply the minimum of ideal and necessary
                if (vehicle.currentSegment?.phase === "approach") {
                    desiredSpeedCap = Math.min(desiredSpeedCap, stoplineSpeed);
                }

                let stoplineS: number | null = null;

                // Find position of stop point if we need to stop
                if (vehicle.currentSegment?.phase === "approach" && stoplineSpeed < vehicle.preferredSpeed) {
                    // For roundabouts: a committed vehicle must NEVER be
                    // clamped back to the stop line - that causes the
                    // visual teleport-back glitch.
                    const jKey = vehicle.currentSegment?.to?.structureID;
                    const isCommittedRoundabout = jKey
                        && this.roundaboutControllers.has(jKey)
                        && this.roundaboutControllers.get(jKey)!.isCommitted(vehicle.id);

                    if (!isCommittedRoundabout) {
                        stoplineS = this.getStoplineS(vehicle);
                    }
                } 
                else if (vehicle.currentSegment?.phase === "approach") {
                  
                    const jKey = vehicle.currentSegment?.to?.structureID;
                  
                    // Roundabout logic slightly different
                    if (jKey && this.roundaboutControllers.has(jKey)) {
                        const ctrl = this.roundaboutControllers.get(jKey)!;
                  
                        // If there is no safe gap then car stops at roundabout stop line
                        // BUT committed vehicles must never be stopped here.
                        if (!ctrl.isCommitted(vehicle.id)) {
                            stoplineS = this.getStoplineS(vehicle);
                        }
                  
                    }
                } 
                else if (vehicle.currentSegment?.phase === "link") {
                    
                    // Looks at next approach segment and identifies where the next stop point is
                    const upcoming = this.getUpcomingStoplineForLink(vehicle, lanes);
                    if (upcoming?.shouldStop) {
                        stoplineS = upcoming.stoplineS;
                    }

                }

                // Intelligent driver model: Virtual leader since cars are designed to follow cars rather than understand something like a red light
                let effectiveLeader = leader;
                let effectiveLeaderGap = leaderGap;
                let effectiveLeaderSpeed: number | null = leader ? leader.speed : null;

                // To get a car to stop we create a fake invisible car that triggers the stopping
                if (stoplineS !== null && Number.isFinite(stoplineS)) {
                    const stoplineGap = stoplineS - vehicle.s;
                    if (!effectiveLeader || stoplineGap < effectiveLeaderGap) {
                        effectiveLeader = null; 
                        effectiveLeaderGap = stoplineGap;
                        effectiveLeaderSpeed = 0;
                    }
                }

                // Calculates speed and acceleration based on who car is following, how far away, and speed limit
                const accel = computeIdmAccel(
                    vehicle, desiredSpeedCap, effectiveLeaderSpeed,
                    Number.isFinite(effectiveLeaderGap) ? effectiveLeaderGap : null,
                    this.cfg
                );

                vehicle.speed = Math.max(0, Math.min(vehicle.speed + accel * dt, vehicle.preferredSpeed));
                let newS = vehicle.s + vehicle.speed * dt;

                // Need this since using useFrame; sim runs in discrete time steps so stuff may be missed or act too late
                if (stoplineS !== null && Number.isFinite(stoplineS) && newS > stoplineS && !isRoundaboutInside) {
                    const maxSpeedToLine = Math.max(0, stoplineS - vehicle.s) / Math.max(1e-6, dt);
                    vehicle.speed = Math.min(vehicle.speed, maxSpeedToLine);
                    newS = stoplineS;
                }

                // In event of IDM acceleration being too weak, just force stop vehicle
                if (leader) {
                    
                    // Inside roundabouts
                    if (isRoundaboutInside && !nearingExit) {
                        const result = this.applyRoundaboutForceStop(vehicle, leader, newS, dt);
                        vehicle.speed = result.speed;
                        newS = result.newS;
                    }
                    
                    // Otherwise standard intersections and roads 
                    else {
                        
                        // If leader on same route
                        if (leader.route === vehicle.route) {
                            const leaderS = desiredS.get(leader) ?? leader.s;

                            // Calculate the absolute s coordinate where we would hit their rear bumper
                            const minSafeS = leaderS - 0.5 * (leader.length + vehicle.length) - this.cfg.spacing.minBumperGap;
                            
                            // If projected move crossed into their bumper
                            if (newS > minSafeS) {
                                const idmA = computeIdmAccel(vehicle, vehicle.preferredSpeed, leader.speed, Math.max(0, minSafeS - vehicle.s), this.cfg);
                                vehicle.speed = Math.max(0, vehicle.speed + idmA * dt);
                                newS = Math.min(vehicle.s + vehicle.speed * dt, minSafeS);
                            }
                        }
                        // Otherwise merged into out lane from different route
                        else {
                            if (this.estimateGapAfterMove(vehicle, newS, leader, desiredS) < this.cfg.spacing.minBumperGap) {
                                const curGap = this.estimateGapAfterMove(vehicle, vehicle.s, leader, desiredS);
                                const idmA = computeIdmAccel(vehicle, vehicle.preferredSpeed, leader.speed, Math.max(0, curGap), this.cfg);
                                vehicle.speed = Math.max(0, vehicle.speed + idmA * dt);
                                newS = vehicle.s + vehicle.speed * dt;
                            }
                        }
                    }
                }

                // Roundabout lane changing checks (actively circulating a roundabout)
                if (isRoundaboutInside && !nearingExit && vehicle.laneKey) {
                    const result = this.applyRoundaboutMergeCheck(vehicle, leader, lanes, newS, dt);
                    vehicle.speed = result.speed;
                    newS = result.newS;
                }

                // Commit final state
                desiredS.set(vehicle, newS);
            }
        }
    }


    /**
     * How far down a specific lane is a car
     * @param occ The current occupancy (car + coordinate)
     * @param laneKey The lane the occupancy concerns
     * @param desiredS The route s values
     * @returns Returns the distance down the lane a car is
     */
    private occCoord(occ: LaneOcc, laneKey: string, desiredS: Map<Vehicle, number>): number {
        if (typeof occ.pinnedCoord === "number") {
            return occ.pinnedCoord;
        }

        const other = occ.vehicle;
        const sVal = desiredS.get(other) ?? other.s;

        // If other is currently on this physical lane, use standard lane coord
        if (other.laneKey && other.laneKey === laneKey) {
            return this.laneCoordFromS(other, sVal);
        }

        // Otherwise fall back to s (shouldn't happen often)
        return sVal;
    }

    /**
     * Checks the next segment if there is a leader and if so how far
     * @param v Vehicles POV
     * @param lanes The lanes so we can search to find the target lane
     * @param desiredS To calculate the gap
     * @returns Leader in next segment + distance to it
     */
    private findLeaderInUpcomingSegments(
        v: Vehicle,
        lanes: Map<string, LaneOcc[]>,
        desiredS: Map<Vehicle, number>
    ): { leader: Vehicle; gap: number } | null {
        // Remove segments more than 1 away
        const segs = v.route.segments;
        if (!segs || v.segmentIndex >= segs.length - 1) return null;
        
        // Ignore current segment
        const currentSeg = v.currentSegment;
        if (!currentSeg) return null;

        // Doesn't run at end of route (no segment ahead)
        if (currentSeg.phase !== "link") return null;

        // Identify target lane
        const distToSegEnd = this.getDistToSegmentEnd(v);

        // Find maximum look ahead distance based on speed
        const brakingDist = this.stoppingDistance(v.speed, v);
        const lookaheadDist = Math.max(brakingDist + 10, 30);

        const nextSegIdx = v.segmentIndex + 1;
        if (nextSegIdx >= segs.length) return null;

        // Identify target lane
        const nextSeg = segs[nextSegIdx];
        const nextLaneKey = laneKeyForSegment(nextSeg, this.roundaboutControllers);
        if (!nextLaneKey) return null;

        const laneOccs = lanes.get(nextLaneKey) ?? [];

        let closestLeader: Vehicle | null = null;
        let closestGap = Infinity;

        
        // Scan through lane occupancies to determine the leader
        for (const occ of laneOccs) {
            const other = occ.vehicle;
            if (other === v) {
                continue;
            }
            if (other.route === v.route) {
                continue;
            }

            const otherSeg = other.currentSegment;
            if (!otherSeg) {
                continue;
            }

            // We calculate gap
            const otherCoord = this.occCoord(occ, nextLaneKey, desiredS);
            const base = this.laneBases.get(nextLaneKey)?.get(segmentId(nextSeg)) ?? 0;
            const otherDistInSeg = Math.max(0, otherCoord - base);
            const gap = distToSegEnd + otherDistInSeg - other.length;

            // If leader is within the lookahead buffer distance then return it
            if (gap > 0 && gap < lookaheadDist && gap < closestGap) {
                closestGap = gap;
                closestLeader = other;
            }
        }

        if (closestLeader) {
            return { leader: closestLeader, gap: closestGap };
        }
        return null;
    }


    /**
     * Forces vehicle to slow down as it reaches the end of a segment for safety
     * @param v Vehicle approaching end of segment
     * @returns The appropriate speed
     */
    private getSegmentBoundarySpeedCap(v: Vehicle): number {
        const currentSeg = v.currentSegment;
        if (!currentSeg) return v.preferredSpeed;

        // Looks how far left on segment then determines a safe speed using breaking distance calculations
        const distToSegEnd = this.getDistToSegmentEnd(v);
        const cautionZone = this.stoppingDistance(v.preferredSpeed, v) + 5;

        // Get car back down to preferred speed
        if (distToSegEnd > cautionZone) {
            return v.preferredSpeed;
        }

        const safeSpeed = Math.sqrt(2 * v.maxDecel * Math.max(0.5, distToSegEnd));
        return Math.max(safeSpeed, 2);
    }


    /**
     * Figures how close vehicles will be after a move (desiredS)
     * @param follower The car that is moving
     * @param newS The resultant new position in the route
     * @param leader The car that it might be getting too close too
     * @param desiredS The target position in the route
     * @returns The new gap size after the move
     */
    private estimateGapAfterMove(
        follower: Vehicle,
        newS: number,
        leader: Vehicle,
        desiredS: Map<Vehicle, number>
    ): number {

        // If cars in the same lane then simpler maths
        if (follower.laneKey && follower.laneKey === leader.laneKey) {
            // For roundabout lanes, use world-position distance
            if (isRoundaboutLaneKey(follower.laneKey)) {
                const myPos = this.getPointAtS(follower.route, newS);
                const leaderPos = leader.model.position;
                if (myPos) {
                    const dist = myPos.distanceTo(leaderPos);
                    return dist - 0.5 * (leader.length + follower.length);
                }
                return Infinity;
            }
            
            // Linear lanes
            const myNewCoord = this.laneCoordFromS(follower, newS);
            const leaderCoord = this.laneCoordFromS(leader, desiredS.get(leader) ?? leader.s);
            return (leaderCoord - myNewCoord) - 0.5 * (leader.length + follower.length);
        }

        // If not in same lane then summ distance to common boundary
        const currentSeg = follower.currentSegment;
        if (!currentSeg) {
            return Infinity;
        }

        const followerSegDists = this.getSegmentDistances(follower.route);
        const followerSegInfo = followerSegDists[follower.segmentIndex];
        const distToSegEnd = Math.max(0, (followerSegInfo?.s1 ?? 0) - newS);
        const leaderSeg = leader.currentSegment;
        if (!leaderSeg) {
            return Infinity;
        }

        const leaderSegDists = this.getSegmentDistances(leader.route);
        const leaderSegInfo = leaderSegDists[leader.segmentIndex];
        const leaderDistInSeg = leader.s - (leaderSegInfo?.s0 ?? 0);

        return distToSegEnd + leaderDistInSeg - leader.length;
    }


    // computeIdmAccel removed - now using shared implementation from physics/idm.ts
    // Call site: computeIdmAccel(v, desiredSpeed, leaderSpeed, gap, this.cfg)


    /**
     * Given a vehicle it finds the leader within a roundabout circulating lane
     * @param v Relative vehicle
     * @param laneOccs Lane occupancies
     * @returns Vehicle in front and the distance between them
     */
    private findRoundaboutLeader(
        v: Vehicle,
        laneOccs: LaneOcc[],
    ): { leader: Vehicle; gap: number } | null {
        
        // First check if roundabout lane exists
        if (!v.laneKey || !isRoundaboutLaneKey(v.laneKey)) {
            return null;
        }

        const junctionId = roundaboutIdFromLaneKey(v.laneKey);
        const rData = this.getRoundaboutData(junctionId);
        if (!rData) {
            return null;
        }

        const laneWidth = this.roundaboutLaneWidth(junctionId);

        // Ring radius bounds
        const outerR = rData.structure.laneMidRadii.length > 0 ? rData.structure.laneMidRadii[rData.structure.laneMidRadii.length - 1] : rData.structure.avgRadius;
        const innerR = rData.structure.laneMidRadii.length > 0 ? rData.structure.laneMidRadii[0] : rData.structure.avgRadius;
        const ringTolerance = laneWidth * 1.5;

        // Where is the vehicle on roundabout circle
        const myPos = v.model.position;
        const myDx = myPos.x - rData.centre.x;
        const myDz = myPos.z - rData.centre.z;
        const myR = Math.sqrt(myDx * myDx + myDz * myDz);
        const myAngle = Math.atan2(myDz, myDx);

        // If this vehicle is already off the ring (exit blend), skip ring leader search
        if (myR > outerR + ringTolerance || myR < innerR - ringTolerance) {
            return null;
        }

        const myLaneIdx = this.nearestRingLaneIndex(rData.structure.laneMidRadii, myR);

        const TAU = Math.PI * 2;
        let bestArcDist = Infinity;
        let bestWorldDist = Infinity;
        let bestLeader: Vehicle | null = null;

        // Determine if car has recently entered roundabout
        const { recentlyEntered: iAmRecentlyEnteredRL, entryKey: myEntryKeyRL } = this.getRoundaboutEntryStatus(v);

        for (const occ of laneOccs) {
            const other = occ.vehicle;
            
            // Ignore cars on exact route (already caught)
            if (other === v || other.route === v.route) {
                continue; 
            }
            
            // Ignores cars that have peeled off ring
            if (other.currentSegment?.phase !== "inside") {
                continue;
            }

            // Skip same-exit vehicles when BOTH recently entered
            if (iAmRecentlyEnteredRL && myEntryKeyRL) {
                const { recentlyEntered: otherRecentlyEntered, entryKey: otherEntryKey } = this.getRoundaboutEntryStatus(other);
                if (otherRecentlyEntered && otherEntryKey === myEntryKeyRL) {
                    continue; // both near entry - skip
                }
            }

            const otherPos = other.model.position;
            const otherDx = otherPos.x - rData.centre.x;
            const otherDz = otherPos.z - rData.centre.z;
            const otherR = Math.sqrt(otherDx * otherDx + otherDz * otherDz);

            // Skip vehicles that have drifted off the ring
            if (otherR > outerR + ringTolerance || otherR < innerR - ringTolerance) {
                continue;
            }

            const otherLaneIdx = this.nearestRingLaneIndex(rData.structure.laneMidRadii, otherR);
            const laneDiff = Math.abs(otherLaneIdx - myLaneIdx);
            if (laneDiff > 1) {
                continue; 
            }

            // Angular ordering
            const otherAngle = Math.atan2(otherDz, otherDx);
            const angularDelta = THREE.MathUtils.euclideanModulo(otherAngle - myAngle, TAU);
            if (angularDelta < 0.01 || angularDelta > Math.PI) {
                continue;
            }

            // Heading filter
            const otherFwd = new THREE.Vector3(Math.sin(other.model.rotation.y), 0, Math.cos(other.model.rotation.y));
            const ringTangentCW = new THREE.Vector3(-Math.sin(otherAngle), 0, Math.cos(otherAngle));
            const tangentAlignment = otherFwd.dot(ringTangentCW);
            if (tangentAlignment < 0.5) {
                continue; 
            }

            // Arc/world distance checks
            const arcDist = angularDelta * rData.structure.avgRadius;
            const worldDist = myPos.distanceTo(otherPos);
            const proximityThreshold = v.length + 2.0;

            if (laneDiff === 0) {
                if (arcDist < bestArcDist) {
                    bestArcDist = arcDist;
                    bestWorldDist = worldDist;
                    bestLeader = other;
                }
            } 
            else {
                if (worldDist < proximityThreshold && worldDist < bestWorldDist) {
                    bestArcDist = arcDist;
                    bestWorldDist = worldDist;
                    bestLeader = other;
                }
            }
        }

        if (!bestLeader || !Number.isFinite(bestWorldDist)) {
            return null;
        }

        const gap = bestArcDist - 0.5 * (bestLeader.length + v.length);
        if (gap <= 0) {
            return null; 
        }

        return { leader: bestLeader, gap };
    }


    // isRoundaboutLaneKey and roundaboutIdFromLaneKey are now imported from helpers/roundaboutUtils.ts

    
    /**
     * Converts a world position into a distance coordinate along a roundabout's circumference
     * @param junctionId ID of the roundabout object
     * @param pos - the world-space position to convert
     * @returns the circumferential distance coordinate
     */
    private roundaboutCoordFromWorldPos(junctionId: string, pos: THREE.Vector3): number {
        const rData = this.getRoundaboutData(junctionId);
        if (!rData) {
            return 0;
        }

        const dx = pos.x - rData.centre.x;
        const dz = pos.z - rData.centre.z;
        const angle = Math.atan2(dz, dx);
        const TAU = Math.PI * 2;
        // Convert angle to appropriate range 0 -> 2pi
        const wrapped = THREE.MathUtils.euclideanModulo(angle, TAU);
        return wrapped * rData.structure.avgRadius;
    }


    /**
     * Find which discrete ring lane index a given radius falls into.
     * Returns the index into `laneMidRadii` whose value is closest to `radius`.
     *
     * @param laneMidRadii - mid-radius of each ring lane
     * @param radius - radius in world units
     * @returns the zero-based index of the closest ring lane
     */
    private nearestRingLaneIndex(laneMidRadii: number[], radius: number): number {
        if (laneMidRadii.length <= 1) {
            // Only one (or zero) rings - always index 0
            return 0;
        }

        let bestIdx = 0;
        let bestDist = Math.abs(radius - laneMidRadii[0]);
        for (let i = 1; i < laneMidRadii.length; i++) {
            const d = Math.abs(radius - laneMidRadii[i]);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    /**
     * Interpolates a world position along a route at the given s-coordinate.
     *
     * @param route - the route to sample
     * @param sValue - distance along the route (metres)
     * @returns the interpolated world position, or `null` if the route is too short
     */
    private getPointAtS(route: Route, sValue: number): THREE.Vector3 | null {
        const pts = this.getRoutePointsCached(route);
        if (!pts || pts.length < 2) {
            // Route has insufficient points to interpolate
            return null;
        }

        const cumDist = this.getRouteCumulativeDistances(route);
        const { idx, t } = this.findIndexAtS(cumDist, sValue);

        const a = pts[idx];
        const b = pts[idx + 1];

        const pA = new THREE.Vector3(a[0], a[1] + this.cfg.rendering.yOffset, a[2]);
        const pB = new THREE.Vector3(b[0], b[1] + this.cfg.rendering.yOffset, b[2]);

        return pA.clone().lerp(pB, t);
    }

    /**
     * Convert a vehicle's s-coordinate into an arc-length position on the
     * roundabout circumference by projecting its world position.
     * Falls back to the raw s value when the vehicle is not on a roundabout lane.
     * @param v - vehicle whose position is resolved
     * @param sValue - distance-along-route value
     * @returns arc-length coordinate on the roundabout (or raw `sValue` fallback)
     */
    private roundaboutCoordFromS(v: Vehicle, sValue: number): number {
        const laneKey = v.laneKey;
        if (!laneKey || !isRoundaboutLaneKey(laneKey)) {
            // Not a roundabout lane - fall back to linear s-coordinate
            return sValue;
        }

        const junctionId = roundaboutIdFromLaneKey(laneKey);

        const pos = this.getPointAtS(v.route, sValue);
        if (!pos) {
            // Cannot determine world position at this s - return input
            return sValue;
        }

        return this.roundaboutCoordFromWorldPos(junctionId, pos);
    }

    /**
     * Convert a vehicle's s-coordinate into a monotonic lane coordinate.
     * For roundabout lanes the result is an arc-length; for straight segments
     * it is a base-offset within the lane's coordinate space.
     * @param v - vehicle to query
     * @param sValue - raw distance-along-route
     * @returns lane-local coordinate suitable for leader/follower comparisons
     */
    private laneCoordFromS(v: Vehicle, sValue: number): number {
        const seg = v.currentSegment;
        if (!seg || !v.laneKey) {
            // Missing segment or lane key - cannot convert, return sValue
            return sValue;
        }

        if (isRoundaboutLaneKey(v.laneKey)) {
            return this.roundaboutCoordFromS(v, sValue);
        }

        const segId = segmentId(seg);
        const base = this.laneBases.get(v.laneKey)?.get(segId) ?? 0;
        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        return base + (sValue - (segInfo?.s0 ?? 0));
    }

    /**
     * Rebuild the lane-base offset maps from the current route set.
     */
    private buildLaneBases() {
        // Delegates to the standalone function in routing/laneCoordinates.ts
        this.laneBases = buildLaneBases(this.routes, this.roundaboutControllers);
        this.laneBasesBuilt = true;
    }

    // SEGMENT AND LANE-KEY TRACKING
    // laneKeyForSegment removed - now using shared implementation from helpers/segmentHelpers.ts
    // Call site: laneKeyForSegment(seg, this.roundaboutControllers)

    /**
     * Advance a vehicle's segment index to match its current s-coordinate,
     * update its lane key, and sync roundabout controller tracking.
     *
     * @param v - the vehicle instance
     */
    private updateVehicleSegment(v: Vehicle) {
        const segs = v.route.segments;
        if (!segs || segs.length === 0) {
            v.currentSegment = null;
            v.segmentIndex = 0;
            v.laneKey = "";
            return;
        }

        const segDists = this.getSegmentDistances(v.route);
        while (v.segmentIndex < segs.length - 1 && v.s > (segDists[v.segmentIndex]?.s1 ?? 0)) {
            v.segmentIndex++;
        }

        v.currentSegment = segs[v.segmentIndex];
        v.laneKey = laneKeyForSegment(v.currentSegment, this.roundaboutControllers);

        // Update roundabout controller tracking when vehicle enters/exits roundabout
        this.updateRoundaboutTracking(v);
    }

    /**
     * Track vehicles on roundabout and manage commitment state
     *
     * @param v - the vehicle instance
     */
    private updateRoundaboutTracking(v: Vehicle) {
        const seg = v.currentSegment;
        if (!seg) return;

        const junctionId = seg.to?.structureID ?? seg.from?.structureID;
        if (!junctionId) return;

        const controller = this.roundaboutControllers.get(junctionId);
        if (!controller) return;

        const rData = this.getRoundaboutData(junctionId);
        if (!rData) {
            return;
        }

        // If vehicle is in "inside" phase on a roundabout, update its position
        if (seg.phase === "inside" && isRoundaboutLaneKey(v.laneKey)) {
            const pos = v.model.position.clone();
            
            // Get the vehicle's heading from its model rotation
            const heading = new THREE.Vector3(0, 0, 1);
            heading.applyQuaternion(v.model.quaternion);
            heading.y = 0;
            heading.normalize();

            // Determine actual lane index from vehicle's distance to centre
            const actualLaneIndex = controller.getLaneIndexForPosition(pos);

            // Determine which arm this vehicle entered from (for same-arm skip logic)
            let vehicleEntryKey: string | undefined;
            const segs = v.route.segments;
            if (segs && v.segmentIndex > 0) {
                const prevSeg = segs[v.segmentIndex - 1];
                if (prevSeg?.phase === "approach") {
                    vehicleEntryKey = this.entryGroupKeyFromNodeKey(
                        nodeKeyOf(prevSeg.from)
                    );
                }
            }

            controller.updateCirculatingVehicle(v.id, pos, v.speed, actualLaneIndex, heading, vehicleEntryKey);
            controller.setGeometry(rData.centre, rData.structure.laneMidRadii);
        }
        // If vehicle has exited the roundabout, remove from tracking
        else if (seg.phase === "exit" || seg.phase === "link") {
            controller.removeCirculatingVehicle(v.id);
            controller.clearCommitment(v.id);
        }
    }

    /**
     * Move the vehicle model to the world position corresponding to `targetS`,
     * clamp within the route bounds, orient the model along the route tangent,
     * and refresh the segment/lane-key tracking.
     * @param v - vehicle to reposition
     * @param targetS - desired distance along the route
     * @returns `true` if the vehicle has reached (or passed) the end of its route
     */
    private applySAndPose(v: Vehicle, targetS: number): boolean {
        const pts = this.getRoutePointsCached(v.route);
        if (!pts || pts.length < 2) return true;

        const cumDist = this.getRouteCumulativeDistances(v.route);
        const maxS = cumDist[cumDist.length - 1];

        v.s = Math.max(0, Math.min(targetS, maxS));

        const { idx, t } = this.findIndexAtS(cumDist, v.s);

        v.routeIndex = idx;
        v.t = t;

        const a = pts[idx];
        const b = pts[idx + 1];

        const pA = new THREE.Vector3(a[0], a[1] + this.cfg.rendering.yOffset, a[2]);
        const pB = new THREE.Vector3(b[0], b[1] + this.cfg.rendering.yOffset, b[2]);

        v.model.position.copy(pA.clone().lerp(pB, t));

        const dir = pB.clone().sub(pA);
        if (dir.lengthSq() > 1e-6) {
            dir.normalize();
            v.model.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
        }

        this.updateVehicleSegment(v);

        return v.s >= maxS - 1e-6;
    }

    /**
     * Lazily create roundabout and intersection controllers for every junction
     * that appears as an approach target in the current route set.
     * Only runs once per simulation initialisation.
     *
     * @param junctionObjectRefs - ref to the set of live junction Three.js groups
     */
    private buildControllersIfNeeded(
        junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>
    ) {
        if (this.controllersBuilt) return;

        const groups = junctionObjectRefs.current;
        if (!groups || groups.length === 0) {
            return;
        }

        const incoming = new Map<string, Set<string>>();

        for (const r of this.routes) {
            for (const seg of r.segments ?? []) {
                if (seg.phase !== "approach") continue;

                const junctionKey = seg.to.structureID;
                const entryKey = this.entryGroupKeyFromNodeKey(nodeKeyOf(seg.from));

                const set = incoming.get(junctionKey) ?? new Set<string>();
                set.add(entryKey);
                incoming.set(junctionKey, set);
            }
        }

        for (const [junctionKey, laneSet] of incoming.entries()) {

            const junctionGroup = this.findGroupById(junctionObjectRefs.current, junctionKey);

            if (!junctionGroup) continue;
            
            const structureData = this.getStructureData(junctionGroup);
            if (!structureData) continue;

            if (structureData.type === "roundabout") {

                this.roundaboutGroups.set(junctionKey, junctionGroup);
                
                const controller = new RoundaboutController(junctionKey, Array.from(laneSet), () => this.cfg);
                this.roundaboutControllers.set(junctionKey, controller);
                

                const structure = junctionGroup.userData.roundaboutStructure;
                const centre = new THREE.Vector3();
                junctionGroup.getWorldPosition(centre);
                
                controller.setGeometry(centre, structure.laneMidRadii);
            } 
            else {
                this.intersectionControllers.set(
                    junctionKey,
                    new IntersectionController(junctionKey, Array.from(laneSet), () => this.cfg)
                );
            }

            this.controllersBuilt = true;
        }
    }

    /**
     * Handle force-stopping when a leader is inside a roundabout.
     * Checks radial distances and lane indices to determine if the leader is a threat,
     * then applies IDM braking if the bumper gap is too small.
     *
     * @param vehicle - the vehicle instance
     * @param leader - the vehicle ahead (or null)
     * @param newS - proposed new s-coordinate along the route
     * @param dt - time delta in seconds since last frame
     * @returns the updated speed and s-coordinate
     */
    private applyRoundaboutForceStop(
        vehicle: Vehicle, leader: Vehicle, newS: number, dt: number
    ): { speed: number; newS: number } {
        const myPos = this.getPointAtS(vehicle.route, newS);
        const leaderPos = leader.model.position;
        if (myPos) {
            const jId = roundaboutIdFromLaneKey(vehicle.laneKey);
            const rData = this.getRoundaboutData(jId);
            let shouldCheck = true;
            if (rData) {
                const myR = Math.hypot(myPos.x - rData.centre.x, myPos.z - rData.centre.z);
                const leadR = Math.hypot(leaderPos.x - rData.centre.x, leaderPos.z - rData.centre.z);
                const lw = this.roundaboutLaneWidth(jId);
                const outerR = rData.structure.laneMidRadii.length > 0
                    ? rData.structure.laneMidRadii[rData.structure.laneMidRadii.length - 1]
                    : rData.structure.avgRadius;

                if (leadR > outerR + lw * 1.5) {
                    shouldCheck = false;
                } else if (rData.structure.laneMidRadii.length >= 2) {
                    const myLane = this.nearestRingLaneIndex(rData.structure.laneMidRadii, myR);
                    const leadLane = this.nearestRingLaneIndex(rData.structure.laneMidRadii, leadR);
                    if (Math.abs(myLane - leadLane) > 1) {
                        shouldCheck = false;
                    }
                }
            }

            if (shouldCheck) {
                const bumpGap = myPos.distanceTo(leaderPos) - 0.5 * (leader.length + vehicle.length);
                const safeGap = bumpGap - this.cfg.spacing.minBumperGap;
                if (safeGap < 0) {
                    const idmA = computeIdmAccel(vehicle, vehicle.preferredSpeed, leader.speed, Math.max(0, bumpGap), this.cfg);
                    vehicle.speed = Math.max(0, vehicle.speed + idmA * dt);
                    newS = vehicle.s + vehicle.speed * dt;
                }
            }
        }
        return { speed: vehicle.speed, newS };
    }

    /**
     * Handle roundabout merge/give-way checks for a vehicle circulating inside a roundabout.
     * Iterates lane occupancies and applies give-way rules when another vehicle is too close.
     *
     * @param vehicle - the vehicle instance
     * @param leader - the vehicle ahead (or null)
     * @param lanes - lane occupancy map
     * @param newS - proposed new s-coordinate along the route
     * @param dt - time delta in seconds since last frame
     * @returns the updated speed and s-coordinate
     */
    private applyRoundaboutMergeCheck(
        vehicle: Vehicle, leader: Vehicle | null,
        lanes: Map<string, LaneOcc[]>, newS: number, dt: number
    ): { speed: number; newS: number } {
        const jId = roundaboutIdFromLaneKey(vehicle.laneKey);
        const rData = this.getRoundaboutData(jId);
        if (!rData) return { speed: vehicle.speed, newS };

        const myPos = this.getPointAtS(vehicle.route, newS) ?? vehicle.model.position;
        const myAngle = Math.atan2(myPos.z - rData.centre.z, myPos.x - rData.centre.x);
        const laneOccs = lanes.get(vehicle.laneKey!) ?? [];
        const { recentlyEntered: iAmRecentlyEntered, entryKey: myEntryKey } = this.getRoundaboutEntryStatus(vehicle);

        for (const occ of laneOccs) {
            const other = occ.vehicle;
            if (other === vehicle || other === leader || other.currentSegment?.phase !== "inside") {
                continue;
            }

            const { recentlyEntered: otherRecentlyEntered, entryKey: otherEntryKey } = this.getRoundaboutEntryStatus(other);
            if (iAmRecentlyEntered && otherRecentlyEntered && myEntryKey && myEntryKey === otherEntryKey) {
                continue;
            }

            const myR = Math.hypot(myPos.x - rData.centre.x, myPos.z - rData.centre.z);
            const otherR = Math.hypot(other.model.position.x - rData.centre.x, other.model.position.z - rData.centre.z);
            const myLane = this.nearestRingLaneIndex(rData.structure.laneMidRadii, myR);
            const otherLane = this.nearestRingLaneIndex(rData.structure.laneMidRadii, otherR);
            const dist = myPos.distanceTo(other.model.position);
            const softMinDist = 0.5 * (vehicle.length + other.length) + this.cfg.spacing.minBumperGap + 1.0;

            if (Math.abs(myLane - otherLane) > 0) {
                continue;
            }

            if (dist < softMinDist) {
                let shouldGiveWay: boolean;
                if (iAmRecentlyEntered && !otherRecentlyEntered) {
                    shouldGiveWay = true;
                } else if (!iAmRecentlyEntered && otherRecentlyEntered) {
                    shouldGiveWay = false;
                } else {
                    const otherAngle = Math.atan2(other.model.position.z - rData.centre.z, other.model.position.x - rData.centre.x);
                    const angDelta = THREE.MathUtils.euclideanModulo(otherAngle - myAngle, Math.PI * 2);
                    shouldGiveWay = (angDelta > 0.01 && angDelta < Math.PI) || (angDelta <= 0.01 && vehicle.id > other.id);
                }

                if (shouldGiveWay) {
                    const bumpGapOv = dist - 0.5 * (vehicle.length + other.length);
                    const idmAov = computeIdmAccel(vehicle, vehicle.preferredSpeed, other.speed, Math.max(0, bumpGapOv), this.cfg);
                    vehicle.speed = Math.max(0, vehicle.speed + idmAov * dt);
                    newS = vehicle.s + vehicle.speed * dt;
                    break;
                }
            }
        }
        return { speed: vehicle.speed, newS };
    }

    /**
     * FIX:
     * - If red: cap speed so we can stop at the stopline (existing behaviour)
     * - If green: ALSO require downstream space on exit lane, otherwise treat like red (prevents blocking the junction)
     * - Also look ahead from link segments to upcoming stop lines
     *
     * @param v - the vehicle instance
     * @param targetSpeed - desired driving speed
     * @param lanes - lane occupancy map
     * @param desiredS - desired s-coordinate
     * @returns the capped target speed
     */
    private applyStoplineAndDownstreamCap(
        v: Vehicle,
        targetSpeed: number,
        lanes: Map<string, LaneOcc[]>,
        desiredS: Map<Vehicle, number>
    ): number {
        const seg = v.currentSegment;
        if (!seg) return targetSpeed;

        // Check current segment if it's an approach
        if (seg.phase === "approach") {
            return this.applyStoplineLogic(v, targetSpeed, seg, lanes, desiredS);
        }

        // Look ahead from link segments to the next approach segment
        if (seg.phase === "link") {
            const upcoming = this.getUpcomingStoplineForLink(v, lanes);
            if (upcoming && upcoming.shouldStop) {
                const adjustedDist = upcoming.stoplineS - v.s;
                if (adjustedDist > 0) {
                    const decel = v.maxDecel * 0.7;
                    const vmax = Math.sqrt(2 * decel * adjustedDist);
                    return Math.min(targetSpeed, vmax);
                }
                return 0;
            }
        }

        return targetSpeed;
    }

    /**
     * Apply traffic-light / roundabout entry logic for an approach segment.
     * Returns a (possibly reduced) target speed that decelerates the vehicle
     * toward its stop line when the signal is not green.
     * @param v - vehicle being evaluated
     * @param targetSpeed - unconstrained desired speed
     * @param seg - current route segment
     * @param lanes - per-lane occupancy map
     * @param desiredS - map of each vehicle's desired next s-value
     * @returns adjusted target speed
     */
    private applyStoplineLogic(
        v: Vehicle,
        targetSpeed: number,
        seg: RouteSegment,
        lanes: Map<string, LaneOcc[]>,
        desiredS: Map<Vehicle, number>
    ): number {
        const junctionKey = seg.to.structureID;
        const controller = this.getController(junctionKey);
        if (!controller) return targetSpeed;

        const entryKey = this.entryGroupKeyFromNodeKey(nodeKeyOf(seg.from));

        const isRoundabout = this.roundaboutControllers.has(junctionKey);
        
        // Handle roundabouts with new gap-based logic
        if (isRoundabout) {
            return this.applyRoundaboutEntryLogic(v, targetSpeed, seg, junctionKey, entryKey, lanes);
        }

        // Regular intersection logic below
        const lightColour = this.intersectionControllers.get(junctionKey)?.getLightColour(entryKey);
        const green = controller.isGreen(entryKey);

        // AMBER logic (intersections only): proceed if too close to safely stop
        if (lightColour === "AMBER") {
            const stopS = this.getStoplineS(v);
            if (stopS !== null) {
                const dist = stopS - v.s;
                const stoppingDist = this.stoppingDistance(v.speed, v);
                if (dist > stoppingDist) {
                    // Safe to stop -> treat as red
                    return this.capToStopline(v, targetSpeed);
                }
                // Too close to stop safely -> proceed
                return targetSpeed;
            }
        }

        // RED_AMBER behaves like RED (intersections)
        if (lightColour === "RED_AMBER") {
            return this.capToStopline(v, targetSpeed);
        }

        // If green, check downstream space
        if (green) {
            return targetSpeed;
        }

        // red -> stop at line
        return this.capToStopline(v, targetSpeed);
    }

    /**
     * New roundabout entry logic with proper gap acceptance and commitment.
     *
     * KEY DESIGN: A vehicle commits to entering the roundabout once it is
     * within braking distance of the stop line AND a safe gap exists.
     * Once committed the decision is IRREVERSIBLE - the vehicle will
     * proceed through the entry smoothly.  Circulating traffic that
     * arrives after the commitment is handled by the circulating
     * give-way rules (inside-roundabout merge logic), NOT by yanking
     * the entering vehicle back behind the stop line.
     *
     * @param v - the vehicle instance
     * @param targetSpeed - desired driving speed
     * @param seg - current route segment
     * @param junctionKey - string key identifying a junction
     * @param entryKey - string key identifying an entry point
     * @param lanes - lane occupancy map
     * @returns the capped target speed
     */
    private applyRoundaboutEntryLogic(
        v: Vehicle,
        targetSpeed: number,
        seg: RouteSegment,
        junctionKey: string,
        entryKey: string,
        lanes: Map<string, LaneOcc[]>
    ): number {
        const controller = this.roundaboutControllers.get(junctionKey);
        if (!controller) return targetSpeed;

        const rData = this.getRoundaboutData(junctionKey);
        if (!rData) return targetSpeed;

        const stopS = this.getStoplineS(v);
        if (stopS === null) return targetSpeed;

        const distToStopline = stopS - v.s;

        // Already committed - proceed unconditionally.
        // Once committed the vehicle MUST continue into the roundabout.
        // Re-checking the gap would cause the vehicle to oscillate
        // (cross the line → brake → snap back) which is exactly the
        // glitch we are eliminating.  Any conflict with circulating
        // traffic is resolved by the ring merge / give-way logic that
        // runs while the vehicle is in the "inside" phase.
        if (controller.isCommitted(v.id)) {
            return targetSpeed;
        }

        // Not yet committed - evaluate gap.────
        const entryAngle = this.getEntryAngleForRoundabout(junctionKey, entryKey);
        if (entryAngle === undefined) return targetSpeed;

        const radius = rData.structure.avgRadius;

        const canEnter = controller.canEnterSafely(entryAngle, radius, entryKey);
        const physicalClear = this.isRoundaboutEntryClear(v, junctionKey, entryKey, lanes);

        if (canEnter && physicalClear) {
            // Gap is available.
            //
            // COMMIT ZONE: commit as soon as the vehicle can no longer
            // comfortably stop before the stop line.  This prevents the
            // old behaviour where the car would coast up to the line,
            // get hard-clamped, wait one frame, THEN commit - which
            // looked like a stutter and was vulnerable to gap-flicker.
            const brakingDist = this.stoppingDistance(v.speed, v);
            const commitMargin = Math.max(brakingDist * 1.2, v.length);

            if (distToStopline <= commitMargin) {
                const entryPosition = controller.getEntryPosition(entryAngle, radius);
                controller.commitVehicle(v.id, entryPosition, entryKey);
            }
            // Whether just committed or still coasting toward the
            // commit zone, allow full speed - the gap is clear.
            return targetSpeed;
        }

        // Gap NOT clear - brake to stop at the line.
        if (distToStopline > 0) {
            const decel = v.maxDecel * 0.7;
            const stoppingSpeed = Math.sqrt(2 * decel * Math.max(0.1, distToStopline));
            return Math.min(targetSpeed, stoppingSpeed);
        }

        // At or past the stop line with no clear gap - full stop.
        return 0;
    }

    /**
     * Check if there are vehicles physically blocking the entry point on the roundabout.
     * Lane-aware: checks proximity at each vehicle's current radius AND detects
     * vehicles that are changing lanes toward the entry path (radial movement
     * toward the outer lane where the entering vehicle will merge).
     *
     * @param v - the vehicle instance
     * @param junctionKey - string key identifying a junction
     * @param entryKey - string key identifying an entry point
     * @param lanes - lane occupancy map
     * @returns `true` if no circulating vehicle blocks the entry point
     */
    private isRoundaboutEntryClear(
        v: Vehicle,
        junctionKey: string,
        entryKey: string,
        lanes: Map<string, LaneOcc[]>
    ): boolean {
        const rData = this.getRoundaboutData(junctionKey);
        if (!rData) return true;

        const entryAngle = this.getEntryAngleForRoundabout(junctionKey, entryKey);
        if (entryAngle === undefined) return true;

        const laneKey = `lane:roundabout:${junctionKey}`;
        const occs = lanes.get(laneKey) ?? [];
        if (occs.length === 0) return true;

        const clearanceGap = Math.max(v.length * 3, 6);

        const { centre, structure } = rData;

        const outerR = structure.laneMidRadii.length > 0
            ? structure.laneMidRadii[structure.laneMidRadii.length - 1]
            : structure.avgRadius;
        const outerEntryPos = new THREE.Vector3(
            centre.x + Math.cos(entryAngle) * outerR,
            centre.y,
            centre.z + Math.sin(entryAngle) * outerR
        );

        const innerR = structure.laneMidRadii.length > 0
            ? structure.laneMidRadii[0]
            : structure.avgRadius;
        const innerEntryPos = new THREE.Vector3(
            centre.x + Math.cos(entryAngle) * innerR,
            centre.y,
            centre.z + Math.sin(entryAngle) * innerR
        );

        for (const occ of occs) {
            const other = occ.vehicle;
            if (other.id === v.id) continue;

            // Skip vehicles that are about to exit the roundabout
            const otherNextSeg = other.route.segments[other.segmentIndex + 1];
            if (otherNextSeg && otherNextSeg.phase === "exit") {
                const segDists = this.getSegmentDistances(other.route);
                const segInfo = segDists[other.segmentIndex];
                const distToExit = segInfo ? (segInfo.s1 - other.s) : Infinity;

                // If they are within 15 units of exiting, they are "locked in"
                if (distToExit < 15) {
                    continue;
                }
            }

            // Skip vehicles entering from the SAME arm
            if (other.currentSegment?.phase === "inside") {
                const { recentlyEntered: otherRecentlyEntered, entryKey: otherEntryKey } = this.getRoundaboutEntryStatus(other);
                if (otherRecentlyEntered && otherEntryKey === entryKey) {
                    continue;
                }
            }

            const otherPos = other.model.position;
            const otherDistFromCentre = Math.sqrt(
                (otherPos.x - centre.x) ** 2 +
                (otherPos.z - centre.z) ** 2
            );

            // Check 1: proximity at the vehicle's CURRENT radius
            const laneEntryPos = new THREE.Vector3(
                centre.x + Math.cos(entryAngle) * otherDistFromCentre,
                centre.y,
                centre.z + Math.sin(entryAngle) * otherDistFromCentre
            );
            const distance = otherPos.distanceTo(laneEntryPos);
            if (distance < clearanceGap) {
                return false;
            }

            // Check 2: distance to the inner entry point
            const distToInnerEntry = otherPos.distanceTo(innerEntryPos);
            if (distToInnerEntry < clearanceGap) {
                return false;
            }

            // Check 3: distance to the outer entry point
            const distToOuterEntry = otherPos.distanceTo(outerEntryPos);
            if (distToOuterEntry < clearanceGap) {
                return false;
            }

            // Check 4: is this vehicle lane-changing TOWARD the outer lane?
            if (structure.laneMidRadii.length >= 2 && otherDistFromCentre < outerR) {
                const otherFwd = new THREE.Vector3(
                    Math.sin(other.model.rotation.y), 0, Math.cos(other.model.rotation.y)
                );
                const radialOut = new THREE.Vector3(
                    otherPos.x - centre.x, 0, otherPos.z - centre.z
                ).normalize();
                const radialComponent = otherFwd.dot(radialOut);

                if (radialComponent > 0.1) {
                    const distToOuter = otherPos.distanceTo(outerEntryPos);
                    const laneChangeClearance = clearanceGap * 1.5;
                    if (distToOuter < laneChangeClearance) return false;
                }

                // Nearing the end of inside segment?
                const otherDistToSegEnd = this.getDistToSegmentEnd(other);
                if (otherDistToSegEnd < 8) {
                    const distToOuter = otherPos.distanceTo(outerEntryPos);
                    if (distToOuter < clearanceGap * 1.5) return false;
                }
            }
        }

        return true;
    }

    /**
     * Clamp a vehicle's speed so it decelerates smoothly to zero at its stop line.
     * @param v - vehicle to constrain
     * @param targetSpeed - unconstrained speed
     * @returns speed limited by stop-line proximity
     */
    private capToStopline(v: Vehicle, targetSpeed: number): number {
        const stopS = this.getStoplineS(v);
        if (stopS === null) return targetSpeed;

        const dist = stopS - v.s;
        if (dist <= 0) return 0;

        return Math.min(targetSpeed, Math.sqrt(2 * v.maxDecel * dist));
    }

    /**
     * Compute the s-coordinate of the effective stop line for the vehicle's
     * current segment, accounting for vehicle length and the configured buffer.
     * @returns stop-line s value, or `null` if segment data is unavailable
     * @param v - the vehicle instance
     */
    private getStoplineS(v: Vehicle): number | null {
        const frontOffset = 0.5 * v.length;
        const stopBuffer = this.cfg.spacing.stopLineOffset;

        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        if (!segInfo) return null;

        return (segInfo.s1 ?? 0) - frontOffset - stopBuffer;
    }

    /**
     * Look ahead from a link segment to the next approach segment and determine
     * the s-coordinate of the upcoming stop line and whether the vehicle should stop.
     * Returns `null` when no applicable stop line exists ahead.
     * @param v - the vehicle instance
     * @param lanes - lane occupancy map
     * @returns the stop-line s-coordinate and whether to stop, or `null` if no stop line applies
     */
    private getUpcomingStoplineForLink(
        v: Vehicle,
        lanes: Map<string, LaneOcc[]>
    ): { stoplineS: number; shouldStop: boolean } | null {
        const seg = v.currentSegment;
        if (!seg || seg.phase !== "link") return null;

        const segs = v.route.segments;
        const nextSegIdx = v.segmentIndex + 1;
        if (!segs || nextSegIdx >= segs.length) return null;

        const nextSeg = segs[nextSegIdx];
        if (!nextSeg || nextSeg.phase !== "approach") return null;

        const segDists = this.getSegmentDistances(v.route);
        const nextSegInfo = segDists[nextSegIdx];

        const distToCurrentSegEnd = this.getDistToSegmentEnd(v);
        const nextSegLength = Math.max(0, (nextSegInfo?.s1 ?? 0) - (nextSegInfo?.s0 ?? 0));
        const totalDistToStopline = distToCurrentSegEnd + nextSegLength;

        const frontOffset = 0.5 * v.length;
        const stopBuffer = this.cfg.spacing.stopLineOffset;
        const stoplineS = v.s + totalDistToStopline - frontOffset - stopBuffer;

        const junctionKey = nextSeg.to.structureID;
        const entryKey = this.entryGroupKeyFromNodeKey(nodeKeyOf(nextSeg.from));

        // Roundabout: use gap-based logic
        if (this.roundaboutControllers.has(junctionKey)) {
            const controller = this.roundaboutControllers.get(junctionKey)!;
            const rData = this.getRoundaboutData(junctionKey);
            
            if (rData) {
                const entryAngle = this.getEntryAngleForRoundabout(junctionKey, entryKey);
                if (entryAngle !== undefined) {
                    const radius = rData.structure.avgRadius;
                    
                    const canEnter = controller.canEnterSafely(entryAngle, radius, entryKey);
                    const physicalClear = this.isRoundaboutEntryClear(v, junctionKey, entryKey, lanes);
                    
                    return { stoplineS, shouldStop: !(canEnter && physicalClear) };
                }
            }
            return { stoplineS, shouldStop: false };
        }

        const controller = this.intersectionControllers.get(junctionKey);
        if (!controller) return { stoplineS, shouldStop: false };

        const lightColour = controller.getLightColour(entryKey);

        if (lightColour === "GREEN") return { stoplineS, shouldStop: false };

        if (lightColour === "AMBER") {
            const stoppingDist = this.stoppingDistance(v.speed, v);
            const shouldStop = totalDistToStopline > stoppingDist;
            return { stoplineS, shouldStop };
        }

        // RED / RED_AMBER
        return { stoplineS, shouldStop: true };
    }



    /**
     * Determine which *physical exit lane* this vehicle will go onto (first non-"inside" segment ahead).
     *
     * @param v - the vehicle instance
     * @returns the lane key of the vehicle's exit lane
     */
    private getExitLaneKeyForVehicle(v: Vehicle): string {
        const segs = v.route.segments ?? [];
        if (!segs.length) return "";

        for (let i = v.segmentIndex + 1; i < segs.length; i++) {
            const s = segs[i];
            if (s.phase === "inside") continue;

            const lk = laneKeyForSegment(s, this.roundaboutControllers);
            return lk ?? "";
        }
        return "";
    }

    /**
     * Return the lane-coordinate start value for the first non-"inside" segment
     * ahead of the vehicle (i.e. the exit lane it will enter).
     *
     * @param exitLaneKey - lane key for the target exit lane
     * @param v - the vehicle instance
     * @returns the lane-coordinate start value for the exit lane
     */
    private laneStartCoordForExitLane(exitLaneKey: string, v: Vehicle): number {
        // If we can find the next non-inside segment, use its base
        const segs = v.route.segments ?? [];
        for (let i = v.segmentIndex + 1; i < segs.length; i++) {
            const s = segs[i];
            if (s.phase === "inside") continue;
            const segId = segmentId(s);
            const base = this.laneBases.get(exitLaneKey)?.get(segId) ?? 0;
            return base; // "start of lane"
        }
        return 0;
    }

    /**
     * Check whether a vehicle on an "inside" segment is close enough to its end to reserve its exit lane.
     *
     * @param v - the vehicle instance
     * @returns `true` if the vehicle should reserve its exit lane
     */
    private shouldReserveExitLane(v: Vehicle): boolean {
        if (v.currentSegment?.phase !== "inside") return false;

        const distToSegEnd = this.getDistToSegmentEnd(v);
        const reserveThreshold = Math.max(v.length * 1.5, this.cfg.spacing.minBumperGap * 2, 3);

        return distToSegEnd <= reserveThreshold;
    }

    /**
     * Derive an entry-group key from a route-graph node key by stripping the
     * trailing lane-index component and prepending `"entry:"`.
     *
     * @param nodeKey - node key in the junction graph
     * @returns the entry-group key string
     */
    private entryGroupKeyFromNodeKey(nodeKey: string): string {
        // nodeKey format: "${structureID}-${exitIndex}-${direction}-${laneIndex}"
        // entryGroupKey = "entry:${structureID}-${exitIndex}-${direction}"
        // structureID may itself contain dashes (UUIDs), so we drop only the last component.
        const parts = nodeKey.split("-");
        if (parts.length < 4) return `entry:${nodeKey}`;
        return `entry:${parts.slice(0, -1).join("-")}`;
    }

    /**
     * Extract the exit index from an entryKey.
     * entryKey format: "entry:UUID-exitIndex-direction"
     * Since UUID contains dashes, we parse from the end.
     *
     * @param entryKey - string key identifying an entry point
     * @returns the zero-based exit index, or `-1` on failure
     */
    private exitIndexFromEntryKey(entryKey: string): number {
        const afterPrefix = entryKey.replace("entry:", "");
        const parts = afterPrefix.split("-");
        // direction is last, exitIndex is second to last
        const exitStr = parts[parts.length - 2];
        const idx = parseInt(exitStr, 10);
        return isNaN(idx) ? -1 : idx;
    }

    /**
     * Get the entry angle for a given entryKey on a roundabout, using structure data.
     *
     * @param junctionKey - string key identifying a junction
     * @param entryKey - string key identifying an entry point
     * @returns the entry angle in radians, or `undefined` if unknown
     */
    private getEntryAngleForRoundabout(
        junctionKey: string,
        entryKey: string
    ): number | undefined {
        const rData = this.getRoundaboutData(junctionKey);
        if (!rData) return undefined;

        const exitIndex = this.exitIndexFromEntryKey(entryKey);
        if (exitIndex < 0 || exitIndex >= rData.structure.exitStructures.length) {
            return undefined;
        }
        return rData.structure.exitStructures[exitIndex].angle;
    }

    /**
     * Aggregate simulation statistics from all active vehicles and counters.
     * @returns the aggregated statistics snapshot
     */
    private updateStats(): SimulationStats {
        const result = collectStats({
            vehicles: this.vehicles,
            elapsedTime: this.elapsedTime,
            completed: this.completed,
            totalTravelTime: this.totalTravelTime,
            travelCount: this.travelCount,
            globalMaxQueueLength: this.globalMaxQueueLength,
            routes: this.routes,
            spawnState: this.spawnState,
            junctionCounters: this.junctionCounters,
            lastVehJunctionTag: this.lastVehJunctionTag,
            intersectionControllers: this.intersectionControllers,
            roundaboutControllers: this.roundaboutControllers,
            getDistToSegmentEnd: (v) => this.getDistToSegmentEnd(v),
            junctionObjects: this.junction.junctionObjects,
            simConfig: this.cfg,
        });
        this.globalMaxQueueLength = result.globalMaxQueueLength;
        this.statsSnapshot = result.snapshot;
        return result.snapshot;
    }


    /**
     * Return the latest simulation statistics snapshot, computing it lazily if needed.
     * @returns the aggregated statistics snapshot
     */
    public getStats(): SimulationStats {
        return this.statsSnapshot ?? this.updateStats();
    }
}
