"use client";

import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { MTLLoader, OBJLoader } from "three/examples/jsm/Addons.js";
import { SpotLightHelper } from "three";
import { useHelper } from "@react-three/drei";
import { CarProperties } from "../includes/types";



export default function Car(carProps: CarProperties) {
    const groupRef = useRef<THREE.Group>(null);
    const spotLightRef = useRef<THREE.SpotLight>(null);
    useHelper(spotLightRef as React.RefObject<THREE.Object3D>, SpotLightHelper);

    let carMaterial = "/models/car-" + carProps.type + "-" + carProps.colour + ".mtl";
    let carObject = "/models/car-" + carProps.type + "-" + carProps.colour + ".obj";

    const materials = useLoader(MTLLoader, carMaterial);

    const [forward, setForward] = useState(false);
    const [backward, setBackward] = useState(false);
    const [left, setLeft] = useState(false);
    const [right, setRight] = useState(false);



    useEffect(() => {
        materials.preload();
    }, [materials]);


    const obj = useLoader(OBJLoader, carObject, (loader) => {
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

        if (spotLightRef.current && groupRef.current) {
            spotLightRef.current.target = groupRef.current;
        }


        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);




    useFrame(() => {
        if (!groupRef.current) {
            return;
        }

        if (carProps.selected) {

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

        }
    });

    const carObj = useMemo(() => obj.clone(), [obj]);

    return (
        <group
            ref={groupRef}
            position={carProps.position}
            scale={[carProps.scale, carProps.scale, carProps.scale]}
            onClick={carProps.onSelect}
        >
            <spotLight
                ref={spotLightRef}
                position={[0, 5, 0]}     
                angle={Math.PI / 6}
                penumbra={0.5}
                intensity={5}
                distance={15}
                castShadow
            />
            <primitive object={carObj} />

            {carProps.selected && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
                    <ringGeometry args={[1.2, 1.5, 32]} />
                    <meshBasicMaterial color="black" side={2} />
                </mesh>
            )}
        </group>
    );

}