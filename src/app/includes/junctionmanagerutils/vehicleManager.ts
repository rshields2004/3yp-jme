import * as THREE from "three";
import { getRoutePoints, computeSegmentDistances } from "./carRouting";
import { IntersectionController } from "./controllers/intersectionController";
import { Vehicle } from "./vehicle";
import { JunctionObjectTypes } from "../types/types";
import { SimConfig, SimulationStats, JunctionStats, JunctionStatsGlobal, LaneOcc, Route, RouteSegment, Tuple3 } from "../types/simulation";
import { RoundaboutController } from "./controllers/roundaboutController";
import { disposeObjectTree } from "./helpers/dispose";
import { isRoundaboutType, buildRoundaboutMeta, RoundaboutMeta } from "./helpers/roundaboutMeta";
import { nodeKeyOf, segmentId, segmentLen } from "./helpers/segmentHelpers";
import { SeededRNG, rngForEntry, CarClass, bodyTypeForModelIndex, hashString } from "../types/carTypes";
import { defaultSimConfig } from "../defaults";




// This class is the bulk of the simulation engine, it is responsible for moving all vehicles throughout junction
export class VehicleManager {


    // CORE SIMULATION STATE

    private scene: THREE.Scene; // Reference to THREE.js scene

    private carModels: THREE.Group[]; // Array of loaded 3D car models for use
    
    private routes: Route[]; // Complete list of all possible routes

    private vehicles: Vehicle[] = []; // Currently active vehicles

    private nextId = 0; // Auto incrementing counter to assign unique ID for vehicles

    private cfg: SimConfig; // Current configuration settings for simulation

    private elapsedTime = 0; // Total time elapsed in the simulation


    // SPAWNING SYSTEM

    private spawned = 0; // Keeps track of total vehicles spawned

    private spawnRatesPerEntry = new Map<string, number>(); // Stores spawn rate for each entry point

    private spawnDemandPerEntry = new Map<string, number>(); // Accumualtes fractional demand for spawning for determinism of simulation
    
    private routesByEntry = new Map<string, Route[]>(); // An optimisation map that groups routes via starting point

    private spawnAccumulator = 0; // Accumulates frame deltas to trigger spawn logic at a fixed time step for determinism

    private entryRNGs = new Map<string, SeededRNG>(); // Random Number Generators specific to each entry point, ensures same seed sims have same exit numbers

    private entryRngKeys = new Map<string, string>(); // Maps used to create stable, reproducible keys for the RNGs so that simulation behaviour doesnt change because internal UUIDs change

    private junctionStableKeys = new Map<string, string>(); // Helper to generate stable keys

    private junctionStableKeysBuilt = false; // Flag to ensure stable keys only initialised once


    // SPATIAL & ROUTING CACHES

    private routePointsCache = new Map<Route, Tuple3[]>(); // Caches the raw 3D points of a route so they don't have to be re-extracted every frame

    private routeSegmentDistances = new Map<Route, Array<{ s0: number; s1: number }>>(); // Caches the start and end distances for every segment in a route, used to calculate which segment vehicle on

    private routeCumulativeDistances = new Map<Route, number[]>(); // Caches the cumulative length along the route, used to efficiently calculate a 3D position given a distance "s"

    private laneBases = new Map<string, Map<string, number>>(); // Coordinate system map, helps linearise positions across multiple segments - used for collision detection
    
    private laneBasesBuilt = false; // A flag to ensure laneBases is calculated only once


    // JUNCTION CONTROL

    private intersectionControllers = new Map<string, IntersectionController>(); // Manages traffic light states

    private roundaboutControllers = new Map<string, RoundaboutController>(); // Manages roundabout logic

    private roundaboutMeta = new Map<string, RoundaboutMeta>(); // Stores geometric metadata needed for simulation

    private controllersBuilt = false; // A flag to ensure controllers are initialised once


    // STATISTICS & TRACKING

    private completed = 0; // Total count of vehicles that have completed their route

    private statsSnapshot: SimulationStats | null = null; // A cached object containing the latest statistics

    private junctionCounters = new Map<string, { entered: number; exited: number; totalWaitTime: number; waitCount: number }>(); // Tracks stats per junction object

    private lastVehJunctionTag = new Map<number, { jid: string | null; phase: string | null }>(); // Remembers last junction and phase a vehicle was in, used to detect x entered y

    private vehicleWaitStart = new Map<number, { jid: string; startTime: number }>(); // Tracks timestamp when a specific vehicle started waiting at a stop line

    private lastActiveLogged: number | null = null; // Helper to prevent console spam by only logging active vehicle count changes (DEBUG)

    
    /**
     * Constructor that sets up the vehicle manager instance
     * @param scene Scene access point
     * @param carModels Loaded models
     * @param routes Routes that cars can take
     * @param cfg Simulation config options
     */
    constructor(scene: THREE.Scene, carModels: THREE.Group[], routes: Route[], cfg?: Partial<SimConfig>) {
        
        // Assign key variables
        this.scene = scene;
        this.carModels = carModels;
        this.routes = routes;

        // Build routes by entry point
        this.buildRoutesByEntry();

        this.cfg = defaultSimConfig;
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
            this.entryRNGs.clear();
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
     * Resets the simulation back to the beginning ready to be played again
     */
    public reset() {
        for (const v of this.vehicles) {
            this.scene.remove(v.model);
            disposeObjectTree(v.model);
        }

        this.vehicles = [];
        this.nextId = 0;

        this.spawned = 0;
        this.completed = 0;

        this.spawnRatesPerEntry.clear();
        this.spawnDemandPerEntry.clear();
        this.routesByEntry.clear();

        this.laneBases.clear();
        this.laneBasesBuilt = false;

        this.routeSegmentDistances.clear();
        this.routePointsCache.clear();
        this.routeCumulativeDistances.clear();

        this.intersectionControllers.clear();
        this.roundaboutControllers.clear();
        this.roundaboutMeta.clear();
        this.controllersBuilt = false;

        this.junctionStableKeys.clear();
        this.junctionStableKeysBuilt = false;
        this.entryRngKeys.clear();
        this.entryRNGs.clear();
        this.spawnAccumulator = 0;

        this.lastActiveLogged = null;

        this.statsSnapshot = null;
        this.junctionCounters.clear();
        this.lastVehJunctionTag.clear();
        this.elapsedTime = 0;
        this.vehicleWaitStart.clear();
    }


    /**
     * Main update loop of the simulation, handles all car movements.
     * @param dt Time detla - change in time since last call
     * @param junctionObjectRefs The refs of junction objects for controller construction
     */
    public update(dt: number, junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>): void {
        
        // If there are no routes available dont bother
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
        this.buildJunctionStableKeys(junctionObjectRefs);
        for (const c of this.intersectionControllers.values()) {
            c.update(dt);
        }

        for (const c of this.roundaboutControllers.values()) {
            c.update(dt);
        }

        // Update spawn rates since last update
        this.updateSpawnRatesFromJunctions(junctionObjectRefs);

        // Calculate per-entry max spawn queue (global divided by number of spawn points)
        const numSpawnPoints = this.routesByEntry.size;
        const maxQueuePerEntry = numSpawnPoints > 0 ? this.cfg.spawning.maxSpawnQueue / numSpawnPoints : this.cfg.spawning.maxSpawnQueue;

        // Accumulate demand at each spawn point
        const SPAWN_TICK = 1 / 60;
        this.spawnAccumulator = (this.spawnAccumulator ?? 0) + dt;
        const spawnTicks = Math.floor(this.spawnAccumulator / SPAWN_TICK);
        this.spawnAccumulator -= spawnTicks * SPAWN_TICK;

        for (const [entryKey, rate] of this.spawnRatesPerEntry.entries()) {
            const currentDemand = this.spawnDemandPerEntry.get(entryKey) || 0;
            const newDemand = currentDemand + rate * (spawnTicks * SPAWN_TICK);
            
            // Cap demand at the per-entry maximum
            this.spawnDemandPerEntry.set(entryKey, Math.min(newDemand, maxQueuePerEntry));
        }

        // Try to spawn from each entry (sorted by stable key for determinism)
        const sortedEntries = Array.from(this.spawnDemandPerEntry.entries()).sort((a, b) => {
                const ka = this.entryRngKeys.get(a[0]) ?? a[0];
                const kb = this.entryRngKeys.get(b[0]) ?? b[0];
                return ka < kb ? -1 : ka > kb ? 1 : 0;
            }
        );

        let totalAttempts = 0;
        for (const [entryKey, demand] of sortedEntries) {
            const vehiclesToSpawn = Math.floor(demand);
            
            // If theres space and vehicles to spawn, attempt to do it
            if (vehiclesToSpawn > 0 && this.vehicles.length < this.cfg.spawning.maxVehicles) {
                let spawned = 0;
                let attempts = 0;
                
                while (
                    spawned < vehiclesToSpawn &&
                    this.vehicles.length < this.cfg.spawning.maxVehicles &&
                    attempts < this.cfg.spawning.maxSpawnAttemptsPerFrame &&
                    totalAttempts < this.cfg.spawning.maxSpawnAttemptsPerFrame * 3
                ) {
                    // Keep trying until maxAttemtps
                    attempts++;
                    totalAttempts++;
                    const ok = this.trySpawnFromEntry(entryKey);
                    if (ok) {
                        spawned++;
                        
                        // Subtract the spawned vehicle from demand
                        this.spawnDemandPerEntry.set(entryKey, demand - spawned);
                    } 
                    else {
                        break; // Can't spawn from this entry right now
                    }
                }
            }
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
                const segDists = this.getSegmentDistances(v.route);
                const segInfo = segDists[v.segmentIndex];
                
                // Considers vehicle waiting if its within this distance to stop line and less than 0.2 speed
                const nearStop = (segInfo?.s1 ?? 0) - v.s < 5.0;
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
                    const c = this.junctionCounters.get(existing.jid) ?? { entered: 0, exited: 0, blockedDownstream: 0, totalWaitTime: 0, waitCount: 0 };
                    c.totalWaitTime += waitDuration;
                    c.waitCount += 1;
                    this.junctionCounters.set(existing.jid, c);
                    this.vehicleWaitStart.delete(v.id);
                }
            }
        }
        
