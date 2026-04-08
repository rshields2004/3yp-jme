/**
 * JunctionComponents.tsx
 *
 * Container component that renders all junction objects from state
 * and provides drag controls for repositioning them in build mode.
 */

"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { useJModellerContext } from "../context/JModellerContext";
import { FLOOR_Y_OFFSET } from "../includes/constants";
import { useThree } from "@react-three/fiber";
import { IntersectionComponent } from "./IntersectionComponent";
import { RoundaboutComponent } from "./RoundaboutComponent";
import { LinkComponent } from "./LinkComponent";


/**
 * Reads the junction config from context and renders the corresponding
 * intersection, roundabout, and link components for every object.
 * @returns the rendered junction object list
 */
export const JunctionComponents = () => {

    const { selectedObjects, junction, snapToValidPosition, setSelectedObjects, junctionObjectRefs, isConfigConfirmed, toolMode } = useJModellerContext();

    // We define our drag controls for all components
    const { camera, gl } = useThree();
    const controlRef = useRef<DragControls | null>(null);

    // Keep a stable ref to snapToValidPosition so DragControls callbacks always use the latest version
    const snapRef = useRef(snapToValidPosition);
    // Sync the snap ref on every render
    useEffect(() => { snapRef.current = snapToValidPosition; });

    // Initialise DragControls for junction objects with drag and escape-key listeners
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
            if (draggedGroup.position.y != FLOOR_Y_OFFSET) {
                draggedGroup.position.y = FLOOR_Y_OFFSET;
            }
        };

        const onDragEnd = (event: { type: string; object: THREE.Object3D }) => {
            requestAnimationFrame(() => {
                snapRef.current(event.object as THREE.Group);
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
    }, [camera, gl, setSelectedObjects]);
    
    

    // Update which objects are draggable whenever the selection, tool mode, or config confirmation changes
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

        let controlObjects: THREE.Group[];
        if (toolMode === "build") {
            // Build mode: all junction objects are draggable
            controlObjects = junctionObjectRefs.current.filter((g): g is THREE.Group => !!g);
        } else {
            // View/Select mode: no dragging
            controlObjects = [];
        }

        controls.objects = controlObjects;


    }, [selectedObjects, isConfigConfirmed, junctionObjectRefs, toolMode, junction.junctionObjects]);


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