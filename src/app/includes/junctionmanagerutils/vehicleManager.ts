import * as THREE from "three";
import { getRoutePoints, estimateRouteSpacing, computeSegmentDistances } from "./carRouting";
import { IntersectionController } from "./controllers/intersectionController";
import { Vehicle } from "./vehicle";
import { JunctionObjectTypes } from "../types/types";
import { SimConfig, SimulationStats, JunctionStats, JunctionStatsGlobal, LaneOcc, Route, RouteSegment, Tuple3 } from "../types/simulation";
import { RoundaboutController } from "./controllers/roundaboutController";
import { disposeObjectTree } from "./helpers/dispose";
import { isRoundaboutType, buildRoundaboutMeta } from "./helpers/roundaboutMeta";
import { segmentId, segmentLen } from "./helpers/segmentHelpers";
import { SeededRNG, rngForEntry, CarClass, carClassForModelIndex, bodyTypeForModelIndex, hashString } from "../types/carTypes";
import { defaultSimConfig } from "../defaults";




export class VehicleManager {
    private scene: THREE.Scene;
    private carModels: THREE.Group[];
    private routes: Route[];

    private vehicles: Vehicle[] = [];
    private nextId = 0;

    private spawned = 0;
    private completed = 0;

    // Spawn rates per entry point (structureID-exitIndex -> vehicles per second)
    private spawnRatesPerEntry = new Map<string, number>();
    
    // Spawn demand per entry point (structureID-exitIndex -> demand accumulator)
    private spawnDemandPerEntry = new Map<string, number>();
    
    // Routes grouped by entry point for efficient spawning
    private routesByEntry = new Map<string, Route[]>();

    // laneKey -> (segmentId -> baseOffset)
    private laneBases = new Map<string, Map<string, number>>();
    private laneBasesBuilt = false;

    // Cache for segment distance info (s0, s1) per route
    private routeSegmentDistances = new Map<Route, Array<{ s0: number; s1: number }>>();
    
    // Cache for route points, spacing, and cumulative distances
    private routePointsCache = new Map<Route, Tuple3[]>();
    private routeSpacingCache = new Map<Route, number>();
    private routeCumulativeDistances = new Map<Route, number[]>();

    private cfg: SimConfig;

    private intersectionControllers = new Map<string, IntersectionController>();
    private roundaboutControllers = new Map<string, RoundaboutController>();
    private roundaboutMeta = new Map<string, { center: THREE.Vector3; laneMidRadii: number[]; maxStrip: number; entryAngles: Map<string, number>; avgRadius: number }>();
    private controllersBuilt = false;

    private lastActiveLogged: number | null = null;

    private statsSnapshot: SimulationStats | null = null;
    private junctionCounters = new Map<string, { entered: number; exited: number; totalWaitTime: number; waitCount: number }>();
    private lastVehJunctionTag = new Map<number, { jid: string | null; phase: string | null }>();
    private elapsedTime = 0;
    // Track when each vehicle started waiting at a junction (vehicleId -> { junctionId, startTime })
    private vehicleWaitStart = new Map<number, { jid: string; startTime: number }>();

    // Store current frame's lane state for segment transition checks
    private lanes = new Map<string, LaneOcc[]>();
    private desiredS = new Map<Vehicle, number>();

    // Per-entry seeded RNGs for deterministic car class selection
    private entryRNGs = new Map<string, SeededRNG>();

    // Stable RNG key per entry (config-hash-based, independent of UUID)
    private entryRngKeys = new Map<string, string>();

    // Stable key per junction structureID (config-hash + ordinal), computed once
    private junctionStableKeys = new Map<string, string>();
    private junctionStableKeysBuilt = false;

    // Fixed-rate accumulator for spawn demand (ensures frame-rate-independent spawn timing)
    private spawnAccumulator = 0;


    constructor(scene: THREE.Scene, carModels: THREE.Group[], routes: Route[], cfg?: Partial<SimConfig>) {
        this.scene = scene;
        this.carModels = carModels;
        this.routes = routes;

        // Build routes by entry point
        this.buildRoutesByEntry();

        this.cfg = defaultSimConfig;
    }

    /** Update simulation configuration */
    public updateConfig(cfg: Partial<SimConfig>): void {
        const oldSeed = this.cfg.simSeed;
        this.cfg = { ...this.cfg, ...cfg };
        // Reset per-entry RNGs when the seed changes so the next run is reproducible
        if (cfg.simSeed !== undefined && cfg.simSeed !== oldSeed) {
            this.entryRNGs.clear();
        }
    }

    /** Get current simulation configuration */
    public getConfig(): SimConfig {
        return { ...this.cfg };
    }

    /** Convert a Node object to a string key */
    private nodeToKey(node: { structureID: string; exitIndex: number; direction: string; laneIndex: number }): string {
        return `${node.structureID}-${node.exitIndex}-${node.direction}-${node.laneIndex}`;
    }

    /** Helper: get cached segment distances for a route */
    private getSegmentDistances(route: Route): Array<{ s0: number; s1: number }> {
        let cached = this.routeSegmentDistances.get(route);
        if (!cached) {
            cached = computeSegmentDistances(route);
            this.routeSegmentDistances.set(route, cached);
        }
        return cached;
    }

    /** Helper: get cached route points */
    private getRoutePointsCached(route: Route): Tuple3[] {
        let cached = this.routePointsCache.get(route);
        if (!cached) {
            cached = getRoutePoints(route);
            this.routePointsCache.set(route, cached);
        }
        return cached;
    }

    /** Helper: get cached route spacing */
    private getRouteSpacing(route: Route): number {
        let cached = this.routeSpacingCache.get(route);
        if (!cached) {
            cached = estimateRouteSpacing(route);
            this.routeSpacingCache.set(route, cached);
        }
        return cached;
    }

    /** Compute (or return cached) cumulative arc-length distances for each route point */
    private getRouteCumulativeDistances(route: Route): number[] {
        const cached = this.routeCumulativeDistances.get(route);
        if (cached) return cached;

        const pts = this.getRoutePointsCached(route);
        const cumDist: number[] = [0];
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
     * Binary-search cumulative distances to find the point-index interval
     * containing a given s-value.  Returns { idx, t } where the position is
     * lerp(pts[idx], pts[idx+1], t).
     */
    private findIndexAtS(cumDist: number[], s: number): { idx: number; t: number } {
        const maxS = cumDist[cumDist.length - 1];
        const clamped = Math.max(0, Math.min(s, maxS));

        // Binary search for the interval
        let lo = 0;
        let hi = cumDist.length - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (cumDist[mid] <= clamped) lo = mid;
            else hi = mid;
        }

        const segLen = cumDist[lo + 1] - cumDist[lo];
        const t = segLen > 1e-9 ? (clamped - cumDist[lo]) / segLen : 0;
        return { idx: lo, t };
    }

