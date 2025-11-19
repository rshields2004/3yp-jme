import {useEffect, useRef } from "react";
import * as THREE from "three";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { useJModellerContext } from "../context/JModellerContext";
import { FLOOR_Y } from "../includes/defaults";
import { useThree } from "@react-three/fiber";
import { IntersectionComponent } from "./IntersectionComponent";


export const JunctionComponents = () => {

    const { selectedObjects, junction, snapToValidPosition, setSelectedObjects, junctionObjectRefs } = useJModellerContext();

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
            if (!draggedGroup) {
                return;
            }
            if (draggedGroup.position.y != FLOOR_Y) {
                draggedGroup.position.y = FLOOR_Y;
            }
        };

        const onDragEnd = (event: any) => {
            requestAnimationFrame(() => snapToValidPosition(event.object as THREE.Group));
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
    }, [camera, gl]);
    
    

    // In the event of a object selection changing, register the correct one with the drag controls
    useEffect(() => {
        const controls = controlRef.current;
        if (!controls)  {
            return;
        }
        const controlObjects = selectedObjects.map(id => junctionObjectRefs.current.find(g => g.userData.id === id)).filter((g): g is THREE.Group => !!g)
        controls.objects = controlObjects;

    }, [selectedObjects]);


    return (
        <>
            {junction.junctionObjects.filter(obj => obj.type === "intersection").map((junctionObject, i) => (
                <IntersectionComponent
                    key={junctionObject.id}
                    id={junctionObject.id}
                    intersectionConfig={junctionObject.config}
                    index={i}
                />
            ))}

            {/* Below goes future objects such as roundabouts etc. */}
        </>
    );
};