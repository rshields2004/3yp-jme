"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useMemo, useRef } from "react";
import { ExitRef, IntersectionConfig, IntersectionStructure, JModellerState, JunctionConfig, JunctionObjectRef, JunctionObjectTypes, JunctionStructure, LaneStructure } from "../includes/types";
import { generateEdgeTubes, generateFloorMesh, generateLaneLines, generateStopLines } from "../includes/utils";
import { defaultJunctionConfig } from "../includes/defaults";
import * as THREE from "three";


const JModellerContext = createContext<JModellerState | undefined>(undefined);

export const JModellerProvider = ({ children }: { children: ReactNode }) => {

    const [junction, setJunction] = useState<JunctionConfig>(defaultJunctionConfig);
    const [selectedJunctionObjectRefs, setSelectedJunctionObjectRefs] = useState<JunctionObjectRef[]>([]);
    const [selectedExits, setSelectedExits] = useState<ExitRef[]>([]);
    const junctionObjectRefs = useRef<JunctionObjectRef[]>([]);
    
    const registerJunctionObject = (group: THREE.Group, id: string, type: JunctionObjectTypes) => {
        const exists = junctionObjectRefs.current.some(obj => obj.refID === id);
        if (!exists) {
            junctionObjectRefs.current.push({ group, refID: id, type });
        }
    };
    const unregisterJunctionObject = (group: THREE.Group) => {
        junctionObjectRefs.current = junctionObjectRefs.current.filter(obj => obj.group !== group);
    };



    const junctionStructure: JunctionStructure = useMemo(() => {
        
        
        // First we calculate intersections
        const intersectionStructures: IntersectionStructure[] = junction.junctionObjects.filter((obj) => obj.type === "intersection").map((obj) => {
            const id = obj.id;
            const config = obj.config;
            const maxExitSpan = Math.max(...config.exitConfig.map(e => e.laneCount * e.laneWidth));
            const adjustedOffset = maxExitSpan / (2 * Math.sin(Math.PI / config.numExits));


            const exitInfo = config.exitConfig.map((exitConfig, exitIndex) => {
                
                const angleStep = (2 * Math.PI) / config.numExits;
                const angle = angleStep * exitIndex;
                
                const stopLines = generateStopLines(exitConfig.laneCount, exitConfig.laneWidth, adjustedOffset, angle);
                
                const laneLines = generateLaneLines(stopLines, exitConfig.exitLength, exitConfig.laneCount);

                
                return { stopLines, laneLines };
            });

            const edgeTubes = generateEdgeTubes(exitInfo);
            const intersectionFloor = generateFloorMesh(exitInfo);

            const maxExitLength = Math.max(...config.exitConfig.map(c => c.exitLength));
            const midPointStop = new THREE.Vector3();
            exitInfo[0].stopLines[0].line.getCenter(midPointStop);
            const maxDistanceToStopLine = maxExitLength + midPointStop.distanceTo(new THREE.Vector3(0, 0, 0)) + 1;

            const origin = config.origin.clone();
            return { id, exitInfo, edgeTubes, maxDistanceToStopLine, intersectionFloor, origin };

        });
        return { intersectionStructures };



        // const roundaboutStructures




    }, [junction]);


    

    return (
        <JModellerContext.Provider value={{
            junction,
            setJunction,
            junctionStructure,
            selectedJunctionObjectRefs,
            setSelectedJunctionObjectRefs,
            junctionObjectRefs,
            registerJunctionObject,
            unregisterJunctionObject,
            selectedExits,
            setSelectedExits,
        }}>
            {children}
        </JModellerContext.Provider>
    );
};

export const useJModellerContext = () => {
    const context = useContext(JModellerContext);
    if (!context) {
        throw new Error("useJunction must be used within the JunctionContext Provider");
    }
    else {
        return context;
    }
};