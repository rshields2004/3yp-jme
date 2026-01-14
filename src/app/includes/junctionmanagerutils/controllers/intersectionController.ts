export class IntersectionController {
    id: string;

    private laneKeys: string[] = [];
    private greenIndex = 0;

    private greenSeconds: number;
    private allRedSeconds: number;

    private timer = 0;

    // "GREEN" -> laneKeys[greenIndex] is green
    // "ALL_RED" -> nobody is green
    private state: "GREEN" | "ALL_RED" = "GREEN";

    constructor(id: string, laneKeys: string[], greenSeconds = 8, allRedSeconds = 2) {
        this.id = id;
        this.laneKeys = [...new Set(laneKeys)];
        this.greenSeconds = greenSeconds;
        this.allRedSeconds = allRedSeconds;
    }

    update(dt: number) {
        if (this.laneKeys.length <= 1) return;

        this.timer += dt;

        if (this.state === "GREEN") {
            if (this.timer >= this.greenSeconds) {
                this.timer = 0;
                this.state = "ALL_RED";
            }
            return;
        }

        // ALL_RED
        if (this.timer >= this.allRedSeconds) {
            this.timer = 0;
            this.state = "GREEN";
            this.greenIndex = (this.greenIndex + 1) % this.laneKeys.length;
        }
    }

    isGreen(laneKey: string): boolean {
        if (this.laneKeys.length === 0) return true;
        if (this.state === "ALL_RED") return false;
        return this.laneKeys[this.greenIndex] === laneKey;
    }

    getState(): "GREEN" | "ALL_RED" {
        return this.state;
    }

    getCurrentGreen(): string | null {
        if (this.laneKeys.length === 0) return null;
        if (this.state === "ALL_RED") return null;
        return this.laneKeys[this.greenIndex];
    }

    getLightColour(laneKey: string): LightColour {
        return this.isGreen(laneKey) ? "GREEN" : "RED";
    }
}

export type LightColour = "RED" | "GREEN";