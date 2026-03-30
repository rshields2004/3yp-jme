import { Vehicle } from "./vehicle";
import { JunctionObjectTypes } from "../types/types";
import { SimulationStats, JunctionStats, JunctionStatsGlobal, LevelOfService } from "../types/simulation";
import { IntersectionController } from "./controllers/intersectionController";
import { RoundaboutController } from "./controllers/roundaboutController";

export type JunctionCounter = {
    entered: number;
    exited: number;
    blockedDownstream: number;
    totalWaitTime: number;
    waitCount: number;
    maxWaitTime: number;
    maxQueueLength: number;
};

export function defaultJunctionCounter(): JunctionCounter {
    return { entered: 0, exited: 0, blockedDownstream: 0, totalWaitTime: 0, waitCount: 0, maxWaitTime: 0, maxQueueLength: 0 };
}

export interface StatsContext {
    vehicles: Vehicle[];
    elapsedTime: number;
    completed: number;
    totalTravelTime: number;
    travelCount: number;
    globalMaxQueueLength: number;
    routes: { length: number };
    spawnState: { spawned: number; spawnDemandPerEntry: Map<string, number> };
    junctionCounters: Map<string, JunctionCounter>;
    lastVehJunctionTag: Map<number, { jid: string | null; phase: string | null }>;
    intersectionControllers: Map<string, IntersectionController>;
    roundaboutControllers: Map<string, RoundaboutController>;
    getDistToSegmentEnd: (v: Vehicle) => number;
}

function computeLOS(avgDelay: number, type: JunctionObjectTypes): LevelOfService {
    if (avgDelay <= 0) return "-";
    if (type === "roundabout") {
        if (avgDelay <= 10) return "A";
        if (avgDelay <= 15) return "B";
        if (avgDelay <= 25) return "C";
        if (avgDelay <= 35) return "D";
        if (avgDelay <= 50) return "E";
        return "F";
    }
    if (avgDelay <= 10) return "A";
    if (avgDelay <= 20) return "B";
    if (avgDelay <= 35) return "C";
    if (avgDelay <= 55) return "D";
    if (avgDelay <= 80) return "E";
    return "F";
}

/**
 * Collects simulation statistics from the current frame state.
 * Mutates junctionCounters, lastVehJunctionTag, and roundabout controllers
 * as side effects (entered/exited detection + notification).
 *
 * Returns the snapshot AND the (possibly updated) globalMaxQueueLength.
 */
