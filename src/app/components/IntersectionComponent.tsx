import {useEffect, useMemo, useRef, useState } from "react";
import { ThickLine } from "./ThickLine";
import * as THREE from "three";
import { IntersectionConfig, IntersectionStructure } from "../includes/types";
import { useJModellerContext } from "../context/JModellerContext";
import { generateEdgeTubes, generateExitMesh, generateFloorMesh, generateLaneLines, generateStopLines } from "../includes/utils";
import { Text } from "@react-three/drei";
import React from "react";


type IntersectionProps = {
    id: string;
    intersectionConfig: IntersectionConfig;
    index: number;
};

export const IntersectionComponent = ({ id, intersectionConfig, index }: IntersectionProps) => {
    const groupRef = useRef<THREE.Group>(null);
    const [hovered, setHovered] = useState<boolean>(false);

    const { 
        junction, 
        selectedObjects, 
        setSelectedObjects, 
        registerJunctionObject, 
        selectedExits,
        setSelectedExits,
        snapToValidPosition
    } = useJModellerContext();

    const intersectionMemo: IntersectionStructure = useMemo(() => {

        const exitInfo = intersectionConfig.exitConfig.map((exitConfig, exitIndex) => {
            const maxExitSpan = Math.max(...intersectionConfig.exitConfig.map(e => e.laneCount * e.laneWidth));
            const adjustedOffset = maxExitSpan / (2 * Math.sin(Math.PI / intersectionConfig.numExits));
            const angleStep = (2 * Math.PI) / intersectionConfig.numExits;
            const angle = angleStep * exitIndex;

            const stopLines = generateStopLines(exitConfig.laneCount, exitConfig.laneWidth, adjustedOffset, angle);
            const laneLines = generateLaneLines(stopLines, exitConfig.exitLength, exitConfig.laneCount, exitConfig.numLanesIn);

            return { stopLines, laneLines };
        });

        const edgeTubes = generateEdgeTubes(exitInfo);
        const intersectionFloor = generateFloorMesh(exitInfo);

        const maxExitLength = Math.max(...intersectionConfig.exitConfig.map(c => c.exitLength));
        const midPointStop = new THREE.Vector3();
        exitInfo[0].stopLines[0].line.getCenter(midPointStop);
        const maxDistanceToStopLine = maxExitLength + midPointStop.distanceTo(new THREE.Vector3(0, 0, 0)) + 1;

        // Add a random ID each time so the below useEffect knows when it needs to re render
        return { id: crypto.randomUUID(), exitInfo, edgeTubes, intersectionFloor, maxDistanceToStopLine, isValid: true, };
    }, [intersectionConfig]);


    useEffect(() => {
        const group = groupRef.current;
        if (!group) { 
            return;
        }
        group.userData.id = id;
        group.userData.type = "intersection";
        group.userData.maxDistanceToStopLine = intersectionMemo.maxDistanceToStopLine;
        group.userData.exitInfo = intersectionMemo.exitInfo;
        
        // Registration only works if intersection doesnt exist before, contains a check for ID
        registerJunctionObject(group);
        snapToValidPosition(group);
    }, [intersectionMemo.id]);
    
    
    
    useEffect(() => {
        const handleWheel = (event: WheelEvent) => {
            if (!hovered || !selectedObjects.includes(id)) return;

            const delta = event.deltaY * 0.0025; // rotation speed
            if (groupRef.current) {
                groupRef.current.rotateY(delta);
            }
        };

        window.addEventListener("wheel", handleWheel);
        return () => window.removeEventListener("wheel", handleWheel);

    }, [hovered, selectedObjects]);
    
    
    const isSelected = groupRef.current ? selectedObjects.includes(groupRef.current.userData.id) : false;
    
    const handleIntersectionClick = (event: any) => {
        if (event.button !== 2){
            return;
        }
        event.stopPropagation();
        const group = groupRef.current;
        if (!group) {
            return;
        }
        setSelectedObjects(prev => prev.includes(group.userData.id) ? prev.filter(g => g !== group.userData.id) : [...prev, group.userData.id]);
    };

    const handleExitClick = (event: any, exitIndex: number) => {
        if (event.button !== 0) {
            return;
        }

        const group = groupRef.current;
        if (!group) {
            return;
        }

        setSelectedExits(prev => {
            const existingIndex = prev.findIndex(e => e.structureID === group.userData.id && e.exitIndex === exitIndex);

            // Deselect if already selected
            if (existingIndex !== -1) {
                return prev.filter((_, i) => i !== existingIndex);
            }

            // New selection
            const newSelection = { structureID: group.userData.id, exitIndex };

            const filteredPrev = prev.filter(e => e.structureID !== group.userData.id);

            if (prev.length < 2) {
                return [...filteredPrev, newSelection];
            }

            if (filteredPrev.length < 2) {
                return [...filteredPrev, { structureID: group.userData.id, exitIndex }];
            } 
            else {
                return [filteredPrev[1], { structureID: group.userData.id, exitIndex }];
            }
        });
    };

    return (
        <group
            ref={groupRef}
            onPointerOver={() => setHovered(true)}
            onPointerOut={() => setHovered(false)}
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
                    <torusGeometry args={[
                        intersectionMemo.maxDistanceToStopLine + 0.25, // radius
                        0.25, // tube radius
                        16, // radial segments
                        64 // tubular segments
                    ]} />
                    <meshBasicMaterial color="black" side={THREE.DoubleSide} />
                </mesh>
            )}

            {/* Floor */}
            <mesh
                geometry={intersectionMemo.intersectionFloor}
                rotation={[-Math.PI / 2, Math.PI, Math.PI]}
                position={[0, 0, 0]}
                onPointerDown={(event) => handleIntersectionClick(event)}
            >
                <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} />
            </mesh>

            {/* Stop lines */}
            {intersectionMemo.exitInfo.map((exit, _) =>
                exit.stopLines.map((lane, _) => (
                    <ThickLine
                        key={crypto.randomUUID()}
                        points={[lane.line.start.toArray(), lane.line.end.toArray()]}
                        colour={lane.properties.colour} // use actual value, not string
                        linewidth={lane.properties.thickness}
                        dashed={lane.properties.pattern === "dashed"}
                        worldUnits={false}
                        isStop={true}
                    />
                ))
            )}

            {/* Lane lines */}
            {intersectionMemo.exitInfo.map((exit, _) =>
                exit.laneLines.slice(1, -1).map((lane, _) => (
                    <ThickLine
                        key={crypto.randomUUID()}
                        points={[lane.line.start.toArray(), lane.line.end.toArray()]}
                        colour={lane.properties.colour} // use actual value, not string
                        linewidth={lane.properties.thickness}
                        dashed={lane.properties.pattern === "dashed"}
                        worldUnits={false}
                    />
                ))
            )}

            {/* Edge tubes */}
            {intersectionMemo.edgeTubes.map((tubeGeom, tubeIndex) => (
                <mesh key={`${tubeIndex}`} geometry={tubeGeom} position={[0, 0, 0]}>
                    <meshStandardMaterial color="grey" emissive="black" emissiveIntensity={0.3} />
                </mesh>
            ))}

            {/* Invisible exit mesh for exit selection */}
            {intersectionMemo.exitInfo.map((exit, exitIndex) => {
                
                const isSelectedExit = selectedExits.some(e => e.structureID === groupRef.current?.userData.id && e.exitIndex === exitIndex);
                const inALink = junction.junctionLinks.some(link =>
                    link.objectPair.some(linkExit =>
                        linkExit.structureID === groupRef.current?.userData.id && linkExit.exitIndex === exitIndex
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
                                handleExitClick(event, exitIndex);
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
