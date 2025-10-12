"use client";

import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import Car from "./Car";
import { useState, useEffect } from "react";
import { TextureLoader, RepeatWrapping, Texture } from "three";

export default function Scene() {
    
    const [cars, setCars] = useState<{ id: number; position: [number, number, number] }[]>([{ id: -1, position: [0, -1000, 0]}]);
    const [selectedCarId, setSelectedCarId] = useState(-1);
    const [grassTexture, setGrassTexture] = useState<Texture | null>(null);
    
    useEffect(() => {
        const loader = new TextureLoader();
        loader.load("/textures/grass.jpg", (texture) => {
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
        texture.repeat.set(500, 500);
        setGrassTexture(texture);
        });
    }, []);
    
    


    const addCar = () => {
        setCars( (previousArray) => [
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
                camera={{ position: [5, 5, 5], fov: 60  }}
                style={{ background: "#444444", width: "100vw", height: "100vh"}}
            >
                <ambientLight intensity={0.5} />
                <directionalLight
                    position={[10, 20, 10]}
                    intensity={1.5}
                    color="white"
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                    shadow-camera-left={-50}
                    shadow-camera-right={50}
                    shadow-camera-top={50}
                    shadow-camera-bottom={-50}
                    shadow-camera-near={1}
                    shadow-camera-far={100}
                />
                <OrbitControls />
                <axesHelper args={[5]} />
                
                {/* The Sun */}
                <mesh position={[10, 20, 10]}>
                    <boxGeometry args={[1, 1, 1]} /> {/* width, height, depth */}
                    <meshStandardMaterial color="orange" />
                </mesh>

                {/* The floor */}
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
                    <planeGeometry args={[500, 500]} />
                    <meshStandardMaterial map={grassTexture} />
                </mesh> 


                { cars.map((car) => (
                    <Car 
                        key={car.id} 
                        position={car.position} 
                        scale={0.5} 
                        selected={car.id === selectedCarId}
                        onSelect={() => setSelectedCarId(car.id)}
                    />
                ))}

            </Canvas>
        </div>
    );
}