"use client";
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

export default function ThreeCanvas() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const objRef = useRef<THREE.Group | null>(null);

    const numExits = 4;
    const laneWidth = 50;

    /**
     * What to do now: Set a junction width, calculate internal angles of middle intersection, generate lane information
     * 
     * 
     */


    useEffect(() => {
        if (!mountRef.current) {
            return;
        }

        let myObject;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x202020);

        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        camera.position.set(10, 10, 10);
        camera.lookAt(new THREE.Vector3(0, 0, 0));
        const cameraDirection = new THREE.Vector3(1, 1, 1).normalize();

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        mountRef.current.appendChild(renderer.domElement);

        // Load a car test
        const mtlLoader = new MTLLoader();
        mtlLoader.load('/car-microcargo-red.mtl', (materials) => {
            materials.preload();
            const objLoader = new OBJLoader();
            objLoader.setMaterials(materials);
            objLoader.load('/car-microcargo-red.obj', (object) => {
                objRef.current = object;
                scene.add(object);
            });
        });

        // 5. Light
        const light = new THREE.AmbientLight( 0x404040 ); // soft white light
        scene.add( light );
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1); // color, intensity
        directionalLight.position.set(5, 10, 7.5); // place it above and in front
        scene.add(directionalLight);

        // 6. Handle Resize
        const handleResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener("resize", handleResize);
        
        window.addEventListener("wheel", (event) => {
            const delta = event.deltaY * 0.05;
            const newPosition = camera.position.clone().addScaledVector(cameraDirection, delta);   
            const distance = newPosition.length();

            if (distance >= 5 && distance <= 40) {
                camera.position.copy(newPosition);
            }

            camera.lookAt(0, 0, 0);
        })


        const axesHelper = new THREE.AxesHelper( 5 );
        scene.add( axesHelper );


        // 7. Animation Loop
        const animate = () => {
            if (objRef.current) {
                objRef.current.rotation.y += 0.01; // rotate around Y-axis
            }
            renderer.render(scene, camera);
            requestAnimationFrame(animate);
        };
        animate();


        return () => {
            window.removeEventListener("resize", handleResize);
            if (mountRef.current) {
                mountRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
        };

    }, []);

    return (
        <div ref={mountRef} style={{ width: "80vw", height: "80vh" }} />
    );
}