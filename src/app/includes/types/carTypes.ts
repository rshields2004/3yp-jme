/**
 * carTypes.ts
 * Defines vehicle body types, their physical properties, spawn weights,
 * model file mappings, and a seeded PRNG for deterministic simulation.
 */

// CAR CLASS DEFINITIONS

/**
 * Physical / kinematic properties for a vehicle body type
 */
export type CarClass = {
    /**
     * Human-readable body type name (matches model filename prefix)
     */
    bodyType: string;
    /**
     * Typical vehicle length in world units
     */
    length: number;
    /**
     * Max speed multiplier relative to SimConfig.maxSpeed (1.0 = 100%)
     */
    speedFactor: number;
    /**
     * Max acceleration multiplier relative to SimConfig.maxAccel
     */
    accelFactor: number;
    /**
     * Max deceleration multiplier relative to SimConfig.maxDecel
     */
    decelFactor: number;
    /**
     * Spawn‐weight (higher = more common). Weights are normalised at runtime.
     */
    weight: number;
};

/**
 * Overridable per-class values stored in SimConfig.
 */
export type CarClassOverride = {
    speedFactor: number;
    accelFactor: number;
    decelFactor: number;
    weight: number;
};

/**
 * Car classes indexed by body type.
 * Speed / accel / decel factors are *multipliers* applied to the
 * SimConfig base values so the UI sliders still scale everything.
 */
export const carClasses: CarClass[] = [
    { bodyType: "coupe",          length: 1.99, speedFactor: 1.10, accelFactor: 1.15, decelFactor: 1.05, weight: 10 },
    { bodyType: "hatchback",      length: 1.81, speedFactor: 1.00, accelFactor: 1.00, decelFactor: 1.00, weight: 20 },
    { bodyType: "micro",          length: 1.42, speedFactor: 0.85, accelFactor: 1.05, decelFactor: 0.95, weight: 5 },
    { bodyType: "microcargo",     length: 1.82, speedFactor: 0.80, accelFactor: 0.90, decelFactor: 0.90, weight: 3 },
    { bodyType: "microtransport", length: 1.82, speedFactor: 0.80, accelFactor: 0.85, decelFactor: 0.90, weight: 3 },
    { bodyType: "minibus",        length: 2.16, speedFactor: 0.90, accelFactor: 0.75, decelFactor: 0.85, weight: 4 },
    { bodyType: "mpv",            length: 2.00, speedFactor: 0.95, accelFactor: 0.90, decelFactor: 0.95, weight: 10 },
    { bodyType: "normal",         length: 1.82, speedFactor: 1.00, accelFactor: 1.00, decelFactor: 1.00, weight: 25 },
    { bodyType: "pickup",         length: 1.97, speedFactor: 0.95, accelFactor: 0.85, decelFactor: 0.90, weight: 6 },
    { bodyType: "pickup-small",   length: 1.92, speedFactor: 0.95, accelFactor: 0.90, decelFactor: 0.95, weight: 4 },
    { bodyType: "station",        length: 2.10, speedFactor: 1.00, accelFactor: 0.95, decelFactor: 1.00, weight: 8 },
    { bodyType: "van",            length: 2.16, speedFactor: 0.85, accelFactor: 0.70, decelFactor: 0.80, weight: 5 },
];

/**
 * Lookup map: bodyType -> CarClass
 */
const classByBodyType = new Map<string, CarClass>(
    carClasses.map(c => [c.bodyType, c])
);

/**
 * Build default overrides from the static carClasses array.
 * @returns a record keyed by body type with default override values
 */
export function defaultCarClassOverrides(): Record<string, CarClassOverride> {
    const out: Record<string, CarClassOverride> = {};
    for (const c of carClasses) {
        out[c.bodyType] = { speedFactor: c.speedFactor, accelFactor: c.accelFactor, decelFactor: c.decelFactor, weight: c.weight };
    }
    return out;
}

/**
 * Merge base carClasses with per-class overrides to produce effective classes.
 *
 * @param overrides - per-class override values
 * @returns the generated array
 */
export function getEffectiveCarClasses(overrides: Record<string, CarClassOverride>): CarClass[] {
    return carClasses.map(c => {
        const o = overrides[c.bodyType];
        return o ? { ...c, ...o } : c;
    });
}

/**
 * Derive the body type string from a model index into `carFiles`.
 * Model filenames are `/models/car-<bodyType>-<color>.obj`.
 *
 * @param modelIndex - index into the loaded car model array
 * @returns the body type string
 */
