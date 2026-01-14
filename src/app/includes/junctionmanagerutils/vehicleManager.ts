import * as THREE from "three";
import { Route, RouteSegment } from "./carRouting";
import { IntersectionController } from "./controllers/intersectionController";

type VehicleSimStats = {
    active: number;
    spawned: number;
    completed: number;
    spawnQueue: number;
};

type SimConfig = {
    // Spawning
    demandRatePerSec: number;
    maxVehicles: number;
    maxSpawnAttemptsPerFrame: number;

    // Motion
    initialSpeed: number; // NEW: configurable initial spawn speed
    maxSpeed: number; // cruise speed
    maxAccel: number; // +m/s^2
    maxDecel: number; // +m/s^2 (braking)

    // Spacing
    minBumperGap: number; // bumper-to-bumper gap at rest
    timeHeadway: number;  // NEW: time-based following distance (seconds)

    // Rendering
    yOffset: number;

    // Stage 2
    enableLaneQueuing: boolean;
    debugLaneQueues: boolean;
};

class Vehicle {
    id: number;
    model: THREE.Group;
    route: Route;

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

    // NEW: stable start-lane identifier for spawn spacing (NOT route-dependent)
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

    private cfg: SimConfig;

    private intersectionControllers = new Map<string, IntersectionController>();
    private controllersBuilt = false;

    constructor(scene: THREE.Scene, carModels: THREE.Group[], routes: Route[], cfg?: Partial<SimConfig>) {
        this.scene = scene;
        this.carModels = carModels;
        this.routes = routes;

        this.cfg = {
            demandRatePerSec: 0.8,
            maxVehicles: 40,
            maxSpawnAttemptsPerFrame: 6,

            initialSpeed: 0,  // NEW: default to 0, can be configured
            maxSpeed: 10,
            maxAccel: 3.0,
            maxDecel: 6.0,

            minBumperGap: 2.0,
            timeHeadway: 1.5,  // NEW: 1.5 second following distance

            yOffset: 0.0,

            enableLaneQueuing: true,
            debugLaneQueues: false,

            ...cfg,
        };
    }

    private junctionIdFromNodeKey(k: string): string {
        // Your NodeKey format appears to start with a UUID, followed by "-<exit>-<in/out>-<lane>"
        // e.g. "UUID-2-out-0" or "UUID-0-in-0"
        // So junction id is the first 36 chars of a UUID.
        if (!k) return k;
        return k.length >= 36 ? k.slice(0, 36) : k;
    }

    public getIntersectionController(junctionId: string): IntersectionController | null {
        return this.intersectionControllers.get(junctionId) ?? null;
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

        this.intersectionControllers.clear();
        this.controllersBuilt = false;
    }

    public getStats(): VehicleSimStats {
        return {
            active: this.vehicles.length,
            spawned: this.spawned,
            completed: this.completed,
            spawnQueue: this.spawnQueue,
        };
    }

