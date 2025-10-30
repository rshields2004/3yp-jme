"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useMemo } from "react";
import { IntersectionConfig, IntersectionStructure, JModellerState, JunctionConfig, JunctionStructure, LaneStructure } from "../includes/types";
import { generateEdgeTubes, generateFloorMesh, generateLaneLines, generateStopLines } from "../includes/utils";
import { defaultJunctionConfig } from "../includes/defaults";
import * as THREE from "three";


const JModellerContext = createContext<JModellerState | undefined>(undefined);

export const JModellerProvider = ({ children }: { children: ReactNode }) => {

    const [junction, setJunction] = useState<JunctionConfig>(defaultJunctionConfig);


    const junctionStructure: JunctionStructure = useMemo(() => {
        
        const intersectionStructures: IntersectionStructure[] = junction.intersections.map((config: IntersectionConfig) => {
            
            const maxExitSpan = Math.max(...config.exitConfig.map(e => e.laneCount * e.laneWidth));
            const adjustedOffset = maxExitSpan / (2 * Math.sin(Math.PI / config.numExits));


            const exitInfo = config.exitConfig.map((exitConfig, exitIndex) => {
                
                const angleStep = (2 * Math.PI) / config.numExits;
                const angle = angleStep * exitIndex;
                
                const stopLines = generateStopLines(exitConfig.laneCount, exitConfig.laneWidth, adjustedOffset, angle, config.origin);
                
                const laneLines = generateLaneLines(stopLines, exitConfig.exitLength, exitConfig.laneCount);

                
                return { stopLines, laneLines };
            });

            const edgeTubes = generateEdgeTubes(exitInfo);
            const intersectionFloor = generateFloorMesh(exitInfo);

            const maxExitLength = Math.max(...config.exitConfig.map(c => c.exitLength));
            const midPointStop = new THREE.Vector3();
            exitInfo[0].stopLines[0].line.getCenter(midPointStop);
            const maxDistanceToStopLine = maxExitLength + midPointStop.distanceTo(config.origin) + 1;

            const origin = config.origin.clone();

            return { exitInfo, edgeTubes, maxDistanceToStopLine, intersectionFloor, origin };
        });

        return { intersectionStructures };
    }, [junction]);

    

    return (
        <JModellerContext.Provider value={{
            junction,
            setJunction,
            junctionStructure,
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