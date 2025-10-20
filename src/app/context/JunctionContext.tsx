"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { Exit, JunctionStructure, JunctionState, JunctionConfig } from "../includes/types";
import { defaultJunctionConfig, defaultJunctionStructure, defaultLaneProperties } from "../includes/defaults";
import { generateEdgeTubes, generateLaneLines, generateStopLines } from "../includes/utils";


const JunctionContext = createContext<JunctionState | undefined>(undefined);

export const JunctionProvider = ({ children }: { children: ReactNode }) => {
    const [junctionConfig, setJunctionConfig] = useState<JunctionConfig>(defaultJunctionConfig);
    const [junctionStructure, setJunctionStructure] = useState<JunctionStructure>(defaultJunctionStructure);


    // Critical: Transforms a change in junction config to reflect a change in junction structure
    useEffect(() => {
        
        // Find the maximum span an exit will take up, ensure there is no criss cross
        const maxExitSpan = Math.max(...junctionConfig.exitConfig.map(e => e.laneCount * e.laneWidth));
        
        // Calculate the minimum radius from the centre the stop lines can be
        const adjustedOffset = maxExitSpan / (2 * Math.sin(Math.PI / junctionConfig.numExits));

        // Build junction structure from config - iterate through each exit to be built
        const updatedExits: Exit[] = junctionConfig.exitConfig.map((exitConfig, exitIndex) => {
            
            // Calculate angle of stop line relative to origin
            const angle = (2 * Math.PI / junctionConfig.numExits) * exitIndex;

            // Generate stop lines using utility function
            const stopLines = generateStopLines(exitConfig.laneCount, exitConfig.laneWidth, adjustedOffset, angle);

            // Generate lane lines from stop lines
            const laneLines = generateLaneLines(stopLines, exitConfig.exitLength, exitConfig.laneCount);

            return { stopLines, laneLines };
        });

        // Generate edge tubes
        const edgeTubes = generateEdgeTubes(updatedExits);

        // Update new junction strucutre
        setJunctionStructure(
            {
                exitInfo: updatedExits, 
                edgeTubes,
            }
        );

    }, [junctionConfig]); // Only redraw when junctionCOnfig is changed anywhere


    return (
        <JunctionContext.Provider value={{
            junctionStructure,
            setJunctionStructure,
            junctionConfig,
            setJunctionConfig,
        }}>
            {children}
        </JunctionContext.Provider>
    );
};

export const useJunction = () => {
    const context = useContext(JunctionContext);
    if (!context) {
        throw new Error("useJunction must be used within the JunctionContext Provider");
    }
    else {
        return context;
    }
};