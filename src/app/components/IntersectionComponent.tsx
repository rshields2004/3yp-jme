import { Intersection } from "../includes/types";
import { ThickLine } from "./ThickLine";

type IntersectionProps = {
    intersection: Intersection;
};

export const IntersectionComponent: React.FC<IntersectionProps> = ({intersection}: IntersectionProps) => {

    const { intersectionStructure } = intersection;

    return (
        <>
            {intersectionStructure.exitInfo.flatMap((exit, exitIndex) =>
                exit.stopLines.map((lane, laneIdx) => (
                    <ThickLine
                        key={`${exitIndex}-${laneIdx}`}
                        start={[lane.start[0], lane.start[1], lane.start[2]]}
                        end={[lane.end[0], lane.end[1], lane.end[2]]}
                        colour={lane.properties.colour}
                        dashed={lane.properties.pattern}
                    />
                ))
            )}

            {intersectionStructure.exitInfo.flatMap((exit, exitIndex) =>
                exit.laneLines.map((lane, laneIdx) => (
                    <ThickLine
                        key={`${exitIndex}-${laneIdx}`}
                        start={[lane.start[0], lane.start[1], lane.start[2]]}
                        end={[lane.end[0], lane.end[1], lane.end[2]]}
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
        </>
    );
};