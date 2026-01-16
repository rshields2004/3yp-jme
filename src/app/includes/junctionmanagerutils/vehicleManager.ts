import * as THREE from "three";
import { Route, RouteSegment, getRoutePoints, estimateRouteSpacing, computeSegmentDistances } from "./carRouting";
import { IntersectionController } from "./controllers/intersectionController";
import { Vehicle } from "./vehicle";
import { JunctionObjectTypes } from "../types/types";
import { SimConfig, SimulationStats, JunctionStats, JunctionStatsGlobal, LaneOcc } from "../types/simulation";
import { RoundaboutController } from "./controllers/roundaboutController";


export class VehicleManager {
    private scene: THREE.Scene;
    private carModels: THREE.Group[];
    private routes: Route[];

    private vehicles: Vehicle[] = [];
    private nextId = 0;

    private spawned = 0;
    private completed = 0;

    // Spawn demand/queue
    private spawnDemand = 0;
    private spawnQueue = 0;

    // laneKey -> (segmentId -> baseOffset)
    private laneBases = new Map<string, Map<string, number>>();
    private laneBasesBuilt = false;

    // Cache for segment distance info (s0, s1) per route
    private routeSegmentDistances = new Map<Route, Array<{ s0: number; s1: number }>>();
    
    // Cache for route points and spacing
    private routePointsCache = new Map<Route, [number, number, number][]>();
    private routeSpacingCache = new Map<Route, number>();

    private cfg: SimConfig;

    private intersectionControllers = new Map<string, IntersectionController>();
    private roundaboutControllers = new Map<string, RoundaboutController>();
    private controllersBuilt = false;

    private lastSpawnQueueLogged: number | null = null;
    private lastActiveLogged: number | null = null;

    private statsSnapshot: SimulationStats | null = null;
    private junctionCounters = new Map<string, { entered: number; exited: number; totalWaitTime: number; waitCount: number }>();
    private lastVehJunctionTag = new Map<number, { jid: string | null; phase: string | null }>();
    private elapsedTime = 0;
    // Track when each vehicle started waiting at a junction (vehicleId -> { junctionId, startTime })
    private vehicleWaitStart = new Map<number, { jid: string; startTime: number }>();


