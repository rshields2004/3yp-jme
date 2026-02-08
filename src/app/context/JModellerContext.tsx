"use client";

import React, { createContext, useContext, useState, ReactNode, useRef } from "react";
import { ExitRef, JModellerState, JunctionConfig } from "../includes/types/types";
import { defaultJunctionConfig, defaultSimConfig } from "../includes/defaults";
import * as THREE from "three";
import { SimulationStats } from "../includes/types/simulation";


const JModellerContext = createContext<JModellerState | undefined>(undefined);

export const JModellerProvider = ({ children }: { children: ReactNode }) => {


    const [junction, setJunction] = useState<JunctionConfig>(defaultJunctionConfig);
    const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
    const [selectedExits, setSelectedExits] = useState<ExitRef[]>([]);
    const [simIsRunning, setSimIsRunning] = useState<boolean>(false);
    const [simIsPaused, setSimIsPaused] = useState<boolean>(false);
    const [carsReady, setCarsReady] = useState<boolean>(false);
    const [followedVehicleId, setFollowedVehicleId] = useState<number | null>(null);
    const [isConfigConfirmed, setIsConfigConfirmed] = useState<boolean>(false);
    const [simConfig, setSimConfig] = useState(defaultSimConfig);



    // Simulation
    const [stats, setStats] = useState<SimulationStats>({
            active: 0,
            spawned: 0,
            completed: 0,
            waiting: 0,
            routes: 0,
            spawnQueue: 0,
            spawnQueueByEntry: {},
            elapsedTime: 0,
            junctions: {
                global: {
                    count: 0,
                    approaching: 0,
                    waiting: 0,
                    inside: 0,
                    exiting: 0,
                    entered: 0,
                    exited: 0,
                    avgWaitTime: 0,
                },
                byId: {},
            },
        });



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

        group.traverse((obj: THREE.Object3D) => {
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
        const draggedID = draggedGroup?.userData?.id;
        if (!draggedID) return;

        // Use world positions (robust if groups move / detach / reparent)
        const draggedWorld = new THREE.Vector3();
        draggedGroup.getWorldPosition(draggedWorld);

        const draggedRadius = Number(draggedGroup.userData.maxDistanceToStopLine) || 0;

        const tmp = new THREE.Vector3();

        const otherObjects = junctionObjectRefs.current
            .filter((g): g is THREE.Group => !!g)
            .filter(g => g !== draggedGroup)                         // prefer reference check
            .filter(g => !!g.userData?.id)                           // ignore invalid
            .filter(g => g.userData.type !== "link")
            .filter(g => !!g.parent)                                 // ignore detached/deleted
            .map(g => {
                const pos = new THREE.Vector3();
                g.getWorldPosition(pos);
                return {
                    pos,
                    radius: Number(g.userData.maxDistanceToStopLine) || 0,
                };
            });

        const newWorldPos = draggedWorld.clone();
        let safe = false;
        let maxIterations = 50;

        while (!safe && maxIterations-- > 0) {
            safe = true;

            for (const { pos: otherPos, radius: otherRadius } of otherObjects) {
                const dist = newWorldPos.distanceTo(otherPos);
                const minDist = draggedRadius + otherRadius;

                if (dist < minDist) {
                    safe = false;

                    const pushDir = tmp.copy(newWorldPos).sub(otherPos);

                    if (pushDir.lengthSq() === 0 || maxIterations < 10) {
                        const angle = Math.random() * 2 * Math.PI;
                        pushDir.set(Math.cos(angle), 0, Math.sin(angle));
                    } else {
                        pushDir.normalize();
                    }

                    newWorldPos.add(pushDir.multiplyScalar(minDist - dist + 0.01));
                }
            }
        }

        // Convert world position back into draggedGroup's local space
        if (draggedGroup.parent) {
            draggedGroup.parent.worldToLocal(newWorldPos);
        }
        draggedGroup.position.copy(newWorldPos);
    };

    const removeObject = (objID: string) => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.filter(obj => obj.id !== objID),
            junctionLinks: prev.junctionLinks.filter(link => !link.objectPair.some(exitRef => exitRef.structureID === objID)),
        }));

        setSelectedObjects(prev => prev.filter(id => id !== objID));
        setSelectedExits(prev => prev.filter(exit => exit.structureID !== objID));

        const groupIndex = junctionObjectRefs.current.findIndex(g => g.userData.id === objID);
        if (groupIndex !== -1) {
            const group = junctionObjectRefs.current[groupIndex];
            unregisterJunctionObject(group);
        }

    }


    const startSim = () => {
        if (simIsRunning) {
            return;
        }
        setSelectedObjects([]);
        setSelectedExits([]);
        setSimIsRunning(true);
    };

    const haltSim = () => {
        setSimIsRunning(false);
        setSimIsPaused(false);
        setIsConfigConfirmed(false); // Reset config phase when simulation stops
    };

    const confirmConfig = () => {
        setIsConfigConfirmed(true);
    };

    const resetConfig = () => {
        setIsConfigConfirmed(false);
    };

    const pauseSim = () => {
        if (simIsRunning && !simIsPaused) {
            setSimIsPaused(true);
        }
    };

    const resumeSim = () => {
        if (simIsRunning && simIsPaused) {
            setSimIsPaused(false);
        }
    };



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
            simIsRunning,
            simIsPaused,
            pauseSim,
            resumeSim,
            startSim,
            haltSim,
            stats,
            setStats,
            carsReady,
            setCarsReady,
            followedVehicleId,
            setFollowedVehicleId,
            isConfigConfirmed,
            confirmConfig,
            resetConfig,
            simConfig,
            setSimConfig
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