export function bodyTypeForModelIndex(modelIndex: number): string {
    const entry = carFiles[modelIndex];
    if (!entry) return "normal";
    // e.g. "/models/car-pickup-small-blue.obj" -> "pickup-small"
    const filename = entry.obj.split("/").pop() ?? "";      // "car-pickup-small-blue.obj"
    const noExt = filename.replace(/\.obj$/, "");           // "car-pickup-small-blue"
    const parts = noExt.split("-");                         // ["car","pickup","small","blue"]
    // Remove leading "car" and trailing color
    parts.shift();  // remove "car"
    parts.pop();    // remove color
    return parts.join("-"); // "pickup-small"
}

/**
 * Get the CarClass for a loaded model index (falls back to "normal").
 *
 * @param modelIndex - index into the loaded car model array
 * @returns the matched car class
 */
export function carClassForModelIndex(modelIndex: number): CarClass {
    const bt = bodyTypeForModelIndex(modelIndex);
    return classByBodyType.get(bt) ?? classByBodyType.get("normal")!;
}

// SEEDED PRNG

/**
 * A simple, fast, seedable 32-bit PRNG (Mulberry32).
 * Same seed produces the same sequence on every device / JS engine.
 */
export class SeededRNG {
    private state: number;

    /**
     * Create a new PRNG seeded with `seed` (truncated to 32-bit integer).
     *
     * @param seed - random seed value
     */
    constructor(seed: number) {
        this.state = seed | 0;
    }