    constructor(scene: THREE.Scene, carModels: THREE.Group[], routes: Route[], cfg?: Partial<SimConfig>) {
        this.scene = scene;
        this.carModels = carModels;
        this.routes = routes;

        this.cfg = {
            demandRatePerSec: 0.8,
            maxVehicles: 40,
            maxSpawnAttemptsPerFrame: 6,
            maxSpawnQueue: 25,

            initialSpeed: 0,
            maxSpeed: 10,
            maxAccel: 3.0,
            maxDecel: 6.0,
            comfortDecel: 3,
            maxJerk: 10,

            minBumperGap: 2.0,
            timeHeadway: 1.5,

            yOffset: 0.0,
            stopLineOffset: 0.4,

            enableLaneQueuing: true,
            debugLaneQueues: false,

            ...cfg,
        };
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
    private getRoutePointsCached(route: Route): [number, number, number][] {
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
            v.model.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
                    else child.material?.dispose();
                }
            });
        }

        this.vehicles = [];
        this.nextId = 0;

        this.spawned = 0;
        this.completed = 0;

        this.spawnDemand = 0;
        this.spawnQueue = 0;

        this.laneBases.clear();
        this.laneBasesBuilt = false;

        this.routeSegmentDistances.clear();
        this.routePointsCache.clear();
        this.routeSpacingCache.clear();

        this.intersectionControllers.clear();
        this.roundaboutControllers.clear();
        this.controllersBuilt = false;

        this.lastSpawnQueueLogged = null;
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
        for (const c of this.intersectionControllers.values()) c.update(dt);
        for (const c of this.roundaboutControllers.values()) c.update(dt);

        // 1) demand -> queue
        this.spawnDemand += this.cfg.demandRatePerSec * dt;
        const newCars = Math.floor(this.spawnDemand);

        if (newCars > 0) {
            this.spawnDemand -= newCars;

            this.spawnQueue = Math.min(
                this.spawnQueue + newCars,
                this.cfg.maxSpawnQueue
            );
        }

        // 2) serve queue
        let attempts = 0;
        while (
            this.spawnQueue > 0 &&
            this.vehicles.length < this.cfg.maxVehicles &&
            attempts < this.cfg.maxSpawnAttemptsPerFrame
        ) {
            attempts++;
            const ok = this.trySpawnOne();
            if (ok) this.spawnQueue--;
            else break;
        }

        this.logSpawnQueueIfChanged();
        this.logActiveVehiclesIfChanged();

        // 3) refresh segment/laneKey before lane logic
        for (const v of this.vehicles) this.updateVehicleSegment(v);

        // 4) compute desiredS with accel/decel + queuing constraints
        const desiredS = new Map<Vehicle, number>();

        if (this.cfg.enableLaneQueuing) {
            this.applyLaneQueuingWithKinematics(dt, desiredS);
        } else {
            for (const v of this.vehicles) {
                v.speed = this.approachSpeed(v.speed, v.preferredSpeed, dt, v);
                desiredS.set(v, v.s + v.speed * dt);
            }
        }

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

    private logSpawnQueueIfChanged() {
        if (this.lastSpawnQueueLogged === null) {
            this.lastSpawnQueueLogged = this.spawnQueue;
            console.log(`[spawn-queue] ${this.spawnQueue}`);
            return;
        }

        if (this.spawnQueue !== this.lastSpawnQueueLogged) {
            console.log(`[spawn-queue] ${this.spawnQueue} (${this.lastSpawnQueueLogged} -> ${this.spawnQueue})`);
            this.lastSpawnQueueLogged = this.spawnQueue;
        }
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

    private calculateSafeFollowingSpeed(follower: Vehicle, leaderSpeed: number, currentGap: number): number {
        const { maxSpeed, minBumperGap } = this.cfg;
        const maxDecel = follower.maxDecel;
        const timeHeadway = follower.timeHeadway;

        if (currentGap <= minBumperGap * 0.5) return 0;

        const availableGap = Math.max(0, currentGap - minBumperGap * 0.5);
        const kinematicSafeSpeed = Math.sqrt(2 * maxDecel * availableGap);

        const desiredGap = minBumperGap + Math.max(0, follower.speed * timeHeadway);

        if (currentGap > desiredGap * 2) {
            return Math.min(follower.preferredSpeed, kinematicSafeSpeed);
        }

        if (currentGap >= desiredGap) {
            const blendFactor = (currentGap - desiredGap) / desiredGap;
            const blendedSpeed = leaderSpeed + blendFactor * (follower.preferredSpeed - leaderSpeed);
            return Math.min(blendedSpeed, kinematicSafeSpeed);
        }

        const gapRatio = currentGap / desiredGap;
        const targetSpeed = follower.preferredSpeed * gapRatio;

        if (gapRatio < 0.7) {
            return Math.max(0, Math.min(targetSpeed, leaderSpeed, kinematicSafeSpeed));
        }

        return Math.max(0, Math.min(targetSpeed, kinematicSafeSpeed));
    }

    private stoppingDistance(speed: number, vehicle?: Vehicle): number {
        const decel = vehicle ? vehicle.maxDecel : this.cfg.maxDecel;
        return (speed * speed) / (2 * decel);
    }

    private maxSpeedForDistance(distance: number, vehicle?: Vehicle): number {
        if (distance <= 0) return 0;
        const decel = vehicle ? vehicle.maxDecel : this.cfg.maxDecel;
        return Math.sqrt(2 * decel * distance);
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
                if (exitLaneKey) {
                    const arr = lanes.get(exitLaneKey) ?? [];
                    // pin to lane start (coord = base + 0)
                    arr.push({ v, pinnedCoord: this.laneStartCoordForExitLane(exitLaneKey, v) });
                    lanes.set(exitLaneKey, arr);
                }
            }
        }

        // Sort within lanes by lane coordinate (front-to-back)
        for (const laneOccs of lanes.values()) {
            laneOccs.sort((a, b) => this.occCoord(b, b.v.laneKey, desiredS) - this.occCoord(a, a.v.laneKey, desiredS));
        }

        // STEP 3: Process each route front-to-back
        for (const [, routeVehicles] of vehiclesByRoute.entries()) {
            for (let i = 0; i < routeVehicles.length; i++) {
                const v = routeVehicles[i];

                let leader: Vehicle | null = null;
                let leaderGap = Infinity;

                // A) Same-route leader
                if (i > 0) {
                    const sameRouteLead = routeVehicles[i - 1];
                    const leadS = desiredS.get(sameRouteLead) ?? sameRouteLead.s;
                    const gap = (leadS - v.s) - 0.5 * (sameRouteLead.length + v.length);
                    if (gap < leaderGap) {
                        leaderGap = gap;
                        leader = sameRouteLead;
                    }
                }

                // B) Same-lane leader from different route (shared physical lane)
                if (v.laneKey) {
                    const laneOccs = lanes.get(v.laneKey) ?? [];
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

                // C) Cross-segment lookahead: link->approach
                const lookaheadResult = this.findLeaderInUpcomingSegments(v, lanes, desiredS);
                if (lookaheadResult && lookaheadResult.gap < leaderGap) {
                    leaderGap = lookaheadResult.gap;
                    leader = lookaheadResult.leader;
                }

                let targetSpeed = v.preferredSpeed;

                if (leader) {
                    targetSpeed = this.calculateSafeFollowingSpeed(v, leader.speed, leaderGap);
                }

                if (lookaheadResult && lookaheadResult.gap < this.stoppingDistance(v.speed, v) + 5) {
                    const boundarySpeedCap = this.getSegmentBoundarySpeedCap(v);
                    targetSpeed = Math.min(targetSpeed, boundarySpeedCap);
                }

                // STOPLINE + DOWNSTREAM BLOCKING (fixes "cars inside junction can't look ahead onto exit")
                const stoplineSpeed = this.applyStoplineAndDownstreamCap(v, targetSpeed, lanes, desiredS);
                
                // For safety-critical signals (red lights), bypass smoothing for immediate response
                // Check both current approach segments AND link segments looking ahead to red lights
                const isOnApproach = v.currentSegment?.phase === "approach";
                const isLookingAheadToStopline = v.currentSegment?.phase === "link" && stoplineSpeed < targetSpeed;
                const isStoppingForLight = stoplineSpeed < targetSpeed && (isOnApproach || isLookingAheadToStopline);
                
                // Apply speed smoothing for more natural behavior (but not for red lights)
                const smoothedSpeed = isStoppingForLight ? stoplineSpeed : v.smoothTargetSpeed(dt, stoplineSpeed);

                const brakingDist = this.stoppingDistance(v.speed, v);
                const isEmergency = leader && leaderGap < brakingDist && leaderGap < 10;

                if (isEmergency || isStoppingForLight) {
                    // Immediate response for emergencies and red lights
                    v.speed = Math.max(smoothedSpeed, v.speed - v.maxDecel * 1.5 * dt);
                } else {
                    v.speed = this.approachSpeed(v.speed, smoothedSpeed, dt, v);
                }

                let newS = v.s + v.speed * dt;

                // Hard collision prevention for same-route leader
                if (leader && leader.route === v.route) {
                    const leaderS = desiredS.get(leader) ?? leader.s;
                    const minSafeS = leaderS - 0.5 * (leader.length + v.length) - this.cfg.minBumperGap;
                    if (newS > minSafeS) {
                        newS = Math.max(v.s, minSafeS);
                        v.speed = 0;
                    }
                }

                // Hard collision prevention for cross-route leader
                if (leader && leader.route !== v.route) {
                    const newGap = this.estimateGapAfterMove(v, newS, leader, desiredS);
                    if (newGap < this.cfg.minBumperGap) {
                        newS = v.s;
                        v.speed = 0;
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
            const base = this.laneBases.get(nextLaneKey)?.get(this.segmentId(nextSeg)) ?? 0;
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

    private approachSpeed(current: number, target: number, dt: number, vehicle: Vehicle): number {
        const maxAccel = vehicle.maxAccel;
        const maxDecel = vehicle.maxDecel;
        
        if (target > current) return Math.min(target, current + maxAccel * dt);
        return Math.max(target, current - maxDecel * dt);
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

        const segId = this.segmentId(seg);
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
                const id = this.segmentId(seg);

                const laneMap = perLane.get(laneKey) ?? new Map<string, RouteSegment>();
                if (!laneMap.has(id)) laneMap.set(id, seg);
                perLane.set(laneKey, laneMap);
            }
        }

        for (const [laneKey, segMap] of perLane.entries()) {
            const segs = Array.from(segMap.values());
            const ids = segs.map((s) => this.segmentId(s));

            const next = new Map<string, string[]>();
            const indeg = new Map<string, number>();
            for (const id of ids) {
                next.set(id, []);
                indeg.set(id, 0);
            }

            for (const a of segs) {
                for (const b of segs) {
                    if (a === b) continue;
                    if (a.to === b.from) {
                        const aid = this.segmentId(a);
                        const bid = this.segmentId(b);
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
                const len = this.segmentLen(seg);

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

    private segmentId(seg: RouteSegment): string {
        const fromKey = `${seg.from.structureID}-${seg.from.exitIndex}-${seg.from.direction}-${seg.from.laneIndex}`;
        const toKey = `${seg.to.structureID}-${seg.to.exitIndex}-${seg.to.direction}-${seg.to.laneIndex}`;
        return `${seg.phase}|${fromKey}|${toKey}`;
    }

    private segmentLen(seg: RouteSegment): number {
        if (!seg.points || seg.points.length < 2) return 0;
        let len = 0;
        for (let i = 1; i < seg.points.length; i++) {
            const dx = seg.points[i][0] - seg.points[i-1][0];
            const dy = seg.points[i][1] - seg.points[i-1][1];
            const dz = seg.points[i][2] - seg.points[i-1][2];
            len += Math.sqrt(dx*dx + dy*dy + dz*dz);
        }
        return len;
    }

    // -----------------------
    // Spawning
    // -----------------------

    private trySpawnOne(): boolean {
        if (!this.routes.length || !this.carModels.length) return false;

        const route = this.routes[Math.floor(Math.random() * this.routes.length)];
        const points = this.getRoutePointsCached(route);
        if (!points || points.length < 2) return false;

        const template = this.carModels[Math.floor(Math.random() * this.carModels.length)];
        const model = template.clone(true);

        const length = this.computeModelLength(model);

        if (!this.hasSpawnSpace(route, length)) return false;

        const p0 = points[0];
        const p1 = points[1];

        const pos0 = new THREE.Vector3(p0[0], p0[1] + this.cfg.yOffset, p0[2]);
        const pos1 = new THREE.Vector3(p1[0], p1[1] + this.cfg.yOffset, p1[2]);

        model.position.copy(pos0);

        const dir = pos1.clone().sub(pos0);
        if (dir.lengthSq() > 1e-6) {
            dir.normalize();
            const yaw = Math.atan2(dir.x, dir.z);
            model.rotation.set(0, yaw, 0);
        }

        this.scene.add(model);

        const v = new Vehicle(this.nextId++, model, route, length, this.cfg.initialSpeed);
        
        // Initialize per-vehicle characteristics based on config with variation
        const random = () => 0.85 + Math.random() * 0.3;
        v.maxAccel = this.cfg.maxAccel * random();
        v.maxDecel = this.cfg.maxDecel * random();
        v.preferredSpeed = this.cfg.maxSpeed * random();
        v.reactionTime = 0.15 + Math.random() * 0.25;
        v.timeHeadway = this.cfg.timeHeadway * (0.8 + Math.random() * 0.4);
        
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

        const brakingDistance = (this.cfg.initialSpeed * this.cfg.initialSpeed) / (2 * this.cfg.maxDecel);
        const timeHeadwayBuffer = this.cfg.initialSpeed * this.cfg.timeHeadway;

        const safetyBuffer = Math.max(brakingDistance, timeHeadwayBuffer);
        const required = newLen + this.cfg.minBumperGap + safetyBuffer;

        return nearestS >= required;
    }

    // -----------------------
    // Segment / laneKey tracking
    // -----------------------

    private laneKeyForSegment(seg: RouteSegment): string {
        // For roundabouts, we NEED to track "inside" phase to prevent collisions
        if (seg.phase === "inside") {
            const junctionId = seg.to.structureID;
            const isRoundabout = this.roundaboutControllers.has(junctionId);
            if (isRoundabout) {
                // Use the roundabout junction as the lane key
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
    }

    // -----------------------
    // Apply desired s -> pose
    // -----------------------

    private applySAndPose(v: Vehicle, targetS: number): boolean {
        const pts = this.getRoutePointsCached(v.route);
        if (!pts || pts.length < 2) return true;

        const spacing = this.getRouteSpacing(v.route);
        const maxS = (pts.length - 1) * spacing;

        v.s = Math.max(0, Math.min(targetS, maxS));

        const idxFloat = v.s / spacing;
        let idx = Math.floor(idxFloat);
        let t = idxFloat - idx;

        if (idx >= pts.length - 1) {
            idx = pts.length - 2;
            t = 1;
        } else if (idx < 0) {
            idx = 0;
            t = 0;
        }

        v.routeIndex = idx;
        v.t = t;

        const a = pts[idx];
        const b = pts[idx + 1];

        const pA = new THREE.Vector3(a[0], a[1] + this.cfg.yOffset, a[2]);
        const pB = new THREE.Vector3(b[0], b[1] + this.cfg.yOffset, b[2]);

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
            const junctionType = junctionObjectRefs.current.find(
                (g) => g?.userData?.id === junctionKey
            )?.userData?.type;
            const isRoundabout = junctionType === "roundabout" ||
                junctionKey.toLowerCase().includes("roundabout") ||
                junctionKey.toLowerCase().includes("rndbt");

            if (isRoundabout) {
                this.roundaboutControllers.set(
                    junctionKey,
                    new RoundaboutController(junctionKey, Array.from(laneSet))
                );
            }
            else {
                this.intersectionControllers.set(
                    junctionKey,
                    new IntersectionController(junctionKey, Array.from(laneSet), 8, 1)
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
                
                // Only start slowing down if stopline is within lookahead distance
                const brakingDist = this.stoppingDistance(v.speed, v);
                const lookaheadDist = Math.max(brakingDist * 1.5, 20); // Start slowing earlier
                
                if (totalDistToStopline < lookaheadDist) {
                    // Check if the light will be red
                    const junctionKey = nextSeg.to.structureID;
                    const controller = this.intersectionControllers.get(junctionKey) ?? this.roundaboutControllers.get(junctionKey);
                    
                    if (controller) {
                        const entryKey = this.entryGroupKeyFromNodeKey(this.nodeToKey(nextSeg.from));
                        const green = controller.isGreen(entryKey);
                        
                        if (!green) {
                            // Red light ahead - start slowing down
                            const frontOffset = 0.5 * v.length;
                            const stopBuffer = this.cfg.stopLineOffset;
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

        const green = controller.isGreen(entryKey);

        // If green, check downstream space ONLY for regular intersections
        // Roundabouts: if green, just go (roundabout controller manages yield)
        if (green) {
            const isRoundabout = this.roundaboutControllers.has(junctionKey);
            if (!isRoundabout) {
                // Intersections: check for downstream blocking
                const exitLaneKey = this.getExitLaneKeyForVehicle(v);
                if (exitLaneKey) {
                    const safetyMargin = Math.max(v.speed * v.timeHeadway * 0.5, this.cfg.minBumperGap);
                    const requiredGap = v.length + safetyMargin;

                    const laneStartBase = this.laneStartBaseForExitLane(exitLaneKey, v);
                    const nearest = this.nearestDistanceFromLaneStart(exitLaneKey, laneStartBase, lanes, desiredS);

                    if (nearest !== null && nearest.dist < requiredGap) {
                        // blocked by downstream congestion
                        return this.capToStopline(v, targetSpeed, seg);
                    }
                }
            }
            // If green: roundabout vehicles just go, intersection vehicles go if not blocked
            return targetSpeed;
        }

        // red -> stop at line
        return this.capToStopline(v, targetSpeed, seg);
    }

    private capToStopline(v: Vehicle, targetSpeed: number, seg: RouteSegment): number {
        const frontOffset = 0.5 * v.length;

        // additional buffer so cars stop *before* the stop line
        const stopBuffer = this.cfg.stopLineOffset;

        const segDists = this.getSegmentDistances(v.route);
        const segInfo = segDists[v.segmentIndex];
        const stopS = (segInfo?.s1 ?? 0) - frontOffset - stopBuffer;

        const dist = stopS - v.s;
        if (dist <= 0) return 0;

        const vmax = Math.sqrt(2 * v.maxDecel * dist);
        return Math.min(targetSpeed, vmax);
    }
    private laneStartBaseForExitLane(exitLaneKey: string, v: Vehicle): number {
        const segs = v.route.segments ?? [];
        for (let i = v.segmentIndex + 1; i < segs.length; i++) {
            const s = segs[i];
            if (s.phase === "inside") continue;

            const segId = this.segmentId(s);
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
            const segId = this.segmentId(s);
            const base = this.laneBases.get(exitLaneKey)?.get(segId) ?? 0;
            return base; // "start of lane"
        }
        return 0;
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
                        const entryKey = this.entryGroupKeyFromNodeKey(this.nodeToKey(seg.from));
                        roundabout.registerVehicleEntering(v.id, entryKey);
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
                        const entryKey = this.entryGroupKeyFromNodeKey(this.nodeToKey(seg.from));
                        roundabout.registerVehicleExiting(v.id, entryKey);
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
        const snapshot: SimulationStats = {
            active: this.vehicles.length,
            spawned: this.spawned,
            completed: this.completed,
            spawnQueue: this.spawnQueue,
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