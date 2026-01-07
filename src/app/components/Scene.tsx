"use client";

import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useState, useEffect, useRef } from "react";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useJModellerContext } from "../context/JModellerContext";
import { carColours, carTypes, FLOOR_Y } from "../includes/defaults";
import * as THREE from "three";
import { MTLLoader, OBJLoader } from "three/examples/jsm/Addons.js";
import { JunctionComponents } from "./JunctionComponents";
import { generateIntersectionPath, generateRoundaboutPath, getMidCurve } from "../includes/carRouting";
import { ThickLine } from "./ThickLine";
import { link } from "fs";
import { useFrame } from "@react-three/fiber";




export default function Scene() {

    const { selectedObjects, junctionObjectRefs } = useJModellerContext();
    const controlsRef = useRef<OrbitControlsImpl>(null)

    

    
    const carPathTest:  [number, number, number][] = [];

    const intersectionRef = junctionObjectRefs.current.find(g => g.userData.id === "i1");
    const roundaboutRef = junctionObjectRefs.current.find(g => g.userData.id === "r1");
    const linkRef = junctionObjectRefs.current.find(g => g.userData.type === "link");

    if (intersectionRef && roundaboutRef && linkRef) {
        const interSectionpath = generateIntersectionPath(
                intersectionRef,
                { exitIndex: 4, laneIndex: 1 },
                { exitIndex: 2, laneIndex: 0 }
            );
        const roundaboutPath = generateRoundaboutPath(
                roundaboutRef,
                { exitIndex: 3, laneIndex: 1 },
                { exitIndex: 1, laneIndex: 0 }
            );
        
        const linkPoints = getMidCurve(linkRef.userData.laneCurves[0], linkRef.userData.laneCurves[0 + 1])

        carPathTest.push(...interSectionpath, ...linkPoints, ...roundaboutPath);
    }

    
    return (
        <>
            <axesHelper args={[50]} />

            <fog attach="fog" args={["#0a0a0a", 100, 250]} />

            <ambientLight intensity={1} />
            <directionalLight position={[20, 50, 20]} intensity={0.6} />
            <pointLight position={[0, 5, 0]} intensity={2} color="#ffaa00" />

            <mesh 
                rotation={[-Math.PI / 2, 0, 0]} 
                position={[0, FLOOR_Y-1, 0]}
                receiveShadow
            >
                <planeGeometry args={[500, 500]} />
                <meshStandardMaterial color="#1c1c1c" />
            </mesh>

            <EffectComposer>
                <Bloom intensity={1.5} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
            </EffectComposer>

            <OrbitControls
                enabled={selectedObjects.length === 0}
                ref={controlsRef}
                minPolarAngle={Math.PI / 6}
                maxPolarAngle={Math.PI / 2.1}
                minDistance={5}
                maxDistance={100}
            />

            <JunctionComponents />
        </>
    );
}