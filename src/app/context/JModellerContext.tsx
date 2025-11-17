"use client";

import React, { createContext, useContext, useState, ReactNode, useRef,  } from "react";
import { ExitRef, JModellerState, JunctionConfig, JunctionObjectRef, JunctionObjectTypes } from "../includes/types";
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


    const snapToValidPosition = (draggedGroup: THREE.Group) => {
        if (!draggedGroup) return;

        const draggedID = draggedGroup.userData.id;
        if (!draggedID) return;

        // Use the precomputed radius from userData
        const draggedRadius = draggedGroup.userData.maxDistanceToStopLine || 0;

        // Get all other junctions
        const otherRefs = junctionObjectRefs.current.filter(obj => obj.refID !== draggedID);

        // Precompute positions and radii for performance
        const others = otherRefs.map(ref => ({
            pos: ref.group.position,
            radius: ref.group.userData.maxDistanceToStopLine || 0,
        }));

        let newPos = draggedGroup.position.clone();
        let safe = false;
        let maxIterations = 50;

        while (!safe && maxIterations-- > 0) {
            safe = true;

            for (const { pos: otherPos, radius: otherRadius } of others) {
                const dist = newPos.distanceTo(otherPos);
                const minDist = draggedRadius + otherRadius;
                console.log("dist " + dist + " " + minDist);
                if (dist < minDist) {
                    safe = false;

                    let pushDir = newPos.clone().sub(otherPos);
                    if (pushDir.lengthSq() === 0) {
                        const angle = Math.random() * 2 * Math.PI;
                        pushDir.set(Math.cos(angle), 0, Math.sin(angle));
                    } 
                    else {
                        pushDir.normalize();
                    }

                    newPos.add(pushDir.multiplyScalar(minDist - dist + 0.01));
                }
            }
        }

        // Snap to the valid position
        draggedGroup.position.copy(newPos);

        // Update junction state
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(jObj =>
                jObj.id === draggedID
                    ? {
                        ...jObj,
                        config: { ...jObj.config, origin: newPos.clone() },
                    }
                    : jObj
            ),
        }));
    };


    const removeObject = (objID: string) => {
        setJunction((prevJunction) => ({
            ...prevJunction,
            junctionObjects: prevJunction.junctionObjects.filter(obj => obj.id !== objID)
        }));


        setSelectedJunctionObjectRefs(prev => prev.filter(obj => obj.refID !== objID));
        setSelectedExits(prev => prev.filter(exit => exit.structureID !== objID));


        const objRefIndex = junctionObjectRefs.current.findIndex(obj => obj.refID === objID);
        if (objRefIndex !== -1) {
            const group = junctionObjectRefs.current[objRefIndex].group;

            // Dispose all meshes in the group
            group.traverse((obj: any) => {
                if (obj instanceof THREE.Mesh) {
                    obj.geometry.dispose();
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else if (obj.material) {
                        obj.material.dispose();
                    }
                }
            });

            // Remove from ref array
            junctionObjectRefs.current.splice(objRefIndex, 1);
        }
    };



    return (
        <JModellerContext.Provider value={{
            junction,
            setJunction,
            selectedJunctionObjectRefs,
            setSelectedJunctionObjectRefs,
            junctionObjectRefs,
            registerJunctionObject,
            unregisterJunctionObject,
            selectedExits,
            setSelectedExits,
            snapToValidPosition,
            removeObject
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