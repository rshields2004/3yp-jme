import {useEffect, useRef } from "react";
import { ThickLine } from "./ThickLine";
import * as THREE from "three";
import { IntersectionStructure } from "../includes/types";
import { useJModellerContext } from "../context/JModellerContext";
import { generateExitMesh } from "../includes/utils";
import { Text } from "@react-three/drei";


type IntersectionProps = {
    id: string;
    intersectionStructure: IntersectionStructure;
};

export const IntersectionComponent = ({ id, intersectionStructure }: IntersectionProps) => {

    const groupRef = useRef<THREE.Group>(null);
    const { 
        junction, 
        selectedJunctionObjectRefs, 
        setSelectedJunctionObjectRefs, 
        registerJunctionObject, 
        unregisterJunctionObject,
        selectedExits,
        setSelectedExits
    } = useJModellerContext();

    const handleIntersectionClick = (event: { button: number; stopPropagation: () => void }) => {
        if (event.button !== 2) return;
        event.stopPropagation();

        setSelectedJunctionObjectRefs(prev => {
            const exists = prev.some(obj => obj.group === groupRef.current);
            if (exists) {
                // Remove it from the selection
                return prev.filter(obj => obj.group !== groupRef.current);
            } else {
                // Add it to the selection
                return [...prev, { group: groupRef.current!, structureID: id, type: "intersection" }];
            }
        });
    };

    const handleExitClick = (junctionGroup: THREE.Group, exitIndex: number) => {
        setSelectedExits(prev => {
            const exists = prev.some(e => e.junctionGroup === junctionGroup && e.exitIndex === exitIndex);
            
            if (exists) {
                return prev.filter(e => !(e.junctionGroup === junctionGroup && e.exitIndex === exitIndex));
            }
            else {
                let newPrev = prev.filter(e => e.junctionGroup !== junctionGroup);
                if (newPrev.length >= 2) {
                    newPrev = newPrev.slice(1);
                }

                return [...newPrev, { junctionGroup, exitIndex, structureType: "intersection", structureID: id }];
            }
        })
    }

    // Upon intersection being initialised, register the object
    useEffect(() => {
        if (!groupRef.current) {
            return;
        }
        registerJunctionObject(groupRef.current, id, "intersection");
        return () => {
            unregisterJunctionObject(groupRef.current!);
        };
    }, []);


    const isSelected = selectedJunctionObjectRefs.some(obj => obj.group === groupRef.current);

    const exitRefs = useRef<Array<THREE.Mesh | null>>([]);
    if (exitRefs.current.length !== intersectionStructure.exitInfo.length) {
        exitRefs.current = intersectionStructure.exitInfo.map(() => null);
    }

    const junctionObject = junction.junctionObjects.find((jObj) => jObj.id === id);
    const origin = junctionObject ? junctionObject.config.origin : new THREE.Vector3(0, 0, 0);

    return (
        <group
            ref={groupRef}
            position={origin}
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
                onPointerDown={(event) => handleIntersectionClick(event)}
            >
                <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} />
            </mesh>

            {/* Stop lines */}
            {intersectionStructure.exitInfo.map((exit, exitIndex) =>
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
            {intersectionStructure.exitInfo.map((exit, exitIndex) =>
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
            {intersectionStructure.edgeTubes.map((tubeGeom, tubeIndex) => (
                <mesh key={`${tubeIndex}`} geometry={tubeGeom} position={[0, 0, 0]}>
                    <meshStandardMaterial color="grey" emissive="black" emissiveIntensity={0.3} />
                </mesh>
            ))}

            {/* Invisible exit mesh for exit selection */}
            {intersectionStructure.exitInfo.map((exit, exitIndex) => {
                
                const isSelectedExit = selectedExits.some(e => e.junctionGroup === groupRef.current && e.exitIndex === exitIndex);
                const inALink = junction.junctionLinks.some(link =>
                    link.objectPair.some(linkExit =>
                        linkExit.junctionGroup === groupRef.current && linkExit.exitIndex === exitIndex
                    )
                );

                return (
                    <mesh
                        key={exitIndex}
                        geometry={generateExitMesh(exit)}
                        rotation={[-Math.PI / 2, Math.PI, Math.PI]}
                        position={[0, 0.01, 0]}
                        onPointerDown={(event) => {
                            event.stopPropagation();
                            handleExitClick(groupRef.current!, exitIndex);
                        }}
                    >
                        <meshBasicMaterial
                            color={inALink ? "green" : (isSelectedExit ? "red" :  "blue")}
                            transparent
                            opacity={(isSelected || inALink ) ? 0.5 : 0} // keep visible if junction is selected
                            side={THREE.DoubleSide}
                        />
                    </mesh>
                );
            })}
        </group>
    );
};
