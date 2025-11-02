import {useEffect, useRef } from "react";
import * as THREE from "three";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { useJModellerContext } from "../context/JModellerContext";
import { FLOOR_Y } from "../includes/defaults";
import { useThree } from "@react-three/fiber";
import { IntersectionComponent } from "./IntersectionComponent";


export const JunctionComponents = () => {

    const { setJunction, selectedJunctionObjectRefs, junctionStructure } = useJModellerContext();

    // We define our drag controls for all components
    const { camera, gl } = useThree();
    const controlRef = useRef<DragControls | null>(null);


    useEffect(() => {
        if (!camera || !gl) return;

        const controls = new DragControls([], camera, gl.domElement);
        controls.transformGroup = true;

        controlRef.current = controls;

        // Drag listener
        const onDrag = (event: any) => {
            const draggedGroup = event.object as THREE.Group;
            if (draggedGroup.position.y != FLOOR_Y) {
                draggedGroup.position.y = FLOOR_Y;
            }
        };

        const onDragEnd = (event: any) => {
            const controls = controlRef.current;
            if (!controls) return;

            controls.objects.forEach(obj => {
                const { id } = obj.userData;
                if (!id) {
                    return;
                }
                setJunction(prev => {
                    // Find the junction object by id
                    const newJunctionObjects = prev.junctionObjects.map(jObj => {
                        if (jObj.id === id) {
                            return {
                                ...jObj,
                                object: {
                                    ...jObj,
                                    config: {
                                        ...jObj.config,
                                        origin: obj.position.clone(), // update position
                                    },
                                },
                            };
                        }
                        return jObj;
                    });
                    return { ...prev, junctionObjects: newJunctionObjects };
                });
            });
        };

        controls.addEventListener("drag", onDrag);
        controls.addEventListener("dragend", onDragEnd);

        return () => {
            controls.removeEventListener("drag", onDrag);
            controls.removeEventListener("dragend", onDragEnd);
            controls.dispose();
        };
    }, [camera, gl]);
    

    // In the event of a object selection changing, register the correct one with the drag controls
    useEffect(() => {
        const controls = controlRef.current;
        if (!controls)  {
            return;
        }
        controls.objects = selectedJunctionObjectRefs.map(obj => obj.group);

    }, [selectedJunctionObjectRefs]);


    return (
        <>
            {junctionStructure.intersectionStructures.map((intersectionStructure, i) => (
                <IntersectionComponent
                    key={intersectionStructure.id}
                    id={intersectionStructure.id}
                    intersectionStructure={intersectionStructure}
                    index={i}
                />
            ))}

            {/* Below goes future objects such as roundabouts etc. */}
        </>
    );
};