import { useEffect, useMemo, useRef, useState } from "react";
import { Intersection } from "../includes/types";
import { ThickLine } from "./ThickLine";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { DragControls, TransformControls } from "@react-three/drei";
import { useJModellerContext } from "../context/JModellerContext";

type IntersectionProps = {
    intersection: Intersection;
    controlsRef?: React.RefObject<any>;
};

export const IntersectionComponent: React.FC<IntersectionProps> = ({ intersection, controlsRef }) => {
    const { intersectionStructure } = intersection;
    const [selected, setSelected] = useState(false);
    const groupRef = useRef<THREE.Group>(null);
    const transformRef = useRef<any>(null);
    const { camera, gl } = useThree();
    const { setJunction } = useJModellerContext();

    const maxExitLength = Math.max(...intersection.intersectionConfig.exitConfig.map(c => c.exitLength));
    const midPointStop = new THREE.Vector3();
    intersectionStructure.exitInfo[0].stopLines[0].line.getCenter(midPointStop);
    const distanceToStopLine = maxExitLength + midPointStop.distanceTo(intersection.intersectionConfig.origin) + 1;

    const handlePointerDown = (e: any) => {
        e.stopPropagation(); // Prevent deselection
        setSelected(true);
    };

    useEffect(() => {
        const handlePointerMissed = () => setSelected(false);
        gl.domElement.addEventListener("pointerdown", handlePointerMissed);
        return () => gl.domElement.removeEventListener("pointerdown", handlePointerMissed);
    }, [gl]);




    
    useEffect(() => {
        const controls = transformRef.current;
        if (!controls) {
            return;
        }

        

        const handleObjectChange = () => {
            const obj = controls.object;
            if (obj) {
                const newOrigin = new THREE.Vector3(
                    obj.position.x,
                    obj.position.y,
                    obj.position.z
                );

                setJunction((prevJunction) => {
                    const updatedIntersections = prevJunction.intersections.map((int) => {
                        if (int === intersection) {
                            // Update only this intersection
                            return {
                                ...int,
                                intersectionConfig: {
                                    ...int.intersectionConfig,
                                    origin: newOrigin,
                                },
                            };
                        }
                        return int; // leave others unchanged
                    });

                    return {
                        ...prevJunction,
                        intersections: updatedIntersections,
                    };
                });
            }
        };

        controls.addEventListener("objectChange", handleObjectChange);
        return () => controls.removeEventListener("objectChange", handleObjectChange);
    }, []);

    const floorMesh = useMemo(() => {
        const shape = new THREE.Shape();
        intersectionStructure.exitInfo.forEach(exit => {
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
    }, [intersectionStructure]);

    return (
        <TransformControls
            ref={transformRef}
            mode="translate"
            enabled={selected} // only draggable when selected
        >
            <group
                ref={groupRef}
            >

                {/* Selection ring */}
                {selected && (
                    <mesh rotation={[-Math.PI / 2, 0, 0]} position={intersection.intersectionConfig.origin}>
                        <ringGeometry args={[distanceToStopLine, distanceToStopLine + 0.5, 32]} />
                        <meshBasicMaterial color="black" side={2} />
                    </mesh>
                )}

                {/* Floor */}
                <mesh
                    geometry={floorMesh}
                    rotation={[-Math.PI / 2, 0, Math.PI]}
                    position={intersection.intersectionConfig.origin}
                    onPointerDown={handlePointerDown}
                >
                    <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} />
                </mesh>

                {/* Stop lines */}
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

                {/* Lane lines */}
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

                {/* Edge tubes */}
                {intersectionStructure.edgeTubes.flatMap((tubeGeom, tubeIndex) => (
                    <mesh key={`${tubeIndex}`} geometry={tubeGeom} position={[0, 0, 0]}>
                        <meshStandardMaterial color="grey" emissive="black" emissiveIntensity={0.3} />
                    </mesh>
                ))}
            </group>
        </TransformControls>
    );
};
