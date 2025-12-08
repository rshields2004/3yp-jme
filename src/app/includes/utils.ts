import * as THREE from "three";
import { defaultLaneProperties } from "./defaults";
import { ExitStructure } from "./types/intersection";
import { LaneStructure } from "./types/types";
import { RingLaneStructure, RoundaboutExitStructure } from "./types/roundabout";

const getDirection = (
    angle: number
) => {
    return new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle)).normalize();
};


export function generateStopLine(
    laneCount: number, 
    laneWidth: number, 
    stopLineOffset: number, 
    angle: number, 
    numLanesIn: number
): LaneStructure {
    const origin = new THREE.Vector3(0, 0, 0);
    const direction = getDirection(angle);
    const perp = new THREE.Vector3(direction.z, 0, -direction.x);

    const stopCenter = origin.clone().add(direction.clone().multiplyScalar(stopLineOffset));

    const totalExitWidth = laneCount * laneWidth;

    const leftPoint = stopCenter.clone().add(perp.clone().multiplyScalar(-totalExitWidth / 2));

    const rightPoint = leftPoint.clone().add(perp.clone().multiplyScalar(numLanesIn * laneWidth));

    return {
        line: new THREE.Line3(leftPoint, rightPoint),
        properties: defaultLaneProperties
    };
}


export function generateLaneLines(
    laneCount: number,
    laneWidth: number,
    stopLineOffset: number,
    angle: number,
    length: number, 
    numLanes: number, 
    numLanesIn: number
): LaneStructure[] {
    const origin = new THREE.Vector3(0, 0, 0);
    const direction = getDirection(angle);
    const perp = new THREE.Vector3(-direction.z, 0, direction.x);

    const totalWidth = laneCount * laneWidth;
    const startOffset = -totalWidth / 2;

    const stopCenter = origin.clone().add(direction.clone().multiplyScalar(stopLineOffset));
    const leftPoint = stopCenter.clone().add(perp.clone().multiplyScalar(startOffset));
    const rightPoint = stopCenter.clone().add(perp.clone().multiplyScalar(startOffset + totalWidth));

    const stopLine: LaneStructure = {
        line: new THREE.Line3(leftPoint.clone(), rightPoint.clone()),
        properties: defaultLaneProperties
    };


    const laneLines: LaneStructure[] = [];

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
            properties: { 
                ...defaultLaneProperties, 
                pattern: (i == 0 || i == numLanes || (numLanes - i) == numLanesIn) ? "solid" : "dashed" 
            },
        });
    }

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
        const firstLane = exit.laneLines[0].line;
        const lastLane = exit.laneLines[exit.laneLines.length - 1].line;

        shape.moveTo(firstLane.start.x, firstLane.start.z);
        shape.lineTo(firstLane.end.x, firstLane.end.z);
        shape.lineTo(lastLane.end.x, lastLane.end.z);
        shape.lineTo(lastLane.start.x, lastLane.start.z);
    });
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
};

export function generateExitMesh(
    exit: ExitStructure | RoundaboutExitStructure
): THREE.ShapeGeometry {
    
    const distanceFromEdge = 0.90;
    const shape = new THREE.Shape();
    
    const leftStart = exit.laneLines[0].line.end;
    const rightStart = exit.laneLines[exit.laneLines.length - 1].line.end;

    const leftEnd = new THREE.Vector3();
    const rightEnd = new THREE.Vector3();

    exit.laneLines[0].line.at(distanceFromEdge, leftEnd);
    exit.laneLines[exit.laneLines.length - 1].line.at(distanceFromEdge, rightEnd);


    // Make sure points are ordered clockwise around the rectangle
    shape.moveTo(leftStart.x, leftStart.z);
    shape.lineTo(rightStart.x, rightStart.z);
    shape.lineTo(rightEnd.x, rightEnd.z);
    shape.lineTo(leftEnd.x, leftEnd.z);
    shape.closePath();

    return new THREE.ShapeGeometry(shape);
};