    public update(dt: number) {
        if (!this.routes.length) return;

        if (!this.laneBasesBuilt) this.buildLaneBases();

        this.buildControllersIfNeeded();
        for (const c of this.intersectionControllers.values()) c.update(dt);


        // 1) demand -> queue
        this.spawnDemand += this.cfg.demandRatePerSec * dt;
        const newCars = Math.floor(this.spawnDemand);
        if (newCars > 0) {
            this.spawnDemand -= newCars;
            this.spawnQueue += newCars;
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

        // 3) refresh segment/laneKey before lane logic
        for (const v of this.vehicles) this.updateVehicleSegment(v);

        // 4) compute desiredS with accel/decel + queuing constraints
        const desiredS = new Map<Vehicle, number>();

        if (this.cfg.enableLaneQueuing) {
            this.applyLaneQueuingWithKinematics(dt, desiredS);
        } else {
            for (const v of this.vehicles) {
                v.speed = this.approachSpeed(v.speed, this.cfg.maxSpeed, dt);
                desiredS.set(v, v.s + v.speed * dt);
            }
        }

        // 5) apply desired s -> pose + despawn
        for (let i = this.vehicles.length - 1; i >= 0; i--) {
            const v = this.vehicles[i];
            const target = desiredS.get(v) ?? v.s;
            const done = this.applySAndPose(v, target);

            if (done) {
                this.scene.remove(v.model);
                this.vehicles.splice(i, 1);
                this.completed += 1;
            }
        }
        
    }

    // -----------------------
    // Stage 2: lane queuing + accel/decel (REFACTORED with proper kinematics)
    // -----------------------

    /**
     * Calculate the safe following speed based on gap to leader.
     * Uses simple kinematic constraint: must be able to stop in available gap.
     */
    private calculateSafeFollowingSpeed(
        followerSpeed: number,
        leaderSpeed: number,
        currentGap: number,  // actual bumper-to-bumper distance
    ): number {
        const { maxSpeed, maxDecel, minBumperGap, timeHeadway } = this.cfg;

        // If gap is negative or very small, must stop
        if (currentGap <= minBumperGap * 0.5) {
            return 0;
        }

        // Kinematic safe speed: max speed to stop in available gap
        // v_safe = sqrt(2 * decel * available_gap)
        const availableGap = Math.max(0, currentGap - minBumperGap * 0.5);
        const kinematicSafeSpeed = Math.sqrt(2 * maxDecel * availableGap);

        // Desired gap for comfortable following: minimum gap + speed-dependent headway
        const desiredGap = minBumperGap + Math.max(0, followerSpeed * timeHeadway);

        // If gap is very large (> 2x desired), just use kinematic limit - accelerate freely
        // This prevents slow acceleration when a stopped car is far ahead
        if (currentGap > desiredGap * 2) {
            return Math.min(maxSpeed, kinematicSafeSpeed);
        }

        // If gap is between desiredGap and 2*desiredGap, blend towards maxSpeed
        if (currentGap >= desiredGap) {
            // Comfortable zone - can go faster than leader, blend towards max
            const blendFactor = (currentGap - desiredGap) / desiredGap; // 0 to 1
            const blendedSpeed = leaderSpeed + blendFactor * (maxSpeed - leaderSpeed);
            return Math.min(blendedSpeed, kinematicSafeSpeed);
        }

        // Gap is less than desired - need to slow down
        // Use gap ratio to determine how much to slow
        const gapRatio = currentGap / desiredGap;
        
        // Target a speed proportional to gap, but don't exceed leader speed
        // (we need to slow down to open the gap)
        const targetSpeed = maxSpeed * gapRatio;
        
        // Only limit to leader speed if we're quite close (< 70% of desired gap)
        // This prevents the "stuck behind slow car" problem when gap is reasonable
        if (gapRatio < 0.7) {
            return Math.max(0, Math.min(targetSpeed, leaderSpeed, kinematicSafeSpeed));
        }
        
        return Math.max(0, Math.min(targetSpeed, kinematicSafeSpeed));
    }

    /**
     * Calculate stopping distance from current speed using kinematic equation.
     * d = v² / (2 * decel)
     */
    private stoppingDistance(speed: number): number {
        return (speed * speed) / (2 * this.cfg.maxDecel);
    }

    /**
     * Calculate maximum speed to stop within given distance.
     * v_max = sqrt(2 * decel * distance)
     */
    private maxSpeedForDistance(distance: number): number {
        if (distance <= 0) return 0;
        return Math.sqrt(2 * this.cfg.maxDecel * distance);
    }

    private applyLaneQueuingWithKinematics(dt: number, desiredS: Map<Vehicle, number>) {
        // STEP 1: Build same-route vehicle lists
        const vehiclesByRoute = new Map<Route, Vehicle[]>();
        for (const v of this.vehicles) {
            const arr = vehiclesByRoute.get(v.route) ?? [];
            arr.push(v);
            vehiclesByRoute.set(v.route, arr);
        }

        // Sort each route's vehicles front-to-back by s (highest s first)
        for (const vehicles of vehiclesByRoute.values()) {
            vehicles.sort((a, b) => b.s - a.s);
        }

        // STEP 2: Build lane groups for cross-route collision detection
        const lanes = new Map<string, Vehicle[]>();
        for (const v of this.vehicles) {
            if (!v.laneKey) continue;
            const arr = lanes.get(v.laneKey) ?? [];
            arr.push(v);
            lanes.set(v.laneKey, arr);
        }

        // Sort within lanes by lane coordinate
        for (const laneVehicles of lanes.values()) {
            laneVehicles.sort((a, b) => this.laneCoord(b) - this.laneCoord(a));
        }

        // STEP 3: Process each route front-to-back
        // This ensures same-route vehicles are processed in correct order
        for (const [route, routeVehicles] of vehiclesByRoute.entries()) {
            for (let i = 0; i < routeVehicles.length; i++) {
                const v = routeVehicles[i];

                // Find leader: check same-route, same-lane, AND upcoming segments
                let leader: Vehicle | null = null;
                let leaderGap = Infinity;

                // A) Same-route leader (the vehicle directly ahead on this route)
                if (i > 0) {
                    const sameRouteLead = routeVehicles[i - 1];
                    const leadS = desiredS.get(sameRouteLead) ?? sameRouteLead.s;
                    const gap = (leadS - v.s) - 0.5 * (sameRouteLead.length + v.length);
                    if (gap < leaderGap) {
                        leaderGap = gap;
                        leader = sameRouteLead;
                    }
                }

                // B) Same-lane leader from different route (handles merging)
                // Cars on different routes CAN share the same physical lane
                if (v.laneKey) {
                    const laneVehicles = lanes.get(v.laneKey) ?? [];
                    const myCoord = this.laneCoord(v);

                    for (const other of laneVehicles) {
                        if (other === v) continue;
                        if (other.route === v.route) continue;

                        const otherCoord = this.laneCoordFromS(other, desiredS.get(other) ?? other.s);
                        if (otherCoord <= myCoord) continue; // not ahead

                        // IMPORTANT: centre-based bumper gap (see Fix 2)
                        const gap = (otherCoord - myCoord) - 0.5 * (other.length + v.length);

                        if (gap < leaderGap) {
                            leaderGap = gap;
                            leader = other;
                        }
                    }
                }

                // C) Cross-segment lookahead: find vehicles in NEXT segment's lane
                // This handles link->approach transitions where different routes share the approach
                const lookaheadResult = this.findLeaderInUpcomingSegments(v, lanes, desiredS);
                if (lookaheadResult && lookaheadResult.gap < leaderGap) {
                    leaderGap = lookaheadResult.gap;
                    leader = lookaheadResult.leader;
                }

                // Calculate target speed
                let targetSpeed = this.cfg.maxSpeed;

                if (leader) {
                    targetSpeed = this.calculateSafeFollowingSpeed(v.speed, leader.speed, leaderGap);
                }

                // If we found a leader via lookahead (cross-route in next segment),
                // apply additional caution near segment boundary
                if (lookaheadResult && lookaheadResult.gap < this.stoppingDistance(v.speed) + 5) {
                    const boundarySpeedCap = this.getSegmentBoundarySpeedCap(v);
                    targetSpeed = Math.min(targetSpeed, boundarySpeedCap);
                }

                // Apply stopline cap (traffic lights)
                targetSpeed = this.applyStoplineCap(v, targetSpeed);

                // Use emergency braking if gap is critical (less than braking distance)
                const brakingDist = this.stoppingDistance(v.speed);
                const isEmergency = leader && leaderGap < brakingDist && leaderGap < 10;

                // Smoothly approach target (with emergency braking if needed)
                if (isEmergency) {
                    // Emergency: use 1.5x max deceleration
                    v.speed = Math.max(targetSpeed, v.speed - this.cfg.maxDecel * 1.5 * dt);
                } else {
                    v.speed = this.approachSpeed(v.speed, targetSpeed, dt);
                }

                // Calculate new position
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

                    // FINAL safety clamp: do not allow overlap
                    if (newGap < this.cfg.minBumperGap) {
                        newS = v.s;   // freeze position
                        v.speed = 0;  // full stop
                    }
                }

                desiredS.set(v, newS);
            }
        }
    }

