"use client";

import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

type ThickLineProps = {
    points: [number, number, number][];  
    colour: string | number;             
    linewidth: number;                  
    dashed: boolean;                    
    worldUnits: boolean;      
    isStop?: boolean;         
};

export const ThickLine: React.FC<ThickLineProps> = ({
    points,
    colour = 0xffffff,
    linewidth = 5,
    dashed = false,
    worldUnits = false,
    isStop = false
}) => {
    const groupRef = useRef<THREE.Group>(null);
    const { size } = useThree();
    const lineRef = useRef<Line2>(null);
    const geometryRef = useRef<LineGeometry>(null);
    const materialRef = useRef<LineMaterial>(null);

    useEffect(() => {
        if (!groupRef.current) return;

        const start = new THREE.Vector3(...points[0]);

        const geometry = new LineGeometry();
        geometry.setPositions(points.flat());

        const material = new LineMaterial({
            color: colour,
            linewidth,
            dashed,
            dashSize: 0.5,
            gapSize: 0.5,
            worldUnits,
        });
        material.resolution.set(size.width, size.height);

        const line = new Line2(geometry, material);
        line.computeLineDistances();
        groupRef.current.add(line);

        // Save refs
        lineRef.current = line;
        geometryRef.current = geometry;
        materialRef.current = material;

        return () => {
            // Remove and dispose
            groupRef.current?.remove(line);
            geometry.dispose();
            material.dispose();
            lineRef.current = null;
            geometryRef.current = null;
            materialRef.current = null;
        };
    }, []); // only on mount


    return <group ref={groupRef} />;
};
