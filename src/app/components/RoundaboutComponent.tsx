"use client";

import { useEffect, useMemo, useRef } from "react";
import { RoundaboutConfig, RoundaboutExitStructure, RoundaboutStructure } from "../includes/types/roundabout";
import * as THREE from "three";
import { useJModellerContext } from "../context/JModellerContext";
import { ThickLine } from "./ThickLine";
import { generateEdgeTubesRound, generateExitMesh, generateLaneLinesRound, generateRingLines, generateRoundaboutFloorMesh, generateStopLineRound, generateTextPosition, getStructureData } from "../includes/utils";
import React from "react";
import { Text } from "@react-three/drei";
import { ThreeEvent } from "@react-three/fiber";



type RoundaboutProps = {
    id: string;
    name: string;
    roundaboutConfig: RoundaboutConfig;
    index: number;
};


export const RoundaboutComponent = ({ id, roundaboutConfig, name }: RoundaboutProps) => {

    const groupRef = useRef<THREE.Group>(null);
    
    const {
        registerJunctionObject,
        snapToValidPosition,
        selectedObjects,
        setSelectedObjects,
        setSelectedExits,
        selectedExits,
        junction,
        simIsRunning
    } = useJModellerContext();

    const roundaboutMemo: RoundaboutStructure = useMemo(() => {
        const { numExits, exitConfig } = roundaboutConfig;

        const maxLaneCount = Math.max(...exitConfig.map(c => c.laneCount));
        const maxNumLaneIn = Math.max(...exitConfig.map(c => c.numLanesIn));
        const maxLaneWidth = Math.max(...exitConfig.map(c => junction.laneWidth));
        const maxDistanceToStopLine = Math.max(...exitConfig.map(c => c.exitLength)) + 15;
        
        const geometricIslandRadius = (maxLaneWidth * (maxLaneCount - maxNumLaneIn)) * 2;
        const laneBandWidth = maxLaneWidth * maxNumLaneIn;
        const minArcPerExit = 20;
        const minAvgRadius = (minArcPerExit * numExits) / (2 * Math.PI);
        const minIslandRadius = Math.max(0, minAvgRadius - laneBandWidth * 0.5);
        const islandRadius = Math.max(geometricIslandRadius, minIslandRadius);
        const outerRadius = islandRadius + laneBandWidth;
        
        const islandGeometry = new THREE.CircleGeometry(islandRadius, 64);
        const floorCircle = new THREE.RingGeometry(islandRadius, outerRadius, 64);

        const exitStructures: RoundaboutExitStructure[] = [];

        for (let i = 0; i < numExits; i++) {
            const angle = (i / numExits) * 2 * Math.PI;
            const config = exitConfig[i];
            const laneLines = generateLaneLinesRound(outerRadius, config.laneCount, junction.laneWidth, angle, config.exitLength - outerRadius, config.numLanesIn);
            const stopLine = generateStopLineRound(config.numLanesIn, laneLines, outerRadius);
            exitStructures.push({ angle, laneLines, stopLine });
        }
        
        const ringLines = generateRingLines(maxNumLaneIn, islandRadius, maxLaneWidth);
        const roundaboutFloor = generateRoundaboutFloorMesh(exitStructures);
        const edgeTubes = generateEdgeTubesRound(outerRadius, exitStructures);
        
        const laneMidRadii = ringLines.map(ring => ring.radius);
        const avgRadius = laneMidRadii.reduce((sum, r) => sum + r, 0) / laneMidRadii.length;
        
        return { 
            id, 
            islandGeometry, 
            floorCircle, 
            ringLines, 
            exitStructures, 
            roundaboutFloor, 
            edgeTubes, 
            maxDistanceToStopLine,
            islandRadius,      
            outerRadius,      
            avgRadius,         
            laneMidRadii       
        };
    }, [roundaboutConfig, id]);

    useEffect(() => {
        const group = groupRef.current;
        if (!group) { 
            return;
        }
        group.userData.roundaboutStructure = roundaboutMemo;
        
        // Registration only works if intersection doesnt exist before, contains a check for ID
        registerJunctionObject(group);
        snapToValidPosition(group);
    }, [roundaboutMemo]);

    const isSelected = groupRef.current ? (() => {
        const data = getStructureData(groupRef.current);
        return data ? selectedObjects.includes(data.id) : false;
    })() : false;

    const handleRoundaboutClick = (event: ThreeEvent<PointerEvent>) => {
        if (event.button !== 2) {
            return;
        }
        if (simIsRunning) {
            return;
        }
        event.stopPropagation();
        const group = groupRef.current;
        if (!group) {
            return;
        }

        const data = getStructureData(group);
        if (!data) {
            return;
        }


        setSelectedObjects(prev => {
            if (prev.includes(data.id)) {
                return prev.filter(id => id !== data.id);
            }
            if (prev.length >= 2) {
                return [prev[1], data.id];
            }
            return [...prev, data.id];
        });
    };

    const handleExitClick = (event: ThreeEvent<PointerEvent>, exitIndex: number) => {
        if (event.button !== 0) {
            return;
        }

        const group = groupRef.current;
        if (!group) {
            return;
        }

        const data = getStructureData(group);
        if (!data) {
            return;
        }

        setSelectedExits(prev => {
            const existingIndex = prev.findIndex(e => e.structureID === data.id && e.exitIndex === exitIndex);

            // Deselect if already selected
            if (existingIndex !== -1) {
                return prev.filter((_, i) => i !== existingIndex);
            }

            // New selection
            const newSelection = { structureID: data.id, exitIndex };

            const filteredPrev = prev.filter(e => e.structureID !== data.id);

            if (prev.length < 2) {
                return [...filteredPrev, newSelection];
            }

            if (filteredPrev.length < 2) {
                return [...filteredPrev, { structureID: data.id, exitIndex }];
            }
            else {
                return [filteredPrev[1], { structureID: data.id, exitIndex }];
            }
        });
    };

    return (
        <group
            key={`r-${id}`}
            ref={groupRef}
        >
            <Text
                key={`r-${id}-label`}
                font="/fonts/Electrolize-Regular.ttf"
                position={[0, 0.1, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.35}
                color="black"
                anchorX="center"
                anchorY="middle"
            >
                Roundabout {name}
            </Text>

            {/* Selection ring */}
            {isSelected && (
                <mesh 
                    key={`r-${id}-select`}
                    rotation={[-Math.PI / 2, 0, 0]} 
                    position={[0, 0, 0]}
                >
                    <torusGeometry 
                        args={[roundaboutMemo.maxDistanceToStopLine + 0.25, 0.25, 16, 64 ]} 
                    />
                    <meshBasicMaterial color="black" side={THREE.DoubleSide} />
                </mesh>
            )}

            {/* Roundabout circular floor */}
            <mesh
                key={`r-${id}-cfloor`}
                geometry={roundaboutMemo.floorCircle}
                rotation={[-Math.PI / 2, 0, 0]}
                onPointerDown={(event) => handleRoundaboutClick(event)}
            >
                <meshStandardMaterial color={"darkgrey"} side={THREE.DoubleSide} />
            </mesh>

            {/* Roundabout floor */}
            <mesh
                key={`r-${id}-floor`}
                geometry={roundaboutMemo.roundaboutFloor}
                rotation={[-Math.PI / 2, Math.PI, Math.PI]}
                onPointerDown={(event) => handleRoundaboutClick(event)}
            >
                <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} />
            </mesh>

            {/* Edge tubes */}
            {roundaboutMemo.edgeTubes.map((tubeGeom, tubeIndex) => (
                <mesh 
                    key={`r-${id}-tube-${tubeIndex}`} 
                    geometry={tubeGeom} 
                    position={[0, 0, 0]}
                >
                    <meshStandardMaterial color="grey" emissive="black" emissiveIntensity={0.3} />
                </mesh>
            ))}

            {/* Roundabout island */}
            <mesh
                key={`r-${id}-island`}
                geometry={roundaboutMemo.islandGeometry}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.01, 0]}
            >
                <meshStandardMaterial color={"white"} side={THREE.DoubleSide} />
            </mesh>

            {/* Roundabout lane lines */}
            {roundaboutMemo.ringLines.slice(1, -1).map((ring, ringIndex) => (
                <ThickLine
                    key={`r-${id}-ring-${ringIndex}`}
                    points={ring.points}
                    colour={ring.properties.colour}
                    linewidth={ring.properties.thickness}
                    dashed={ring.properties.pattern === "dashed"}
                    worldUnits={false}
                />
            ))}

            {/* Invisible exit mesh for exit selection */}
            {roundaboutMemo.exitStructures.map((exit, exitIndex) => {
                const isSelectedExit = groupRef.current ? (() => {
                    const data = getStructureData(groupRef.current);
                    return data ? selectedExits.some(e => e.structureID === data.id && e.exitIndex === exitIndex) : false;
                })() : false;
                const inALink = groupRef.current ? (() => {
                    const data = getStructureData(groupRef.current);
                    return data ? junction.junctionLinks.some(link => link.objectPair.some(linkExit => linkExit.structureID === data.id && linkExit.exitIndex === exitIndex)) : false;
                })() : false;
                const position =  generateTextPosition(exit);
                const dir = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), position).normalize();
                const angleY = Math.atan2(dir.x, dir.z);

                return (
                    <group
                        key={`r-${id}-exit-${exitIndex}`}
                    >
                        Exit stop line
                        <ThickLine
                            key={`r-${id}-stopline-${exitIndex}`}
                            points={exit.stopLine.points}
                            colour={exit.stopLine.properties.colour} // use actual value, not string
                            linewidth={exit.stopLine.properties.thickness}
                            dashed={exit.stopLine.properties.pattern === "dashed"}
                            worldUnits={false}
                        />


                        {/* Exit lane lines */}
                        {exit.laneLines.slice(1, -1).map((lane, laneIndex) => (
                            <ThickLine
                                key={`r-${id}-exit-${exitIndex}-lane-${laneIndex}`}
                                points={[lane.line.start.toArray(), lane.line.end.toArray()]}
                                colour={lane.properties.colour} // use actual value, not string
                                linewidth={lane.properties.thickness}
                                dashed={lane.properties.pattern === "dashed"}
                                worldUnits={false}
                            />
                        ))}

                        {/* Exit Text */}
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

                        {/* Exit Invisible Mesh for selection */}
                        <mesh
                            key={`r-${id}-exitmesh-${exitIndex}`}
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
                    </group>
                );
            })}
        </group>
    );
};