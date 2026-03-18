import { LightColour, SimConfig } from "../../types/simulation";

/**
 * UK light sequence per approach (simplified but correct):
 *   RED -> RED+AMBER -> GREEN -> AMBER -> ALL_RED -> (next approach) RED+AMBER -> GREEN -> ...
 *
 * Notes:
 * - While an approach is active, all other approaches are held at RED.
 * - During ALL_RED, everyone is RED.
 * - If there is 0 laneKeys, we default to always GREEN (no control needed).
 * - If there is 1 laneKey, we keep it GREEN continuously (no cycling).
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

    constructor(
        id: string,
        laneKeys: string[],
        cfgGetter: () => SimConfig
    ) {
        this.id = id;
        this.laneKeys = [...new Set(laneKeys)];
        this.getCfg = cfgGetter;
    }

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

    /** True only during GREEN phase for the currently-served approach. */
    isGreen(laneKey: string): boolean {
        return this.getCurrentGreen() === laneKey;
    }

    getState(): "GREEN" | "AMBER" | "ALL_RED" | "RED_AMBER" {
        return this.state;
    }

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
     */
    canNewVehicleEnter(laneKey: string): boolean {
        return this.isGreen(laneKey);
    }
}
