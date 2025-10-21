"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useMemo } from "react";
import { Exit, Intersection, JModellerState, Junction } from "../includes/types";
import { generateEdgeTubes, generateLaneLines, generateStopLines } from "../includes/utils";
import { defaultJunction } from "../includes/defaults";


const JModellerContext = createContext<JModellerState | undefined>(undefined);

export const JModellerProvider = ({ children }: { children: ReactNode }) => {

    const [junction, setJunction] = useState<Junction>(defaultJunction);

    // Converts all configs to a string that the useEffect can track
    const configsVersion = useMemo(() => {
        return junction.intersections.map((i) => JSON.stringify(i.intersectionConfig)).join("|");
    }, [junction.intersections]);


    useEffect(() => {
        
        // We need to update the entire configuration, since a config has been changed
        setJunction((prev) => {

            // We first update the intersections
            const updatedIntersections: Intersection[] = prev.intersections.map((intersection) => {
                
                const { intersectionConfig } = intersection;

                const maxExitSpan = Math.max(...intersectionConfig.exitConfig.map((e) => e.laneCount * e.laneWidth));

                const adjustedOffset = maxExitSpan / (2 * Math.sin(Math.PI / intersectionConfig.numExits));

                const updatedExits: Exit[] = intersectionConfig.exitConfig.map((exitConfig, exitIndex) => {

                    const angle = (2 * Math.PI / intersectionConfig.numExits) * exitIndex;

                    const stopLines = generateStopLines(exitConfig.laneCount, exitConfig.laneWidth, adjustedOffset, angle, intersectionConfig.origin);

                    const laneLines = generateLaneLines(stopLines, exitConfig.exitLength, exitConfig.laneCount, intersectionConfig.origin);

                    return { stopLines, laneLines };

                });

                const edgeTubes = generateEdgeTubes(updatedExits);

                return {
                    ...intersection,
                    intersectionStructure: {
                        exitInfo: updatedExits,
                        edgeTubes,
                    },
                };

            });

            return {
                ...prev,
                intersections: updatedIntersections,
            };
        });
    }, [configsVersion]); // Only redraw when junctionCOnfig is changed anywhere


    return (
        <JModellerContext.Provider value={{
            junction,
            setJunction
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