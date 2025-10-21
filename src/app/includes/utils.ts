import * as THREE from "three";
import { Exit, LaneLine } from "./types";
import { defaultLaneProperties } from "./defaults";


const getDirection = (angle: number) => {
    return new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle)).normalize();
}


export function generateStopLines(laneCount: number, laneWidth: number, stopLineOffset: number, angle: number, originRaw: [number, number, number]): LaneLine[] {
    const origin = new THREE.Vector3().fromArray(originRaw);
    const direction = getDirection(angle);
    const perp = new THREE.Vector3(-direction.z, 0, direction.x);

    const totalWidth = laneCount * laneWidth;
    const startOffset = -totalWidth / 2;

    const stopCenter = origin.clone().add(direction.clone().multiplyScalar(stopLineOffset));
    const leftPoint = stopCenter.clone().add(perp.clone().multiplyScalar(startOffset));
    const rightPoint = stopCenter.clone().add(perp.clone().multiplyScalar(startOffset + totalWidth));

    return [
        {
            start: [leftPoint.x, origin.y, leftPoint.z],
            end: [rightPoint.x, origin.y, rightPoint.z],
            properties: defaultLaneProperties
        },
    ];
}


export function generateLaneLines(stopLines: LaneLine[], length: number, numLanes: number, originRaw: [number, number, number]): LaneLine[] {

    const laneLines: LaneLine[] = [];
    stopLines.forEach((stopLine) => {
        const origin = new THREE.Vector3(...originRaw);
        const startVec = new THREE.Vector3(...stopLine.start);
        const endVec = new THREE.Vector3(...stopLine.end);

        // Vector along the stop line
        const stopDir = endVec.clone().sub(startVec).normalize();

        // Vector perpendicular to stop line (direction lanes extend)
        const laneDir = new THREE.Vector3(-stopDir.z, 0, stopDir.x).normalize();

        // stop line vector
        const stopVec = endVec.clone().sub(startVec);

        // left edge of stop line
        const leftEdge = startVec.clone();

        for (let i = 0; i <= numLanes; i++) {
            const fractionAlong = (i / numLanes); // 0 -> left edge, 1 -> right edge
            const laneStart = leftEdge.clone().add(stopVec.clone().multiplyScalar(fractionAlong));
            const laneEnd = laneStart.clone().add(laneDir.clone().multiplyScalar(-length));
            console.log(origin.y);
            laneLines.push({
                start: [laneStart.x, origin.y, laneStart.z],
                end: [laneEnd.x, origin.y, laneEnd.z],
                properties: { ...defaultLaneProperties, pattern: (i == 0 || i == numLanes) ? "solid" : "dashed" },
            });
        }
    });

    return laneLines;
}



export function generateEdgeTubes(
    exits: Exit[],
    radius = 0.1,
    segments = 500
): THREE.TubeGeometry[] {
    const tubeGeometries: THREE.TubeGeometry[] = [];

    const exitCount = exits.length;

    const curveLengthScale = 0.1;

    for (let i = 0; i < exitCount; i++) {
        const exitA = exits[i];
        const exitB = exits[(i + 1) % exitCount];

        // Leftmost lane of exitA (first lane)
        const leftLaneA = exitA.laneLines[exitA.laneLines.length - 1];

        // Rightmost lane of exitB (last lane)
        const rightLaneB = exitB.laneLines[0];

        // Points: leftLaneA.end -> a1 -> a0 -> leftLaneA.start -> leftLaneB.start -> b0 -> b1 -> leftLaneB.end
        const p0 = new THREE.Vector3(...leftLaneA.end);
        const p1 = new THREE.Vector3(...leftLaneA.start);

        const difference1 = p0.clone().sub(p1).normalize();

        const a0 = p1.clone().addScaledVector(difference1, curveLengthScale);
        const a1 = p1.clone().addScaledVector(difference1, curveLengthScale * 5);

        const p2 = new THREE.Vector3(...rightLaneB.start);
        const p3 = new THREE.Vector3(...rightLaneB.end);

        const difference2 = p3.clone().sub(p2).normalize();
        const b0 = p2.clone().addScaledVector(difference2, curveLengthScale);
        const b1 = p2.clone().addScaledVector(difference2, curveLengthScale * 5);

        // Smooth curve through these points
        const curve1 = new THREE.CatmullRomCurve3([p0, a0]);
        const curve2 = new THREE.CatmullRomCurve3([a1, a0, p1, p2, b0, b1]);
        const curve3 = new THREE.CatmullRomCurve3([b1, p3]);

        const tube1 = new THREE.TubeGeometry(curve1, segments, radius, 8, false);
        const tube2 = new THREE.TubeGeometry(curve2, segments, radius, 8, false);
        const tube3 = new THREE.TubeGeometry(curve3, segments, radius, 8, false);

        tubeGeometries.push(tube1);
        tubeGeometries.push(tube2);
        tubeGeometries.push(tube3);
    }

    return tubeGeometries;
}