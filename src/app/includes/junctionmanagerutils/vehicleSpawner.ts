import * as THREE from "three";
import React from "react";
import { Vehicle } from "./vehicle";
import { JunctionConfig } from "../types/types";
import { SimConfig, Route, Tuple3 } from "../types/simulation";
import { RoundaboutController } from "./controllers/roundaboutController";
import { SeededRNG, rngForEntry, CarClass, bodyTypeForModelIndex, hashString, getEffectiveCarClasses } from "../types/carTypes";
import { laneKeyForSegment } from "./helpers/segmentHelpers";


// ─── State ────────────────────────────────────────────────────────────────────

export type SpawnState = {
    spawned: number;
    spawnRatesPerEntry: Map<string, number>;
    spawnDemandPerEntry: Map<string, number>;
    /** Routes grouped by "<structureID>-<exitIndex>" */
    routesByEntry: Map<string, Route[]>;
    spawnAccumulator: number;
    entryRNGs: Map<string, SeededRNG>;
    /** Stable, seed-reproducible key per entry point */
    entryRngKeys: Map<string, string>;
    junctionStableKeys: Map<string, string>;
    junctionStableKeysBuilt: boolean;
};

export function createSpawnState(routes: Route[]): SpawnState {
    const state: SpawnState = {
        spawned: 0,
        spawnRatesPerEntry: new Map(),
        spawnDemandPerEntry: new Map(),
        routesByEntry: new Map(),
        spawnAccumulator: 0,
        entryRNGs: new Map(),
        entryRngKeys: new Map(),
        junctionStableKeys: new Map(),
        junctionStableKeysBuilt: false,
    };
    buildRoutesByEntry(state, routes);
    return state;
}

export function resetSpawnState(state: SpawnState, routes: Route[]): void {
    state.spawned = 0;
    state.spawnRatesPerEntry.clear();
    state.spawnDemandPerEntry.clear();
    state.routesByEntry.clear();
    state.spawnAccumulator = 0;
    state.entryRNGs.clear();
    state.entryRngKeys.clear();
    state.junctionStableKeys.clear();
    state.junctionStableKeysBuilt = false;
    buildRoutesByEntry(state, routes);
}



// ─── Main per-frame entry point ───────────────────────────────────────────────

/**
 * Run one simulation tick of the spawning system.
 * Called from VehicleManager.update() once per frame.
 */
