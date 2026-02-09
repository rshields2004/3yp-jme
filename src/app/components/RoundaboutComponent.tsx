"use client";

import { useEffect, useMemo, useRef } from "react";
import { RoundaboutConfig, RoundaboutExitStructure, RoundaboutStructure } from "../includes/types/roundabout";
import * as THREE from "three";
import { useJModellerContext } from "../context/JModellerContext";
import { ThickLine } from "./ThickLine";
import { generateEdgeTubesRound, generateExitMesh, generateLaneLinesRound, generateRingLines, generateRoundaboutFloorMesh, generateStopLineRound, generateTextPosition } from "../includes/utils";
import React from "react";
import { Text } from "@react-three/drei";
import { ThreeEvent } from "@react-three/fiber";



type RoundaboutProps = {
    id: string;
    roundaboutConfig: RoundaboutConfig;
    index: number;
};


export const RoundaboutComponent = ({ id, roundaboutConfig }: RoundaboutProps) => {

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
        const maxLaneWidth = Math.max(...exitConfig.map(c => c.laneWidth));
        const maxDistanceToStopLine = Math.max(...exitConfig.map(c => c.exitLength)) + 15;
        
        const geometricIslandRadius = (maxLaneWidth * (maxLaneCount - maxNumLaneIn)) * 2;
        const laneBandWidth = maxLaneWidth * maxNumLaneIn;
        const minArcPerExit = 20; // 2× clearanceGap (6)
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

            const laneLines = generateLaneLinesRound(outerRadius, config.laneCount, config.laneWidth, angle, config.exitLength - outerRadius, config.numLanesIn);

            const stopLine = generateStopLineRound(config.numLanesIn, laneLines, outerRadius);
            exitStructures.push({ angle, laneLines, stopLine });
        }
        const ringLines = generateRingLines(maxNumLaneIn, islandRadius, maxLaneWidth);
        const roundaboutFloor = generateRoundaboutFloorMesh(exitStructures);
        const edgeTubes = generateEdgeTubesRound(outerRadius, exitStructures);
        
        return { id: id, islandGeometry, floorCircle, ringLines, exitStructures, roundaboutFloor, edgeTubes, maxDistanceToStopLine }
    }, [roundaboutConfig, id]);

    useEffect(() => {
        const group = groupRef.current;
        if (!group) { 
            return;
        }
        group.userData.id = id;
        group.userData.type = "roundabout";
        group.userData.maxDistanceToStopLine = roundaboutMemo.maxDistanceToStopLine;
        group.userData.roundaboutExitStructure = roundaboutMemo.exitStructures;
        group.userData.exitInfo = roundaboutMemo.exitStructures;
        group.userData.roundaboutRingStructure = roundaboutMemo.ringLines;
        group.userData.exitConfig = roundaboutConfig.exitConfig;
        
        // Registration only works if intersection doesnt exist before, contains a check for ID
        registerJunctionObject(group);
        snapToValidPosition(group);
    }, [roundaboutMemo.id, id, registerJunctionObject, roundaboutMemo.exitStructures, roundaboutMemo.ringLines, roundaboutMemo.maxDistanceToStopLine, snapToValidPosition, roundaboutConfig.exitConfig]);

    const isSelected = groupRef.current ? selectedObjects.includes(groupRef.current.userData.id) : false;

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
        setSelectedObjects(prev => {
            if (prev.includes(group.userData.id)) {
                return prev.filter(id => id !== group.userData.id);
            }
            if (prev.length >= 2) {
                return [prev[1], group.userData.id];
            }
            return [...prev, group.userData.id];
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
                Roundabout {id.slice(0, 6)}
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
                const isSelectedExit = selectedExits.some(e => e.structureID === groupRef.current?.userData.id && e.exitIndex === exitIndex);
                const inALink = junction.junctionLinks.some(link =>
                    link.objectPair.some(linkExit =>
                        linkExit.structureID === groupRef.current?.userData.id && linkExit.exitIndex === exitIndex
                    )
                );
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