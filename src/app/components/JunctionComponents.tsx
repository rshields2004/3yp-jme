"use client";

import {useEffect, useRef } from "react";
import * as THREE from "three";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { useJModellerContext } from "../context/JModellerContext";
import { FLOOR_Y } from "../includes/defaults";
import { useThree } from "@react-three/fiber";
import { IntersectionComponent } from "./IntersectionComponent";
import { RoundaboutComponent } from "./RoundaboutComponent";
import { LinkComponent } from "./LinkComponent";
import { getStructureData } from "../includes/utils";


export const JunctionComponents = () => {

    const { selectedObjects, junction, snapToValidPosition, setSelectedObjects, junctionObjectRefs, isConfigConfirmed } = useJModellerContext();

    // We define our drag controls for all components
    const { camera, gl } = useThree();
    const controlRef = useRef<DragControls | null>(null);

    useEffect(() => {
        if (!camera || !gl) return;

        const controls = new DragControls([], camera, gl.domElement);
        controls.transformGroup = true;

        controlRef.current = controls;

        // Drag listener
        const onDrag = (event: { type: string; object: THREE.Object3D }) => {
            const draggedGroup = event.object as THREE.Group;
            if (!draggedGroup) {
                return;
            }
            if (draggedGroup.position.y != FLOOR_Y) {
                draggedGroup.position.y = FLOOR_Y;
            }
        };

        const onDragEnd = (event: { type: string; object: THREE.Object3D }) => {
            requestAnimationFrame(() => {
                snapToValidPosition(event.object as THREE.Group);
            });
        };

        const onKeyPress = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setSelectedObjects([]);
            }
        }

        controls.addEventListener("drag", onDrag);
        controls.addEventListener("dragend", onDragEnd);
        window.addEventListener("keydown", onKeyPress);
        return () => {
            controls.removeEventListener("drag", onDrag);
            controls.removeEventListener("dragend", onDragEnd);
            controls.dispose();
            window.removeEventListener("keydown", onKeyPress);
        };
    }, [camera, gl, setSelectedObjects, snapToValidPosition]);
    
    

    // In the event of a object selection changing, register the correct one with the drag controls
    useEffect(() => {
        const controls = controlRef.current;
        if (!controls)  {
            return;
        }
        
        // Disable dragging when config is confirmed (simulation config phase)
        if (isConfigConfirmed) {
            controls.objects = [];
            controls.enabled = false;
            return;
        }
        
        controls.enabled = true;
        // In the selectedObjects useEffect:
        
        const controlObjects = selectedObjects.map(id => junctionObjectRefs.current.find(g => {
            const data = getStructureData(g);
            return data && data.id === id;
        })).filter((g): g is THREE.Group => !!g);

        controls.objects = controlObjects;


    }, [selectedObjects, setSelectedObjects, snapToValidPosition, junctionObjectRefs, isConfigConfirmed]);


    return (
        <>
            {junction.junctionObjects.filter(obj => obj.type === "intersection").map((junctionObject, i) => (
                <IntersectionComponent
                    key={junctionObject.id.slice(0, 6)}
                    id={junctionObject.id}
                    name={junctionObject.name}
                    intersectionConfig={junctionObject.config}
                    index={i}
                    initialTransform={junctionObject.transform}
                />
            ))}

            {junction.junctionObjects.filter(obj => obj.type === "roundabout").map((junctionObject, i) => (
                <RoundaboutComponent
                    key={junctionObject.id.slice(0, 6)}
                    id={junctionObject.id}
                    name={junctionObject.name}
                    roundaboutConfig={junctionObject.config}
                    index={i}
                    initialTransform={junctionObject.transform}
                />
            ))}

            {junction.junctionLinks.map((link, linkIndex) => {
                const config1 = junction.junctionObjects.find(o => o.id === link.objectPair[0].structureID)?.config.exitConfig[link.objectPair[0].exitIndex];
                const config2 = junction.junctionObjects.find(o => o.id === link.objectPair[1].structureID)?.config.exitConfig[link.objectPair[1].exitIndex];
                if (!config1 || !config2) return null;
                return (
                    <LinkComponent
                        key={`l-${linkIndex}`}
                        link={link}
                        config1={config1}
                        config2={config2}
                    />
                );
            })}

            {/* Below goes future objects such as roundabouts etc. */}
        </>
    );
};