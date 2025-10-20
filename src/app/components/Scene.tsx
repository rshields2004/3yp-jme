"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import Car from "./Car";
import { useState, useEffect } from "react";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useJunction } from "../context/JunctionContext";
import { ThickLine } from "./ThickLine";

export default function Scene() {

    const { junctionStructure } = useJunction();
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


    const numRows = 5;
    const numCols = 5;
    const spacing = 1;

    const offsetX = (numCols - 1) * spacing / 2;
    const offsetZ = (numRows - 1) * spacing / 2;

    const carsTest = Array.from({ length: numRows * numCols }, (_, i) => {
        const row = Math.floor(i / numCols);
        const col = i % numCols;

        return {
            id: i,
            position: [col * spacing - offsetX, 0, row * spacing - offsetZ] as [number, number, number],
        };
    });


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
                    maxDistance={100}
                />

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

                {junctionStructure.exitInfo.flatMap((exit, exitIdx) =>
                    exit.stopLines.map((lane, laneIdx) => (
                        <ThickLine
                            key={`${exitIdx}-${laneIdx}`}
                            start={[lane.start[0], 0.02, lane.start[2]]}
                            end={[lane.end[0], 0.02, lane.end[2]]}
                            colour={lane.properties.colour}
                            dashed={lane.properties.pattern}
                        />
                    ))
                )}

                {junctionStructure.exitInfo.flatMap((exit, exitIdx) =>
                    exit.laneLines.map((lane, laneIdx) => (
                        <ThickLine
                            key={`${exitIdx}-${laneIdx}`}
                            start={[lane.start[0], 0.02, lane.start[2]]}
                            end={[lane.end[0], 0.02, lane.end[2]]}
                            colour={lane.properties.colour}
                            dashed={lane.properties.pattern}
                        />
                    ))
                )}

                {junctionStructure.edgeTubes.flatMap((tubeGeom, tubeIdx) =>
                    <mesh
                        key={`${tubeIdx}`}
                        geometry={tubeGeom}
                        position={[0, 0, 0]}
                    >
                        <meshStandardMaterial
                            color={"grey"}
                            emissive={"black"}
                            emissiveIntensity={0.3}
                        />
                    </mesh>
                )}

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

                {carsTest.map((car) => (
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