export function generateLaneLinesRound(
    outerRadius: number,
    laneCount: number,
    laneWidth: number,
    angle: number,
    exitLength: number,
    numLanesIn: number
): LaneStructure[] {
    const start = new THREE.Vector3(Math.cos(angle) * outerRadius, 0, Math.sin(angle) * outerRadius);
    const endBase = start.clone().add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(exitLength));
    const right = new THREE.Vector3().subVectors(endBase, start).cross(new THREE.Vector3(0, 1, 0)).normalize();

    const laneLines: LaneStructure[] = [];

    for (let i = 0; i <= laneCount; i++) {
        const offset = (i - (laneCount) / 2) * laneWidth;
        const laneStart = start.clone().add(right.clone().multiplyScalar(offset));
        const laneEnd = endBase.clone().add(right.clone().multiplyScalar(offset));


        const dir = new THREE.Vector3().subVectors(laneEnd, laneStart).normalize();

        const a = 1;
        const b = 2 * laneStart.dot(dir);
        const c = laneStart.dot(laneStart) - (outerRadius * outerRadius);

        const discriminant = b * b - 4 * a * c;

        if (discriminant < 0) {
            console.warn("big trouble");
        }
        else {
            const sqrtD = Math.sqrt(discriminant);
            const t1 = (-b + sqrtD) / (2*a);
            const t2 = (-b - sqrtD) / (2*a);
            // choose the smaller positive t as the intersection along dir
            const t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
            const newStart = laneStart.clone().add(dir.clone().multiplyScalar(t));
            
            const lengthDiff = laneStart.distanceTo(newStart);
            // compute new laneEnd to preserve original length
            const originalLength = laneEnd.distanceTo(laneStart);
            const newEnd = newStart.clone().add(dir.clone().multiplyScalar(originalLength + lengthDiff));
            laneLines.push({
                line: new THREE.Line3(newStart, newEnd),
                properties: {
                    ...defaultLaneProperties,
                    pattern: (i === 0 || i === laneCount || i === laneCount - numLanesIn) ? "solid" : "dashed",                
                }
            });
        }

        

        
    }
    return laneLines;
};

export function shortestAngleDiff(
    a: number, 
    b: number
): number {
    let diff = b - a;
    while (diff > Math.PI) {
        diff -= 2 * Math.PI;
    }
    while (diff < -Math.PI) {
        diff += 2 * Math.PI;
    }
    return diff;
}

export function generateStopLineRound(
    numLanesIn: number,
    laneLinesRound: LaneStructure[],
    outerRadius: number
): RingLaneStructure {
    const left = laneLinesRound[laneLinesRound.length - 1];
    const right = laneLinesRound[laneLinesRound.length - 1 - numLanesIn];

    const angleLeft = Math.atan2(left.line.start.z, left.line.start.x);
    const angleRight = Math.atan2(right.line.start.z, right.line.start.x);

    const points: [number, number, number][] = [];
    const segments = 16; // number of points along the curve

    const angleDiff = shortestAngleDiff(angleLeft, angleRight);

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = angleLeft + t * angleDiff;
        const x = Math.cos(angle) * outerRadius;
        const z = Math.sin(angle) * outerRadius;
        points.push([x, 0, z]);
    }

    return {
        points,
        radius: outerRadius,
        properties: {
            ...defaultLaneProperties,
            pattern: "dashed"
        }
    };
}

export function generateRoundaboutFloorMesh(
    exitStructures: RoundaboutExitStructure[]
): THREE.ShapeGeometry {
    
    const shape = new THREE.Shape();

    shape.moveTo(exitStructures[0].laneLines[0].line.start.x, exitStructures[0].laneLines[0].line.start.z);
    
    exitStructures.forEach(eX => {
        shape.lineTo(eX.laneLines[0].line.start.x, eX.laneLines[0].line.start.z);
        shape.lineTo(eX.laneLines[0].line.end.x, eX.laneLines[0].line.end.z);
        shape.lineTo(eX.laneLines[eX.laneLines.length - 1].line.end.x, eX.laneLines[eX.laneLines.length - 1].line.end.z);
        shape.lineTo(eX.laneLines[eX.laneLines.length - 1].line.start.x, eX.laneLines[eX.laneLines.length - 1].line.start.z);
    });

    shape.closePath();

    return new THREE.ShapeGeometry(shape);
};

