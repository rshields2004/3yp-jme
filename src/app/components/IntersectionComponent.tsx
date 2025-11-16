import {useEffect, useRef } from "react";
import { ThickLine } from "./ThickLine";
import * as THREE from "three";
import { IntersectionStructure } from "../includes/types";
import { useJModellerContext } from "../context/JModellerContext";
import { generateExitMesh } from "../includes/utils";
import { Text } from "@react-three/drei";
import React from "react";


type IntersectionProps = {
    id: string;
    intersectionStructure: IntersectionStructure;
    index: number;
};

export const IntersectionComponent = ({ id, intersectionStructure, index }: IntersectionProps) => {

    const groupRef = useRef<THREE.Group>(null);
    const { 
        junction, 
        selectedJunctionObjectRefs, 
        setSelectedJunctionObjectRefs, 
        registerJunctionObject, 
        unregisterJunctionObject,
        selectedExits,
        setSelectedExits,
        snapToValidPosition
    } = useJModellerContext();

    const handleIntersectionClick = (event: { button: number; stopPropagation: () => void }) => {
        if (event.button !== 2) return;
        event.stopPropagation();

        // Since only 2 can be selected at a time, we remove the earliest selected and select the new one
        setSelectedJunctionObjectRefs(prev => {
            const exists = prev.some(obj => obj.group === groupRef.current);
            if (exists) {
                return prev.filter(obj => obj.group !== groupRef.current);
            } 
            else {
                return [...prev, { group: groupRef.current!, refID: id, type: "intersection" }];
            }
        });
    };

    const handleExitClick = (junctionGroup: THREE.Group, exitIndex: number) => {
        setSelectedExits(prev => {
            const selectedAlready = prev.some(exit => exit.junctionGroup === junctionGroup && exit.exitIndex === exitIndex);
            const inALink = junction.junctionLinks.some(link =>
                link.objectPair.some(linkExit =>
                    linkExit.junctionGroup === junctionGroup && linkExit.exitIndex === exitIndex
                )
            );

            if (selectedAlready) {
                return prev.filter(exit => !(exit.junctionGroup === junctionGroup && exit.exitIndex === exitIndex));
            }

            if (inALink) {
                return prev;
            }

            let newLinks = prev.filter(exit => exit.junctionGroup !== junctionGroup);

            if (newLinks.length >= 2) {
                newLinks = newLinks.slice(1);
            }

            return [
                ...newLinks,
                { junctionGroup, exitIndex, structureType: "intersection", structureIndex: index, structureID: id }
            ];
        });
    };

    // Upon intersection being initialised, register the object
    useEffect(() => {
        if (!groupRef.current) {
            return;
        }
        
        //Actually added the id to the group userdata so THREE group can be linked to array ref object
        groupRef.current.userData.id = id;
        registerJunctionObject(groupRef.current, id, "intersection");
        
        snapToValidPosition(groupRef.current);
        
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

            <Text
                font="/fonts/Electrolize-Regular.ttf"
                position={[0, 0.1, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.5}             
                color="white"            
                anchorX="center"         
                anchorY="middle"         
            >
                Intersection {index}
            </Text>

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
                
                
                const end = exit.laneLines[0].line.end;
                const start = exit.laneLines[exit.laneLines.length - 1].line.end;

                const end2 = exit.laneLines[0].line.start;
                const start2 = exit.laneLines[exit.laneLines.length - 1].line.start;


                const midpoint = new THREE.Vector3().addVectors(end, start).multiplyScalar(0.5);
                const midpoint2 = new THREE.Vector3().addVectors(end2, start2).multiplyScalar(0.5);

                const position = new THREE.Vector3().lerpVectors(midpoint, midpoint2, 1 / midpoint.distanceTo(midpoint2)).add(new THREE.Vector3(0, 0.1, 0));

                const dir = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), position).normalize();
                const angleY = Math.atan2(dir.x, dir.z);

                
                return (
                    <React.Fragment
                        key={exitIndex}
                    >
                        <Text
                            font="/fonts/Electrolize-Regular.ttf"
                            position={position}
                            rotation={[-Math.PI / 2, 0, angleY]}
                            fontSize={0.5}         
                            fontStyle="normal"
                            fontWeight={1}    
                            color="white"            
                            anchorX="center"         
                            anchorY="middle"  
                            strokeColor="black"       
                        >
                            Exit {exitIndex}
                        </Text>
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
                    </React.Fragment>
                );
            })}
        </group>
    );
};
