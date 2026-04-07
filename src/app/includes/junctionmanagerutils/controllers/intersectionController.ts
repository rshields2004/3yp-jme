/**
 * intersectionController.ts
 *
 * UK-style traffic signal controller for signalised intersections. Cycles
 * through approaches using the standard RED → RED_AMBER → GREEN → AMBER →
 * ALL_RED sequence.
 *
 * - While an approach is active, all other approaches are held at RED.
 * - During ALL_RED, every approach is RED.
 * - Zero lane keys → always GREEN (no control needed).
 * - One lane key → GREEN continuously (no cycling).
 */

import { LightColour, SimConfig } from "../../types/simulation";

/**
 * UK-style traffic signal controller. Cycles through approaches using
 * RED → RED_AMBER → GREEN → AMBER → ALL_RED.
 */
export class IntersectionController {
    id: string;

    private laneKeys: string[] = [];
    private greenIndex = 0;

    private readonly getCfg: () => SimConfig;

    private get greenSeconds() { return this.getCfg().controllers.intersection.intersectionGreenTime; }
    private get amberSeconds() { return this.getCfg().controllers.intersection.intersectionAmberTime; }
    private get redAmberSeconds() { return this.getCfg().controllers.intersection.intersectionRedAmberTime; }
    private get allRedSeconds() { return this.getCfg().controllers.intersection.intersectionAllRedTime; }

    private timer = 0;

    private state: "GREEN" | "AMBER" | "ALL_RED" | "RED_AMBER" = "GREEN";

    /**
     * Create a new intersection signal controller.
     * @param id - junction ID
     * @param laneKeys - distinct entry-group keys this intersection serves
     * @param cfgGetter - accessor for the current simulation config
     */
    constructor(
        id: string,
        laneKeys: string[],
        cfgGetter: () => SimConfig
    ) {
        this.id = id;
        this.laneKeys = [...new Set(laneKeys)];
        this.getCfg = cfgGetter;
    }

    /**
     * Advance the signal timer by `dt` seconds and transition states as needed.
     * @param dt - time delta in seconds since last frame
     */
    update(dt: number) {
        // If no control needed, keep green and exit
        if (this.laneKeys.length <= 1) {
            this.state = "GREEN";
            this.timer = 0;
            this.greenIndex = 0;
            return;
        }

        this.timer += dt;

        switch (this.state) {
            case "GREEN": {
                if (this.timer >= this.greenSeconds) {
                    this.timer = 0;
                    this.state = "AMBER";
                }
                break;
            }
            case "AMBER": {
                if (this.timer >= this.amberSeconds) {
                    this.timer = 0;
                    this.state = "ALL_RED";
                }
                break;
            }
            case "ALL_RED": {
                if (this.timer >= this.allRedSeconds) {
                    this.timer = 0;
                    // Advance to next approach, then show RED+AMBER before green
                    this.greenIndex = (this.greenIndex + 1) % this.laneKeys.length;
                    this.state = "RED_AMBER";
                }
                break;
            }
            case "RED_AMBER": {
                if (this.timer >= this.redAmberSeconds) {
                    this.timer = 0;
                    this.state = "GREEN";
                }
                break;
            }
        }
    }

    /**
     * True only during GREEN phase for the currently-served approach.
     *
     * @param laneKey - string key identifying a specific lane
     * @returns `true` when no vehicles are circulating
     */
    isGreen(laneKey: string): boolean {
        return this.getCurrentGreen() === laneKey;
    }

    /**
     * Return the current signal phase.
     * @returns a human-readable state summary
     */
    getState(): "GREEN" | "AMBER" | "ALL_RED" | "RED_AMBER" {
        return this.state;
    }

    /**
     * Return the lane key of the currently-green approach, or `null` if none.
     * @returns the currently-green lane key, or `null` if none
     */
    getCurrentGreen(): string | null {
        if (this.laneKeys.length === 0) return null;
        if (this.state !== "GREEN") return null;
        return this.laneKeys[this.greenIndex];
    }

    /**
     * Returns the UK-style light colour state for a given approach laneKey.
     * Use this to drive ThickLine colours:
     *  - RED       -> setRed()
     *  - RED_AMBER -> setRedAmber()
     *  - GREEN     -> setGreen()
     *  - AMBER     -> setAmber()
     *
     * @param laneKey - string key identifying a specific lane
     * @returns the signal colour string
     */
    getLightColour(laneKey: string): LightColour {
        if (this.laneKeys.length === 0) return "GREEN"; // no controller => treat as green

        const isActiveApproach = this.laneKeys[this.greenIndex] === laneKey;

        // Non-active approaches are always RED (even during RED_AMBER of the active approach)
        if (!isActiveApproach) return "RED";

        // Active approach colour depends on phase
        switch (this.state) {
            case "GREEN":
                return "GREEN";
            case "AMBER":
                return "AMBER";
            case "RED_AMBER":
                return "RED_AMBER";
            case "ALL_RED":
            default:
                return "RED";
        }
    }

    /**
     * Optional helper: if you want vehicles to be allowed on AMBER (some sims do),
     * keep using isGreen() for strict behaviour.
     * If you want "treat AMBER as proceed if already close", handle that in VehicleManager.
     *
     * @param laneKey - string key identifying a specific lane
     * @returns `true` if the entry is permitted
     */
    canNewVehicleEnter(laneKey: string): boolean {
        return this.isGreen(laneKey);
    }

    /**
     * Return the number of distinct signal phases (approach groups).
     * @returns phase count (0 = no lanes, 1 = always green, >1 = cycling)
     */
    getNumPhases(): number {
        return this.laneKeys.length;
    }
}
