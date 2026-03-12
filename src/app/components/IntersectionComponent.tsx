"use client";

import { useEffect, useMemo, useRef } from "react";
import { ThickLine, ThickLineHandle } from "./ThickLine";
import * as THREE from "three";
import { IntersectionConfig, IntersectionStructure } from "../includes/types/intersection";
import { useJModellerContext } from "../context/JModellerContext";
import { generateEdgeTubes, generateExitMesh, generateFloorMesh, generateLaneLines, generateStopLine, generateTextPosition, getStructureData } from "../includes/utils";
import { Text } from "@react-three/drei";
import React from "react";
import { ThreeEvent } from "@react-three/fiber";


import { ObjectTransform } from "../includes/types/types";

type IntersectionProps = {
    id: string;
    name: string;
    intersectionConfig: IntersectionConfig;
    index: number;
    /** When provided (P2P client), position is applied directly instead of snapToValidPosition. */
    initialTransform?: ObjectTransform;
};

export const IntersectionComponent = ({ id, intersectionConfig, name, initialTransform }: IntersectionProps) => {
    const groupRef = useRef<THREE.Group>(null);
    const {
        junction,
        selectedObjects,
        registerJunctionObject,
        selectedExits,
        setSelectedExits,
        snapToValidPosition,
        toolMode
    } = useJModellerContext();


    const intersectionMemo: IntersectionStructure = useMemo(() => {

        const exitInfo = intersectionConfig.exitConfig.map((exitConfig, exitIndex) => {
            const maxExitSpan = Math.max(...intersectionConfig.exitConfig.map(e => e.laneCount * junction.laneWidth));
            const adjustedOffset = maxExitSpan / (2 * Math.sin(Math.PI / intersectionConfig.numExits));
            const angleStep = (2 * Math.PI) / intersectionConfig.numExits;
            const angle = angleStep * exitIndex;

            const stopLine = generateStopLine(exitConfig.laneCount, junction.laneWidth, adjustedOffset, angle, exitConfig.numLanesIn);
            const laneLines = generateLaneLines(exitConfig.laneCount, junction.laneWidth, adjustedOffset, angle, exitConfig.exitLength, exitConfig.laneCount, exitConfig.numLanesIn);

            return { stopLine, laneLines };
        });

        const edgeTubes = generateEdgeTubes(exitInfo);
        const intersectionFloor = generateFloorMesh(exitInfo);

        const maxExitLength = Math.max(...intersectionConfig.exitConfig.map(c => c.exitLength));
        const midPointStop = exitInfo[0].laneLines[0].line.start.clone().lerp(exitInfo[0].laneLines[exitInfo[0].laneLines.length - 1].line.start.clone(), 0.5);

        const maxDistanceToStopLine = maxExitLength + midPointStop.distanceTo(new THREE.Vector3(0, 0, 0)) + 15;

        // Add a random ID each time so the below useEffect knows when it needs to re render
        return { id: id, exitInfo, edgeTubes, intersectionFloor, maxDistanceToStopLine };
    }, [intersectionConfig, id]);


    

    useEffect(() => {
        const group = groupRef.current;
        if (!group) {
            return;
        }
        group.userData.id = id;
        group.userData.intersectionStructure = intersectionMemo;

        // Registration only works if intersection doesnt exist before, contains a check for ID
        registerJunctionObject(group);

        if (initialTransform) {
            // P2P client path: apply the host's world transform directly.
            group.position.set(
                initialTransform.position.x,
                initialTransform.position.y,
                initialTransform.position.z
            );
            group.quaternion.set(
                initialTransform.quaternion.x,
                initialTransform.quaternion.y,
                initialTransform.quaternion.z,
                initialTransform.quaternion.w
            );
        } else {
            snapToValidPosition(group);
        }
    }, [intersectionMemo]);



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








    const isSelected = groupRef.current ? (() => {
        const data = getStructureData(groupRef.current);
        return data ? selectedObjects.includes(data.id) : false;
    })() : false;


    const handleExitClick = (event: ThreeEvent<PointerEvent>, exitIndex: number) => {
        if (event.button !== 0) {
            return;
        }
        // Exit clicks only work in build mode (for linking)
        if (toolMode !== "build") return;

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
                Intersection {name}
            </Text>

            {/* Floor */}
            <mesh
                key={`i-floor-${id}`}
                geometry={intersectionMemo.intersectionFloor}
                rotation={[-Math.PI / 2, Math.PI, Math.PI]}
                position={[0, 0, 0]}
            >
                <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
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

            {/* Bounding ring — visible in build mode */}
            {toolMode === "build" && (
                <mesh
                    key={`i-${id}-bounding`}
                    rotation={[-Math.PI / 2, 0, 0]}
                    position={[0, 0.005, 0]}
                >
                    <ringGeometry args={[intersectionMemo.maxDistanceToStopLine - 0.15, intersectionMemo.maxDistanceToStopLine, 64]} />
                    <meshBasicMaterial color="white" transparent opacity={0.35} side={THREE.DoubleSide} />
                </mesh>
            )}

            {/* Invisible exit mesh for exit selection */}
            {intersectionMemo.exitInfo.map((exit, exitIndex) => {
                const isSelectedExit = groupRef.current ? (() => {
                    const data = getStructureData(groupRef.current);
                    return data ? selectedExits.some(e => e.structureID === data.id && e.exitIndex === exitIndex) : false;
                })() : false;

                const inALink = groupRef.current ? (() => {
                    const data = getStructureData(groupRef.current);
                    return data ? junction.junctionLinks.some(link => link.objectPair.some(linkExit => linkExit.structureID === data.id && linkExit.exitIndex === exitIndex)) : false;
                })() : false;
                
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
                            Exit {exitIndex + 1}
                        </Text>
                        {/* Exit Invisible Mesh for selection */}
                        <mesh
                            key={`i-${id}-exitmesh-${exitIndex}`}
                            geometry={generateExitMesh(exit)}
                            rotation={[-Math.PI / 2, Math.PI, Math.PI]}
                            position={[0, 0.01, 0]}
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                if (toolMode === "build") event.nativeEvent.stopImmediatePropagation();
                                handleExitClick(event, exitIndex);
                            }}
                        >
                            <meshBasicMaterial
                                color={inALink ? "green" : (isSelectedExit ? "red" : "blue")}
                                transparent
                                opacity={(toolMode === "build" || isSelected || inALink) ? 0.5 : 0}
                                side={THREE.DoubleSide}
                            />
                        </mesh>
                    </group>
                );
            })}
        </group>
    );
};