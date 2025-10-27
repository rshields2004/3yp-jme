import { useEffect, useMemo, useRef, useState } from "react";
import { Intersection } from "../includes/types";
import { ThickLine } from "./ThickLine";
import * as THREE from "three";
import { useDrag } from "@use-gesture/react";
import { useThree } from "@react-three/fiber";


type IntersectionProps = {
    intersection: Intersection;
    controlsRef?: React.RefObject<any>; 
};

export const IntersectionComponent: React.FC<IntersectionProps> = ({intersection, controlsRef}: IntersectionProps) => {

    const { intersectionStructure } = intersection;
    const [selected, setSelected] = useState<boolean>(false);
    const groupRef = useRef<THREE.Group>(null);
    const { camera, gl, scene } = useThree();
    const maxExitLength = Math.max(...intersection.intersectionConfig.exitConfig.map(config => config.exitLength));
    const midPointStop = new THREE.Vector3();
    intersection.intersectionStructure.exitInfo[0].stopLines[0].line.getCenter(midPointStop);
    const distanceToStopLine = maxExitLength + midPointStop.distanceTo(intersection.intersectionConfig.origin) + 1;


    const handlePointerDown = (e: any) => {
        e.stopPropagation(); // Prevent deselection when clicking on this mesh
        setSelected(true);
    };

    useEffect(() => {
        const handlePointerMissed = () => setSelected(false);
        gl.domElement.addEventListener("pointerdown", handlePointerMissed);
        return () => gl.domElement.removeEventListener("pointerdown", handlePointerMissed);
    }, [gl]);

    useEffect(() => {
        if (!controlsRef?.current) return;
        controlsRef.current.enabled = !selected;
    }, [selected, controlsRef]);

    // Handle dragging
    const dragBind = useDrag(
        ({ offset: [x, y] }) => {
            if (selected && groupRef.current) {
                groupRef.current.position.x = x / 50; // adjust sensitivity
                groupRef.current.position.z = -y / 50;
            }
        },
        { enabled: selected }
    );

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
        <group
            ref={groupRef}
            {...dragBind()} onPointerMissed={() => setSelected(false)}
        >
            {selected && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={intersection.intersectionConfig.origin}>
                    <ringGeometry args={[distanceToStopLine, distanceToStopLine + 0.5, 32]} />
                    <meshBasicMaterial color="black" side={2} />
                </mesh>
            )}
            
            
            <mesh geometry={floorMesh} 
                rotation={[-Math.PI / 2, 0, Math.PI]} 
                position={intersection.intersectionConfig.origin}
                onPointerDown={handlePointerDown}
            >
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