    /** Step 5: used by TrafficSimulation.tsx to query light state for colouring stop lines */
    public getIntersectionController(junctionId: string): IntersectionController | RoundaboutController | null {
        return this.intersectionControllers.get(junctionId) ?? this.roundaboutControllers.get(junctionId) ?? null;
    }
    public getRoundaboutController(junctionId: string): RoundaboutController | null {
        return this.roundaboutControllers.get(junctionId) ?? null;
    }

    public isRoundabout(junctionId: string): boolean {
        return this.roundaboutControllers.has(junctionId);
    }

    /** Get a vehicle by ID for camera following */
    public getVehicleById(id: number): Vehicle | undefined {
        return this.vehicles.find(v => v.id === id);
    }

    /** Get all active vehicles (for raycasting/selection) */
    public getVehicles(): Vehicle[] {
        return this.vehicles;
    }


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
        this.routeSpacingCache.clear();
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


    public update(dt: number, junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>) {
        if (!this.routes.length) return;

        this.elapsedTime += dt;

        if (!this.laneBasesBuilt) this.buildLaneBases();

        this.buildControllersIfNeeded(junctionObjectRefs);
        this.buildJunctionStableKeys(junctionObjectRefs);
        for (const c of this.intersectionControllers.values()) c.update(dt);
        for (const c of this.roundaboutControllers.values()) c.update(dt);

        // 1) Update spawn rates from junction objects
        this.updateSpawnRatesFromJunctions(junctionObjectRefs);

        // Calculate per-entry max spawn queue (global divided by number of spawn points)
        const numSpawnPoints = this.routesByEntry.size;
        const maxQueuePerEntry = numSpawnPoints > 0 ? this.cfg.spawning.maxSpawnQueue / numSpawnPoints : this.cfg.spawning.maxSpawnQueue;

        // 2) Accumulate demand per entry using fixed-rate ticks for
        //    seed reproducibility.  The demand counter increments at a
        //    fixed rate (1/60 s) so the Nth vehicle is always attempted
        //    at the same simulation-time regardless of frame rate.
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

        // 3) Try to spawn from each entry (sorted by stable key for determinism)
        const sortedEntries = Array.from(this.spawnDemandPerEntry.entries())
            .sort((a, b) => {
                const ka = this.entryRngKeys.get(a[0]) ?? a[0];
                const kb = this.entryRngKeys.get(b[0]) ?? b[0];
                return ka < kb ? -1 : ka > kb ? 1 : 0;
            });
        let totalAttempts = 0;
        for (const [entryKey, demand] of sortedEntries) {
            const vehiclesToSpawn = Math.floor(demand);
            
            if (vehiclesToSpawn > 0 && this.vehicles.length < this.cfg.spawning.maxVehicles) {
                let spawned = 0;
                let attempts = 0;
                
                while (
                    spawned < vehiclesToSpawn &&
                    this.vehicles.length < this.cfg.spawning.maxVehicles &&
                    attempts < this.cfg.spawning.maxSpawnAttemptsPerFrame &&
                    totalAttempts < this.cfg.spawning.maxSpawnAttemptsPerFrame * 3
                ) {
                    attempts++;
                    totalAttempts++;
                    const ok = this.trySpawnFromEntry(entryKey);
                    if (ok) {
                        spawned++;
                        // Subtract the spawned vehicle from demand
                        this.spawnDemandPerEntry.set(entryKey, demand - spawned);
                    } else {
                        break; // Can't spawn from this entry right now
                    }
                }
            }
        }

        this.logActiveVehiclesIfChanged();

        // 3) refresh segment/laneKey before lane logic
        for (const v of this.vehicles) this.updateVehicleSegment(v);

        // 4) compute desiredS with accel/decel + queuing constraints
        const desiredS = new Map<Vehicle, number>();

      
        this.applyLaneQueuingWithKinematics(dt, desiredS);
       

        // 5) apply desired s -> pose + despawn
        for (let i = this.vehicles.length - 1; i >= 0; i--) {
            const v = this.vehicles[i];
            const target = desiredS.get(v) ?? v.s;
            const done = this.applySAndPose(v, target);

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
        // --- Wait time tracking (event-based: track start/end of waiting) ---
        for (const v of this.vehicles) {
            const seg = v.currentSegment;
            const jid = seg?.to?.structureID ?? seg?.from?.structureID;
            
            // Check if vehicle is currently waiting (approach phase, stopped, near stopline)
            let isWaiting = false;
            let waitJid: string | null = null;
            if (seg && seg.phase === "approach" && jid) {
                const segDists = this.getSegmentDistances(v.route);
                const segInfo = segDists[v.segmentIndex];
                const nearStop = (segInfo?.s1 ?? 0) - v.s < 2.0;
                const stopped = v.speed < 0.2;
                isWaiting = nearStop && stopped;
                waitJid = jid;
            }
            
            const existing = this.vehicleWaitStart.get(v.id);
            
            if (isWaiting && waitJid) {
                // Vehicle is waiting - start tracking if not already
                if (!existing) {
                    this.vehicleWaitStart.set(v.id, { jid: waitJid, startTime: this.elapsedTime });
                }
            } else {
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

    private logActiveVehiclesIfChanged() {
        const active = this.vehicles.length;

        if (this.lastActiveLogged === null) {
            this.lastActiveLogged = active;
            console.log(`[active-vehicles] ${active}`);
            return;
        }

        if (active !== this.lastActiveLogged) {
            console.log(
                `[active-vehicles] ${this.lastActiveLogged} -> ${active}`
            );
            this.lastActiveLogged = active;
        }
    }


    // -----------------------
    // Stage 2: lane queuing + accel/decel
    // -----------------------

    

    private stoppingDistance(speed: number, vehicle?: Vehicle): number {
        const decel = vehicle ? vehicle.maxDecel : this.cfg.motion.maxDecel;
        return (speed * speed) / (2 * decel);
    }


    /**
     * IMPORTANT FIX:
     * - Build lane occupancy across routes (shared physical lane)
     * - ALSO "reserve" the outgoing lane for vehicles inside a junction (so busy junctions don't deadlock)
     * - ALSO block entry on green if downstream exit lane is occupied too close to the start (no space to clear)
     */
    private applyLaneQueuingWithKinematics(dt: number, desiredS: Map<Vehicle, number>) {
        // STEP 1: Build same-route vehicle lists
        const vehiclesByRoute = new Map<Route, Vehicle[]>();
        for (const v of this.vehicles) {
            const arr = vehiclesByRoute.get(v.route) ?? [];
            arr.push(v);
            vehiclesByRoute.set(v.route, arr);
        }

        for (const vehicles of vehiclesByRoute.values()) {
            vehicles.sort((a, b) => b.s - a.s);
        }

        // STEP 2: Build lane groups for cross-route collision detection (LaneOcc so we can "pin" junction reservations)
        const lanes = new Map<string, LaneOcc[]>();
        
        // Store in instance variables for use in updateVehicleSegment
        this.lanes = lanes;
        this.desiredS = desiredS;

        for (const v of this.vehicles) {
            // normal occupancy on current physical lane (if any)
            if (v.laneKey) {
                const arr = lanes.get(v.laneKey) ?? [];
                arr.push({ v });
                lanes.set(v.laneKey, arr);
            }

            // reservation occupancy: if inside a junction, also occupy the *exit* lane start
            if (v.currentSegment?.phase === "inside") {
                const exitLaneKey = this.getExitLaneKeyForVehicle(v);
                if (exitLaneKey && this.shouldReserveExitLane(v) && !this.isRoundaboutLaneKey(v.laneKey)) {
                    const arr = lanes.get(exitLaneKey) ?? [];
                    // pin to lane start (coord = base + 0)
                    arr.push({ v, pinnedCoord: this.laneStartCoordForExitLane(exitLaneKey, v) });
                    lanes.set(exitLaneKey, arr);
                }
            }
        }

        // Sort within lanes by lane coordinate (front-to-back)
        for (const [laneKey, laneOccs] of lanes.entries()) {
            laneOccs.sort((a, b) => this.occCoord(b, laneKey, desiredS) - this.occCoord(a, laneKey, desiredS));
        }
        // STEP 3: Process each route front-to-back
        for (const [, routeVehicles] of vehiclesByRoute.entries()) {
            for (let i = 0; i < routeVehicles.length; i++) {
                const v = routeVehicles[i];
                
                // Determine if we're on a roundabout inside phase early
                const isRoundaboutInside = v.currentSegment?.phase === "inside" && this.isRoundaboutLaneKey(v.laneKey);

                let leader: Vehicle | null = null;
                let leaderGap = Infinity;

                // A) Same-route leader
                if (i > 0) {
                    const sameRouteLead = routeVehicles[i - 1];
                    
                    if (isRoundaboutInside && sameRouteLead.currentSegment?.phase === "exit") {
                        // Same-route leader is exiting — use world-position distance.
                        // The s-delta can be misleading here because the exit arm Bézier
                        // curves away from the ring, so physical distance better reflects
                        // actual inter-vehicle clearance.
                        const myPos = v.model.position;
                        const leadPos = sameRouteLead.model.position;
                        const worldDist = myPos.distanceTo(leadPos);
                        const worldGap = worldDist - 0.5 * (sameRouteLead.length + v.length);

                        // Also compute s-gap as a cross-check
                        const leadS = desiredS.get(sameRouteLead) ?? sameRouteLead.s;
                        const sGap = (leadS - v.s) - 0.5 * (sameRouteLead.length + v.length);

                        // Take the LARGER (more optimistic) gap — if world distance is
                        // large the paths are diverging and the s-gap overstates conflict.
                        const gap = Math.max(worldGap, sGap);
                        if (gap < leaderGap && gap > -v.length) {
                            leaderGap = gap;
                            leader = sameRouteLead;
                        }
                    } else {
                        // Linear s-value based gap (works for all segments including roundabout inside)
                        const leadS = desiredS.get(sameRouteLead) ?? sameRouteLead.s;
                        const gap = (leadS - v.s) - 0.5 * (sameRouteLead.length + v.length);
                        if (gap < leaderGap && gap > -v.length) {
                            leaderGap = gap;
                            leader = sameRouteLead;
                        }
                    }
                }

                // B) Same-lane leader from different route (shared physical lane)
                // When a roundabout vehicle is within 3 units of its segment
                // exit, it should stop watching ring traffic and instead look
                // ahead to the next segment (the exit arm) so it doesn't
                // brake for a circulating vehicle that's continuing around.
                const segDists = this.getSegmentDistances(v.route);
                const segInfo = segDists[v.segmentIndex];
                const distToSegEnd = segInfo ? (segInfo.s1 - v.s) : Infinity;
                const nearingExit = isRoundaboutInside && distToSegEnd < 6;

                if (v.laneKey) {
                    const laneOccs = lanes.get(v.laneKey) ?? [];
                    if (this.isRoundaboutLaneKey(v.laneKey) && !nearingExit) {
                        const roundaboutLeader = this.findRoundaboutLeader(v, laneOccs, desiredS);
                        if (roundaboutLeader && roundaboutLeader.gap < leaderGap) {
                            leaderGap = roundaboutLeader.gap;
                            leader = roundaboutLeader.leader;
                        }
                    } else if (!this.isRoundaboutLaneKey(v.laneKey)) {
                        const myCoord = this.laneCoord(v);

                        for (const occ of laneOccs) {
                            const other = occ.v;
                            if (other === v) continue;
                            if (other.route === v.route) continue;

                            const otherCoord = this.occCoord(occ, v.laneKey, desiredS);
                            if (otherCoord <= myCoord) continue;

                            const gap = (otherCoord - myCoord) - 0.5 * (other.length + v.length);

                            if (gap < leaderGap) {
                                leaderGap = gap;
                                leader = other;
                            }
                        }
                    }
                }

                // C) Cross-segment lookahead.
                // Normally skipped for roundabout inside, but ENABLED when
                // the vehicle is nearing its exit (within 3 units) so it
                // can see congestion on the exit arm and brake in time.
                let lookaheadResult: { leader: Vehicle; gap: number } | null = null;
                
                if (!isRoundaboutInside || nearingExit) {
                    lookaheadResult = this.findLeaderInUpcomingSegments(v, lanes, desiredS);
                    if (lookaheadResult && lookaheadResult.gap < leaderGap) {
                        leaderGap = lookaheadResult.gap;
                        leader = lookaheadResult.leader;
                    }
                }

                // Base speed caps (segment boundary lookahead)
                // SKIP for roundabout inside phase - let cars flow freely to their exit
                let desiredSpeedCap = v.preferredSpeed;
                if (!isRoundaboutInside && lookaheadResult && lookaheadResult.gap < this.stoppingDistance(v.speed, v) + 5) {
                    const boundarySpeedCap = this.getSegmentBoundarySpeedCap(v);
                    desiredSpeedCap = Math.min(desiredSpeedCap, boundarySpeedCap);
                }

                // STOPLINE + DOWNSTREAM BLOCKING
                const stoplineSpeed = this.applyStoplineAndDownstreamCap(v, desiredSpeedCap, lanes, desiredS);

                if (v.currentSegment?.phase === "approach") {
                    desiredSpeedCap = Math.min(desiredSpeedCap, stoplineSpeed);
                }

                let stoplineS: number | null = null;

                if (v.currentSegment?.phase === "approach" && stoplineSpeed < v.preferredSpeed) {
                    stoplineS = this.getStoplineS(v);
                } else if (v.currentSegment?.phase === "approach") {
                    // For roundabout approaches: always know the stopline position
                    // so the hard clamp can prevent overshoot if the gap closes
                    // between frames.  Only let the car past once committed.
                    const jKey = v.currentSegment?.to?.structureID;
                    if (jKey && this.roundaboutControllers.has(jKey)) {
                        const ctrl = this.roundaboutControllers.get(jKey)!;
                        if (!ctrl.isCommitted(v.id)) {
                            stoplineS = this.getStoplineS(v);
                        }
                    }
                } else if (v.currentSegment?.phase === "link") {
                    const upcoming = this.getUpcomingStoplineForLink(v, lanes);
                    if (upcoming?.shouldStop) {
                        stoplineS = upcoming.stoplineS;
                    }
                }
                // NOTE: No exit blocking for roundabout inside phase - let cars flow freely
                // They will naturally follow leaders on the exit lane via normal IDM once they transition

                // NOTE: No exit lane crossing check needed - routing handles gradual lane
                // merging to the outer ring before the exit point.

                // If a stopline is active, treat it as a virtual leader if closer than any real leader
                let effectiveLeader = leader;
                let effectiveLeaderGap = leaderGap;
                let effectiveLeaderSpeed: number | null = leader ? leader.speed : null;

                if (stoplineS !== null && Number.isFinite(stoplineS)) {
                    const stoplineGap = stoplineS - v.s;
                    if (!effectiveLeader || stoplineGap < effectiveLeaderGap) {
                        effectiveLeader = null; // virtual leader (stopline)
                        effectiveLeaderGap = stoplineGap;
                        effectiveLeaderSpeed = 0;
                    }
                }



                // IDM acceleration model
                const accel = this.computeIdmAccel(
                    v,
                    desiredSpeedCap,
                    effectiveLeaderSpeed,
                    Number.isFinite(effectiveLeaderGap) ? effectiveLeaderGap : null
                );

                v.speed = Math.max(0, v.speed + accel * dt);
                v.speed = Math.min(v.speed, v.preferredSpeed);

                let newS = v.s + v.speed * dt;


                // Apply stopline clamping (but never for roundabout inside phase)
                if (stoplineS !== null && Number.isFinite(stoplineS) && newS > stoplineS && !isRoundaboutInside) {
                    const dist = Math.max(0, stoplineS - v.s);
                    const maxSpeedToLine = dist / Math.max(1e-6, dt);
                    v.speed = Math.min(v.speed, maxSpeedToLine);
                    newS = stoplineS;
                }

                // Hard collision prevention
                if (leader) {
                    if (isRoundaboutInside && !nearingExit) {
                        // For roundabout: lane-aware world-position collision check
                        const myPos = this.getPointAtS(v.route, newS);
                        const leaderPos = leader.model.position;
                        if (myPos) {
                            const jId = this.roundaboutIdFromLaneKey(v.laneKey);
                            const rMeta = this.roundaboutMeta.get(jId);
                            let shouldCheck = true;
                            if (rMeta) {
                                const myR = Math.sqrt((myPos.x - rMeta.center.x) ** 2 + (myPos.z - rMeta.center.z) ** 2);
                                const leadR = Math.sqrt((leaderPos.x - rMeta.center.x) ** 2 + (leaderPos.z - rMeta.center.z) ** 2);
                                const lw = this.roundaboutLaneWidth(jId);
                                const outerR = rMeta.laneMidRadii.length > 0
                                    ? rMeta.laneMidRadii[rMeta.laneMidRadii.length - 1]
                                    : rMeta.avgRadius;

                                // Skip if leader is off the ring (diverging to exit arm)
                                if (leadR > outerR + lw * 1.5) shouldCheck = false;
                                // Skip if on non-adjacent ring lanes (allow ±1 for merge zones)
                                else if (rMeta.laneMidRadii.length >= 2) {
                                    const myLane = this.nearestRingLaneIndex(rMeta.laneMidRadii, myR);
                                    const leadLane = this.nearestRingLaneIndex(rMeta.laneMidRadii, leadR);
                                    if (Math.abs(myLane - leadLane) > 1) shouldCheck = false;
                                }
                            }
                            if (shouldCheck) {
                                const dist = myPos.distanceTo(leaderPos);
                                const bumpGap = dist - 0.5 * (leader.length + v.length);
                                const safeGap = bumpGap - this.cfg.spacing.minBumperGap;
                                if (safeGap < v.length) {
                                    // Use IDM with the measured gap for smooth deceleration
                                    const idmA = this.computeIdmAccel(
                                        v, v.preferredSpeed, leader.speed, Math.max(0, bumpGap)
                                    );
                                    v.speed = Math.max(0, v.speed + idmA * dt);
                                    newS = v.s + v.speed * dt;
                                }
                            }
                        }
                    } else {
                        // Regular collision prevention for non-roundabout segments
                        if (leader.route === v.route) {
                            const leaderS = desiredS.get(leader) ?? leader.s;
                            const minSafeS = leaderS - 0.5 * (leader.length + v.length) - this.cfg.spacing.minBumperGap;
                            if (newS > minSafeS) {
                                const sGap = Math.max(0, minSafeS - v.s);
                                const idmA = this.computeIdmAccel(
                                    v, v.preferredSpeed, leader.speed, sGap
                                );
                                v.speed = Math.max(0, v.speed + idmA * dt);
                                newS = Math.min(v.s + v.speed * dt, minSafeS);
                            }
                        } else {
                            const newGap = this.estimateGapAfterMove(v, newS, leader, desiredS);
                            if (newGap < this.cfg.spacing.minBumperGap) {
                                const curGap = this.estimateGapAfterMove(v, v.s, leader, desiredS);
                                const idmA = this.computeIdmAccel(
                                    v, v.preferredSpeed, leader.speed, Math.max(0, curGap)
                                );
                                v.speed = Math.max(0, v.speed + idmA * dt);
                                newS = v.s + v.speed * dt;
                            }
                        }
                    }
                }

                // Unconditional world-space overlap prevention for roundabout vehicles.
                // Catches lateral conflicts (lane-changes into occupied space) that
                // leader-following can't detect because the other vehicle is beside us,
                // not ahead.  ASYMMETRIC yield rules:
                //   - A recently-entered vehicle (near start of its inside segment)
                //     ALWAYS yields to an established circulating vehicle, because
                //     circulating traffic has absolute priority on a roundabout.
                //   - Between two established vehicles, the angularly-behind one yields.
                // SKIP when nearing exit — at that point we only follow the exit arm.
                if (isRoundaboutInside && !nearingExit && v.laneKey) {
                    const jId = this.roundaboutIdFromLaneKey(v.laneKey);
                    const rMeta = this.roundaboutMeta.get(jId);
                    if (rMeta) {
                        const myPos = this.getPointAtS(v.route, newS) ?? v.model.position;
                        const myDx = myPos.x - rMeta.center.x;
                        const myDz = myPos.z - rMeta.center.z;
                        const myAngle = Math.atan2(myDz, myDx);
                        const TAU = Math.PI * 2;
                        const laneOccs = lanes.get(v.laneKey) ?? [];

                        // Detect if I recently entered — near the start of my inside segment.
                        const myDistFromSegStart = segInfo ? (v.s - segInfo.s0) : Infinity;
                        const iAmRecentlyEntered = myDistFromSegStart < 6;

                        for (const occ of laneOccs) {
                            const other = occ.v;
                            if (other === v || other === leader) continue;
                            const otherPhase = other.currentSegment?.phase;
                            if (otherPhase !== "inside") continue;

                            // Skip vehicles that entered from the same arm —
                            // they go to different circulating lanes and shouldn't
                            // block each other at the entry zone.
                            // Only skip if BOTH vehicles are recently entered.
                            if (iAmRecentlyEntered) {
                                const otherSegs = other.route.segments;
                                if (otherSegs && other.segmentIndex > 0) {
                                    const otherPrevSeg = otherSegs[other.segmentIndex - 1];
                                    if (otherPrevSeg?.phase === "approach") {
                                        const mySegs = v.route.segments;
                                        if (mySegs && v.segmentIndex > 0) {
                                            const myPrevSeg = mySegs[v.segmentIndex - 1];
                                            if (myPrevSeg?.phase === "approach") {
                                                const myEntryKey = this.entryGroupKeyFromNodeKey(
                                                    this.nodeToKey(myPrevSeg.from)
                                                );
                                                const otherEntryKey = this.entryGroupKeyFromNodeKey(
                                                    this.nodeToKey(otherPrevSeg.from)
                                                );
                                                if (myEntryKey === otherEntryKey) {
                                                    // Also check the other vehicle is near entry
                                                    const otherSegDists2 = this.getSegmentDistances(other.route);
                                                    const otherSegInfo2 = otherSegDists2[other.segmentIndex];
                                                    const otherDistFromStart2 = otherSegInfo2
                                                        ? (other.s - otherSegInfo2.s0) : Infinity;
                                                    if (otherDistFromStart2 < 6) continue;
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            const otherPos = other.model.position;
                            const dist = myPos.distanceTo(otherPos);
                            const hardMinDist = 0.5 * (v.length + other.length) + this.cfg.spacing.minBumperGap;
                            const softMinDist = hardMinDist + 1.0;

                            if (dist < softMinDist) {
                                // Determine if the other vehicle also recently entered.
                                const otherSegDists = this.getSegmentDistances(other.route);
                                const otherSegInfo = otherSegDists[other.segmentIndex];
                                const otherDistFromSegStart = otherSegInfo ? (other.s - otherSegInfo.s0) : Infinity;
                                const otherRecentlyEntered = otherDistFromSegStart < 6;

                                let iShouldYield: boolean;

                                if (iAmRecentlyEntered && !otherRecentlyEntered) {
                                    // I just entered, they're established — I ALWAYS yield.
                                    iShouldYield = true;
                                } else if (!iAmRecentlyEntered && otherRecentlyEntered) {
                                    // They just entered, I'm established — they yield, not me.
                                    iShouldYield = false;
                                } else {
                                    // Both established or both recently entered — use angular position.
                                    const otherDx = otherPos.x - rMeta.center.x;
                                    const otherDz = otherPos.z - rMeta.center.z;
                                    const otherAngle = Math.atan2(otherDz, otherDx);
                                    const angDelta = THREE.MathUtils.euclideanModulo(
                                        otherAngle - myAngle, TAU
                                    );
                                    iShouldYield =
                                        (angDelta > 0.01 && angDelta < Math.PI) ||
                                        (angDelta <= 0.01 && v.id > other.id);
                                }

                                if (iShouldYield) {
                                    // IDM deceleration using measured gap
                                    const bumpGapOv = dist - 0.5 * (v.length + other.length);
                                    const idmAov = this.computeIdmAccel(
                                        v, v.preferredSpeed, other.speed, Math.max(0, bumpGapOv)
                                    );
                                    v.speed = Math.max(0, v.speed + idmAov * dt);
                                    newS = v.s + v.speed * dt;
                                    break;
                                }
                            }
                        }
                    }
                }

                // World-space collision guard for committed approach vehicles.
                // While crossing from the stop line into the ring, check for
                // circulating vehicles that are physically close — a ring
                // vehicle may have started a lane change after we committed.
                if (v.currentSegment?.phase === "approach" && v.laneKey) {
                    const jKey = v.currentSegment?.to?.structureID;
                    if (jKey && this.roundaboutControllers.has(jKey)) {
                        const ctrl = this.roundaboutControllers.get(jKey)!;
                        if (ctrl.isCommitted(v.id)) {
                            const rMeta = this.roundaboutMeta.get(jKey);
                            if (rMeta) {
                                const ringLaneKey = `lane:roundabout:${jKey}`;
                                const ringOccs = lanes.get(ringLaneKey) ?? [];
                                const myPos = this.getPointAtS(v.route, newS) ?? v.model.position;

                                for (const occ of ringOccs) {
                                    const other = occ.v;
                                    if (other.id === v.id) continue;
                                    const otherPhase = other.currentSegment?.phase;
                                    if (otherPhase !== "inside") continue;

                                    const otherPos = other.model.position;
                                    const dist = myPos.distanceTo(otherPos);
                                    const safetyDist = 0.5 * (v.length + other.length) + v.length;

                                    if (dist < safetyDist) {
                                        const bumpGap = dist - 0.5 * (v.length + other.length);
                                        const idmBrake = this.computeIdmAccel(
                                            v, v.preferredSpeed, other.speed, Math.max(0, bumpGap)
                                        );
                                        v.speed = Math.max(0, v.speed + idmBrake * dt);
                                        newS = v.s + v.speed * dt;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                desiredS.set(v, newS);
            }
        }
    }

    private occCoord(occ: LaneOcc, laneKey: string, desiredS: Map<Vehicle, number>): number {
        if (typeof occ.pinnedCoord === "number") return occ.pinnedCoord;

        const other = occ.v;
        const sVal = desiredS.get(other) ?? other.s;

        // If other is currently on THIS physical lane, use standard lane coord
        if (other.laneKey && other.laneKey === laneKey) {
            return this.laneCoordFromS(other, sVal);
        }

        // Otherwise fall back to s (shouldn't happen often)
        return sVal;
    }

    private findLeaderInUpcomingSegments(
        v: Vehicle,
        lanes: Map<string, LaneOcc[]>,
        desiredS: Map<Vehicle, number>
    ): { leader: Vehicle; gap: number } | null {
        const segs = v.route.segments;
        if (!segs || v.segmentIndex >= segs.length - 1) return null;

        const currentSeg = v.currentSegment;
        if (!currentSeg) return null;

        if (currentSeg.phase !== "link") return null;

        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        const distToSegEnd = Math.max(0, (segInfo?.s1 ?? 0) - v.s);

        const brakingDist = this.stoppingDistance(v.speed, v);
        const lookaheadDist = Math.max(brakingDist + 10, 30);

        const nextSegIdx = v.segmentIndex + 1;
        if (nextSegIdx >= segs.length) return null;

        const nextSeg = segs[nextSegIdx];
        const nextLaneKey = this.laneKeyForSegment(nextSeg);
        if (!nextLaneKey) return null;

        const laneOccs = lanes.get(nextLaneKey) ?? [];

        let closestLeader: Vehicle | null = null;
        let closestGap = Infinity;

        for (const occ of laneOccs) {
            const other = occ.v;
            if (other === v) continue;
            if (other.route === v.route) continue;

            const otherSeg = other.currentSegment;
            if (!otherSeg) continue;

            if (otherSeg.phase !== nextSeg.phase && !(otherSeg.phase === "inside" && nextSeg.phase === "approach")) {
                // normal match: same phase
                // allow reservation logic to still work by not hard rejecting inside here
            }

            const otherCoord = this.occCoord(occ, nextLaneKey, desiredS);

            // Treat the start of next lane as coord 0 (relative). We need relative distance into lane.
            // We can approximate "distance into segment" via coord - base.
            const base = this.laneBases.get(nextLaneKey)?.get(segmentId(nextSeg)) ?? 0;
            const otherDistInSeg = Math.max(0, otherCoord - base);

            const gap = distToSegEnd + otherDistInSeg - other.length;

            if (gap > 0 && gap < lookaheadDist && gap < closestGap) {
                closestGap = gap;
                closestLeader = other;
            }
        }

        if (closestLeader) return { leader: closestLeader, gap: closestGap };
        return null;
    }


    private getSegmentBoundarySpeedCap(v: Vehicle): number {
        const currentSeg = v.currentSegment;
        if (!currentSeg) return v.preferredSpeed;

        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        const distToSegEnd = Math.max(0, (segInfo?.s1 ?? 0) - v.s);
        const cautionZone = this.stoppingDistance(v.preferredSpeed, v) + 5;

        if (distToSegEnd > cautionZone) return v.preferredSpeed;

        const safeSpeed = Math.sqrt(2 * v.maxDecel * Math.max(0.5, distToSegEnd));
        return Math.max(safeSpeed, 2);
    }

    private estimateGapAfterMove(
        follower: Vehicle,
        newS: number,
        leader: Vehicle,
        desiredS: Map<Vehicle, number>
    ): number {
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

        const currentSeg = follower.currentSegment;
        if (!currentSeg) return Infinity;

        const followerSegDists = this.getSegmentDistances(follower.route);
        const followerSegInfo = followerSegDists[follower.segmentIndex];
        const distToSegEnd = Math.max(0, (followerSegInfo?.s1 ?? 0) - newS);
        const leaderSeg = leader.currentSegment;
        if (!leaderSeg) return Infinity;

        const leaderSegDists = this.getSegmentDistances(leader.route);
        const leaderSegInfo = leaderSegDists[leader.segmentIndex];
        const leaderDistInSeg = leader.s - (leaderSegInfo?.s0 ?? 0);

        return distToSegEnd + leaderDistInSeg - leader.length;
    }

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

        const freeRoadTerm = 1 - Math.pow(v.speed / v0, delta);

        if (gap === null || !Number.isFinite(gap) || gap <= 0 || leaderSpeed === null) {
            return Math.max(-v.maxDecel, Math.min(a * freeRoadTerm, a));
        }

        const dv = v.speed - leaderSpeed;
        const sStar = s0 + Math.max(0, v.speed * T + (v.speed * dv) / (2 * Math.sqrt(a * b)));
        const interaction = Math.pow(sStar / Math.max(0.1, gap), 2);

        const accel = a * (freeRoadTerm - interaction);

        return Math.max(-v.maxDecel, Math.min(accel, a));
    }

    private findRoundaboutLeader(
        v: Vehicle,
        laneOccs: LaneOcc[],
        _desiredS: Map<Vehicle, number>
    ): { leader: Vehicle; gap: number } | null {
        if (!v.laneKey || !this.isRoundaboutLaneKey(v.laneKey)) return null;

        const junctionId = this.roundaboutIdFromLaneKey(v.laneKey);
        const meta = this.roundaboutMeta.get(junctionId);
        if (!meta) return null;

        const laneWidth = this.roundaboutLaneWidth(junctionId);

        // Ring radius bounds — vehicles must be within this to count as "on the ring"
        const outerR = meta.laneMidRadii.length > 0
            ? meta.laneMidRadii[meta.laneMidRadii.length - 1]
            : meta.avgRadius;
        const innerR = meta.laneMidRadii.length > 0
            ? meta.laneMidRadii[0]
            : meta.avgRadius;
        const ringTolerance = laneWidth * 1.5;

        // Use actual model position (always up-to-date) instead of s → world interpolation
        const myPos = v.model.position;
        const myDx = myPos.x - meta.center.x;
        const myDz = myPos.z - meta.center.z;
        const myR = Math.sqrt(myDx * myDx + myDz * myDz);
        const myAngle = Math.atan2(myDz, myDx);

        // If this vehicle is already off the ring (exit blend), skip ring leader search
        if (myR > outerR + ringTolerance || myR < innerR - ringTolerance) return null;

        // Determine which discrete ring lane this vehicle is on
        const myLaneIdx = this.nearestRingLaneIndex(meta.laneMidRadii, myR);

        const TAU = Math.PI * 2;
        let bestArcDist = Infinity;
        let bestWorldDist = Infinity;
        let bestLeader: Vehicle | null = null;

        // Determine if *we* recently entered, and if so, which arm we came from.
        const myDistFromSegStart = (() => {
            const sd = this.getSegmentDistances(v.route);
            const si = sd[v.segmentIndex];
            return si ? (v.s - si.s0) : Infinity;
        })();
        const iAmRecentlyEnteredRL = myDistFromSegStart < 6;
        let myEntryKeyRL: string | undefined;
        if (iAmRecentlyEnteredRL) {
            const segs = v.route.segments;
            if (segs && v.segmentIndex > 0) {
                const prev = segs[v.segmentIndex - 1];
                if (prev?.phase === "approach") {
                    myEntryKeyRL = this.entryGroupKeyFromNodeKey(this.nodeToKey(prev.from));
                }
            }
        }

        for (const occ of laneOccs) {
            const other = occ.v;
            if (other === v) continue;
            if (other.route === v.route) continue; // same-route handled separately

            // Only consider vehicles still genuinely on the ring ("inside" phase).
            // Vehicles in "exit" phase are diverging off — not a ring conflict.
            const otherPhase = other.currentSegment?.phase;
            if (otherPhase !== "inside") continue;

            // Skip same-arm vehicles when BOTH are recently entered — they are
            // going to different circulating lanes and should not be leaders to
            // each other in the entry zone.
            if (iAmRecentlyEnteredRL && myEntryKeyRL) {
                const otherSegs = other.route.segments;
                if (otherSegs && other.segmentIndex > 0) {
                    const otherPrev = otherSegs[other.segmentIndex - 1];
                    if (otherPrev?.phase === "approach") {
                        const otherEntryKey = this.entryGroupKeyFromNodeKey(
                            this.nodeToKey(otherPrev.from)
                        );
                        if (otherEntryKey === myEntryKeyRL) {
                            const otherSD = this.getSegmentDistances(other.route);
                            const otherSI = otherSD[other.segmentIndex];
                            const otherDFS = otherSI ? (other.s - otherSI.s0) : Infinity;
                            if (otherDFS < 6) continue; // both near entry — skip
                        }
                    }
                }
            }

            const otherPos = other.model.position;
            const otherDx = otherPos.x - meta.center.x;
            const otherDz = otherPos.z - meta.center.z;
            const otherR = Math.sqrt(otherDx * otherDx + otherDz * otherDz);

            // Skip vehicles that have drifted off the ring (on exit-blend portion)
            if (otherR > outerR + ringTolerance || otherR < innerR - ringTolerance) continue;

            // Lane filter: prefer vehicles on the SAME discrete ring lane.
            // But also consider adjacent-lane vehicles if physically very close
            // (catches lane-changers that are merging across our path).
            const otherLaneIdx = this.nearestRingLaneIndex(meta.laneMidRadii, otherR);
            const laneDiff = Math.abs(otherLaneIdx - myLaneIdx);
            if (laneDiff > 1) continue; // 2+ lanes away — never a leader

            // Angular ordering: is the other vehicle ahead in the travel direction?
            // Ring travel increases angle (CCW in atan2 space).  Only consider
            // vehicles within half the ring ahead — beyond that they are actually
            // behind us travelling in the same direction.
            const otherAngle = Math.atan2(otherDz, otherDx);
            const angularDelta = THREE.MathUtils.euclideanModulo(otherAngle - myAngle, TAU);
            if (angularDelta < 0.01 || angularDelta > Math.PI) continue;

            // Heading filter: skip vehicles whose heading diverges from the ring
            // tangent. A vehicle on the exit blend has its heading pointing radially
            // outward rather than following the CW ring direction.
            const otherFwd = new THREE.Vector3(
                Math.sin(other.model.rotation.y), 0, Math.cos(other.model.rotation.y)
            );
            const ringTangentCW = new THREE.Vector3(
                -Math.sin(otherAngle), 0, Math.cos(otherAngle)
            );
            const tangentAlignment = otherFwd.dot(ringTangentCW);
            if (tangentAlignment < 0.5) continue; // heading away from ring → exiting

            // Prefer nearest vehicle by arc distance along the ring (not world
            // distance, which on a small ring can be shorter across the diameter
            // than around the arc, causing incorrect leader picks).
            // Same-lane vehicles always take priority; adjacent-lane vehicles only
            // count if they are within a close proximity threshold (catches
            // lane-changers merging into our path).
            const arcDist = angularDelta * meta.avgRadius;
            const worldDist = myPos.distanceTo(otherPos);
            const proximityThreshold = v.length + 2.0; // car length + buffer

            if (laneDiff === 0) {
                // Same lane — normal arc-distance-based best leader
                if (arcDist < bestArcDist) {
                    bestArcDist = arcDist;
                    bestWorldDist = worldDist;
                    bestLeader = other;
                }
            } else {
                // Adjacent lane — only treat as leader if physically very close
                if (worldDist < proximityThreshold && worldDist < bestWorldDist) {
                    bestArcDist = arcDist;
                    bestWorldDist = worldDist;
                    bestLeader = other;
                }
            }
        }

        if (!bestLeader || !Number.isFinite(bestWorldDist)) return null;

        const gap = bestWorldDist - 0.5 * (bestLeader.length + v.length);
        if (gap <= 0) return null; // overlapping — let hard collision handler deal with it

        return { leader: bestLeader, gap };
    }

    private approachSpeed(current: number, target: number, dt: number, vehicle: Vehicle): number {
        const maxAccel = vehicle.maxAccel;
        const maxDecel = vehicle.maxDecel;
        
        if (target > current) return Math.min(target, current + maxAccel * dt);
        return Math.max(target, current - maxDecel * dt);
    }

    private isRoundaboutLaneKey(laneKey: string): boolean {
        return laneKey.startsWith("lane:roundabout:");
    }

    private roundaboutIdFromLaneKey(laneKey: string): string {
        // lane:roundabout:UUID -> UUID
        return laneKey.replace("lane:roundabout:", "");
    }

    /**
     * Universal roundabout coordinate: CW angle from center × avgRadius.
     * Works for ALL vehicles on the roundabout regardless of route or ring lane.
     */
    private roundaboutCoordFromWorldPos(junctionId: string, pos: THREE.Vector3): number {
        const meta = this.roundaboutMeta.get(junctionId);
        if (!meta) return 0;

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
        if (!meta || meta.laneMidRadii.length < 2) return 3.0;
        return Math.abs(
            meta.laneMidRadii[meta.laneMidRadii.length - 1] - meta.laneMidRadii[0]
        ) / Math.max(1, meta.laneMidRadii.length - 1);
    }

    /**
     * Find which discrete ring lane index a given radius falls into.
     * Returns the index into `laneMidRadii` whose value is closest to `radius`.
     */
    private nearestRingLaneIndex(laneMidRadii: number[], radius: number): number {
        if (laneMidRadii.length <= 1) return 0;
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
        if (!pts || pts.length < 2) return null;

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
        if (!laneKey || !this.isRoundaboutLaneKey(laneKey)) return sValue;

        const junctionId = this.roundaboutIdFromLaneKey(laneKey);

        const pos = this.getPointAtS(v.route, sValue);
        if (!pos) return sValue;

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
        if (!seg || !v.laneKey) return sValue;

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
                    if (this.nodeToKey(a.to) === this.nodeToKey(b.from)) {
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

            for (const id of ids) if (!bases.has(id)) bases.set(id, 0);

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
        v.preferredSpeed = this.cfg.motion.maxSpeed * carClass.speedFactor * (0.9 + rVariation2 * 0.2);
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

    private computeModelLength(model: THREE.Group): number {
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);

        const raw = size.z;
        if (!Number.isFinite(raw) || raw < 0.1) return 4.5;
        return raw;
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
                        this.nodeToKey(prevSeg.from)
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
                const entryKey = this.entryGroupKeyFromNodeKey(this.nodeToKey(seg.from));

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
                    const controller = this.intersectionControllers.get(junctionKey) ?? this.roundaboutControllers.get(junctionKey);
                    
                    if (controller) {
                        const entryKey = this.entryGroupKeyFromNodeKey(this.nodeToKey(nextSeg.from));

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
        const controller = this.intersectionControllers.get(junctionKey) ?? this.roundaboutControllers.get(junctionKey);
        if (!controller) return targetSpeed;

        const entryKey = this.entryGroupKeyFromNodeKey(this.nodeToKey(seg.from));

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
            // // Intersections: check for downstream blocking slows down simulation massively
            // const exitLaneKey = this.getExitLaneKeyForVehicle(v);
            // if (exitLaneKey) {
            //     const safetyMargin = this.cfg.spacing.minBumperGap;
            //     const requiredGap = v.length + safetyMargin;

            //     const laneStartBase = this.laneStartBaseForExitLane(exitLaneKey, v);
            //     const nearest = this.nearestDistanceFromLaneStart(exitLaneKey, laneStartBase, lanes, desiredS);

            //     if (nearest !== null && nearest.dist < requiredGap) {
            //         // blocked by downstream congestion
            //         return this.capToStopline(v, targetSpeed);
            //     }
            // }
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

        // The entry point on the outer lane (where entering vehicles merge)
        const outerR = meta.laneMidRadii.length > 0
            ? meta.laneMidRadii[meta.laneMidRadii.length - 1]
            : meta.avgRadius;
        const outerEntryPos = new THREE.Vector3(
            meta.center.x + Math.cos(entryAngle) * outerR,
            meta.center.y,
            meta.center.z + Math.sin(entryAngle) * outerR
        );

        // Also compute the inner lane entry point — vehicles going to the
        // inner lane cross ALL lanes, so we must check clearance at every
        // lane radius, not just the outer one.
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

            // Skip vehicles entering from the SAME arm — they go to
            // different circulating lanes and won't conflict with us.
            // BUT only skip if they are still near the entry point (recently
            // entered). Once they've progressed along the ring they may have
            // merged into our path and MUST be checked.
            const otherSeg = other.currentSegment;
            if (otherSeg?.phase === "inside") {
                const otherSegs = other.route.segments;
                if (otherSegs && other.segmentIndex > 0) {
                    const otherPrevSeg = otherSegs[other.segmentIndex - 1];
                    if (otherPrevSeg?.phase === "approach") {
                        const otherEntryKey = this.entryGroupKeyFromNodeKey(
                            this.nodeToKey(otherPrevSeg.from)
                        );
                        if (otherEntryKey === entryKey) {
                            // Only skip if the other vehicle is still near
                            // the start of its inside segment (recently entered).
                            const otherSegDists = this.getSegmentDistances(other.route);
                            const otherSegInfo = otherSegDists[other.segmentIndex];
                            const otherDistFromStart = otherSegInfo
                                ? (other.s - otherSegInfo.s0) : Infinity;
                            if (otherDistFromStart < 6) continue;
                        }
                    }
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
                if (this.elapsedTime < 30) console.log(`[PhysClear] v${v.id} entry=${entryKey}: BLOCKED check1 by v${other.id} dist=${distance.toFixed(1)} < gap=${clearanceGap.toFixed(1)} otherR=${otherDistFromCenter.toFixed(1)} outerR=${outerR.toFixed(1)}`);
                return false;
            }

            // Check 2: distance to the inner entry point — catches inner-lane
            // vehicles that are near the entry radially even if their own-radius
            // projection looks far away.
            const distToInnerEntry = otherPos.distanceTo(innerEntryPos);
            if (distToInnerEntry < clearanceGap) {
                if (this.elapsedTime < 30) console.log(`[PhysClear] v${v.id} entry=${entryKey}: BLOCKED check2(inner) by v${other.id} dist=${distToInnerEntry.toFixed(1)} < gap=${clearanceGap.toFixed(1)}`);
                return false;
            }

            // Check 3: distance to the outer entry point
            const distToOuterEntry = otherPos.distanceTo(outerEntryPos);
            if (distToOuterEntry < clearanceGap) {
                if (this.elapsedTime < 30) console.log(`[PhysClear] v${v.id} entry=${entryKey}: BLOCKED check3(outer) by v${other.id} dist=${distToOuterEntry.toFixed(1)} < gap=${clearanceGap.toFixed(1)}`);
                return false;
            }

            // Check 4: is this vehicle lane-changing TOWARD the outer lane
            // (i.e., heading radially outward near the entry)?
            // If so, it will cross the entry path even though it's currently
            // on an inner lane.
            if (meta.laneMidRadii.length >= 2 && otherDistFromCenter < outerR) {
                // Vehicle is inside the outer lane band. Check if it's heading
                // outward toward the entry zone.
                const otherFwd = new THREE.Vector3(
                    Math.sin(other.model.rotation.y), 0, Math.cos(other.model.rotation.y)
                );
                // Radial outward direction from center through the vehicle
                const radialOut = new THREE.Vector3(
                    otherPos.x - meta.center.x, 0, otherPos.z - meta.center.z
                ).normalize();
                const radialComponent = otherFwd.dot(radialOut);

                // If vehicle has a meaningful outward radial component,
                // it's changing to an outer lane. Check if it's near the
                // entry point angularly.
                if (radialComponent > 0.1) {
                    const distToOuter = otherPos.distanceTo(outerEntryPos);
                    // Use a larger clearance for lane-changers since they're
                    // sweeping across our merge path
                    const laneChangeClearance = clearanceGap * 1.5;
                    if (distToOuter < laneChangeClearance) return false;
                }

                // Also check: is this vehicle nearing the end of its inside
                // segment? It will soon start moving outward to exit, sweeping
                // across the entry path even if its heading hasn't turned yet.
                const otherSegDists2 = this.getSegmentDistances(other.route);
                const otherSegInfo2 = otherSegDists2[other.segmentIndex];
                if (otherSegInfo2) {
                    const otherDistToSegEnd = otherSegInfo2.s1 - other.s;
                    if (otherDistToSegEnd < 8) {
                        const distToOuter = otherPos.distanceTo(outerEntryPos);
                        if (distToOuter < clearanceGap * 1.5) return false;
                    }
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
        const entryKey = this.entryGroupKeyFromNodeKey(this.nodeToKey(nextSeg.from));

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
    private laneStartBaseForExitLane(exitLaneKey: string, v: Vehicle): number {
        const segs = v.route.segments ?? [];
        for (let i = v.segmentIndex + 1; i < segs.length; i++) {
            const s = segs[i];
            if (s.phase === "inside") continue;

            const segId = segmentId(s);
            return this.laneBases.get(exitLaneKey)?.get(segId) ?? 0;
        }
        return 0;
    }


    /** Smallest positive coordinate from the start of the lane to the back of the nearest vehicle */
    private nearestDistanceFromLaneStart(
        laneKey: string,
        laneStartBase: number,
        lanes: Map<string, LaneOcc[]>,
        desiredS: Map<Vehicle, number>
    ): { dist: number; vehicleId: number } | null {
        const occs = lanes.get(laneKey);
        if (!occs || occs.length === 0) return null;

        let bestDist = Infinity;
        let bestId = -1;

        for (const occ of occs) {
            const coord = this.occCoord(occ, laneKey, desiredS);

            // Convert absolute coord -> distance from lane start to vehicle center
            const distToCenter = coord - laneStartBase;

            // We only care about vehicles on/after the lane start
            if (distToCenter < 0) continue;

            // Calculate distance to the back of the vehicle (subtract half length)
            const distToBack = Math.max(0, distToCenter - occ.v.length * 0.5);

            if (distToBack < bestDist) {
                bestDist = distToBack;
                bestId = occ.v.id;
            }
        }

        if (!Number.isFinite(bestDist)) return null;
        return { dist: bestDist, vehicleId: bestId };
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