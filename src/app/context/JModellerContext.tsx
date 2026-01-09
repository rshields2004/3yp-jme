"use client";

import React, { createContext, useContext, useState, ReactNode, useRef } from "react";
import { Car, ExitRef, IntersectionTrafficController, JModellerState, JunctionConfig } from "../includes/types/types";
import { defaultJunctionConfig } from "../includes/defaults";
import * as THREE from "three";


const JModellerContext = createContext<JModellerState | undefined>(undefined);

export const JModellerProvider = ({ children }: { children: ReactNode }) => {


    const [junction, setJunction] = useState<JunctionConfig>(defaultJunctionConfig);
    const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
    const [selectedExits, setSelectedExits] = useState<ExitRef[]>([]);
    const [simIsRunning, setSimIsRunning] = useState<boolean>(false);



    // Simulation
    const trafficControllers = useRef<{ [id: string]: IntersectionTrafficController }>({});
    const [cars, setCars] = useState<Car[]>([]);




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


    const startIntersectionSequence = (intersectionId: string) => {
        if (!trafficControllers.current) {
            return;
        }
        const controller = trafficControllers.current[intersectionId]
        if (!controller || controller.intervalId) return;

        controller.intervalId = setInterval(() => {
            // Reset all to red
            controller.stopLinesQueue.forEach(s => s.ref.current?.setRed());

            // Only change the current exit
            const current = controller.stopLinesQueue[controller.currentIndex];

            const colour = controller.sequence[controller.currentStep];

            switch (colour) {
                case "red":
                    current.ref.current?.setRed();
                    break;
                case "red-amber":
                    current.ref.current?.setRedAmber();
                    break;
                case "green":
                    current.ref.current?.setGreen();
                    break;
                case "amber":
                    current.ref.current?.setAmber();
                    break;
            }

            controller.currentStep++;
            if (controller.currentStep >= controller.sequence.length) {
                controller.currentStep = 0;
                controller.currentIndex = (controller.currentIndex + 1) % controller.stopLinesQueue.length;
            }
        }, 1000); // adjust timing as needed
    };


    const stopIntersectionSequence = (intersectionId: string) => {
        if (!trafficControllers.current) {
            return;
        }
        const controller = trafficControllers.current[intersectionId]
        if (!controller) return;
        if (controller.intervalId) clearInterval(controller.intervalId);
        controller.intervalId = null;
        controller.currentIndex = 0;
        controller.currentStep = 0;

        // Reset all to red
        controller.stopLinesQueue.forEach(s => s.ref.current?.setRed());
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
        junction.junctionObjects.filter(o => o.type === "intersection").forEach(i => startIntersectionSequence(i.id));
    };

    const haltSim = () => {
        setSimIsRunning(false);
        junction.junctionObjects.filter(o => o.type === "intersection").forEach(i => stopIntersectionSequence(i.id));
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
            trafficControllers,
            startIntersectionSequence,
            stopIntersectionSequence,
            simIsRunning,
            startSim,
            haltSim,
            cars,
            setCars
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