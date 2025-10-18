"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { Exit, JunctionState, Lane } from "../includes/types";
import { defaultJunction } from "../includes/defaults";
import { generateStopLinePoints } from "../includes/utils";

const JunctionContext = createContext<JunctionState | undefined>(undefined);

export const JunctionProvider = ({ children }: { children: ReactNode }) => {
    const [junctionConfig, setJunctionConfig] = useState<Exit[]>(defaultJunction);



    useEffect(() => {
        // This code operates when the configuration is changed, any property outlined in types.ts -> JunctionState and its children

        // First lets calculate the polygon in the middle
        const stopLines: Lane[] = generateStopLinePoints(junctionConfig.length, 5);

        // Now we set the first lane line for each exit as the stop line
        setJunctionConfig((prevConfig) =>
            prevConfig.map((exit, exitIdx) => ({
                ...exit,
                lanes: exit.lanes.map((lane, laneIdx) =>
                    laneIdx === 0 ? stopLines[exitIdx] : lane
                ),
            }))
        );
        console.log("success");
    }, []);



    return (
        <JunctionContext.Provider value={{
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