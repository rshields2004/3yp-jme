"use client";

import React, { createContext, useContext, useState, ReactNode, useRef, useEffect } from "react";
import { ExitRef, JModellerState, JunctionConfig, JunctionObjectTypes } from "../includes/types/types";
import { defaultJunctionConfig, defaultSimConfig, FLOOR_Y_OFFSET } from "../includes/defaults";
import * as THREE from "three";
import { SimulationStats } from "../includes/types/simulation";
import { FollowedVehicleStats } from "../includes/types/simulation";
import { IntersectionStructure } from "../includes/types/intersection";
import { RoundaboutStructure } from "../includes/types/roundabout";
import { getStructureData } from "../includes/utils";
import { usePeer } from "./PeerContext";
import { NetMessage } from "../includes/types/peer";


const JModellerContext = createContext<JModellerState | undefined>(undefined);

export const JModellerProvider = ({ children }: { children: ReactNode }) => {


    const [junction, setJunction] = useState<JunctionConfig>(defaultJunctionConfig);
    const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
    const [selectedExits, setSelectedExits] = useState<ExitRef[]>([]);
    const [simIsRunning, setSimIsRunning] = useState<boolean>(false);
    const [simIsPaused, setSimIsPaused] = useState<boolean>(false);
    const [carsReady, setCarsReady] = useState<boolean>(false);
    const [followedVehicleId, setFollowedVehicleId] = useState<number | null>(null);
    const [followedVehicleStats, setFollowedVehicleStats] = useState<FollowedVehicleStats | null>(null);
    const [isConfigConfirmed, setIsConfigConfirmed] = useState<boolean>(false);
    const [simConfig, setSimConfig] = useState(defaultSimConfig);
    const [objectCounter, setObjectCounter] = useState(0);
    const [toolMode, setToolMode] = useState<"view" | "build">("view");

    // ── P2P: receive config from host ─────────────────────────────────────
    const { connections, isHost } = usePeer();
    useEffect(() => {
        if (isHost) return;
        const conn = connections[0];
        if (!conn) return;
        const handler = (data: unknown) => {
            const msg = data as NetMessage;
            if (msg.type === "INIT_CONFIG") {
                setJunction(msg.appdata.junctionConfig);
                setSimConfig(msg.appdata.simulationConfig);
            }
        };
        conn.on("data", handler);
        // Request the current config now that our handler is registered.
        // This avoids a race where the host sent INIT_CONFIG before this
        // effect had a chance to attach the listener.
        if (conn.open) {
            conn.send({ type: "REQUEST_CONFIG" });
        }
        return () => { conn.off("data", handler); };
    }, [connections, isHost]);

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

        const structureData = getStructureData(group);
        if (!structureData) {
            return;
        }
        if (!junctionObjectRefs.current.includes(group)) {
            junctionObjectRefs.current.push(group);
        }
    };


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
        
        
        const draggedData = getStructureData(draggedGroup);
        if (!draggedData) {
            return;
        }

        // Use world positions (robust if groups move / detach / reparent)
        const draggedWorld = new THREE.Vector3();
        draggedGroup.getWorldPosition(draggedWorld);

        const draggedRadius = draggedData.maxDistanceToStopLine;

        const tmp = new THREE.Vector3();

        const otherObjects = junctionObjectRefs.current.filter((g): g is THREE.Group => !!g).filter(g => g !== draggedGroup).map(g => {
            const data = getStructureData(g);
            if (!data) {
                return null;
            }

            const pos = new THREE.Vector3();
            g.getWorldPosition(pos);
            return {
                pos,
                radius: data.maxDistanceToStopLine,
            };
        }).filter((obj): obj is { pos: THREE.Vector3; radius: number} => obj !== null).filter(obj => !!obj);

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
                    } 
                    else {
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
        draggedGroup.position.y = FLOOR_Y_OFFSET;

        // Persist the final snapped position into the junction React state so
        // it is always the source of truth (P2P peers read it from here).
        const id = draggedData.id as string;
        if (id) {
            const wq = new THREE.Quaternion();
            draggedGroup.updateWorldMatrix(true, false);
            draggedGroup.getWorldQuaternion(wq);
            // newWorldPos is already in local space after worldToLocal above,
            // but we stored the world position before that conversion.
            // Use the group's current world position for the stored value.
            const finalWorld = new THREE.Vector3();
            draggedGroup.getWorldPosition(finalWorld);
            setJunction(prev => ({
                ...prev,
                junctionObjects: prev.junctionObjects.map(obj =>
                    obj.id === id
                        ? { ...obj, transform: {
                            position: { x: finalWorld.x, y: finalWorld.y, z: finalWorld.z },
                            quaternion: { x: wq.x, y: wq.y, z: wq.z, w: wq.w },
                        }}
                        : obj
                ),
            }));
        }
    };

    const removeObject = (objID: string) => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.filter(obj => obj.id !== objID),
            junctionLinks: prev.junctionLinks.filter(link => !link.objectPair.some(exitRef => exitRef.structureID === objID)),
        }));

        setSelectedObjects(prev => prev.filter(id => id !== objID));
        setSelectedExits(prev => prev.filter(exit => exit.structureID !== objID));

        const groupIndex = junctionObjectRefs.current.findIndex(g => {
            const data = getStructureData(g);
            return data && data.id === objID;
        });

        if (groupIndex !== -1) {
            const group = junctionObjectRefs.current[groupIndex];
            unregisterJunctionObject(group);
        }

    };


    const startSim = () => {
        if (simIsRunning) {
            return;
        }
        setSelectedObjects([]);
        setSelectedExits([]);
        setToolMode("view");
        setSimIsRunning(true);
    };

    const haltSim = () => {
        setSimIsRunning(false);
        setSimIsPaused(false);
        setIsConfigConfirmed(false); // Reset config phase when simulation stops
    };

    const confirmConfig = () => {
        setIsConfigConfirmed(true);
        setToolMode("view");
        setSelectedObjects([]);
        setSelectedExits([]);
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
            objectCounter,
            setObjectCounter,
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
            followedVehicleStats,
            setFollowedVehicleStats,
            isConfigConfirmed,
            confirmConfig,
            resetConfig,
            simConfig,
            setSimConfig,
            toolMode,
            setToolMode,
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