    /**
     * Return a float in [0, 1).
     * @returns a pseudorandom float in [0, 1)
     */
    next(): number {
        let t = (this.state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /**
     * Return an integer in [0, max).
     *
     * @param max - exclusive upper bound
     * @returns a pseudorandom integer in [0, max)
     */
    nextInt(max: number): number {
        return Math.floor(this.next() * max);
    }

    /**
     * Pick a CarClass based on weights using this RNG,
     * filtered to only the enabled body types.
     * Pass effectiveClasses to use config-overridden values.
     *
     * @param enabledBodyTypes - set of enabled body type names
     * @param effectiveClasses - array of effective car class definitions
     * @returns the selected car class
     */
    pickCarClass(enabledBodyTypes?: string[], effectiveClasses?: CarClass[]): CarClass {
        const base = effectiveClasses ?? carClasses;
        const pool = enabledBodyTypes && enabledBodyTypes.length > 0
            ? base.filter(c => enabledBodyTypes.includes(c.bodyType))
            : base;
        if (pool.length === 0) return base[0]; // fallback
        const totalWeight = pool.reduce((s, c) => s + c.weight, 0);
        let r = this.next() * totalWeight;
        for (const cc of pool) {
            r -= cc.weight;
            if (r <= 0) return cc;
        }
        return pool[pool.length - 1];
    }
}

/**
 * Hash a string into a 32-bit integer (FNV-1a inspired).
 *
 * @param str - input string
 * @returns a 32-bit hash integer
 */
export function hashString(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h | 0;
}

/**
 * Create a seeded RNG for a specific entry point by combining
 * the global seed with a deterministic hash of the entry key.
 *
 * @param globalSeed - global random seed
 * @param entryKey - string key identifying an entry point
 * @returns a seeded PRNG instance
 */
export function rngForEntry(globalSeed: string, entryKey: string): SeededRNG {
    const baseSeed = hashString(globalSeed);
    let hash = baseSeed;
    for (let i = 0; i < entryKey.length; i++) {
        hash = Math.imul(hash ^ entryKey.charCodeAt(i), 0x5bd1e995);
        hash ^= hash >>> 15;
    }
    return new SeededRNG(hash);
}

/**
 * Return the indices into `carFiles` whose body type matches the given CarClass.
 *
 * @param cc - car class definition
 * @returns the generated array
 */
export function modelIndicesForClass(cc: CarClass): number[] {
    const out: number[] = [];
    for (let i = 0; i < carFiles.length; i++) {
        if (bodyTypeForModelIndex(i) === cc.bodyType) out.push(i);
    }
    return out;
}

/**
 * Pre-computed index list cache keyed by body type — avoids re-scanning on every call.
 */
const _modelIndicesCache = new Map<string, number[]>();
/**
 * Cached version of {@link modelIndicesForClass} — avoids re-scanning on every call.
 *
 * @param cc - car class definition
 * @returns the generated array
 */
export function getModelIndicesForClass(cc: CarClass): number[] {
    let cached = _modelIndicesCache.get(cc.bodyType);
    if (!cached) {
        cached = modelIndicesForClass(cc);
        _modelIndicesCache.set(cc.bodyType, cached);
    }
    return cached;
}



/**
 * OBJ/MTL file path pairs for every car model variant (body type × colour).
 */
export const carFiles = [
    { obj: "/models/car-coupe-blue.obj", mtl: "/models/car-coupe-blue.mtl" },
    { obj: "/models/car-coupe-citrus.obj", mtl: "/models/car-coupe-citrus.mtl" },
    { obj: "/models/car-coupe-green.obj", mtl: "/models/car-coupe-green.mtl" },
    { obj: "/models/car-coupe-orange.obj", mtl: "/models/car-coupe-orange.mtl" },
    { obj: "/models/car-coupe-red.obj", mtl: "/models/car-coupe-red.mtl" },
    { obj: "/models/car-coupe-silver.obj", mtl: "/models/car-coupe-silver.mtl" },
    { obj: "/models/car-coupe-violet.obj", mtl: "/models/car-coupe-violet.mtl" },

    { obj: "/models/car-hatchback-blue.obj", mtl: "/models/car-hatchback-blue.mtl" },
    { obj: "/models/car-hatchback-citrus.obj", mtl: "/models/car-hatchback-citrus.mtl" },
    { obj: "/models/car-hatchback-green.obj", mtl: "/models/car-hatchback-green.mtl" },
    { obj: "/models/car-hatchback-orange.obj", mtl: "/models/car-hatchback-orange.mtl" },
    { obj: "/models/car-hatchback-red.obj", mtl: "/models/car-hatchback-red.mtl" },
    { obj: "/models/car-hatchback-silver.obj", mtl: "/models/car-hatchback-silver.mtl" },
    { obj: "/models/car-hatchback-violet.obj", mtl: "/models/car-hatchback-violet.mtl" },

    { obj: "/models/car-micro-blue.obj", mtl: "/models/car-micro-blue.mtl" },
    { obj: "/models/car-micro-citrus.obj", mtl: "/models/car-micro-citrus.mtl" },
    { obj: "/models/car-micro-green.obj", mtl: "/models/car-micro-green.mtl" },
    { obj: "/models/car-micro-orange.obj", mtl: "/models/car-micro-orange.mtl" },
    { obj: "/models/car-micro-red.obj", mtl: "/models/car-micro-red.mtl" },
    { obj: "/models/car-micro-silver.obj", mtl: "/models/car-micro-silver.mtl" },
    { obj: "/models/car-micro-violet.obj", mtl: "/models/car-micro-violet.mtl" },

    { obj: "/models/car-microcargo-blue.obj", mtl: "/models/car-microcargo-blue.mtl" },
    { obj: "/models/car-microcargo-citrus.obj", mtl: "/models/car-microcargo-citrus.mtl" },
    { obj: "/models/car-microcargo-green.obj", mtl: "/models/car-microcargo-green.mtl" },
    { obj: "/models/car-microcargo-orange.obj", mtl: "/models/car-microcargo-orange.mtl" },
    { obj: "/models/car-microcargo-red.obj", mtl: "/models/car-microcargo-red.mtl" },
    { obj: "/models/car-microcargo-silver.obj", mtl: "/models/car-microcargo-silver.mtl" },
    { obj: "/models/car-microcargo-violet.obj", mtl: "/models/car-microcargo-violet.mtl" },

    { obj: "/models/car-microtransport-blue.obj", mtl: "/models/car-microtransport-blue.mtl" },
    { obj: "/models/car-microtransport-citrus.obj", mtl: "/models/car-microtransport-citrus.mtl" },
    { obj: "/models/car-microtransport-green.obj", mtl: "/models/car-microtransport-green.mtl" },
    { obj: "/models/car-microtransport-orange.obj", mtl: "/models/car-microtransport-orange.mtl" },
    { obj: "/models/car-microtransport-red.obj", mtl: "/models/car-microtransport-red.mtl" },
    { obj: "/models/car-microtransport-silver.obj", mtl: "/models/car-microtransport-silver.mtl" },
    { obj: "/models/car-microtransport-violet.obj", mtl: "/models/car-microtransport-violet.mtl" },

    { obj: "/models/car-minibus-blue.obj", mtl: "/models/car-minibus-blue.mtl" },
    { obj: "/models/car-minibus-citrus.obj", mtl: "/models/car-minibus-citrus.mtl" },
    { obj: "/models/car-minibus-green.obj", mtl: "/models/car-minibus-green.mtl" },
    { obj: "/models/car-minibus-orange.obj", mtl: "/models/car-minibus-orange.mtl" },
    { obj: "/models/car-minibus-red.obj", mtl: "/models/car-minibus-red.mtl" },
    { obj: "/models/car-minibus-silver.obj", mtl: "/models/car-minibus-silver.mtl" },
    { obj: "/models/car-minibus-violet.obj", mtl: "/models/car-minibus-violet.mtl" },

    { obj: "/models/car-mpv-blue.obj", mtl: "/models/car-mpv-blue.mtl" },
    { obj: "/models/car-mpv-citrus.obj", mtl: "/models/car-mpv-citrus.mtl" },
    { obj: "/models/car-mpv-green.obj", mtl: "/models/car-mpv-green.mtl" },
    { obj: "/models/car-mpv-orange.obj", mtl: "/models/car-mpv-orange.mtl" },
    { obj: "/models/car-mpv-red.obj", mtl: "/models/car-mpv-red.mtl" },
    { obj: "/models/car-mpv-silver.obj", mtl: "/models/car-mpv-silver.mtl" },
    { obj: "/models/car-mpv-violet.obj", mtl: "/models/car-mpv-violet.mtl" },

    { obj: "/models/car-normal-blue.obj", mtl: "/models/car-normal-blue.mtl" },
    { obj: "/models/car-normal-citrus.obj", mtl: "/models/car-normal-citrus.mtl" },
    { obj: "/models/car-normal-green.obj", mtl: "/models/car-normal-green.mtl" },
    { obj: "/models/car-normal-orange.obj", mtl: "/models/car-normal-orange.mtl" },
    { obj: "/models/car-normal-red.obj", mtl: "/models/car-normal-red.mtl" },
    { obj: "/models/car-normal-silver.obj", mtl: "/models/car-normal-silver.mtl" },
    { obj: "/models/car-normal-violet.obj", mtl: "/models/car-normal-violet.mtl" },

    { obj: "/models/car-pickup-blue.obj", mtl: "/models/car-pickup-blue.mtl" },
    { obj: "/models/car-pickup-citrus.obj", mtl: "/models/car-pickup-citrus.mtl" },
    { obj: "/models/car-pickup-green.obj", mtl: "/models/car-pickup-green.mtl" },
    { obj: "/models/car-pickup-orange.obj", mtl: "/models/car-pickup-orange.mtl" },
    { obj: "/models/car-pickup-red.obj", mtl: "/models/car-pickup-red.mtl" },
    { obj: "/models/car-pickup-silver.obj", mtl: "/models/car-pickup-silver.mtl" },
    { obj: "/models/car-pickup-violet.obj", mtl: "/models/car-pickup-violet.mtl" },

    { obj: "/models/car-pickup-small-blue.obj", mtl: "/models/car-pickup-small-blue.mtl" },
    { obj: "/models/car-pickup-small-citrus.obj", mtl: "/models/car-pickup-small-citrus.mtl" },
    { obj: "/models/car-pickup-small-green.obj", mtl: "/models/car-pickup-small-green.mtl" },
    { obj: "/models/car-pickup-small-orange.obj", mtl: "/models/car-pickup-small-orange.mtl" },
    { obj: "/models/car-pickup-small-red.obj", mtl: "/models/car-pickup-small-red.mtl" },
    { obj: "/models/car-pickup-small-silver.obj", mtl: "/models/car-pickup-small-silver.mtl" },
    { obj: "/models/car-pickup-small-violet.obj", mtl: "/models/car-pickup-small-violet.mtl" },

    { obj: "/models/car-station-blue.obj", mtl: "/models/car-station-blue.mtl" },
    { obj: "/models/car-station-citrus.obj", mtl: "/models/car-station-citrus.mtl" },
    { obj: "/models/car-station-green.obj", mtl: "/models/car-station-green.mtl" },
    { obj: "/models/car-station-orange.obj", mtl: "/models/car-station-orange.mtl" },
    { obj: "/models/car-station-red.obj", mtl: "/models/car-station-red.mtl" },
    { obj: "/models/car-station-silver.obj", mtl: "/models/car-station-silver.mtl" },
    { obj: "/models/car-station-violet.obj", mtl: "/models/car-station-violet.mtl" },

    { obj: "/models/car-van-blue.obj", mtl: "/models/car-van-blue.mtl" },
    { obj: "/models/car-van-citrus.obj", mtl: "/models/car-van-citrus.mtl" },
    { obj: "/models/car-van-green.obj", mtl: "/models/car-van-green.mtl" },
    { obj: "/models/car-van-orange.obj", mtl: "/models/car-van-orange.mtl" },
];