export function generateEdgeTubesRound(
    outerRadius: number,
    exitStructures: RoundaboutExitStructure[]
): THREE.TubeGeometry[] {
    const tubeGeometries: THREE.TubeGeometry[] = [];


     for (let i = 0; i < exitStructures.length; i++) {
        const exit1 = exitStructures[i];
        const exit2 = exitStructures[(i + 1) % exitStructures.length]; // wrap around

        // Leftmost lane of exit1 (outer edge)
        const left = exit1.laneLines[exit1.laneLines.length - 1];
        // Rightmost lane of exit2 (inner edge)
        const right = exit2.laneLines[0];

        const angleLeft = Math.atan2(left.line.start.z, left.line.start.x);
        let angleRight = Math.atan2(right.line.start.z, right.line.start.x);
        if (angleRight < angleLeft) angleRight += Math.PI * 2;

        const points: THREE.Vector3[] = [];
        const segments = 16;
        for (let j = 0; j <= segments; j++) {
            const t = j / segments;
            const angle = angleLeft + t * (angleRight - angleLeft);
            points.push(new THREE.Vector3(Math.cos(angle) * outerRadius, 0, Math.sin(angle) * outerRadius));
        }

        const curve = new THREE.CatmullRomCurve3(points);

        // Edge tubes along first and last lane of exit1 (cover its lanes)
        const curveStart = new THREE.CatmullRomCurve3([
            exit1.laneLines[0].line.start.clone(),
            exit1.laneLines[0].line.end.clone()
        ]);
        
        const curveEnd = new THREE.CatmullRomCurve3([
            exit1.laneLines[exit1.laneLines.length - 1].line.start.clone(),
            exit1.laneLines[exit1.laneLines.length - 1].line.end.clone()
        ]);

        tubeGeometries.push(new THREE.TubeGeometry(curve, 64, 0.1, 8, false));
        tubeGeometries.push(new THREE.TubeGeometry(curveStart, 64, 0.1, 8, false));
        tubeGeometries.push(new THREE.TubeGeometry(curveEnd, 64, 0.1, 8, false));
    }

    return tubeGeometries;
};

export function generateRingLines(
    maxLaneCount: number,
    islandRadius: number,
    maxLaneWidth: number
): RingLaneStructure[] {

    const ringLines: RingLaneStructure[] = [];
    for (let i = 0; i <= maxLaneCount; i++) {
        const radius = islandRadius + i * maxLaneWidth;
        const points: [number, number, number][] = [];
        for (let j = 0; j <= 256; j++) {
            const theta = (j / 256) * Math.PI * 2;
            points.push([Math.cos(theta) * radius, 0, Math.sin(theta) * radius]);
        }
        ringLines.push({ radius, points, properties: {
                ...defaultLaneProperties ,
                pattern: "dashed"
            }
        });
    }
    console.log(ringLines.length); 
    return ringLines;
}

export function generateTextPosition(
    exit: ExitStructure | RoundaboutExitStructure
): THREE.Vector3 {
    const end = exit.laneLines[0].line.end;
    const start = exit.laneLines[exit.laneLines.length - 1].line.end;

    const end2 = exit.laneLines[0].line.start;
    const start2 = exit.laneLines[exit.laneLines.length - 1].line.start;


    const midpoint = new THREE.Vector3().addVectors(end, start).multiplyScalar(0.5);
    const midpoint2 = new THREE.Vector3().addVectors(end2, start2).multiplyScalar(0.5);

    const position = new THREE.Vector3().lerpVectors(midpoint, midpoint2, 1 / midpoint.distanceTo(midpoint2)).add(new THREE.Vector3(0, 0.1, 0));
    return position.clone();
};

export function generateTextAngle(
    exit: ExitStructure | RoundaboutExitStructure
): number {
    const position = generateTextPosition(exit);
    const dir = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), position).normalize();
    const angleY = Math.atan2(dir.x, dir.z);

    return angleY;
};


export function getExitWorldPosition(junctionGroup: THREE.Group, exit: ExitStructure | RoundaboutExitStructure, position: string): THREE.Vector3 {

    const points = exit.laneLines.map(lane =>
        position === "start" ? lane.line.start : lane.line.end
    );


    const left = points[0].clone();
    const right = points[points.length - 1].clone();

    const midpoint = new THREE.Vector3();
    midpoint.addVectors(left, right).multiplyScalar(0.5);

    return midpoint.applyMatrix4(junctionGroup.matrixWorld);

};