export function collectStats(ctx: StatsContext): { snapshot: SimulationStats; globalMaxQueueLength: number } {
    const byId: Record<string, JunctionStats> = {};

    const ensure = (jid: string, type: JunctionObjectTypes): JunctionStats => {
        if (!byId[jid]) {
            const c = ctx.junctionCounters.get(jid) ?? defaultJunctionCounter();
            const avgWait = c.waitCount > 0 ? c.totalWaitTime / c.waitCount : 0;
            const arrivalRate = ctx.elapsedTime > 0 ? c.entered / ctx.elapsedTime : 0;
            const departureRate = ctx.elapsedTime > 0 ? c.exited / ctx.elapsedTime : 0;
            const dos = departureRate > 0 ? arrivalRate / departureRate : 0;
            byId[jid] = {
                id: jid,
                type,
                approaching: 0,
                waiting: 0,
                inside: 0,
                exiting: 0,
                entered: c.entered,
                exited: c.exited,
                avgWaitTime: avgWait,
                maxWaitTime: c.maxWaitTime,
                throughput: ctx.elapsedTime > 0 ? (c.exited / ctx.elapsedTime) * 60 : 0,
                maxQueueLength: c.maxQueueLength,
                levelOfService: computeLOS(avgWait, type),
                dos,
                prc: dos > 0 ? ((1 / dos) - 1) * 100 : 0,
                mmq: c.maxQueueLength,
                currentGreenKey: null,
                state: undefined,
            };
        }
        return byId[jid];
    };

    // ---------
    // 1) Per-vehicle snapshot counts + entered/exited detection
    // ---------
    for (const v of ctx.vehicles) {
        const seg = v.currentSegment;
        if (!seg) continue;

        let jid: string | null = null;
        if (seg.phase === "approach") jid = seg.to.structureID;
        else if (seg.phase === "inside") jid = seg.to.structureID;
        else if (seg.phase === "exit") jid = seg.from.structureID;

        if (jid) {
            const isRoundabout = ctx.roundaboutControllers.has(jid);
            const js = ensure(jid, isRoundabout ? "roundabout" : "intersection");

            if (seg.phase === "approach") js.approaching += 1;
            else if (seg.phase === "inside") js.inside += 1;
            else if (seg.phase === "exit") js.exiting += 1;

            if (seg.phase === "approach") {
                const nearStop = ctx.getDistToSegmentEnd(v) < 2.0;
                const stopped = v.speed < 0.2;
                if (nearStop && stopped) js.waiting += 1;
            }

            const prev = ctx.lastVehJunctionTag.get(v.id) ?? { jid: null, phase: null };

            if (jid && seg.phase === "inside" && !(prev.jid === jid && prev.phase === "inside")) {
                const c = ctx.junctionCounters.get(jid) ?? defaultJunctionCounter();
                c.entered += 1;
                ctx.junctionCounters.set(jid, c);
                js.entered = c.entered;

                const roundabout = ctx.roundaboutControllers.get(jid);
                if (roundabout && prev.phase === "approach") {
                    roundabout.registerVehicleEntering(v.id);
                }
            }

            if (jid && seg.phase === "exit" && !(prev.jid === jid && prev.phase === "exit")) {
                const c = ctx.junctionCounters.get(jid) ?? defaultJunctionCounter();
                c.exited += 1;
                ctx.junctionCounters.set(jid, c);
                js.exited = c.exited;

                const roundabout = ctx.roundaboutControllers.get(jid);
                if (roundabout && prev.phase === "inside") {
                    roundabout.registerVehicleExiting(v.id);
                }
            }

            ctx.lastVehJunctionTag.set(v.id, { jid, phase: seg.phase });
        } else {
            ctx.lastVehJunctionTag.set(v.id, { jid: null, phase: seg.phase ?? null });
        }
    }

    // ---------
    // 2) Attach signal state for controllers
    // ---------
    for (const [jid, controller] of ctx.intersectionControllers.entries()) {
        const js = ensure(jid, "intersection");
        js.currentGreenKey = controller.getCurrentGreen?.() ?? null;
        js.state = controller.getState?.();
        const c = ctx.junctionCounters.get(jid) ?? defaultJunctionCounter();
        js.entered = c.entered;
        js.exited = c.exited;
    }

    for (const [jid, controller] of ctx.roundaboutControllers.entries()) {
        const js = ensure(jid, "roundabout");
        js.currentGreenKey = controller.getCurrentGreen?.() ?? null;
        js.state = controller.getState?.();
        const c = ctx.junctionCounters.get(jid) ?? defaultJunctionCounter();
        js.entered = c.entered;
        js.exited = c.exited;
    }

    // ---------
    // 3) Update per-junction max queue length (high-water mark)
    // ---------
    for (const j of Object.values(byId)) {
        const c = ctx.junctionCounters.get(j.id);
        if (c && j.waiting > c.maxQueueLength) {
            c.maxQueueLength = j.waiting;
            ctx.junctionCounters.set(j.id, c);
            j.maxQueueLength = c.maxQueueLength;
        }
    }

    // ---------
    // 4) Global junction aggregates
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
        maxQueueLength: 0,
        throughput: 0,
        prc: 0,
        mmq: 0,
    };

    let totalWaitTime = 0;
    let totalWaitCount = 0;
    let maxDos = 0;
    let totalMaxQueue = 0;

    for (const j of Object.values(byId)) {
        global.approaching += j.approaching;
        global.waiting += j.waiting;
        global.inside += j.inside;
        global.exiting += j.exiting;
        global.entered += j.entered;
        global.exited += j.exited;
        if (j.dos > maxDos) maxDos = j.dos;
        totalMaxQueue += j.maxQueueLength;

        if (j.id) {
            const c = ctx.junctionCounters.get(j.id);
            if (c) {
                totalWaitTime += c.totalWaitTime;
                totalWaitCount += c.waitCount;
            }
        }
    }

    global.avgWaitTime = totalWaitCount > 0 ? totalWaitTime / totalWaitCount : 0;
    global.prc = maxDos > 0 ? ((1 / maxDos) - 1) * 100 : 0;
    global.mmq = global.count > 0 ? totalMaxQueue / global.count : 0;

    let updatedGlobalMaxQueue = ctx.globalMaxQueueLength;
    if (global.waiting > updatedGlobalMaxQueue) {
        updatedGlobalMaxQueue = global.waiting;
    }
    global.maxQueueLength = updatedGlobalMaxQueue;
    global.throughput = ctx.elapsedTime > 0 ? (global.exited / ctx.elapsedTime) * 60 : 0;

    // ---------
    // 5) Build final SimulationStats snapshot
    // ---------
    let totalSpawnQueue = 0;
    const spawnQueueByEntry: Record<string, number> = {};
    for (const [entryKey, demand] of ctx.spawnState.spawnDemandPerEntry.entries()) {
        const queue = Math.floor(demand);
        totalSpawnQueue += queue;
        spawnQueueByEntry[entryKey] = queue;
    }

    let avgSpeed = 0;
    if (ctx.vehicles.length > 0) {
        let totalSpeed = 0;
        for (const v of ctx.vehicles) {
            totalSpeed += v.speed;
        }
        avgSpeed = totalSpeed / ctx.vehicles.length;
    }

    const snapshot: SimulationStats = {
        active: ctx.vehicles.length,
        spawned: ctx.spawnState.spawned,
        completed: ctx.completed,
        spawnQueue: totalSpawnQueue,
        spawnQueueByEntry,
        routes: ctx.routes.length,
        elapsedTime: ctx.elapsedTime,
        avgSpeed,
        avgTravelTime: ctx.travelCount > 0 ? ctx.totalTravelTime / ctx.travelCount : 0,
        waiting: global.waiting,
        junctions: {
            global,
            byId,
        },
    };

    return { snapshot, globalMaxQueueLength: updatedGlobalMaxQueue };
}
