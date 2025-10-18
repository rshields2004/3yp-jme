import { defaultLaneProperties } from "./defaults";
import { Lane } from "./types";

export const generateStopLinePoints = (n: number, radius: number, y = 0): Lane[] => {
    if (n < 3) {
        throw new Error("Junction must have at least 3 exits");
    }
    else {
        const lanes: Lane[] = [];
        const angleStep = (2 * Math.PI) / n;

        for (let i = 0; i < n; i++) {
            const angle1 = i * angleStep;
            const x1 = Math.cos(angle1) * radius;
            const z1 = Math.sin(angle1) * radius;
            const angle2 = (i + 1) * angleStep;
            const x2 = Math.cos(angle2) * radius;
            const z2 = Math.sin(angle2) * radius;
            lanes.push(
                {
                    start: [x1, y, z1],
                    end: [x2, y, z2],
                    properties: { ...defaultLaneProperties },
                }
            );
        }
        console.log(lanes.length);
        return lanes;
    }
}