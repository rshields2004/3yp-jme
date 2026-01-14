"use client";

import { useEffect, useMemo, useRef } from "react";
import { ThickLine, ThickLineHandle } from "./ThickLine";
import * as THREE from "three";
import { IntersectionConfig, IntersectionStructure } from "../includes/types/intersection";
import { useJModellerContext } from "../context/JModellerContext";
import { generateEdgeTubes, generateExitMesh, generateFloorMesh, generateLaneLines, generateStopLine, generateTextPosition } from "../includes/utils";
import { Text } from "@react-three/drei";
import React from "react";
import { ThreeEvent } from "@react-three/fiber";


type IntersectionProps = {
    id: string;
    intersectionConfig: IntersectionConfig;
    index: number;
};

export const IntersectionComponent = ({ id, intersectionConfig, index }: IntersectionProps) => {
    const groupRef = useRef<THREE.Group>(null);
    const {
        junction,
        selectedObjects,
        setSelectedObjects,
        registerJunctionObject,
        selectedExits,
        setSelectedExits,
        snapToValidPosition,
        simIsRunning
    } = useJModellerContext();


    const intersectionMemo: IntersectionStructure = useMemo(() => {

        const exitInfo = intersectionConfig.exitConfig.map((exitConfig, exitIndex) => {
            const maxExitSpan = Math.max(...intersectionConfig.exitConfig.map(e => e.laneCount * e.laneWidth));
            const adjustedOffset = maxExitSpan / (2 * Math.sin(Math.PI / intersectionConfig.numExits));
            const angleStep = (2 * Math.PI) / intersectionConfig.numExits;
            const angle = angleStep * exitIndex;

            const stopLine = generateStopLine(exitConfig.laneCount, exitConfig.laneWidth, adjustedOffset, angle, exitConfig.numLanesIn);
            const laneLines = generateLaneLines(exitConfig.laneCount, exitConfig.laneWidth, adjustedOffset, angle, exitConfig.exitLength, exitConfig.laneCount, exitConfig.numLanesIn);

            return { stopLine, laneLines };
        });

        const edgeTubes = generateEdgeTubes(exitInfo);
        const intersectionFloor = generateFloorMesh(exitInfo);

        const maxExitLength = Math.max(...intersectionConfig.exitConfig.map(c => c.exitLength));
        const midPointStop = exitInfo[0].laneLines[0].line.start.clone().lerp(exitInfo[0].laneLines[exitInfo[0].laneLines.length - 1].line.start.clone(), 0.5);

        const maxDistanceToStopLine = maxExitLength + midPointStop.distanceTo(new THREE.Vector3(0, 0, 0)) + 15;

        // Add a random ID each time so the below useEffect knows when it needs to re render
        return { id: id, exitInfo, edgeTubes, intersectionFloor, maxDistanceToStopLine };
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
    }, [id, intersectionMemo.exitInfo, intersectionMemo.maxDistanceToStopLine, registerJunctionObject, snapToValidPosition]);



    const stopLineRefs: React.RefObject<ThickLineHandle | null>[] = useMemo(
        () => intersectionMemo.exitInfo.map(() => React.createRef<ThickLineHandle>()),
        [intersectionMemo.exitInfo]
    );


    useEffect(() => {
        const group = groupRef.current;
        if (!group) return;

        // This will be read by the simulation tick to colour stop lines
        if (!group.userData.stopLineRefsByEntryKey) {
            group.userData.stopLineRefsByEntryKey = {};
        }

        // VehicleManager groups lanes like: "entry:<UUID>-<exit>-<dir>"
        // Your stop lines are for approaching traffic => dir = "in"
        for (let exitIndex = 0; exitIndex < intersectionMemo.exitInfo.length; exitIndex++) {
            const entryKey = `entry:${id}-${exitIndex}-in`;
            group.userData.stopLineRefsByEntryKey[entryKey] = stopLineRefs[exitIndex];
        }

        // cleanup
        return () => {
            if (!group.userData.stopLineRefsByEntryKey) return;
            for (let exitIndex = 0; exitIndex < intersectionMemo.exitInfo.length; exitIndex++) {
            const entryKey = `entry:${id}-${exitIndex}-in`;
            delete group.userData.stopLineRefsByEntryKey[entryKey];
            }
        };
    }, [id, intersectionMemo.exitInfo.length, stopLineRefs]);








    const isSelected = groupRef.current ? selectedObjects.includes(groupRef.current.userData.id) : false;

    const handleIntersectionClick = (event: ThreeEvent<PointerEvent>) => {
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
        setSelectedObjects(prev => prev.includes(group.userData.id) ? prev.filter(g => g !== group.userData.id) : [...prev, group.userData.id]);
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
            key={`i-${id}`}
            ref={groupRef}
        >

            <Text
                key={`i-label-${id}`}
                font="/fonts/Electrolize-Regular.ttf"
                position={[0, 0.1, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.35}
                color="white"
                anchorX="center"
                anchorY="middle"
            >
                Intersection {index}
            </Text>

            {/* Selection ring */}
            {isSelected && (
                <mesh
                    key={`i-select-${id}`}
                    rotation={[-Math.PI / 2, 0, 0]}
                    position={[0, 0, 0]}
                >
                    <torusGeometry
                        args={[intersectionMemo.maxDistanceToStopLine + 0.25, 0.25, 16, 64]}
                    />
                    <meshBasicMaterial color="black" side={THREE.DoubleSide} />
                </mesh>
            )}

            {/* Floor */}
            <mesh
                key={`i-floor-${id}`}
                geometry={intersectionMemo.intersectionFloor}
                rotation={[-Math.PI / 2, Math.PI, Math.PI]}
                position={[0, 0, 0]}
                onPointerDown={(event) => handleIntersectionClick(event)}
            >
                <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} />
            </mesh>



            {/* Edge tubes */}
            {intersectionMemo.edgeTubes.map((tubeGeom, tubeIndex) => (
                <mesh
                    key={`i-tube-${tubeIndex}`}
                    geometry={tubeGeom}
                    position={[0, 0, 0]}
                >
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
                const position = generateTextPosition(exit);
                const dir = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), position).normalize();
                const angleY = Math.atan2(dir.x, dir.z);


                return (
                    <group
                        key={`i-${id}-exit-${exitIndex}`}
                    >
                        {/* Exit stop lines - FIXED: Stable key instead of random UUID */}
                        <ThickLine
                            key={`stopline-${exitIndex}`}
                            ref={stopLineRefs[exitIndex]}
                            points={[exit.stopLine.line.start.toArray(), exit.stopLine.line.end.toArray()]}
                            colour={exit.stopLine.properties.colour}
                            linewidth={exit.stopLine.properties.thickness}
                            dashed={exit.stopLine.properties.pattern === "dashed"}
                            worldUnits={false}
                        />

                        {/* Exit lane lines - FIXED: Stable keys instead of random UUIDs */}
                        {exit.laneLines.slice(1, -1).map((lane, laneIndex) => (
                            <ThickLine
                                key={`exit-${exitIndex}-lane-${laneIndex}`}
                                points={[lane.line.start.toArray(), lane.line.end.toArray()]}
                                colour={lane.properties.colour}
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
                            key={`i-${id}-exitmesh-${exitIndex}`}
                            geometry={generateExitMesh(exit)}
                            rotation={[-Math.PI / 2, Math.PI, Math.PI]}
                            position={[0, 0.01, 0]}
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                handleExitClick(event, exitIndex);
                            }}
                        >
                            <meshBasicMaterial
                                color={inALink ? "green" : (isSelectedExit ? "red" : "blue")}
                                transparent
                                opacity={(isSelected || inALink) ? 0.5 : 0} // keep visible if junction is selected
                                side={THREE.DoubleSide}
                            />
                        </mesh>
                    </group>
                );
            })}
        </group>
    );
};