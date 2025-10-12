"use client";

import { useFrame, useLoader } from "@react-three/fiber";
import { group } from "console";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MTLLoader, OBJLoader } from "three/examples/jsm/Addons.js";


type CarProps = {
    key: number;
    position?: [number, number, number];
    scale?: number,
};


export default function Car({position = [0, 0, 0], scale = 1}: CarProps) {
    const groupRef = useRef<THREE.Group>(null);
    const materials = useLoader(MTLLoader, "/models/car-microcargo-red.mtl");

    const [forward, setForward] = useState(false);
    const [backward, setBackward] = useState(false);
    const [left, setLeft] = useState(false);
    const [right, setRight] = useState(false);


    useEffect(() => {
        materials.preload();
    }, [materials]);


    const obj = useLoader(OBJLoader, "/models/car-microcargo-red.obj", (loader) => {
        const objloader = loader;
        objloader.setMaterials(materials);
    });

    useEffect(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === "w") {
                    setForward(true);
                } 
                if (e.key === "s") {
                    setBackward(true);
                }
                if (e.key === "a") {
                    setLeft(true);
                }
                if (e.key === "d") {
                    setRight(true);
                }
            };
            const handleKeyUp = (e: KeyboardEvent) => {
                if (e.key === "w") {
                    setForward(false);
                } 
                if (e.key === "s") {
                    setBackward(false);
                }
                if (e.key === "a") {
                    setLeft(false);
                }
                if (e.key === "d") {
                    setRight(false);
                }
            };

            window.addEventListener("keydown", handleKeyDown);
            window.addEventListener("keyup", handleKeyUp);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);




    useFrame(() => {
        if (!groupRef.current) {
            return;
        }

        if (left) {
            groupRef.current.rotation.y += 0.03;
        }
        if (right) {
            groupRef.current.rotation.y -= 0.03;
        }

        const forwardVector = new THREE.Vector3(0, 0, -1);
        forwardVector.applyQuaternion(groupRef.current.quaternion);

        if (forward) {
            groupRef.current.position.addScaledVector(forwardVector, -0.03);
        }
        if (backward) {
            groupRef.current.position.addScaledVector(forwardVector, 0.03);
        }

        
    });

    const cloneObj = obj.clone();

    return (
        <group 
            ref={groupRef} 
            position={position} 
            scale={[scale, scale, scale]}
        >
            <primitive object={cloneObj} />
        </group>
    );

}