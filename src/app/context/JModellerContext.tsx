"use client";

import React, { createContext, useContext, useState, ReactNode, useRef  } from "react";
import { ExitRef, JModellerState, JunctionConfig, JunctionLink } from "../includes/types/types";
import { defaultJunctionConfig } from "../includes/defaults";
import * as THREE from "three";



const JModellerContext = createContext<JModellerState | undefined>(undefined);

export const JModellerProvider = ({ children }: { children: ReactNode }) => {

    
    const [junction, setJunction] = useState<JunctionConfig>(defaultJunctionConfig);
    const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
    const [selectedExits, setSelectedExits] = useState<ExitRef[]>([]);

    const junctionObjectRefs = useRef<THREE.Group[]>([]);


    const registerJunctionObject = (group: THREE.Group) => {
        if (!group.userData.id) {
            return;
        }

        if (!junctionObjectRefs.current.includes(group)) {
            junctionObjectRefs.current.push(group);
        }
    }


    const unregisterJunctionObject = (group: THREE.Group) => {
        
        junctionObjectRefs.current = junctionObjectRefs.current.filter(g => g !== group);

        group.traverse((obj: any) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                }
                else if (obj.material) {
                    obj.material.dispose();
                }
            }
        });
    };


    const snapToValidPosition = (draggedGroup: THREE.Group) => {
        
        if (!draggedGroup?.userData?.id) {
            return;
        }

        const draggedID = draggedGroup.userData.id;
        const draggedRadius = draggedGroup.userData.maxDistanceToStopLine || 0;

        const otherObjects = junctionObjectRefs.current.filter(g => g.userData.id !== draggedID).map(g => ({
            pos: g.position,
            radius: g.userData.maxDistanceToStopLine || 0,
        }));

        let newPos = draggedGroup.position.clone();
        let safe = false;
        let maxIterations = 50;

        while (!safe && maxIterations-- > 0) {
            safe = true;

            for (const { pos: otherPos, radius: otherRadius } of otherObjects) {
                const dist = newPos.distanceTo(otherPos);
                const minDist = draggedRadius + otherRadius;

                if (dist < minDist) {
                    safe = false;

                    let pushDir = newPos.clone().sub(otherPos);

                    // If exactly overlapping or close to running out of iterations, pick a random direction
                    if (pushDir.lengthSq() === 0 || maxIterations < 10) {
                        const angle = Math.random() * 2 * Math.PI;
                        pushDir.set(Math.cos(angle), 0, Math.sin(angle));
                    } 
                    else {
                        pushDir.normalize();
                    }

                    // Move by the overlap amount + small epsilon
                    newPos.add(pushDir.multiplyScalar(minDist - dist + 0.01));
                }
            }
        }

        // Snap the dragged group to the computed valid position
        draggedGroup.position.copy(newPos);
    };

    // const setBestRotation = () => {

    //     for (const link of junction.junctionLinks) {
            
    //         const [exitRefA, exitRefB] = link.objectPair;

    //         const junctionA = junctionObjectRefs.current.find(j => j.userData.id === exitRefA.structureID);
    //         const junctionB = junctionObjectRefs.current.find(j => j.userData.id === exitRefB.structureID);

    //         console.log("running");

    //         if (junctionA && junctionB) {
    //             console.log("getting here");
    //             const localA = getExitMidpoint(junctionA.userData.exitInfo[exitRefA.exitIndex]);
    //             const localB = getExitMidpoint(junctionB.userData.exitInfo[exitRefB.exitIndex]);

    //             let best = { dist: Infinity, a: 0, b: 0};

    //             for (let i = 0; i < 360; i++) {
    //                 const aAngle = THREE.MathUtils.degToRad(i);
    //                 for (let j = 0; j < 360; j++) {
    //                     const bAngle = THREE.MathUtils.degToRad(j);

    //                     const worldA = getWorldPoint(junctionA, localA, aAngle);
    //                     const worldB = getWorldPoint(junctionB, localB, bAngle);

    //                     const dist = worldA.distanceTo(worldB);
    //                     if (dist < best.dist) best = { dist, a: aAngle, b: bAngle };
    //                 }
    //             }

    //             junctionA.rotation.y += best.a;
    //             junctionB.rotation.y += best.b;

    //             console.log(`Link ${link.id} aligned. Minimal distance:`, best.dist);
    //         }


    //     }


    // };









    const removeObject = (objID: string) => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.filter(obj => obj.id !== objID),
            junctionLinks: prev.junctionLinks.filter(link => !link.objectPair.some(exitRef => exitRef.structureID === objID)),
        }));

        setSelectedObjects(prev => prev.filter(id => id !== objID));
        setSelectedExits(prev => prev.filter(exit => exit.structureID!== objID));

        const groupIndex = junctionObjectRefs.current.findIndex(g => g.userData.id === objID);
        if (groupIndex !== -1) {
            const group = junctionObjectRefs.current[groupIndex];
            unregisterJunctionObject(group);
        }

    }

    

    return (
        <JModellerContext.Provider value={{
            junction,
            setJunction,
            selectedObjects,
            setSelectedObjects,
            junctionObjectRefs,
            registerJunctionObject,
            unregisterJunctionObject,
            selectedExits,
            setSelectedExits,
            snapToValidPosition,
            removeObject,
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