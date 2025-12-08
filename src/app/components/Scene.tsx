"use client";

import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import Car from "./Car";
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




export const carCache = new Map<string, THREE.Group>();
export async function preloadCars() {
    const loadPromises: Promise<void>[] = [];
    for (const type of carTypes) {
        for (const colour of carColours) {
            const key = `${type}-${colour}`;
            if (!carCache.has(key)) {
                loadPromises.push((async () => {
                    try {
                        const materials = await new Promise<MTLLoader.MaterialCreator>((resolve, reject) => {
                            new MTLLoader().load(`/models/car-${type}-${colour}.mtl`, resolve, undefined, reject);
                        });
                        materials.preload();

                        const obj = await new Promise<THREE.Group>((resolve, reject) => {
                            new OBJLoader().setMaterials(materials).load(`/models/car-${type}-${colour}.obj`, resolve, undefined, reject);
                        });

                        carCache.set(key, obj);

                    } catch (err) {
                        console.error(`Failed to load car ${key}`, err);
                    }
                })());
            }
        }
    }

    await Promise.all(loadPromises);
}

type CarState = {
    mesh: THREE.Group;
    path: [number, number, number][]; // points
    segmentIndex: number;             // current segment in path
    progress: number;                 // 0..1 between points
    speed: number;                    // units per second
};

export default function Scene() {

    const { selectedObjects, junctionObjectRefs } = useJModellerContext();
    const [selectedCarId, setSelectedCarId] = useState(-1);
    const [carsLoaded, setCarsLoaded] = useState<boolean>(false);
    const carRef = useRef<THREE.Group>(null);
    const [carIndex, setCarIndex] = useState(0);
    const speed = 5; // points per second

    const controlsRef = useRef<OrbitControlsImpl>(null)

    // Jonnys Dealership
    useEffect(() => {
        const loadAllCars = async () => {
            await preloadCars(); // waits for all cars to finish loading
            setCarsLoaded(true); // now safe to render all <Car> components
        };
        loadAllCars();
    }, []);

    const spacing = 1.2;
    const offsetX = (carColours.length - 1) * spacing / 2;
    const offsetZ = (carTypes.length - 1) * spacing / 2;
    const carsTest = carTypes.flatMap((type, typeIndex) =>
        carColours.map((colour, colourIndex) => {
            const x = colourIndex * spacing - offsetX; // center on x-axis
            const z = typeIndex * spacing - offsetZ;   // center on z-axis
            return {
                id: typeIndex * carColours.length + colourIndex,
                type,
                colour,
                position: [x - 30, 3, z] as [number, number, number],
            };
        })
    );
    

    

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

    const [carMesh] = useState(() => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(1, 0.5, 2),
            new THREE.MeshStandardMaterial({ color: "red" })
        );
        g.add(body);
        return g;
    });

    useFrame((_, delta) => {
        if (!carRef.current || carPathTest.length === 0) return;

        let nextIndex = carIndex + speed * delta;
        if (nextIndex >= carPathTest.length) nextIndex = carPathTest.length - 1;

        const point = carPathTest[Math.floor(nextIndex)];
        carRef.current.position.set(...point);

        // rotate to face next point
        if (Math.floor(nextIndex) < carPathTest.length - 1) {
            const nextPoint = carPathTest[Math.floor(nextIndex) + 1];
            const dir = new THREE.Vector3(...nextPoint).sub(new THREE.Vector3(...point)).normalize();
            carRef.current.lookAt(new THREE.Vector3(...point).add(dir));
        }

        setCarIndex(nextIndex);
    });
    
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
            <primitive object={carMesh} ref={carRef} />
        </>
    );
}