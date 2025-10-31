"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import Car from "./Car";
import { useState, useEffect, useRef } from "react";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useJModellerContext } from "../context/JModellerContext";
import { IntersectionComponent } from "./IntersectionComponent";
import { carColours, carTypes } from "../includes/defaults";
import * as THREE from "three";
import { MTLLoader, OBJLoader } from "three/examples/jsm/Addons.js";


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
                        console.log(`Successfully loaded car: ${key}`);
                    } catch (err) {
                        console.error(`Failed to load car ${key}`, err);
                    }
                })());
            }
        }
    }

    await Promise.all(loadPromises);
}


export default function Scene() {

    const { junctionStructure } = useJModellerContext();
    const [cars, setCars] = useState<{ id: number; position: [number, number, number] }[]>([{ id: -1, position: [0, -1000, 0] }]);
    const [selectedCarId, setSelectedCarId] = useState(-1);
    const [carsLoaded, setCarsLoaded] = useState<boolean>(false);
    
    
    const [selected, setSelected] = useState(-1);

    const intersectionRefs = useRef<(THREE.Group | null)[]>([]);

    useEffect(() => {
        const count = junctionStructure.intersectionStructures.length;
        intersectionRefs.current = Array(count).fill(null).map((_, i) => intersectionRefs.current[i] || null);
    }, [junctionStructure.intersectionStructures.length]);


    const currentDraggable = selected >= 0 ? [intersectionRefs.current[selected]] : [];

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
                position: [x, 0, z] as [number, number, number],
            };
        })
    );




    return (
        <div style={{ width: "100vw", height: "100vh" }}>

            <Canvas
                camera={{ position: [5, 5, 5], fov: 60 }}
                style={{ background: "#0a0a0a", width: "100vw", height: "100vh" }}
            >
                <axesHelper args={[50]} />

                <fog attach="fog" args={["#0a0a0a", 100, 150]} />

                <ambientLight intensity={1} />
                <directionalLight position={[20, 50, 20]} intensity={0.6} />
                <pointLight position={[0, 5, 0]} intensity={2} color="#ffaa00" />

                <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                    <planeGeometry args={[500, 500]} />
                    <meshStandardMaterial color="#1c1c1c" />
                </mesh>

                <EffectComposer>
                    <Bloom intensity={1.5} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
                </EffectComposer>

                <OrbitControls
                    enabled={selected == -1}
                    minPolarAngle={Math.PI / 6}
                    maxPolarAngle={Math.PI / 2}
                    minDistance={5}
                    maxDistance={100}
                />

                {
                    junctionStructure.intersectionStructures.map((intersectionStructure, structureIndex) => (
                         <IntersectionComponent
                            key={structureIndex}
                            ref={(el) => { intersectionRefs.current[structureIndex] = el; }}
                            index={structureIndex}
                            intersectionStructure={intersectionStructure}
                            selected={selected}
                            setSelected={setSelected}
                        />
                    ))

                }
                {carsLoaded && carsTest.map((car) => (
                    <Car
                        key={car.id}
                        position={car.position}
                        scale={0.5}
                        selected={car.id === selectedCarId}
                        colour={car.colour}
                        type={car.type}
                        onSelect={() => setSelectedCarId(car.id)}
                    />
                ))}
            </Canvas>
        </div>
    );
}