import {useEffect, useRef, useState } from "react";
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
                const { structureIndex, type } = obj.userData;
                if (type === "intersection") {
                    setJunction(prev => {
                        const newIntersections = [...prev.intersections];
                        newIntersections[structureIndex] = {
                            ...newIntersections[structureIndex],
                            origin: obj.position.clone(),
                        };
                        return { ...prev, intersections: newIntersections };
                    });
                }
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
                    key={i}
                    structureIndex={i}
                    intersectionStructure={intersectionStructure}
                />
            ))}

            {/* Below goes future objects such as roundabouts etc. */}
        </>
    );
};