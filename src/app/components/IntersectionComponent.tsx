import {useEffect, useRef } from "react";
import { ThickLine } from "./ThickLine";
import * as THREE from "three";
import { IntersectionStructure, JunctionObjectRef } from "../includes/types";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { useJModellerContext } from "../context/JModellerContext";


type IntersectionProps = {
    structureIndex: number;
    intersectionStructure: IntersectionStructure;
    registerJunctionObject: (group: THREE.Group, type: string) => void;
    unregisterJunctionObject: (group: THREE.Group) => void;
    controlRef: React.RefObject<DragControls | null>;
};

export const IntersectionComponent = ({ structureIndex, intersectionStructure, registerJunctionObject, unregisterJunctionObject, controlRef}: IntersectionProps) => {

    const groupRef = useRef<THREE.Group>(null);
    const { junction, setJunction, selectedJunctionObjectRef, setSelectedJunctionObjectRef } = useJModellerContext();

    useEffect(() => {
        if (!groupRef.current) {
            return;
        }
        registerJunctionObject(groupRef.current, "intersection");
        return () => {
            unregisterJunctionObject(groupRef.current!);
        };
    }, []);

    useEffect(() => {
        const controls = controlRef.current;
        const group = groupRef.current;
        if (!group || !controls) return;

        const onDrag = (event: any) => {
            const draggedGroup = event.object as THREE.Group;
            draggedGroup.position.copy(draggedGroup.position);
        };

        const onDragEnd = () => {
            if (!groupRef.current) return;

            const newOrigin = groupRef.current.position.clone();

            setJunction(prev => {
                const newIntersections = [...prev.intersections];
                newIntersections[structureIndex] = {
                    ...newIntersections[structureIndex],
                    origin: newOrigin,
                };
                return { ...prev, intersections: newIntersections };
            });
        };

        controls.addEventListener("drag", onDrag);
        controls.addEventListener("dragend", onDragEnd);

        return () => {
            controls.removeEventListener("drag", onDrag);
            controls.removeEventListener("dragend", onDragEnd);
        };
    }, []);


    const isSelected = selectedJunctionObjectRef?.group === groupRef.current;

    return (
        <>
            <group
                ref={groupRef}
                position={junction.intersections[structureIndex].origin}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedJunctionObjectRef({ group: groupRef.current!, type: "intersection" });
                }}
                onPointerMissed={(event) => {
                    if (event.button === 0 && isSelected) {
                        setSelectedJunctionObjectRef(null);
                    }
                }}
            >

                {/* Selection ring */}
                {isSelected && (
                    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                        <ringGeometry args={[intersectionStructure.maxDistanceToStopLine, intersectionStructure.maxDistanceToStopLine + 0.5, 100]} />
                        <meshBasicMaterial color="black" side={THREE.DoubleSide} />
                    </mesh>
                )}

                {/* Floor */}
                <mesh
                    geometry={intersectionStructure.intersectionFloor}
                    rotation={[-Math.PI / 2, Math.PI, Math.PI]}
                    position={[0, 0, 0]}
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

        </>
    );
};