export function spawnTick(
    state: SpawnState,
    dt: number,
    junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>,
    cfg: SimConfig,
    vehicles: Vehicle[],
    carModels: THREE.Group[],
    scene: THREE.Scene,
    junction: JunctionConfig,
    roundaboutControllers: Map<string, RoundaboutController>,
    nextId: () => number,
    getRoutePointsCached: (route: Route) => Tuple3[],
    findGroupById: (groups: THREE.Group[], id: string) => THREE.Group | undefined,
    getStructureData: (group: THREE.Group) => { id: string; type: string; maxDistanceToStopLine: number } | null,
    getGroupId: (group: THREE.Group) => string | null,
    updateVehicleSegment: (v: Vehicle) => void,
): void {
    buildJunctionStableKeys(state, junctionObjectRefs, junction, findGroupById, getStructureData);
    updateSpawnRatesFromJunctions(state, junctionObjectRefs, junction, cfg, getGroupId);

    // Compute per-entry maximum demand queue
    const numSpawnPoints = state.routesByEntry.size;
    const maxQueuePerEntry =
        numSpawnPoints > 0
            ? cfg.spawning.maxSpawnQueue / numSpawnPoints
            : cfg.spawning.maxSpawnQueue;

    // Accumulate demand at fixed tick rate for determinism
    const SPAWN_TICK = 1 / 60;
    state.spawnAccumulator += dt;
    const spawnTicks = Math.floor(state.spawnAccumulator / SPAWN_TICK);
    state.spawnAccumulator -= spawnTicks * SPAWN_TICK;

    for (const [entryKey, rate] of state.spawnRatesPerEntry.entries()) {
        const currentDemand = state.spawnDemandPerEntry.get(entryKey) || 0;
        const newDemand = currentDemand + rate * (spawnTicks * SPAWN_TICK);
        state.spawnDemandPerEntry.set(entryKey, Math.min(newDemand, maxQueuePerEntry));
    }

    // Sort entries by stable key so spawn order is deterministic across sessions
    const sortedEntries = Array.from(state.spawnDemandPerEntry.entries()).sort((a, b) => {
        const ka = state.entryRngKeys.get(a[0]) ?? a[0];
        const kb = state.entryRngKeys.get(b[0]) ?? b[0];
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    let totalAttempts = 0;
    for (const [entryKey, demand] of sortedEntries) {
        const vehiclesToSpawn = Math.floor(demand);

        if (vehiclesToSpawn > 0 && vehicles.length < cfg.spawning.maxVehicles) {
            let spawned = 0;
            let attempts = 0;

            while (
                spawned < vehiclesToSpawn &&
                vehicles.length < cfg.spawning.maxVehicles &&
                attempts < cfg.spawning.maxSpawnAttemptsPerFrame &&
                totalAttempts < cfg.spawning.maxSpawnAttemptsPerFrame * 3
            ) {
                attempts++;
                totalAttempts++;
                const ok = trySpawnFromEntry(
                    state, entryKey, cfg, vehicles, carModels, scene,
                    roundaboutControllers, nextId, getRoutePointsCached, updateVehicleSegment,
                );
                if (ok) {
                    spawned++;
                    state.spawnDemandPerEntry.set(entryKey, demand - spawned);
                } else {
                    break;
                }
            }
        }
    }
}


// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildRoutesByEntry(state: SpawnState, routes: Route[]): void {
    state.routesByEntry.clear();

    for (const route of routes) {
        const firstSeg = route.segments?.[0];
        if (!firstSeg) continue;

        const entryKey = `${firstSeg.from.structureID}-${firstSeg.from.exitIndex}`;

        if (!state.routesByEntry.has(entryKey)) {
            state.routesByEntry.set(entryKey, []);
        }
        state.routesByEntry.get(entryKey)!.push(route);
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
 * sort order (x then z). This relative ordering is robust even if
 * positions have small floating-point differences between tabs.
 */
function buildJunctionStableKeys(
    state: SpawnState,
    junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>,
    junction: JunctionConfig,
    findGroupById: (groups: THREE.Group[], id: string) => THREE.Group | undefined,
    getStructureData: (group: THREE.Group) => { id: string; type: string; maxDistanceToStopLine: number } | null,
): void {
    if (state.junctionStableKeysBuilt) return;

    const groups = junctionObjectRefs.current;
    if (!groups || groups.length === 0) return;

    // Collect unique structureIDs referenced by routes
    const structureIDs = new Set<string>();
    for (const routes of state.routesByEntry.values()) {
        for (const r of routes) {
            for (const seg of r.segments ?? []) {
                structureIDs.add(seg.from.structureID);
                structureIDs.add(seg.to.structureID);
            }
        }
    }

    const idToHash = new Map<string, string>();
    const idToPos  = new Map<string, { x: number; z: number }>();

    for (const sid of structureIDs) {
        const g = findGroupById(groups, sid);
        if (!g) continue;

        const jObj = junction.junctionObjects.find(o => o.id === sid);
        const configObj: Record<string, unknown> = {
            type: jObj?.type ?? getStructureData(g)?.type ?? "unknown",
            exitConfig: jObj?.config?.exitConfig ?? [],
        };
        const configHash = hashString(JSON.stringify(configObj)).toString(36);
        idToHash.set(sid, configHash);

        const wp = new THREE.Vector3();
        g.getWorldPosition(wp);
        idToPos.set(sid, { x: wp.x, z: wp.z });
    }

    const hashGroups = new Map<string, string[]>();
    for (const [sid, ch] of idToHash.entries()) {
        const arr = hashGroups.get(ch) ?? [];
        arr.push(sid);
        hashGroups.set(ch, arr);
    }

    for (const [ch, sids] of hashGroups.entries()) {
        sids.sort((a, b) => {
            const pa = idToPos.get(a)!;
            const pb = idToPos.get(b)!;
            const ax = Math.round(pa.x), az = Math.round(pa.z);
            const bx = Math.round(pb.x), bz = Math.round(pb.z);
            return ax !== bx ? ax - bx : az - bz;
        });
        for (let i = 0; i < sids.length; i++) {
            state.junctionStableKeys.set(sids[i], `${ch}:${i}`);
        }
    }

    // Rebuild entryRngKeys from junctionStableKeys
    state.entryRngKeys.clear();
    state.entryRNGs.clear(); // force re-creation with new keys

    for (const [entryKey] of state.routesByEntry.entries()) {
        const dashIdx = entryKey.lastIndexOf("-");
        const sid     = entryKey.substring(0, dashIdx);
        const exitIdx = entryKey.substring(dashIdx + 1);

        const jStable = state.junctionStableKeys.get(sid);
        state.entryRngKeys.set(entryKey, jStable ? `cfg:${jStable}:${exitIdx}` : `entry:${entryKey}`);
    }

    state.junctionStableKeysBuilt = true;
}

/** Refresh spawn rates from live junction config; leaves accumulated demand untouched */
function updateSpawnRatesFromJunctions(
    state: SpawnState,
    junctionObjectRefs: React.RefObject<THREE.Group<THREE.Object3DEventMap>[]>,
    junction: JunctionConfig,
    cfg: SimConfig,
    getGroupId: (group: THREE.Group) => string | null,
): void {
    if (!junctionObjectRefs.current) return;

    state.spawnRatesPerEntry.clear();
    const validEntries = new Set<string>();

    for (const group of junctionObjectRefs.current) {
        const structureID = getGroupId(group);
        if (!structureID) continue;

        const jObj       = junction.junctionObjects.find(o => o.id === structureID);
        const exitConfig = jObj?.config?.exitConfig ?? group.userData.exitConfig;

        if (!exitConfig || !Array.isArray(exitConfig)) continue;

        exitConfig.forEach((config: { spawnRate?: number }, exitIndex: number) => {
            const entryKey = `${structureID}-${exitIndex}`;

            if (!state.routesByEntry.has(entryKey)) return;

            validEntries.add(entryKey);

            state.spawnRatesPerEntry.set(entryKey, config.spawnRate ?? cfg.spawning.spawnRate);

            if (!state.spawnDemandPerEntry.has(entryKey)) {
                state.spawnDemandPerEntry.set(entryKey, 0);
            }
        });
    }

    // Remove demand for entries that are no longer valid spawn points
    for (const entryKey of state.spawnDemandPerEntry.keys()) {
        if (!validEntries.has(entryKey)) {
            state.spawnDemandPerEntry.delete(entryKey);
        }
    }
}

/**
 * Try to spawn a vehicle from a specific entry point.
 *
 * IMPORTANT FOR SEED REPRODUCIBILITY:
 * The seeded RNG is always advanced by the same number of values per
 * spawn attempt, regardless of whether hasSpawnSpace allows the spawn.
 * This guarantees the Nth spawn attempt at a given entry always produces
 * the same vehicle type / colour / stats, even when earlier attempts were
 * blocked at different times due to frame-rate differences.
 */
function trySpawnFromEntry(
    state: SpawnState,
    entryKey: string,
    cfg: SimConfig,
    vehicles: Vehicle[],
    carModels: THREE.Group[],
    scene: THREE.Scene,
    roundaboutControllers: Map<string, RoundaboutController>,
    nextId: () => number,
    getRoutePointsCached: (route: Route) => Tuple3[],
    updateVehicleSegment: (v: Vehicle) => void,
): boolean {
    const routesForEntry = state.routesByEntry.get(entryKey);
    if (!routesForEntry || routesForEntry.length === 0 || !carModels.length) return false;

    // Get or create seeded RNG for this entry point
    let rng = state.entryRNGs.get(entryKey);
    if (!rng) {
        const stableKey = state.entryRngKeys.get(entryKey) ?? entryKey;
        rng = rngForEntry(cfg.simSeed, stableKey);
        state.entryRNGs.set(entryKey, rng);
    }

    // ── Consume a fixed number of RNG values per attempt ──────────
    // Even if the spawn fails (no space), these values are consumed
    // so the sequence stays aligned.
    const rRouteIdx   = rng.nextInt(routesForEntry.length);
    const effectiveClasses = getEffectiveCarClasses(cfg.carClassOverrides);
    const rCarClass   = rng.pickCarClass(cfg.rendering.enabledCarClasses, effectiveClasses);
    const rColourIdx  = rng.next();
    const rVariation0 = rng.next();
    const rVariation1 = rng.next();
    const rVariation2 = rng.next();
    const rReaction   = rng.next();
    const rHeadway    = rng.next();

    // ── Resolve route ─────────────────────────────────────────────
    const route  = routesForEntry[rRouteIdx];
    const points = getRoutePointsCached(route);
    if (!points || points.length < 2) return false;

    const carClass: CarClass = rCarClass;
    const length = carClass.length;

    // ── Space check (does NOT touch RNG) ─────────────────────────
    if (!hasSpawnSpace(route, length, vehicles, cfg, roundaboutControllers, getRoutePointsCached)) return false;

    // ── Resolve model (colour variant) ───────────────────────────
    const matchingModels: number[] = [];
    for (let i = 0; i < carModels.length; i++) {
        const carFileIdx = carModels[i].userData?.carFileIndex as number | undefined;
        if (carFileIdx !== undefined) {
            const bt = bodyTypeForModelIndex(carFileIdx);
            if (bt === carClass.bodyType) matchingModels.push(i);
        }
    }
    matchingModels.sort((a, b) => {
        const ai = (carModels[a].userData?.carFileIndex as number) ?? 0;
        const bi = (carModels[b].userData?.carFileIndex as number) ?? 0;
        return ai - bi;
    });

    let loadedIndex: number;
    if (matchingModels.length > 0) {
        loadedIndex = matchingModels[Math.floor(rColourIdx * matchingModels.length)];
    } else {
        loadedIndex = Math.floor(rColourIdx * carModels.length);
    }
    const template = carModels[loadedIndex];
    if (!template) return false;
    const model = template.clone(true);

    // ── Place ────────────────────────────────────────────────────
    const p0 = points[0];
    const p1 = points[1];

    const pos0 = new THREE.Vector3(p0[0], p0[1] + cfg.rendering.yOffset, p0[2]);
    const pos1 = new THREE.Vector3(p1[0], p1[1] + cfg.rendering.yOffset, p1[2]);

    model.position.copy(pos0);

    const dir = pos1.clone().sub(pos0);
    if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        const yaw = Math.atan2(dir.x, dir.z);
        model.rotation.set(0, yaw, 0);
    }

    scene.add(model);

    const v = new Vehicle(nextId(), model, route, length, cfg.motion.initialSpeed);

    v.maxAccel       = cfg.motion.maxAccel       * carClass.accelFactor  * (0.9 + rVariation0 * 0.2);
    v.maxDecel       = cfg.motion.maxDecel       * carClass.decelFactor  * (0.9 + rVariation1 * 0.2);
    v.preferredSpeed = cfg.motion.preferredSpeed * carClass.speedFactor  * (0.9 + rVariation2 * 0.2);
    v.reactionTime   = 0.15 + rReaction * 0.25;
    v.timeHeadway    = cfg.spacing.timeHeadway   * (0.8 + rHeadway * 0.4);

    v.s              = 0;
    v.segmentIndex   = 0;
    v.currentSegment = route.segments?.length ? route.segments[0] : null;
    updateVehicleSegment(v);

    v.spawnKey = spawnKeyForRoute(route, roundaboutControllers, getRoutePointsCached);

    vehicles.push(v);
    state.spawned += 1;

    return true;
}

function spawnKeyForRoute(
    route: Route,
    roundaboutControllers: Map<string, RoundaboutController>,
    getRoutePointsCached: (route: Route) => Tuple3[],
): string {
    const firstSeg = route.segments?.[0];
    const lk = firstSeg ? laneKeyForSegment(firstSeg, roundaboutControllers) : "";
    if (lk) return `spawn:${lk}`;

    const points = getRoutePointsCached(route);
    const p0 = points[0];
    return `spawnPoint:${p0[0].toFixed(3)},${p0[1].toFixed(3)},${p0[2].toFixed(3)}`;
}

function hasSpawnSpace(
    route: Route,
    newLen: number,
    vehicles: Vehicle[],
    cfg: SimConfig,
    roundaboutControllers: Map<string, RoundaboutController>,
    getRoutePointsCached: (route: Route) => Tuple3[],
): boolean {
    const spawnKey = spawnKeyForRoute(route, roundaboutControllers, getRoutePointsCached);

    let nearest: Vehicle | null = null;
    let nearestS = Infinity;

    for (const v of vehicles) {
        if (v.spawnKey !== spawnKey) continue;
        if (v.s < nearestS) {
            nearestS = v.s;
            nearest  = v;
        }
    }

    if (!nearest) return true;

    const brakingDistance   = (cfg.motion.initialSpeed ** 2) / (2 * cfg.motion.maxDecel);
    const timeHeadwayBuffer = cfg.motion.initialSpeed * cfg.spacing.timeHeadway;

    const safetyBuffer = Math.max(brakingDistance, timeHeadwayBuffer);
    const required     = newLen + cfg.spacing.minBumperGap + safetyBuffer;

    return nearestS >= required;
}
