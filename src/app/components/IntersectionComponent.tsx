import { useMemo } from "react";
import { Intersection } from "../includes/types";
import { ThickLine } from "./ThickLine";
import * as THREE from "three";

type IntersectionProps = {
    intersection: Intersection;
};

export const IntersectionComponent: React.FC<IntersectionProps> = ({intersection}: IntersectionProps) => {

    const { intersectionStructure } = intersection;

    const maxExitLength = Math.max(...intersection.intersectionConfig.exitConfig.map(config => config.exitLength));
    const midPointStop = new THREE.Vector3();
    intersection.intersectionStructure.exitInfo[0].stopLines[0].line.getCenter(midPointStop);
    const distanceToStopLine = maxExitLength + midPointStop.distanceTo(intersection.intersectionConfig.origin) + 1;



    const floorMesh = useMemo(() => {
        const shape = new THREE.Shape();

        intersectionStructure.exitInfo.forEach((exit, _) => {
            const stopLine = exit.stopLines[0].line;
            const firstLane = exit.laneLines[0].line;
            const lastLane = exit.laneLines[exit.laneLines.length - 1].line;

            // Start at the start of the stop line
            const startPoint = stopLine.start;
            shape.moveTo(startPoint.x, startPoint.z);

            // End of first lane line
            const endFirstLane = firstLane.end;
            shape.lineTo(endFirstLane.x, endFirstLane.z);

            // End of last lane line
            const endLastLane = lastLane.end;
            shape.lineTo(endLastLane.x, endLastLane.z);

            // End of stop line
            const endStop = stopLine.end;
            shape.lineTo(endStop.x, endStop.z);
        });

        shape.closePath();
        return new THREE.ShapeGeometry(shape);
    }, [intersectionStructure]);

    return (
        <group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={intersection.intersectionConfig.origin}>
                    <ringGeometry args={[distanceToStopLine, distanceToStopLine + 0.5, 32]} />
                    <meshBasicMaterial color="black" side={2} />
            </mesh>
            <mesh geometry={floorMesh} rotation={[-Math.PI / 2, 0, Math.PI]} position={intersection.intersectionConfig.origin}>
                <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} />
            </mesh>
            {intersectionStructure.exitInfo.flatMap((exit, exitIndex) =>
                exit.stopLines.map((lane, laneIdx) => (
                    <ThickLine
                        key={`${exitIndex}-${laneIdx}`}
                        line={lane.line}
                        colour={lane.properties.colour}
                        dashed={lane.properties.pattern}
                    />
                ))
            )}

            {intersectionStructure.exitInfo.flatMap((exit, exitIndex) =>
                exit.laneLines.map((lane, laneIdx) => (
                    <ThickLine
                        key={`${exitIndex}-${laneIdx}`}
                        line={lane.line}
                        colour={lane.properties.colour}
                        dashed={lane.properties.pattern}
                    />
                ))
            )}

            {intersectionStructure.edgeTubes.flatMap((tubeGeom, tubeIndex) =>
                <mesh
                    key={`${tubeIndex}`}
                    geometry={tubeGeom}
                    position={[0, 0, 0]}
                >
                    <meshStandardMaterial
                        color={"grey"}
                        emissive={"black"}
                        emissiveIntensity={0.3}
                    />
                </mesh>
            )}
        </group>
    );
};