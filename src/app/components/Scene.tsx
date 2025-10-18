"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import Car from "./Car";
import { useState, useEffect } from "react";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useJunction } from "../context/JunctionContext";
import { Line } from "@react-three/drei";
import { Exit, Lane } from "../includes/types";

export default function Scene() {

    const { junctionConfig } = useJunction();
    const [cars, setCars] = useState<{ id: number; position: [number, number, number] }[]>([{ id: -1, position: [0, -1000, 0] }]);
    const [selectedCarId, setSelectedCarId] = useState(-1);

    const addCar = () => {
        setCars((previousArray) => [
            ...previousArray,
            {
                id: Date.now(),
                position: [0, 0, 0],
            },
        ])
    }

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Shift") addCar();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);


    return (
        <div style={{ width: "100vw", height: "100vh" }}>
            <Canvas
                camera={{ position: [5, 5, 5], fov: 60 }}
                style={{ background: "#0a0a0a", width: "100vw", height: "100vh" }}
            >

                <OrbitControls
                    minPolarAngle={Math.PI / 6}
                    maxPolarAngle={Math.PI / 2}
                    minDistance={5}
                    maxDistance={50}
                />
                <axesHelper args={[50]} />

                <fog attach="fog" args={["#0a0a0a", 50, 150]} />

                <ambientLight intensity={0.1} />
                <directionalLight position={[20, 50, 20]} intensity={0.6} />
                <pointLight position={[0, 5, 0]} intensity={2} color="#ffaa00" />

                <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                    <planeGeometry args={[500, 500]} />
                    <meshStandardMaterial color="#1c1c1c" />
                </mesh>

                <EffectComposer>
                    <Bloom intensity={1.5} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
                </EffectComposer>


                {junctionConfig.flatMap((exit, exitIdx) => {
                    return exit.lanes.map((lane, laneIdx) => {
                        return (
                            <Line
                                key={`${exitIdx}-${laneIdx}`}
                                points={[lane.start, lane.end]} // or [0,0] placeholder
                                color={lane.properties.colour}
                                lineWidth={lane.properties.thickness * 10}
                                dashed={lane.properties.pattern === "dashed"}
                            />
                        );
                    });
                })}

                {cars.map((car) => (
                    <Car
                        key={car.id}
                        position={car.position}
                        scale={0.5}
                        selected={car.id === selectedCarId}
                        colour="red"
                        type="microcargo"
                        onSelect={() => setSelectedCarId(car.id)}
                    />
                ))}
            </Canvas>
        </div>
    );
}