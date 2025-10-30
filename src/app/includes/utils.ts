import * as THREE from "three";
import { defaultLaneProperties } from "./defaults";
import { ExitStructure, LaneStructure } from "./types";


const getDirection = (
    angle: number
) => {
    return new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle)).normalize();
};


export function generateStopLines(
    laneCount: number, 
    laneWidth: number, 
    stopLineOffset: number, 
    angle: number, 
    originRaw: THREE.Vector3
): LaneStructure[] {
    const origin = originRaw.clone();
    const direction = getDirection(angle);
    const perp = new THREE.Vector3(-direction.z, 0, direction.x);

    const totalWidth = laneCount * laneWidth;
    const startOffset = -totalWidth / 2;

    const stopCenter = origin.clone().add(direction.clone().multiplyScalar(stopLineOffset));
    const leftPoint = stopCenter.clone().add(perp.clone().multiplyScalar(startOffset));
    const rightPoint = stopCenter.clone().add(perp.clone().multiplyScalar(startOffset + totalWidth));

    return [
        {
            line: new THREE.Line3(leftPoint.clone(), rightPoint.clone()),
            properties: defaultLaneProperties
        },
    ];
}


export function generateLaneLines(
    stopLines: LaneStructure[], 
    length: number, 
    numLanes: number, 
): LaneStructure[] {

    const laneLines: LaneStructure[] = [];
    stopLines.forEach((stopLine) => {
        const startVec = stopLine.line.start.clone();
        const endVec = stopLine.line.end.clone();

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
            laneLines.push({
                line: new THREE.Line3(laneStart.clone(), laneEnd.clone()),
                properties: { ...defaultLaneProperties, pattern: (i == 0 || i == numLanes) ? "solid" : "dashed" },
            });
        }
    });

    return laneLines;
}



export function generateEdgeTubes(
    exits: ExitStructure[],
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
        const p0 = leftLaneA.line.end.clone();
        const p1 = leftLaneA.line.start.clone();

        const difference1 = p0.clone().sub(p1).normalize();

        const a0 = p1.clone().addScaledVector(difference1, curveLengthScale);
        const a1 = p1.clone().addScaledVector(difference1, curveLengthScale * 5);

        const p2 = rightLaneB.line.start.clone();
        const p3 = rightLaneB.line.end.clone();

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


export function generateFloorMesh(
    exits: ExitStructure[]
): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
        exits.forEach(exit => {
            const stopLine = exit.stopLines[0].line;
            const firstLane = exit.laneLines[0].line;
            const lastLane = exit.laneLines[exit.laneLines.length - 1].line;

            shape.moveTo(stopLine.start.x, stopLine.start.z);
            shape.lineTo(firstLane.end.x, firstLane.end.z);
            shape.lineTo(lastLane.end.x, lastLane.end.z);
            shape.lineTo(stopLine.end.x, stopLine.end.z);
        });
        shape.closePath();
    return new THREE.ShapeGeometry(shape);
};