import { useEffect, useRef, useState } from "react";
import { ThickLine } from "./ThickLine";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { DragControls, OrbitControls, TransformControls } from "@react-three/drei";
import { useJModellerContext } from "../context/JModellerContext";
import { IntersectionConfig, IntersectionStructure } from "../includes/types";
import { group } from "console";

type IntersectionProps = {
    intersectionStructure: IntersectionStructure;
};

export const IntersectionComponent: React.FC<IntersectionProps> = ({ intersectionStructure }) => {
    const [selected, setSelected] = useState(false);


    return (
        <>
            <DragControls>
                <group
                    position={intersectionStructure.origin}
                    onPointerMissed={(event) => {
                        if (event.button === 0) {
                            setSelected(false);
                        }
                    }}
                >

                    {/* Selection ring */}
                    {selected && (
                        <mesh rotation={[-Math.PI / 2, 0, 0]} position={intersectionStructure.origin}>
                            <ringGeometry args={[intersectionStructure.maxDistanceToStopLine, intersectionStructure.maxDistanceToStopLine + 0.5, 100]} />
                            <meshBasicMaterial color="black" side={2} />
                        </mesh>
                    )}

                    {/* Floor */}
                    <mesh
                        geometry={intersectionStructure.intersectionFloor}
                        rotation={[-Math.PI / 2, Math.PI, Math.PI]}
                        position={intersectionStructure.origin}
                        onPointerDown={(event) => {
                            event.stopPropagation(); // Prevent bubbling up to parent
                            setSelected(true);
                        }}
                    >
                        <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} />
                    </mesh>

                    {intersectionStructure.exitInfo.flatMap((exit, exitIndex) =>
                        exit.stopLines.map((lane, laneIdx) => (
                            <ThickLine
                                key={`${exitIndex}-${laneIdx}`}
                                line={lane.line}
                                colour={lane.properties.colour}
                                dashed={lane.properties.pattern}
                            />
                        ))
                    )}

                    {/* Stop lines */}
                    {intersectionStructure.exitInfo.flatMap((exit, exitIndex) =>
                        exit.stopLines.map((lane, laneIdx) => (
                            <ThickLine
                                key={`${exitIndex}-${laneIdx}`}
                                line={lane.line}
                                colour={lane.properties.colour}
                                dashed={lane.properties.pattern}
                            />
                        ))
                    )}

                    {/* Lane lines */}
                    {intersectionStructure.exitInfo.flatMap((exit, exitIndex) =>
                        exit.laneLines.map((lane, laneIdx) => (
                            <ThickLine
                                key={`${exitIndex}-${laneIdx}`}
                                line={lane.line}
                                colour={lane.properties.colour}
                                dashed={lane.properties.pattern}
                            />
                        ))
                    )}

                    {/* Edge tubes */}
                    {intersectionStructure.edgeTubes.flatMap((tubeGeom, tubeIndex) => (
                        <mesh key={`${tubeIndex}`} geometry={tubeGeom} position={[0, 0, 0]}>
                            <meshStandardMaterial color="grey" emissive="black" emissiveIntensity={0.3} />
                        </mesh>
                    ))}
                </group>
            </DragControls>
            <OrbitControls
                enabled={!selected}
                minPolarAngle={Math.PI / 6}
                maxPolarAngle={Math.PI / 2}
                minDistance={5}
                maxDistance={100}
            />
        </>
    );
};