    /**
     * Look ahead into upcoming segments to find vehicles that might be queued there.
     * This handles the link->approach transition where a fast car on a link needs to
     * see slow/stopped cars on the approach (possibly from different routes).
     */
    private findLeaderInUpcomingSegments(
        v: Vehicle,
        lanes: Map<string, Vehicle[]>,
        desiredS: Map<Vehicle, number>
    ): { leader: Vehicle; gap: number } | null {
        const segs = v.route.segments;
        if (!segs || v.segmentIndex >= segs.length - 1) return null;

        const currentSeg = v.currentSegment;
        if (!currentSeg) return null;

        // Only do cross-segment lookahead on link phase (link -> approach transition)
        // This is where the original problem occurred
        if (currentSeg.phase !== "link") {
            return null;
        }

        // Distance from current position to end of current segment
        const distToSegEnd = Math.max(0, (currentSeg.s1 ?? 0) - v.s);

        // Calculate required braking distance at current speed
        const brakingDist = this.stoppingDistance(v.speed);
        
        // Look ahead far enough to cover braking distance + buffer
        const lookaheadDist = Math.max(brakingDist + 10, 30);

        // Only look at the NEXT segment's lane
        const nextSegIdx = v.segmentIndex + 1;
        if (nextSegIdx >= segs.length) return null;
        
        const nextSeg = segs[nextSegIdx];
        const nextLaneKey = this.laneKeyForSegment(nextSeg);
        
        // Skip if next segment has no laneKey (inside junction)
        if (!nextLaneKey) return null;

        // Find vehicles in the next segment's lane
        const laneVehicles = lanes.get(nextLaneKey) ?? [];
        
        let closestLeader: Vehicle | null = null;
        let closestGap = Infinity;

        for (const other of laneVehicles) {
            if (other === v) continue;
            if (other.route === v.route) continue; // Same-route handled elsewhere

            const otherSeg = other.currentSegment;
            if (!otherSeg) continue;
            
            // Only match vehicles in the same phase as our next segment
            // (e.g., if next segment is "approach", only match other "approach" vehicles)
            if (otherSeg.phase !== nextSeg.phase) continue;

            // Other's distance from start of their segment
            const otherDistInSeg = other.s - (otherSeg.s0 ?? 0);

            // Total gap = distance to next segment + other's position - other's length
            const gap = distToSegEnd + otherDistInSeg - other.length;

            // Only consider if gap is reasonable (positive and within lookahead distance)
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
     * Calculate a safe approach speed when nearing a segment boundary.
     * This ensures we can stop in time if there's a queue in the next segment.
     */
    private getSegmentBoundarySpeedCap(v: Vehicle): number {
        const currentSeg = v.currentSegment;
        if (!currentSeg) return this.cfg.maxSpeed;

        // Distance to end of current segment
        const distToSegEnd = Math.max(0, (currentSeg.s1 ?? 0) - v.s);

        // Only apply cap when close to boundary (within braking distance + buffer)
        const cautionZone = this.stoppingDistance(this.cfg.maxSpeed) + 5;
        
        if (distToSegEnd > cautionZone) {
            return this.cfg.maxSpeed; // Far from boundary, no cap
        }

        // When close to boundary, cap speed so we can stop at the boundary if needed
        // This gives us time to react to queues in the next segment
        // v_max = sqrt(2 * decel * distance)
        const safeSpeed = Math.sqrt(2 * this.cfg.maxDecel * Math.max(0.5, distToSegEnd));
        
        return Math.max(safeSpeed, 2); // Minimum 2 m/s to keep moving
    }

    /**
     * Estimate gap to a cross-route leader after moving to newS
     */
    private estimateGapAfterMove(
        follower: Vehicle,
        newS: number,
        leader: Vehicle,
        desiredS: Map<Vehicle, number>
    ): number {
        // If same lane, use lane coordinates
        if (follower.laneKey && follower.laneKey === leader.laneKey) {
            const myNewCoord = this.laneCoordFromS(follower, newS);
            const leaderCoord = this.laneCoordFromS(leader, desiredS.get(leader) ?? leader.s);
            return (leaderCoord - myNewCoord) - 0.5 * (leader.length + follower.length);
        }

        // For cross-segment, estimate based on segment boundaries
        const currentSeg = follower.currentSegment;
        if (!currentSeg) return Infinity;

        const distToSegEnd = Math.max(0, (currentSeg.s1 ?? 0) - newS);
        const leaderSeg = leader.currentSegment;
        if (!leaderSeg) return Infinity;

        const leaderDistInSeg = leader.s - (leaderSeg.s0 ?? 0);

        return distToSegEnd + leaderDistInSeg - leader.length;
    }

    private approachSpeed(current: number, target: number, dt: number): number {
        if (target > current) {
            return Math.min(target, current + this.cfg.maxAccel * dt);
        }
        return Math.max(target, current - this.cfg.maxDecel * dt);
    }

    // -----------------------
    // Lane coordinate system (fixes merge/boundary deadlocks)
    // -----------------------

    private laneCoord(v: Vehicle): number {
        return this.laneCoordFromS(v, v.s);
    }

    private laneCoordFromS(v: Vehicle, sValue: number): number {
        const seg = v.currentSegment;
        if (!seg || !v.laneKey) return sValue;

        const segId = this.segmentId(seg);
        const base = this.laneBases.get(v.laneKey)?.get(segId) ?? 0;
        return base + (sValue - (seg.s0 ?? 0));
    }

    private buildLaneBases() {
        this.laneBases.clear();

        // collect segments per laneKey (dedup)
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

        // build base offsets via simple connectivity (A.to === B.from)
        for (const [laneKey, segMap] of perLane.entries()) {
            const segs = Array.from(segMap.values());
            const ids = segs.map((s) => this.segmentId(s));

            const next = new Map<string, string[]>();
            const indeg = new Map<string, number>();
            for (const id of ids) {
                next.set(id, []);
                indeg.set(id, 0);
            }

            // NOTE: O(n^2) but usually small
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

            // fallback
            for (const id of ids) if (!bases.has(id)) bases.set(id, 0);

            this.laneBases.set(laneKey, bases);
        }

        this.laneBasesBuilt = true;
    }

    private segmentId(seg: RouteSegment): string {
        return `${seg.phase}|${seg.from}|${seg.to}|${(seg.s0 ?? 0).toFixed(3)}|${(seg.s1 ?? 0).toFixed(3)}`;
    }

    private segmentLen(seg: RouteSegment): number {
        return Math.max(0, (seg.s1 ?? 0) - (seg.s0 ?? 0));
    }

    // -----------------------
    // Spawning (length-aware, s-based spacing using spawnKey)
    // REFACTORED: Now accounts for initial speed and required braking distance
    // -----------------------

    private trySpawnOne(): boolean {
        if (!this.routes.length || !this.carModels.length) return false;

        const route = this.routes[Math.floor(Math.random() * this.routes.length)];
        if (!route?.points || route.points.length < 2) return false;

        const template = this.carModels[Math.floor(Math.random() * this.carModels.length)];
        const model = template.clone(true);

        const length = this.computeModelLength(model);

        // IMPORTANT: use s-based spawn spacing that accounts for initial speed
        if (!this.hasSpawnSpace(route, length)) return false;

        const p0 = route.points[0];
        const p1 = route.points[1];

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

        // Use configurable initial speed
        const v = new Vehicle(this.nextId++, model, route, length, this.cfg.initialSpeed);
        v.s = 0;
        v.segmentIndex = 0;
        v.currentSegment = route.segments?.length ? route.segments[0] : null;
        this.updateVehicleSegment(v);

        // spawnKey = start lane identity (not route identity)
        v.spawnKey = this.spawnKeyForRoute(route);

        this.vehicles.push(v);
        this.spawned += 1;

        return true;
    }

    private computeModelLength(model: THREE.Group): number {
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);

        // assumes forward is +Z; swap to size.x if your models are different
        const raw = size.z;
        if (!Number.isFinite(raw) || raw < 0.1) return 4.5;
        return raw;
    }

    private spawnKeyForRoute(route: Route): string {
        const firstSeg = route.segments?.[0];
        const lk = firstSeg ? this.laneKeyForSegment(firstSeg) : "";
        if (lk) return `spawn:${lk}`;

        // fallback if segments missing: use first point (stable enough)
        const p0 = route.points[0];
        return `spawnPoint:${p0[0].toFixed(3)},${p0[1].toFixed(3)},${p0[2].toFixed(3)}`;
    }

    /**
     * REFACTORED: Check if there's enough space to spawn a new vehicle.
     * Now accounts for initial speed by requiring extra space for braking distance.
     */
    private hasSpawnSpace(route: Route, newLen: number): boolean {
        const spawnKey = this.spawnKeyForRoute(route);

        let nearest: Vehicle | null = null;
        let nearestS = Infinity;

        for (const v of this.vehicles) {
            if (v.spawnKey !== spawnKey) continue;

            // Vehicles start at s=0 and move forward; the closest to spawn is the smallest s
            if (v.s < nearestS) {
                nearestS = v.s;
                nearest = v;
            }
        }

        if (!nearest) return true;

        // Calculate required spawn gap:
        // 1. New car length
        // 2. Minimum bumper gap
        // 3. Extra space for braking from initial speed (if both have same speed, 
        //    they need space to decelerate without collision)
        // 4. Time headway buffer at initial speed
        
        const brakingDistance = this.stoppingDistance(this.cfg.initialSpeed);
        const timeHeadwayBuffer = this.cfg.initialSpeed * this.cfg.timeHeadway;
        
        // Required gap = car length + min gap + larger of (braking distance or time headway)
        const safetyBuffer = Math.max(brakingDistance, timeHeadwayBuffer);
        const required = newLen + this.cfg.minBumperGap + safetyBuffer;

        // Since spawn is at s=0, the front car must be at least "required" ahead
        return nearestS >= required;
    }

    // -----------------------
    // Segment / laneKey tracking
    // -----------------------

    private laneKeyForSegment(seg: RouteSegment): string {
        // Stage 2 queues only on physical lanes; ignore junction-internal segments
        if (seg.phase === "inside") return "";
        if (seg.phase === "exit") return `lane:${seg.to}`;
        return `lane:${seg.from}`; // link + approach
    }

    private updateVehicleSegment(v: Vehicle) {
        const segs = v.route.segments;
        if (!segs || segs.length === 0) {
            v.currentSegment = null;
            v.segmentIndex = 0;
            v.laneKey = "";
            return;
        }

        while (v.segmentIndex < segs.length - 1 && v.s > (segs[v.segmentIndex].s1 ?? 0)) {
            v.segmentIndex++;
        }

        v.currentSegment = segs[v.segmentIndex];
        v.laneKey = this.laneKeyForSegment(v.currentSegment);
    }

    // -----------------------
    // Apply desired s -> pose
    // -----------------------

    private applySAndPose(v: Vehicle, targetS: number): boolean {
        const pts = v.route.points;
        if (!pts || pts.length < 2) return true;

        const spacing = v.route.spacing ?? 0.5;
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
    private buildControllersIfNeeded() {
        if (this.controllersBuilt) return;

        // junctionKey -> set of incoming laneKeys
        const incoming = new Map<string, Set<string>>();

        for (const r of this.routes) {
            for (const seg of r.segments ?? []) {
                if (seg.phase !== "approach") continue;

                // temporary inference: junctionKey is "to"
                const junctionKey = this.junctionIdFromNodeKey(String(seg.to));

                // temporary laneKey: incoming lane identity is based on "from"
                // (this matches your laneKeyForSegment(link/approach) -> lane:<from>)
                const entryKey = this.entryGroupKeyFromNodeKey(String(seg.from));
                const set = incoming.get(junctionKey) ?? new Set<string>();
                set.add(entryKey);
                incoming.set(junctionKey, set);
            }
        }

        for (const [junctionKey, laneSet] of incoming.entries()) {
            this.intersectionControllers.set(
                junctionKey,
                new IntersectionController(junctionKey, Array.from(laneSet), 8, 1) // 8s each approach
            );
            console.log("[controller]", junctionKey, Array.from(laneSet));
        }
        

        this.controllersBuilt = true;
    }

    private applyStoplineCap(v: Vehicle, targetSpeed: number): number {
        const seg = v.currentSegment;
        if (!seg) return targetSpeed;

        // Only stop-control on approaches
        if (seg.phase !== "approach") return targetSpeed;

        // junctionKey inferred as seg.to for approaches
        const junctionKey = this.junctionIdFromNodeKey(String(seg.to));
        const controller = this.intersectionControllers.get(junctionKey);
        if (!controller) return targetSpeed; // if unknown, allow

        // Vehicle's incoming lane identity
        const entryKey = this.entryGroupKeyFromNodeKey(String(seg.from));
        if (controller.isGreen(entryKey)) return targetSpeed;

        // Otherwise cap so we can stop at stopline (seg.s1) without overshooting.
        // stopline is at seg.s1, but we want the FRONT bumper to stop before it.
        const frontOffset = 0.5 * v.length;
        const stopS = seg.s1 - frontOffset;

        const dist = stopS - v.s; // distance remaining to stop target
        if (dist <= 0) return 0;  // already at/over line -> stop

        // v_max = sqrt(2 * a * d) - maximum speed to stop within distance d
        const vmax = Math.sqrt(2 * this.cfg.maxDecel * dist);
        return Math.min(targetSpeed, vmax);
    }

    private entryGroupKeyFromNodeKey(nodeKey: string): string {
        // "UUID-0-in-2" -> "entry:UUID-0-in"
        const parts = nodeKey.split("-");
        if (parts.length < 4) return `entry:${nodeKey}`;
        const uuid = parts.slice(0, 5).join("-"); // UUID has 5 dash parts
        const exit = parts[5];
        const dir  = parts[6]; // "in" or "out"
        return `entry:${uuid}-${exit}-${dir}`;
    }
}