        // Clean up wait tracking for despawned vehicles
        for (const [vid] of this.vehicleWaitStart) {
            if (!this.vehicles.some(v => v.id === vid)) {
                this.vehicleWaitStart.delete(vid);
            }
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
     * @param v Vehicle to perform calcualtion on
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
        for (const v of this.vehicles) {
            const arr = vehiclesByRoute.get(v.route) ?? [];
            arr.push(v);
            vehiclesByRoute.set(v.route, arr);
        }

        for (const vehicles of vehiclesByRoute.values()) {
            vehicles.sort((a, b) => b.s - a.s);
        }

        // Same for each lane
        const lanes = new Map<string, LaneOcc[]>();
        
        for (const v of this.vehicles) {
            if (v.laneKey) {
                const arr = lanes.get(v.laneKey) ?? [];
                arr.push({ v });
                lanes.set(v.laneKey, arr);
            }

            // This step prevents gridlocks by pinning a ghost copy at the start of the inside segment whilst a car is moving through it
            if (v.currentSegment?.phase === "inside") {
                const exitLaneKey = this.getExitLaneKeyForVehicle(v);
                if (exitLaneKey && this.shouldReserveExitLane(v) && !this.isRoundaboutLaneKey(v.laneKey)) {
                    const arr = lanes.get(exitLaneKey) ?? [];
                    arr.push({ v, pinnedCoord: this.laneStartCoordForExitLane(exitLaneKey, v) });
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
                const v = routeVehicles[i];
                
                // Roundabout has slightly different logic so we need to check
                const isRoundaboutInside = v.currentSegment?.phase === "inside" && this.isRoundaboutLaneKey(v.laneKey);
                
                // Update whether a vehicle is exiting inside a roundabout
                if (isRoundaboutInside && v.laneKey) {
                    const jId = this.roundaboutIdFromLaneKey(v.laneKey);
                    const ctrl = this.roundaboutControllers.get(jId);

                    if (ctrl) {
                        const nextSeg = v.route.segments[v.segmentIndex + 1];
                        let isExiting = false;

                        // Check if we are physically close to the exit
                        if (nextSeg && nextSeg.phase === "exit") {
                            const dist = this.getDistToSegmentEnd(v);
                            if (dist < 15) {
                                isExiting = true;
                            }
                        }

                        // Notify the controller so waiting cars know we are leaving
                        // (Make sure you added setVehicleExiting to RoundaboutController class!)
                        ctrl.setVehicleExiting(v.id, isExiting);
                    }
                }
                let leader: Vehicle | null = null;
                let leaderGap = Infinity;

                if (i > 0) {
                    const sameRouteLead = routeVehicles[i - 1];
                    if (isRoundaboutInside && sameRouteLead.currentSegment?.phase === "exit") {
                        
                        // Find how far in front the next car is from within a roundabout using euclidean distance as cant use desiredS
                        const worldDist = v.model.position.distanceTo(sameRouteLead.model.position);
                        const worldGap = worldDist - 0.5 * (sameRouteLead.length + v.length);

                        const leadS = desiredS.get(sameRouteLead) ?? sameRouteLead.s;
                        const sGap = (leadS - v.s) - 0.5 * (sameRouteLead.length + v.length);

                        const gap = Math.max(worldGap, sGap);
                        if (gap < leaderGap && gap > -v.length) {
                            leaderGap = gap;
                            leader = sameRouteLead;
                        }
                    } 
                    else {
                        
                        // Find how far in front next car is from outside a roundabout using desiredS as geometry is ok
                        const leadS = desiredS.get(sameRouteLead) ?? sameRouteLead.s;
                        const gap = (leadS - v.s) - 0.5 * (sameRouteLead.length + v.length);
                        if (gap < leaderGap && gap > -v.length) {
                            leaderGap = gap;
                            leader = sameRouteLead;
                        }
                    }
                }

                // Find leader for same lane but different route

                // As above, leader detection is done differently in roundabout
                const distToSegEnd = this.getDistToSegmentEnd(v);
                const nearingExit = isRoundaboutInside && distToSegEnd < 5;

                // If vehicles share same lane key
                if (v.laneKey) {
                    const laneOccs = lanes.get(v.laneKey) ?? [];

                    if (this.isRoundaboutLaneKey(v.laneKey) && !nearingExit) {
                        
                        // USe roundabout leader function instead of below
                        const roundaboutLeader = this.findRoundaboutLeader(v, laneOccs);
                        if (roundaboutLeader && roundaboutLeader.gap < leaderGap) {
                            leaderGap = roundaboutLeader.gap;
                            leader = roundaboutLeader.leader;
                        }
                    } 
                    else if (!this.isRoundaboutLaneKey(v.laneKey)) {
                        const myCoord = this.laneCoord(v);

                        for (const occ of laneOccs) {
                            const other = occ.v;
                            
                            // Filter out self and same route vehicles (done already)
                            if (other === v || other.route === v.route) {
                                continue;
                            }

                            // Skip cars behind
                            const otherCoord = this.occCoord(occ, v.laneKey, desiredS);
                            if (otherCoord <= myCoord) {
                                continue;
                            }

                            // Same logic as same route leader
                            const gap = (otherCoord - myCoord) - 0.5 * (other.length + v.length);
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
                    lookaheadResult = this.findLeaderInUpcomingSegments(v, lanes, desiredS);
                    if (lookaheadResult && lookaheadResult.gap < leaderGap) {
                        leaderGap = lookaheadResult.gap;
                        leader = lookaheadResult.leader;
                    }
                }

                // If car nearing end of segment, get appropriate speed for next segment e.g., corner speed
                let desiredSpeedCap = v.preferredSpeed;
                if (!isRoundaboutInside && lookaheadResult && lookaheadResult.gap < this.stoppingDistance(v.speed, v) + 5) {
                    const boundarySpeedCap = this.getSegmentBoundarySpeedCap(v);
                    desiredSpeedCap = Math.min(desiredSpeedCap, boundarySpeedCap);
                }

                // Look ahead and see what speed we need to go at to stop in time for obstacle
                const stoplineSpeed = this.applyStoplineAndDownstreamCap(v, desiredSpeedCap, lanes, desiredS);

                // If we are approaching an object then apply the minimum of ideal and necessary
                if (v.currentSegment?.phase === "approach") {
                    desiredSpeedCap = Math.min(desiredSpeedCap, stoplineSpeed);
                }

                let stoplineS: number | null = null;

                // Find position of stop point if we need to stop
                if (v.currentSegment?.phase === "approach" && stoplineSpeed < v.preferredSpeed) {
                    stoplineS = this.getStoplineS(v);
                } 
                else if (v.currentSegment?.phase === "approach") {
                  
                    const jKey = v.currentSegment?.to?.structureID;
                  
                    // Roundabout logic slightly different
                    if (jKey && this.roundaboutControllers.has(jKey)) {
                        const ctrl = this.roundaboutControllers.get(jKey)!;
                  
                        // If there is no safe gap then car stops at roundabout stop line
                        if (!ctrl.isCommitted(v.id)) {
                            stoplineS = this.getStoplineS(v);
                        }
                  
                    }
                } 
                else if (v.currentSegment?.phase === "link") {
                    
                    // Looks at next approach segment and identifies where the next stop point is
                    const upcoming = this.getUpcomingStoplineForLink(v, lanes);
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
                    const stoplineGap = stoplineS - v.s;
                    if (!effectiveLeader || stoplineGap < effectiveLeaderGap) {
                        effectiveLeader = null; 
                        effectiveLeaderGap = stoplineGap;
                        effectiveLeaderSpeed = 0;
                    }
                }

                // Calculates speed and acceleration based on who car is following, how far away, and speed limit
                const accel = this.computeIdmAccel(
                    v, desiredSpeedCap, effectiveLeaderSpeed,
                    Number.isFinite(effectiveLeaderGap) ? effectiveLeaderGap : null
                );

                v.speed = Math.max(0, Math.min(v.speed + accel * dt, v.preferredSpeed));
                let newS = v.s + v.speed * dt;

                // Need this since using useFrame; sim runs in discrete time steps so stuff may be missed or act too late
                if (stoplineS !== null && Number.isFinite(stoplineS) && newS > stoplineS && !isRoundaboutInside) {
                    const maxSpeedToLine = Math.max(0, stoplineS - v.s) / Math.max(1e-6, dt);
                    v.speed = Math.min(v.speed, maxSpeedToLine);
                    newS = stoplineS;
                }

                // In event of IDM acceleration being too weak, just force stop vehicle
                if (leader) {
                    
                    // Inside roundabouts
                    if (isRoundaboutInside && !nearingExit) {
                        const myPos = this.getPointAtS(v.route, newS);
                        const leaderPos = leader.model.position;
                        if (myPos) {
                            const jId = this.roundaboutIdFromLaneKey(v.laneKey);
                            const rMeta = this.roundaboutMeta.get(jId);
                            let shouldCheck = true;
                            if (rMeta) {
                                
                                // Calculate radiual distance from centre of roundabout for this and leader
                                const myR = Math.hypot(myPos.x - rMeta.center.x, myPos.z - rMeta.center.z);
                                const leadR = Math.hypot(leaderPos.x - rMeta.center.x, leaderPos.z - rMeta.center.z);
                                const lw = this.roundaboutLaneWidth(jId);
                                const outerR = rMeta.laneMidRadii.length > 0 ? rMeta.laneMidRadii[rMeta.laneMidRadii.length - 1] : rMeta.avgRadius;

                                // If leader outside outer edge, it has left so dont care anymore
                                if (leadR > outerR + lw * 1.5) {
                                    shouldCheck = false;
                                }

                                // If roundabout has multiple lanes, check if we are in same lane
                                else if (rMeta.laneMidRadii.length >= 2) {
                                    const myLane = this.nearestRingLaneIndex(rMeta.laneMidRadii, myR);
                                    const leadLane = this.nearestRingLaneIndex(rMeta.laneMidRadii, leadR);
                                    
                                    // More than one lane away, not a threat
                                    if (Math.abs(myLane - leadLane) > 1) {
                                        shouldCheck = false;
                                    }
                                }
                            }

                            // If car is a threat still then check actual 3D distances
                            if (shouldCheck) {
                                
                                // Calculate bumper to bumper distance
                                const bumpGap = myPos.distanceTo(leaderPos) - 0.5 * (leader.length + v.length);
                                const safeGap = bumpGap - this.cfg.spacing.minBumperGap;
                                
                                // Override if distance is too small
                                if (safeGap < 0) {
                                    const idmA = this.computeIdmAccel(v, v.preferredSpeed, leader.speed, Math.max(0, bumpGap));
                                    v.speed = Math.max(0, v.speed + idmA * dt);
                                    newS = v.s + v.speed * dt;
                                }
                            }
                        }
                    }
                    
                    // Otherwise standard intersections and roads 
                    else {
                        
                        // If leader on same route
                        if (leader.route === v.route) {
                            const leaderS = desiredS.get(leader) ?? leader.s;

                            // Calcualte the absolute s coorindate where we would hit their read bumper
                            const minSafeS = leaderS - 0.5 * (leader.length + v.length) - this.cfg.spacing.minBumperGap;
                            
                            // If projected move crossed into their bumper
                            if (newS > minSafeS) {
                                const idmA = this.computeIdmAccel(v, v.preferredSpeed, leader.speed, Math.max(0, minSafeS - v.s));
                                v.speed = Math.max(0, v.speed + idmA * dt);
                                newS = Math.min(v.s + v.speed * dt, minSafeS);
                            }
                        }
                        // Otherwise merged into out lane from different route
                        else {
                            if (this.estimateGapAfterMove(v, newS, leader, desiredS) < this.cfg.spacing.minBumperGap) {
                                const curGap = this.estimateGapAfterMove(v, v.s, leader, desiredS);
                                const idmA = this.computeIdmAccel(v, v.preferredSpeed, leader.speed, Math.max(0, curGap));
                                v.speed = Math.max(0, v.speed + idmA * dt);
                                newS = v.s + v.speed * dt;
                            }
                        }
                    }
                }

                // Roundabout lane changing checks (actively circulating a roundabout)
                if (isRoundaboutInside && !nearingExit && v.laneKey) {
                    const jId = this.roundaboutIdFromLaneKey(v.laneKey);
                    const rMeta = this.roundaboutMeta.get(jId);
                    
                    if (rMeta) {
                        
                        // Calculate exact angle around the centre of the roundabout circle
                        const myPos = this.getPointAtS(v.route, newS) ?? v.model.position;
                        const myAngle = Math.atan2(myPos.z - rMeta.center.z, myPos.x - rMeta.center.x);
                        const laneOccs = lanes.get(v.laneKey) ?? [];

                        // Has vehicle recently entered the roundabout and from which road
                        const { recentlyEntered: iAmRecentlyEntered, entryKey: myEntryKey } = this.getRoundaboutEntryStatus(v);

                        // Iterate through lane occupencies checking each car with respect to us
                        for (const occ of laneOccs) {
                            
        
                            const other = occ.v;
                            
                            // Skip us                    
                            if (other === v || other === leader || other.currentSegment?.phase !== "inside") {
                                continue;
                            }

                            // Ask same question as above for other car
                            const { recentlyEntered: otherRecentlyEntered, entryKey: otherEntryKey } = this.getRoundaboutEntryStatus(other);

                            // Skip vehicles that recently entered from the exact same arm as us
                            if (iAmRecentlyEntered && otherRecentlyEntered && myEntryKey && myEntryKey === otherEntryKey) {
                                continue; 
                            }


                            // Caclulate distances between the other car and us 
                            const myR = Math.hypot(myPos.x - rMeta.center.x, myPos.z - rMeta.center.z);
                            const otherR = Math.hypot(other.model.position.x - rMeta.center.x, other.model.position.z - rMeta.center.z);
                            const myLane = this.nearestRingLaneIndex(rMeta.laneMidRadii, myR);
                            const otherLane = this.nearestRingLaneIndex(rMeta.laneMidRadii, otherR);
                            const dist = myPos.distanceTo(other.model.position);
                            
                            // Min distance before we consider it a merge crash inner -> outer lane problem
                            const softMinDist = 0.5 * (v.length + other.length) + this.cfg.spacing.minBumperGap + 1.0;
                            if (Math.abs(myLane - otherLane) > 0) {
                                continue;
                            }

                            if (dist < softMinDist) {
                                let shouldGiveWay: boolean;

                                // Giving way matrix

                                if (iAmRecentlyEntered && !otherRecentlyEntered) {
                                    shouldGiveWay = true; // Rule 1: I am merging in, they are already established in ring so i must give way
                                } 
                                else if (!iAmRecentlyEntered && otherRecentlyEntered) {
                                    shouldGiveWay = false; // Rule 2: I am established, the are trying to merge into my side so i must give way
                                } 
                                else {
                                    // Rule 3: We are both established so who gives way? Whoever is further behind the other on the circle
                                    const otherAngle = Math.atan2(other.model.position.z - rMeta.center.z, other.model.position.x - rMeta.center.x);
                                    const angDelta = THREE.MathUtils.euclideanModulo(otherAngle - myAngle, Math.PI * 2);
                                    shouldGiveWay = (angDelta > 0.01 && angDelta < Math.PI) || (angDelta <= 0.01 && v.id > other.id);
                                }

                                // If the above yield we need to give way, we need to hit the brakes
                                if (shouldGiveWay) {
                                    const bumpGapOv = dist - 0.5 * (v.length + other.length);
                                    const idmAov = this.computeIdmAccel(v, v.preferredSpeed, other.speed, Math.max(0, bumpGapOv));
                                    v.speed = Math.max(0, v.speed + idmAov * dt);
                                    newS = v.s + v.speed * dt;
                                    break;
                                }
                            }
                        }
                    }
                }

                // Commit final state
                desiredS.set(v, newS);
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

        const other = occ.v;
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

        // Doesnt run at end of route (not a segment is next)
        if (currentSeg.phase !== "link") return null;

        // Identify target lane
        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        const distToSegEnd = Math.max(0, (segInfo?.s1 ?? 0) - v.s);

        // Find maximum look ahead distance based on speed
        const brakingDist = this.stoppingDistance(v.speed, v);
        const lookaheadDist = Math.max(brakingDist + 10, 30);

        const nextSegIdx = v.segmentIndex + 1;
        if (nextSegIdx >= segs.length) return null;

        // Identify target lane
        const nextSeg = segs[nextSegIdx];
        const nextLaneKey = this.laneKeyForSegment(nextSeg);
        if (!nextLaneKey) return null;

        const laneOccs = lanes.get(nextLaneKey) ?? [];

        let closestLeader: Vehicle | null = null;
        let closestGap = Infinity;

        
        // Scan through lane occupancies to determine the leader
        for (const occ of laneOccs) {
            const other = occ.v;
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
        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        const distToSegEnd = Math.max(0, (segInfo?.s1 ?? 0) - v.s);
        const cautionZone = this.stoppingDistance(v.preferredSpeed, v) + 5;

        // Get car back down to preffered speed
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
            if (this.isRoundaboutLaneKey(follower.laneKey)) {
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


    /**
     * Uses suvat equation to calculate the correct accelleration based on vehicle speed and gap
     * @param v Current vehicle
     * @param desiredSpeed The speed the car wants to travel at
     * @param leaderSpeed The speed of the car in front
     * @param gap How big the gap between the cars are
     * @returns The new acceleration the car should apply
     */
    private computeIdmAccel(
        v: Vehicle,
        desiredSpeed: number,
        leaderSpeed: number | null,
        gap: number | null
    ): number {

        const v0 = Math.max(0.1, desiredSpeed);
        const a = Math.max(0.1, v.maxAccel);
        const b = Math.max(0.1, this.cfg.motion.comfortDecel);
        const delta = 4;
        const s0 = Math.max(0.5, this.cfg.spacing.minBumperGap);
        const T = Math.max(0.5, v.timeHeadway);

        // Calculate acceleration when road is empty (+ve acelleration part)
        const freeRoadTerm = 1 - Math.pow(v.speed / v0, delta);

        if (gap === null || !Number.isFinite(gap) || gap <= 0 || leaderSpeed === null) {
            return Math.max(-v.maxDecel, Math.min(a * freeRoadTerm, a));
        }

        // Brake part
        const dv = v.speed - leaderSpeed;
        const sStar = s0 + Math.max(0, v.speed * T + (v.speed * dv) / (2 * Math.sqrt(a * b)));
        const interaction = Math.pow(sStar / Math.max(0.1, gap), 2);

        // Finds sum of +ve and -ve acceleration
        const accel = a * (freeRoadTerm - interaction);

        return Math.max(-v.maxDecel, Math.min(accel, a));
    }


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
        if (!v.laneKey || !this.isRoundaboutLaneKey(v.laneKey)) {
            return null;
        }

        const junctionId = this.roundaboutIdFromLaneKey(v.laneKey);
        const meta = this.roundaboutMeta.get(junctionId);
        if (!meta) {
            return null;
        }

        const laneWidth = this.roundaboutLaneWidth(junctionId);

        // Ring radius bounds
        const outerR = meta.laneMidRadii.length > 0 ? meta.laneMidRadii[meta.laneMidRadii.length - 1] : meta.avgRadius;
        const innerR = meta.laneMidRadii.length > 0 ? meta.laneMidRadii[0] : meta.avgRadius;
        const ringTolerance = laneWidth * 1.5;

        // Where is the vehicle on roundabout circle
        const myPos = v.model.position;
        const myDx = myPos.x - meta.center.x;
        const myDz = myPos.z - meta.center.z;
        const myR = Math.sqrt(myDx * myDx + myDz * myDz);
        const myAngle = Math.atan2(myDz, myDx);

        // If this vehicle is already off the ring (exit blend), skip ring leader search
        if (myR > outerR + ringTolerance || myR < innerR - ringTolerance) {
            return null;
        }

        const myLaneIdx = this.nearestRingLaneIndex(meta.laneMidRadii, myR);

        const TAU = Math.PI * 2;
        let bestArcDist = Infinity;
        let bestWorldDist = Infinity;
        let bestLeader: Vehicle | null = null;

        // Determine if car has recently entered roundabout
        const { recentlyEntered: iAmRecentlyEnteredRL, entryKey: myEntryKeyRL } = this.getRoundaboutEntryStatus(v);

        for (const occ of laneOccs) {
            const other = occ.v;
            
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
                    continue; // both near entry — skip
                }
            }

            const otherPos = other.model.position;
            const otherDx = otherPos.x - meta.center.x;
            const otherDz = otherPos.z - meta.center.z;
            const otherR = Math.sqrt(otherDx * otherDx + otherDz * otherDz);

            // Skip vehicles that have drifted off the ring
            if (otherR > outerR + ringTolerance || otherR < innerR - ringTolerance) {
                continue;
            }

            const otherLaneIdx = this.nearestRingLaneIndex(meta.laneMidRadii, otherR);
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
            const arcDist = angularDelta * meta.avgRadius;
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


    /**
     * Checks if a lanekey is on a roundabout
     * @param laneKey The key to check
     * @returns True or false depending on the answer
     */
    private isRoundaboutLaneKey(laneKey: string): boolean {
        return laneKey.startsWith("lane:roundabout:");
    }


    /**
     * Extracts the object ID from a lanekey for a roundabout
     * @param laneKey Roundabout lane key
     * @returns The object ID
     */
    private roundaboutIdFromLaneKey(laneKey: string): string {
        // lane:roundabout:UUID -> UUID
        return laneKey.replace("lane:roundabout:", "");
    }

    

    private roundaboutCoordFromWorldPos(junctionId: string, pos: THREE.Vector3): number {
        const meta = this.roundaboutMeta.get(junctionId);
        if (!meta) {
            // Missing metadata for this junction — cannot compute coord
            return 0;
        }

        const dx = pos.x - meta.center.x;
        const dz = pos.z - meta.center.z;
        const angle = Math.atan2(dz, dx);
        const TAU = Math.PI * 2;
        const wrapped = THREE.MathUtils.euclideanModulo(angle, TAU);
        return wrapped * meta.avgRadius;
    }

    /** Compute average lane width for a roundabout from its radii metadata */
    private roundaboutLaneWidth(junctionId: string): number {
        const meta = this.roundaboutMeta.get(junctionId);
        if (!meta || meta.laneMidRadii.length < 2) {
            // Fallback lane width when insufficient metadata is available
            return 3.0;
        }

        const outer = meta.laneMidRadii[meta.laneMidRadii.length - 1];
        const inner = meta.laneMidRadii[0];
        const total = Math.abs(outer - inner);
        const div = Math.max(1, meta.laneMidRadii.length - 1);
        return total / div;
    }

    /**
     * Find which discrete ring lane index a given radius falls into.
     * Returns the index into `laneMidRadii` whose value is closest to `radius`.
     */
    private nearestRingLaneIndex(laneMidRadii: number[], radius: number): number {
        if (laneMidRadii.length <= 1) {
            // Only one (or zero) rings — always index 0
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

    private roundaboutCoordFromS(v: Vehicle, sValue: number): number {
        const laneKey = v.laneKey;
        if (!laneKey || !this.isRoundaboutLaneKey(laneKey)) {
            // Not a roundabout lane — fall back to linear s-coordinate
            return sValue;
        }

        const junctionId = this.roundaboutIdFromLaneKey(laneKey);

        const pos = this.getPointAtS(v.route, sValue);
        if (!pos) {
            // Cannot determine world position at this s — return input
            return sValue;
        }

        return this.roundaboutCoordFromWorldPos(junctionId, pos);
    }

    // -----------------------
    // Lane coordinate system
    // -----------------------

    private laneCoord(v: Vehicle): number {
        return this.laneCoordFromS(v, v.s);
    }

    private laneCoordFromS(v: Vehicle, sValue: number): number {
        const seg = v.currentSegment;
        if (!seg || !v.laneKey) {
            // Missing segment or lane key — cannot convert, return sValue
            return sValue;
        }

        if (this.isRoundaboutLaneKey(v.laneKey)) {
            return this.roundaboutCoordFromS(v, sValue);
        }

        const segId = segmentId(seg);
        const base = this.laneBases.get(v.laneKey)?.get(segId) ?? 0;
        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        return base + (sValue - (segInfo?.s0 ?? 0));
    }

    private buildLaneBases() {
        this.laneBases.clear();

        const perLane = new Map<string, Map<string, RouteSegment>>();

        for (const r of this.routes) {
            for (const seg of r.segments ?? []) {
                const laneKey = this.laneKeyForSegment(seg);
                if (!laneKey) continue;
                const id = segmentId(seg);

                const laneMap = perLane.get(laneKey) ?? new Map<string, RouteSegment>();
                if (!laneMap.has(id)) laneMap.set(id, seg);
                perLane.set(laneKey, laneMap);
            }
        }

        for (const [laneKey, segMap] of perLane.entries()) {
            const segs = Array.from(segMap.values());
            const ids = segs.map((s) => segmentId(s));

            const next = new Map<string, string[]>();
            const indeg = new Map<string, number>();
            for (const id of ids) {
                next.set(id, []);
                indeg.set(id, 0);
            }

            for (const a of segs) {
                for (const b of segs) {
                    if (a === b) continue;
                    if (nodeKeyOf(a.to) === nodeKeyOf(b.from)) {
                        const aid = segmentId(a);
                        const bid = segmentId(b);
                        next.get(aid)!.push(bid);
                        indeg.set(bid, (indeg.get(bid) ?? 0) + 1);
                    }
                }
            }

            const bases = new Map<string, number>();
            const q: string[] = [];

            for (const [id, d] of indeg.entries()) {
                if (d === 0) {
                    bases.set(id, 0);
                    q.push(id);
                }
            }

            while (q.length) {
                const id = q.shift()!;
                const seg = segMap.get(id)!;
                const base = bases.get(id) ?? 0;
                const len = segmentLen(seg);

                for (const nid of next.get(id) ?? []) {
                    if (!bases.has(nid)) {
                        bases.set(nid, base + len);
                        q.push(nid);
                    }
                }
            }

            for (const id of ids) {
                if (!bases.has(id)) {
                    bases.set(id, 0);
                }
            }

            this.laneBases.set(laneKey, bases);
        }

        this.laneBasesBuilt = true;
    }

    // -----------------------
    // Helper methods for per-entry spawning
    // -----------------------

    /** Build a map of routes grouped by entry point (structureID-exitIndex) */
    private buildRoutesByEntry(): void {
        this.routesByEntry.clear();
        // Don't clear entryRngKeys here — they are rebuilt by
        // buildJunctionStableKeys() once junction groups are available.

        for (const route of this.routes) {
            const firstSeg = route.segments?.[0];
            if (!firstSeg) continue;

            const entryKey = `${firstSeg.from.structureID}-${firstSeg.from.exitIndex}`;

            if (!this.routesByEntry.has(entryKey)) {
                this.routesByEntry.set(entryKey, []);
            }
            this.routesByEntry.get(entryKey)!.push(route);
        }
    }

    /**
     * Build stable, config-hash-based keys for every entry point.
     * The key encodes the junction TYPE + CONFIG (excluding the random UUID)
     * so that two browser tabs with the same layout always produce the
     * same RNG sequences, even when the underlying structureIDs differ.
     *
     * To disambiguate identical junctions (same type + config), junctions
     * with the same config hash are sub-indexed by their world-position
     * sort order (x then z).  This relative ordering is robust even if
     * positions have small floating-point differences between tabs.
     */
    private buildJunctionStableKeys(
        junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>
    ): void {
        if (this.junctionStableKeysBuilt) return;

        const groups = junctionObjectRefs.current;
        if (!groups || groups.length === 0) return;

        // Collect unique structureIDs referenced by routes
        const structureIDs = new Set<string>();
        for (const r of this.routes) {
            for (const seg of r.segments ?? []) {
                structureIDs.add(seg.from.structureID);
                structureIDs.add(seg.to.structureID);
            }
        }

        // For each structureID, compute a config hash from the junction group userData
        const idToHash = new Map<string, string>();
        const idToPos = new Map<string, { x: number; z: number }>();

        for (const sid of structureIDs) {
            const g = groups.find((grp) => grp?.userData?.id === sid);
            if (!g) continue;

            // Serialise the config-relevant userData fields (exclude id)
            const configObj: Record<string, unknown> = {
                type: g.userData.type ?? "unknown",
                exitConfig: g.userData.exitConfig ?? [],
            };
            const configHash = hashString(JSON.stringify(configObj)).toString(36);
            idToHash.set(sid, configHash);

            // World position for sub-index tiebreaker
            const wp = new THREE.Vector3();
            g.getWorldPosition(wp);
            idToPos.set(sid, { x: wp.x, z: wp.z });
        }

        // Group structureIDs by their config hash
        const hashGroups = new Map<string, string[]>();
        for (const [sid, ch] of idToHash.entries()) {
            const arr = hashGroups.get(ch) ?? [];
            arr.push(sid);
            hashGroups.set(ch, arr);
        }

        // Within each group, sort by world position (x then z) → assign sub-index
        for (const [ch, sids] of hashGroups.entries()) {
            sids.sort((a, b) => {
                const pa = idToPos.get(a)!;
                const pb = idToPos.get(b)!;
                // Round to 0 dp — only the RELATIVE order matters, not the exact value
                const ax = Math.round(pa.x), az = Math.round(pa.z);
                const bx = Math.round(pb.x), bz = Math.round(pb.z);
                return ax !== bx ? ax - bx : az - bz;
            });
            for (let i = 0; i < sids.length; i++) {
                this.junctionStableKeys.set(sids[i], `${ch}:${i}`);
            }
        }

        // Rebuild entryRngKeys from junctionStableKeys
        this.entryRngKeys.clear();
        this.entryRNGs.clear(); // force re-creation with new keys

        for (const [entryKey] of this.routesByEntry.entries()) {
            // entryKey format: "structureID-exitIndex"
            const dashIdx = entryKey.lastIndexOf("-");
            const sid = entryKey.substring(0, dashIdx);
            const exitIdx = entryKey.substring(dashIdx + 1);

            const jStable = this.junctionStableKeys.get(sid);
            if (jStable) {
                this.entryRngKeys.set(entryKey, `cfg:${jStable}:${exitIdx}`);
            } else {
                // Fallback — shouldn't happen, but keeps things working
                this.entryRngKeys.set(entryKey, `entry:${entryKey}`);
            }
        }

        this.junctionStableKeysBuilt = true;
    }

    /** Update spawn rates per entry from junction object configs */
    private updateSpawnRatesFromJunctions(junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>): void {
        if (!junctionObjectRefs.current) return;

        // Clear existing rates (but NOT demand - demand accumulates)
        this.spawnRatesPerEntry.clear();

        // Track valid entry points (those with routes)
        const validEntries = new Set<string>();

        for (const group of junctionObjectRefs.current) {
            if (!group?.userData?.id) continue;
            
            const structureID = group.userData.id as string;
            const exitConfig = group.userData.exitConfig;
            
            if (!exitConfig || !Array.isArray(exitConfig)) continue;
            
            // Set spawn rate for each exit of this junction
            exitConfig.forEach((config: { spawnRate?: number }, exitIndex: number) => {
                const entryKey = `${structureID}-${exitIndex}`;
                
                // Only set spawn rate if this exit has routes starting from it (is a spawn point)
                // Connected exits won't have routes in routesByEntry
                if (!this.routesByEntry.has(entryKey)) {
                    return; // Skip this exit - it's connected to another junction
                }
                
                validEntries.add(entryKey);
                
                // Per-exit override takes priority, otherwise fall back to global SimConfig rate
                const rate = config.spawnRate ?? this.cfg.spawning.spawnRate;
                this.spawnRatesPerEntry.set(entryKey, rate);
                
                // Initialize demand to 0 if this is a new entry
                if (!this.spawnDemandPerEntry.has(entryKey)) {
                    this.spawnDemandPerEntry.set(entryKey, 0);
                }
            });
        }
        
        // Clear demand for entries that are no longer valid spawn points (e.g., now connected)
        for (const entryKey of this.spawnDemandPerEntry.keys()) {
            if (!validEntries.has(entryKey)) {
                this.spawnDemandPerEntry.delete(entryKey);
            }
        }
    }

    // -----------------------
    // Spawning
    // -----------------------

    /**
     * Try to spawn a vehicle from a specific entry point.
     *
     * IMPORTANT FOR SEED REPRODUCIBILITY:
     * The seeded RNG is always advanced by the same number of values per
     * spawn attempt, regardless of whether `hasSpawnSpace` allows the
     * spawn.  This guarantees the Nth spawn attempt at a given entry
     * always produces the same vehicle type / colour / stats, even when
     * earlier attempts were blocked at different times due to frame-rate
     * differences.
     */
    private trySpawnFromEntry(entryKey: string): boolean {
        const routesForEntry = this.routesByEntry.get(entryKey);
        if (!routesForEntry || routesForEntry.length === 0 || !this.carModels.length) return false;

        // Get or create seeded RNG for this entry point
        let rng = this.entryRNGs.get(entryKey);
        if (!rng) {
            // Use position-based stable key instead of UUID-based entryKey
            const stableKey = this.entryRngKeys.get(entryKey) ?? entryKey;
            rng = rngForEntry(this.cfg.simSeed, stableKey);
            this.entryRNGs.set(entryKey, rng);
        }

        // ── Consume a fixed number of RNG values per attempt ──────────
        // Even if the spawn fails (no space), these values are consumed
        // so the sequence stays aligned.
        const rRouteIdx   = rng.nextInt(routesForEntry.length);   // 1
        const rCarClass   = rng.pickCarClass(this.cfg.rendering.enabledCarClasses); // 2 (internally consumes 1)
        const rColourIdx  = rng.next();                           // 3
        const rVariation0 = rng.next();                           // 4
        const rVariation1 = rng.next();                           // 5
        const rVariation2 = rng.next();                           // 6
        const rReaction   = rng.next();                           // 7
        const rHeadway    = rng.next();                           // 8

        // ── Resolve route ─────────────────────────────────────────────
        const route = routesForEntry[rRouteIdx];
        const points = this.getRoutePointsCached(route);
        if (!points || points.length < 2) return false;

        const carClass: CarClass = rCarClass;
        const length = carClass.length;

        // ── Space check (does NOT touch RNG) ─────────────────────────
        if (!this.hasSpawnSpace(route, length)) return false;

        // ── Resolve model (colour variant) ───────────────────────────
        const matchingModels: number[] = [];
        for (let i = 0; i < this.carModels.length; i++) {
            const carFileIdx = this.carModels[i].userData?.carFileIndex as number | undefined;
            if (carFileIdx !== undefined) {
                const bt = bodyTypeForModelIndex(carFileIdx);
                if (bt === carClass.bodyType) matchingModels.push(i);
            }
        }
        // Sort by carFileIndex for deterministic colour order
        matchingModels.sort((a, b) => {
            const ai = (this.carModels[a].userData?.carFileIndex as number) ?? 0;
            const bi = (this.carModels[b].userData?.carFileIndex as number) ?? 0;
            return ai - bi;
        });

        let loadedIndex: number;
        if (matchingModels.length > 0) {
            loadedIndex = matchingModels[Math.floor(rColourIdx * matchingModels.length)];
        } else {
            loadedIndex = Math.floor(rColourIdx * this.carModels.length);
        }
        const template = this.carModels[loadedIndex];
        if (!template) return false;
        const model = template.clone(true);

        // ── Place ────────────────────────────────────────────────────
        const p0 = points[0];
        const p1 = points[1];

        const pos0 = new THREE.Vector3(p0[0], p0[1] + this.cfg.rendering.yOffset, p0[2]);
        const pos1 = new THREE.Vector3(p1[0], p1[1] + this.cfg.rendering.yOffset, p1[2]);

        model.position.copy(pos0);

        const dir = pos1.clone().sub(pos0);
        if (dir.lengthSq() > 1e-6) {
            dir.normalize();
            const yaw = Math.atan2(dir.x, dir.z);
            model.rotation.set(0, yaw, 0);
        }

        this.scene.add(model);

        const v = new Vehicle(this.nextId++, model, route, length, this.cfg.motion.initialSpeed);

        // Apply car-class-specific characteristics from pre-drawn RNG values
        v.maxAccel      = this.cfg.motion.maxAccel  * carClass.accelFactor * (0.9 + rVariation0 * 0.2);
        v.maxDecel      = this.cfg.motion.maxDecel  * carClass.decelFactor * (0.9 + rVariation1 * 0.2);
        v.preferredSpeed = this.cfg.motion.preferredSpeed * carClass.speedFactor * (0.9 + rVariation2 * 0.2);
        v.reactionTime  = 0.15 + rReaction * 0.25;
        v.timeHeadway   = this.cfg.spacing.timeHeadway * (0.8 + rHeadway * 0.4);

        v.s = 0;
        v.segmentIndex = 0;
        v.currentSegment = route.segments?.length ? route.segments[0] : null;
        this.updateVehicleSegment(v);

        v.spawnKey = this.spawnKeyForRoute(route);

        this.vehicles.push(v);
        this.spawned += 1;

        return true;
    }

    private spawnKeyForRoute(route: Route): string {
        const firstSeg = route.segments?.[0];
        const lk = firstSeg ? this.laneKeyForSegment(firstSeg) : "";
        if (lk) return `spawn:${lk}`;

        const points = this.getRoutePointsCached(route);
        const p0 = points[0];
        return `spawnPoint:${p0[0].toFixed(3)},${p0[1].toFixed(3)},${p0[2].toFixed(3)}`;
    }

    private hasSpawnSpace(route: Route, newLen: number): boolean {
        const spawnKey = this.spawnKeyForRoute(route);

        let nearest: Vehicle | null = null;
        let nearestS = Infinity;

        for (const v of this.vehicles) {
            if (v.spawnKey !== spawnKey) continue;

            if (v.s < nearestS) {
                nearestS = v.s;
                nearest = v;
            }
        }

        if (!nearest) return true;

        const brakingDistance = (this.cfg.motion.initialSpeed * this.cfg.motion.initialSpeed) / (2 * this.cfg.motion.maxDecel);
        const timeHeadwayBuffer = this.cfg.motion.initialSpeed * this.cfg.spacing.timeHeadway;

        const safetyBuffer = Math.max(brakingDistance, timeHeadwayBuffer);
        const required = newLen + this.cfg.spacing.minBumperGap + safetyBuffer;

        return nearestS >= required;
    }

    // -----------------------
    // Segment / laneKey tracking
    // -----------------------

    private laneKeyForSegment(seg: RouteSegment): string {
        // For roundabouts: single lane key per roundabout. Vehicles cross ring lanes
        // during gradual merges, so per-ring-lane keys don't work.
        if (seg.phase === "inside") {
            const junctionId = seg.to.structureID;
            const isRoundabout = this.roundaboutControllers.has(junctionId);
            if (isRoundabout) {
                return `lane:roundabout:${junctionId}`;
            }
            return "";  // Normal intersection - ignore inside phase
        }
        const toKey = `${seg.to.structureID}-${seg.to.exitIndex}-${seg.to.direction}-${seg.to.laneIndex}`;
        const fromKey = `${seg.from.structureID}-${seg.from.exitIndex}-${seg.from.direction}-${seg.from.laneIndex}`;
        if (seg.phase === "exit") return `lane:${toKey}`;
        return `lane:${fromKey}`; // link + approach
    }

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
        v.laneKey = this.laneKeyForSegment(v.currentSegment);

        // Update roundabout controller tracking when vehicle enters/exits roundabout
        this.updateRoundaboutTracking(v);
    }

    /**
     * Track vehicles on roundabout and manage commitment state
     */
    private updateRoundaboutTracking(v: Vehicle) {
        const seg = v.currentSegment;
        if (!seg) return;

        const junctionId = seg.to?.structureID ?? seg.from?.structureID;
        if (!junctionId) return;

        const controller = this.roundaboutControllers.get(junctionId);
        if (!controller) return;

        const meta = this.roundaboutMeta.get(junctionId);
        if (!meta) return;

        // If vehicle is in "inside" phase on a roundabout, update its position
        if (seg.phase === "inside" && this.isRoundaboutLaneKey(v.laneKey)) {
            const pos = v.model.position.clone();
            
            // Get the vehicle's heading from its model rotation
            const heading = new THREE.Vector3(0, 0, 1);
            heading.applyQuaternion(v.model.quaternion);
            heading.y = 0;
            heading.normalize();

            // Determine actual lane index from vehicle's distance to center
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
            controller.setGeometry(meta.center, meta.laneMidRadii);
        }
        // If vehicle has exited the roundabout, remove from tracking
        else if (seg.phase === "exit" || seg.phase === "link") {
            controller.removeCirculatingVehicle(v.id);
            controller.clearCommitment(v.id);
        }
    }

    // -----------------------
    // Apply desired s -> pose
    // -----------------------

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

    private buildControllersIfNeeded(
        junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>
    ) {
        if (this.controllersBuilt) return;

        const groups = junctionObjectRefs.current;
        if (!groups || groups.length === 0) {
            // refs not ready yet — try again next frame
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
            // Detect roundabout junctions
            const junctionGroup = junctionObjectRefs.current.find(
                (g) => g?.userData?.id === junctionKey
            );
            const junctionType = junctionGroup?.userData?.type;
            const isRoundabout = isRoundaboutType(junctionKey, junctionType);

            if (isRoundabout) {
                const controller = new RoundaboutController(junctionKey, Array.from(laneSet), () => this.cfg);
                this.roundaboutControllers.set(junctionKey, controller);

                const meta = buildRoundaboutMeta(junctionKey, junctionGroup as THREE.Group | undefined);
                if (meta) {
                    this.roundaboutMeta.set(junctionKey, meta);
                    controller.setGeometry(meta.center, meta.laneMidRadii);
                }
            } else {
                this.intersectionControllers.set(
                    junctionKey,
                    new IntersectionController(junctionKey, Array.from(laneSet), () => this.cfg)
                );
            }

            this.controllersBuilt = true;
        }
    }

    /**
     * FIX:
     * - If red: cap speed so we can stop at the stopline (existing behaviour)
     * - If green: ALSO require downstream space on exit lane, otherwise treat like red (prevents blocking the junction)
     * - Also look ahead from link segments to upcoming stop lines
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
            const segs = v.route.segments;
            if (!segs || v.segmentIndex >= segs.length - 1) return targetSpeed;

            const nextSegIdx = v.segmentIndex + 1;
            const nextSeg = segs[nextSegIdx];
            
            if (nextSeg && nextSeg.phase === "approach") {
                // Calculate distance to the stop line in the next segment
                const segDists = this.getSegmentDistances(v.route);
                const currentSegInfo = segDists[v.segmentIndex];
                const nextSegInfo = segDists[nextSegIdx];
                
                const distToCurrentSegEnd = Math.max(0, (currentSegInfo?.s1 ?? 0) - v.s);
                const nextSegLength = Math.max(0, (nextSegInfo?.s1 ?? 0) - (nextSegInfo?.s0 ?? 0));
                const totalDistToStopline = distToCurrentSegEnd + nextSegLength;
                
                const junctionKey = nextSeg.to.structureID;
                const isRoundabout = this.roundaboutControllers.has(junctionKey);

                // For roundabouts: use the configured decel zone
                // For intersections: use braking distance calculation
                const lookaheadDist = Math.max(this.stoppingDistance(v.speed, v) * 1.5, 20);
                
                if (totalDistToStopline < lookaheadDist) {
                    const controller = this.getController(junctionKey);
                    
                    if (controller) {
                        const entryKey = this.entryGroupKeyFromNodeKey(nodeKeyOf(nextSeg.from));

                        if (isRoundabout) {
                            // Roundabout: check gap availability
                            const roundaboutController = this.roundaboutControllers.get(junctionKey)!;
                            const meta = this.roundaboutMeta.get(junctionKey);
                            
                            if (meta) {
                                const entryAngle = meta.entryAngles.get(entryKey);
                                if (entryAngle !== undefined) {
                                    const radius = meta.avgRadius;
                                    
                                    const canEnter = roundaboutController.canEnterSafely(entryAngle, radius, entryKey);
                                    
                                    if (!canEnter) {
                                        // Need to stop - calculate deceleration
                                        const frontOffset = 0.5 * v.length;
                                        const stopBuffer = this.cfg.spacing.stopLineOffset;
                                        const adjustedDist = totalDistToStopline - frontOffset - stopBuffer;
                                        
                                        if (adjustedDist > 0) {
                                            const decel = v.maxDecel * 0.7;
                                            const vmax = Math.sqrt(2 * decel * adjustedDist);
                                            return Math.min(targetSpeed, vmax);
                                        }
                                        return 0;
                                    }
                                }
                            }
                        } else {
                            // Regular intersection: check light
                            const green = controller.isGreen(entryKey);
                        
                            if (!green) {
                                // Red light ahead - start slowing down
                                const frontOffset = 0.5 * v.length;
                                const stopBuffer = this.cfg.spacing.stopLineOffset;
                                const adjustedDist = totalDistToStopline - frontOffset - stopBuffer;
                            
                                if (adjustedDist > 0) {
                                    const vmax = Math.sqrt(2 * v.maxDecel * adjustedDist);
                                    return Math.min(targetSpeed, vmax);
                                }
                                return 0;
                            }
                        }
                    }
                }
            }
        }

        return targetSpeed;
    }

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
     * New roundabout entry logic with proper gap acceptance and commitment
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

        const meta = this.roundaboutMeta.get(junctionKey);
        if (!meta) return targetSpeed;

        const stopS = this.getStoplineS(v);
        if (stopS === null) return targetSpeed;

        const distToStopline = stopS - v.s;
        const frontBumperS = v.s + 0.5 * v.length;
        const frontBumperDistToLine = stopS + this.cfg.spacing.stopLineOffset - frontBumperS;

        // Check if vehicle is already committed (front bumper has crossed the stopline).
        // Even when committed, keep checking for circulating vehicles that may
        // have moved into the entry path (e.g., lane-changers).  If something
        // is now blocking, brake smoothly rather than blindly charging in.
        if (controller.isCommitted(v.id)) {
            const stillClear = this.isRoundaboutEntryClear(v, junctionKey, entryKey, 0, lanes);
            if (!stillClear) {
                // Something appeared in our path after we committed.
                // Brake hard but smoothly — don't de-commit (we're already
                // partway across), just slow to a crawl until the path clears.
                const decel = v.maxDecel * 0.8;
                const stoppingDist = Math.max(0.1, distToStopline + 2);
                const cappedSpeed = Math.sqrt(2 * decel * stoppingDist);
                return Math.min(targetSpeed, Math.max(0, cappedSpeed));
            }
            return targetSpeed;
        }

        // Get entry parameters for gap checking
        const entryAngle = meta.entryAngles.get(entryKey);
        if (entryAngle === undefined) return targetSpeed;

        // Use average radius - vehicle crosses all lanes at entry point
        const radius = meta.avgRadius;

        // Check if safe to enter using gap-based logic
        const canEnter = controller.canEnterSafely(entryAngle, radius, entryKey);

        // Also check for vehicles physically present on the roundabout
        const physicalClear = this.isRoundaboutEntryClear(v, junctionKey, entryKey, 0, lanes);

        // DEBUG: log entry attempts for first 30s
        if (this.elapsedTime < 30 && distToStopline < 5) {
            const circCount = controller.getState();
            console.log(`[RoundaboutEntry] v${v.id} entry=${entryKey} distToLine=${distToStopline.toFixed(1)} canEnter=${canEnter} physClear=${physicalClear} ${circCount} avgR=${meta.avgRadius.toFixed(1)} entryAngle=${entryAngle.toFixed(2)}`);
        }

        if (canEnter && physicalClear) {
            // Gap is available — commit NOW if at the line, then go.
            // We commit before releasing speed so that even if the gap
            // closes on the next frame, the vehicle is already committed
            // and won't freeze half-out over the stop line.
            if (frontBumperDistToLine <= 0) {
                const entryPosition = controller.getEntryPosition(entryAngle, radius);
                controller.commitVehicle(v.id, entryPosition, entryKey);
            }
            return targetSpeed;
        }

        // Gap NOT clear — hard stop at the stop line.  Never allow the
        // vehicle to creep past where it would stick out into the ring.
        if (distToStopline > 0) {
            const decel = v.maxDecel * 0.7;
            const stoppingSpeed = Math.sqrt(2 * decel * Math.max(0.1, distToStopline));
            return Math.min(targetSpeed, stoppingSpeed);
        }

        // At or past the stop line with no clear gap — full stop.
        return 0;
    }

    /**
     * Check if there are vehicles physically blocking the entry point on the roundabout.
     * Lane-aware: checks proximity at each vehicle's current radius AND detects
     * vehicles that are changing lanes toward the entry path (radial movement
     * toward the outer lane where the entering vehicle will merge).
     */
    private isRoundaboutEntryClear(
        v: Vehicle,
        junctionKey: string,
        entryKey: string,
        entryLaneIndex: number,
        lanes: Map<string, LaneOcc[]>
    ): boolean {
        const meta = this.roundaboutMeta.get(junctionKey);
        if (!meta) return true;

        const entryAngle = meta.entryAngles.get(entryKey);
        if (entryAngle === undefined) return true;

        const laneKey = `lane:roundabout:${junctionKey}`;
        const occs = lanes.get(laneKey) ?? [];
        if (occs.length === 0) return true;

        const clearanceGap = Math.max(v.length * 3, 6);

        const outerR = meta.laneMidRadii.length > 0
            ? meta.laneMidRadii[meta.laneMidRadii.length - 1]
            : meta.avgRadius;
        const outerEntryPos = new THREE.Vector3(
            meta.center.x + Math.cos(entryAngle) * outerR,
            meta.center.y,
            meta.center.z + Math.sin(entryAngle) * outerR
        );

        const innerR = meta.laneMidRadii.length > 0
            ? meta.laneMidRadii[0]
            : meta.avgRadius;
        const innerEntryPos = new THREE.Vector3(
            meta.center.x + Math.cos(entryAngle) * innerR,
            meta.center.y,
            meta.center.z + Math.sin(entryAngle) * innerR
        );

        for (const occ of occs) {
            const other = occ.v;
            if (other.id === v.id) continue;
            const otherNextSeg = other.route.segments[other.segmentIndex + 1];
    
            if (otherNextSeg && otherNextSeg.phase === "exit") {
                // Calculate how far they are from the start of their exit
                // (We reuse your existing helper or calculate manually)
                const segDists = this.getSegmentDistances(other.route);
                const segInfo = segDists[other.segmentIndex];
                const distToExit = segInfo ? (segInfo.s1 - other.s) : Infinity;

                // If they are within 15 meters of exiting, they are "locked in".
                // In real life, we see their blinker or wheel turn.
                if (distToExit < 15) {
                    // OPTIONAL: If you want to be 100% sure they are exiting at YOUR arm
                    // you can check if their exit node matches your entry node.
                    // But usually, just knowing they are exiting is enough to be safe.
                    continue; 
                }
            }
            // ⬇️ REFACTORED: Skip vehicles entering from the SAME arm
            if (other.currentSegment?.phase === "inside") {
                const { recentlyEntered: otherRecentlyEntered, entryKey: otherEntryKey } = this.getRoundaboutEntryStatus(other);
                if (otherRecentlyEntered && otherEntryKey === entryKey) {
                    continue; // They are still near the start of their entry, from our arm
                }
            }

            const otherPos = other.model.position;
            const otherDistFromCenter = Math.sqrt(
                (otherPos.x - meta.center.x) ** 2 +
                (otherPos.z - meta.center.z) ** 2
            );

            // Check 1: proximity at the vehicle's CURRENT radius
            const laneEntryPos = new THREE.Vector3(
                meta.center.x + Math.cos(entryAngle) * otherDistFromCenter,
                meta.center.y,
                meta.center.z + Math.sin(entryAngle) * otherDistFromCenter
            );
            const distance = otherPos.distanceTo(laneEntryPos);
            if (distance < clearanceGap) {
                if (this.elapsedTime < 30) console.log(`[PhysClear] v${v.id} entry=${entryKey}: BLOCKED check1 by v${other.id}`);
                return false;
            }

            // Check 2: distance to the inner entry point
            const distToInnerEntry = otherPos.distanceTo(innerEntryPos);
            if (distToInnerEntry < clearanceGap) {
                if (this.elapsedTime < 30) console.log(`[PhysClear] v${v.id} entry=${entryKey}: BLOCKED check2(inner) by v${other.id}`);
                return false;
            }

            // Check 3: distance to the outer entry point
            const distToOuterEntry = otherPos.distanceTo(outerEntryPos);
            if (distToOuterEntry < clearanceGap) {
                if (this.elapsedTime < 30) console.log(`[PhysClear] v${v.id} entry=${entryKey}: BLOCKED check3(outer) by v${other.id}`);
                return false;
            }

            // Check 4: is this vehicle lane-changing TOWARD the outer lane?
            if (meta.laneMidRadii.length >= 2 && otherDistFromCenter < outerR) {
                const otherFwd = new THREE.Vector3(
                    Math.sin(other.model.rotation.y), 0, Math.cos(other.model.rotation.y)
                );
                const radialOut = new THREE.Vector3(
                    otherPos.x - meta.center.x, 0, otherPos.z - meta.center.z
                ).normalize();
                const radialComponent = otherFwd.dot(radialOut);

                if (radialComponent > 0.1) {
                    const distToOuter = otherPos.distanceTo(outerEntryPos);
                    const laneChangeClearance = clearanceGap * 1.5;
                    if (distToOuter < laneChangeClearance) return false;
                }

                // ⬇️ REFACTORED: Nearing the end of inside segment?
                const otherDistToSegEnd = this.getDistToSegmentEnd(other);
                if (otherDistToSegEnd < 8) {
                    const distToOuter = otherPos.distanceTo(outerEntryPos);
                    if (distToOuter < clearanceGap * 1.5) return false;
                }
            }
        }

        return true;
    }

    private capToStopline(v: Vehicle, targetSpeed: number): number {
        const frontOffset = 0.5 * v.length;

        // additional buffer so cars stop *before* the stop line
        const stopBuffer = this.cfg.spacing.stopLineOffset;

        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        const stopS = (segInfo?.s1 ?? 0) - frontOffset - stopBuffer;

        const dist = stopS - v.s;
        if (dist <= 0) return 0;

        const vmax = Math.sqrt(2 * v.maxDecel * dist);
        return Math.min(targetSpeed, vmax);
    }

    private getStoplineS(v: Vehicle): number | null {
        const frontOffset = 0.5 * v.length;
        const stopBuffer = this.cfg.spacing.stopLineOffset;

        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        if (!segInfo) return null;

        return (segInfo.s1 ?? 0) - frontOffset - stopBuffer;
    }

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
        const currentSegInfo = segDists[v.segmentIndex];
        const nextSegInfo = segDists[nextSegIdx];

        const distToCurrentSegEnd = Math.max(0, (currentSegInfo?.s1 ?? 0) - v.s);
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
            const meta = this.roundaboutMeta.get(junctionKey);
            
            if (meta) {
                const entryAngle = meta.entryAngles.get(entryKey);
                if (entryAngle !== undefined) {
                    const radius = meta.avgRadius;
                    
                    const canEnter = controller.canEnterSafely(entryAngle, radius, entryKey);
                    const physicalClear = this.isRoundaboutEntryClear(v, junctionKey, entryKey, 0, lanes);
                    
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



    /** Determine which *physical exit lane* this vehicle will go onto (first non-"inside" segment ahead). */
    private getExitLaneKeyForVehicle(v: Vehicle): string {
        const segs = v.route.segments ?? [];
        if (!segs.length) return "";

        for (let i = v.segmentIndex + 1; i < segs.length; i++) {
            const s = segs[i];
            if (s.phase === "inside") continue;

            const lk = this.laneKeyForSegment(s);
            return lk ?? "";
        }
        return "";
    }

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

    private shouldReserveExitLane(v: Vehicle): boolean {
        if (v.currentSegment?.phase !== "inside") return false;

        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        if (!segInfo) return false;

        const distToSegEnd = Math.max(0, (segInfo.s1 ?? 0) - v.s);
        const reserveThreshold = Math.max(v.length * 1.5, this.cfg.spacing.minBumperGap * 2, 3);

        return distToSegEnd <= reserveThreshold;
    }

    

    private entryGroupKeyFromNodeKey(nodeKey: string): string {
        const parts = nodeKey.split("-");
        if (parts.length < 4) return `entry:${nodeKey}`;
        const uuid = parts.slice(0, 5).join("-");
        const exit = parts[5];
        const dir = parts[6];
        return `entry:${uuid}-${exit}-${dir}`;
    }

    private updateStats(): SimulationStats {
        const byId: Record<string, JunctionStats> = {};

        const ensure = (jid: string, type: JunctionObjectTypes): JunctionStats => {
            if (!byId[jid]) {
                const c = this.junctionCounters.get(jid) ?? { entered: 0, exited: 0, blockedDownstream: 0, totalWaitTime: 0, waitCount: 0 };
                byId[jid] = {
                    id: jid,
                    type,
                    approaching: 0,
                    waiting: 0,
                    inside: 0,
                    exiting: 0,
                    entered: c.entered,
                    exited: c.exited,
                    avgWaitTime: c.waitCount > 0 ? c.totalWaitTime / c.waitCount : 0,
                    currentGreenKey: null,
                    state: undefined,
                };
            }
            return byId[jid];
        };

        // ---------
        // 1) Per-vehicle snapshot counts + entered/exited detection
        // ---------

        for (const v of this.vehicles) {
            const seg = v.currentSegment;
            if (!seg) continue;

            // Decide which junction this segment belongs to (best-effort with current segment encoding)
            // approach: seg.to is junction node key
            // inside:   seg.to is usually still junction-ish (in your generator); if not, adjust here
            // exit:     seg.from is junction node key
            let jid: string | null = null;

            if (seg.phase === "approach") jid = seg.to.structureID;
            else if (seg.phase === "inside") jid = seg.to.structureID;
            else if (seg.phase === "exit") jid = seg.from.structureID;

            // Snapshot counts
            if (jid) {
                // Right now we only know intersections exist (controllers map). Roundabouts later.
                const isRoundabout = this.roundaboutControllers.has(jid);
                const js = ensure(jid, isRoundabout ? "roundabout" : "intersection");

                if (seg.phase === "approach") js.approaching += 1;
                else if (seg.phase === "inside") js.inside += 1;
                else if (seg.phase === "exit") js.exiting += 1;

                // Waiting heuristic (since you don’t have an explicit WAITING state in this file)
                // "approach + almost stopped + near stopline"
                if (seg.phase === "approach") {
                    const segDists = this.getSegmentDistances(v.route);
                    const segInfo = segDists[v.segmentIndex];
                    const nearStop = (segInfo?.s1 ?? 0) - v.s < 2.0; // tweak if needed
                    const stopped = v.speed < 0.2;
                    if (nearStop && stopped) js.waiting += 1;
                }

                // ---------
                // entered/exited detection (cumulative)
                // ---------
                const prev = this.lastVehJunctionTag.get(v.id) ?? { jid: null, phase: null };

                // “entered” when phase becomes inside for a junction
                if (jid && seg.phase === "inside" && !(prev.jid === jid && prev.phase === "inside")) {
                    const c = this.junctionCounters.get(jid) ?? { entered: 0, exited: 0, blockedDownstream: 0, totalWaitTime: 0, waitCount: 0 };
                    c.entered += 1;
                    this.junctionCounters.set(jid, c);
                    js.entered = c.entered; // keep snapshot aligned

                    // Notify roundabout controller
                    const roundabout = this.roundaboutControllers.get(jid);
                    if (roundabout && prev.phase === "approach") {
                        roundabout.registerVehicleEntering(v.id);
                    }
                }

                // “exited” when phase becomes exit for a junction
                if (jid && seg.phase === "exit" && !(prev.jid === jid && prev.phase === "exit")) {
                    const c = this.junctionCounters.get(jid) ?? { entered: 0, exited: 0, blockedDownstream: 0, totalWaitTime: 0, waitCount: 0 };
                    c.exited += 1;
                    this.junctionCounters.set(jid, c);
                    js.exited = c.exited;

                    // Notify roundabout controller
                    const roundabout = this.roundaboutControllers.get(jid);
                    if (roundabout && prev.phase === "inside") {
                        roundabout.registerVehicleExiting(v.id);
                    }
                }

                this.lastVehJunctionTag.set(v.id, { jid, phase: seg.phase });
            } else {
                // Not in any junction-related segment
                this.lastVehJunctionTag.set(v.id, { jid: null, phase: seg.phase ?? null });
            }
        }

        // Remove tags for vehicles that despawned (prevents Map growth)
        // (cheap cleanup)
        for (const [vid] of this.lastVehJunctionTag) {
            if (!this.vehicles.some(v => v.id === vid)) this.lastVehJunctionTag.delete(vid);
        }

        // ---------
        // 2) Attach signal state for intersections
        // ---------
        for (const [jid, controller] of this.intersectionControllers.entries()) {
            const js = ensure(jid, "intersection");
            js.currentGreenKey = controller.getCurrentGreen?.() ?? null;
            js.state = controller.getState?.();
            // Keep counters in sync (in case controller exists but no vehicles near it)
            const c = this.junctionCounters.get(jid) ?? { entered: 0, exited: 0, blockedDownstream: 0, totalWaitTime: 0, waitCount: 0 };
            js.entered = c.entered;
            js.exited = c.exited;
        }

        for (const [jid, controller] of this.roundaboutControllers.entries()) {
            const js = ensure(jid, "roundabout");
            js.currentGreenKey = controller.getCurrentGreen?.() ?? null;
            js.state = controller.getState?.();
            const c = this.junctionCounters.get(jid) ?? { entered: 0, exited: 0, blockedDownstream: 0, totalWaitTime: 0, waitCount: 0 };
            js.entered = c.entered;
            js.exited = c.exited;
        }

        // ---------
        // 3) Global junction aggregates
        // ---------
        const global: JunctionStatsGlobal = {
            count: Object.keys(byId).length,
            approaching: 0,
            waiting: 0,
            inside: 0,
            exiting: 0,
            entered: 0,
            exited: 0,
            avgWaitTime: 0,
        };

        let totalWaitTime = 0;
        let totalWaitCount = 0;

        for (const j of Object.values(byId)) {
            global.approaching += j.approaching;
            global.waiting += j.waiting;
            global.inside += j.inside;
            global.exiting += j.exiting;
            global.entered += j.entered;
            global.exited += j.exited;

            // Accumulate wait times for global average
            if (j.id) {
                const c = this.junctionCounters.get(j.id);
                if (c) {
                    totalWaitTime += c.totalWaitTime;
                    totalWaitCount += c.waitCount;
                }
            }
        }

        global.avgWaitTime = totalWaitCount > 0 ? totalWaitTime / totalWaitCount : 0;

        // ---------
        // 4) Build final SimulationStats snapshot
        // ---------
        
        // Calculate total spawn queue from all entry demands
        let totalSpawnQueue = 0;
        const spawnQueueByEntry: Record<string, number> = {};
        for (const [entryKey, demand] of this.spawnDemandPerEntry.entries()) {
            const queue = Math.floor(demand);
            totalSpawnQueue += queue;
            spawnQueueByEntry[entryKey] = queue;
        }
        
        const snapshot: SimulationStats = {
            active: this.vehicles.length,
            spawned: this.spawned,
            completed: this.completed,
            spawnQueue: totalSpawnQueue,
            spawnQueueByEntry,
            routes: this.routes.length,
            elapsedTime: this.elapsedTime,

            // keep this as a convenience; for now equal to junction waiting aggregate
            waiting: global.waiting,

            junctions: {
                global,
                byId,
            },
        };

        this.statsSnapshot = snapshot;
        return snapshot;
    }


    public getStats(): SimulationStats {
        return this.statsSnapshot ?? this.updateStats();
    }
}