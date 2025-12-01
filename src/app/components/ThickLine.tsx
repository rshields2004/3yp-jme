import React, { forwardRef, useRef, useImperativeHandle, useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export type ThickLineHandle = {
    updatePoints: (points: [number, number, number][]) => void;
    setDashed(isDashed: boolean): void;
};

type ThickLineProps = {
    points: [number, number, number][];
    colour?: string | number;
    linewidth?: number;
    dashed?: boolean;
    worldUnits?: boolean;
    dashSize?: number;
    gapSize?: number;
};

export const ThickLine = forwardRef<ThickLineHandle, ThickLineProps>(
    ({ points, colour = 0xffffff, linewidth = 5, dashed = false, worldUnits = false, dashSize = 0.5, gapSize = 0.5 }, ref) => {
        const groupRef = useRef<THREE.Group>(null);
        const { size } = useThree();
        const lineRef = useRef<Line2>(null);
        const geometryRef = useRef<LineGeometry>(null);
        const materialRef = useRef<LineMaterial>(null);

        useImperativeHandle(ref, () => ({
            updatePoints(newPoints: [number, number, number][]) {
                if (!geometryRef.current) return;
                geometryRef.current.setPositions(newPoints.flat());
                if (lineRef.current) lineRef.current.computeLineDistances();
            },
            setDashed(isDashed: boolean) {
                if (!materialRef.current) return;
                materialRef.current.dashed = isDashed;
                materialRef.current.needsUpdate = true;
            }
        }));

        useEffect(() => {
            if (!groupRef.current) return;

            const current = groupRef.current;

            const geometry = new LineGeometry();
            geometry.setPositions(points.flat());

            const material = new LineMaterial({
                color: colour,
                linewidth,
                dashed,
                dashSize,
                gapSize,
                worldUnits
            });
            material.resolution.set(size.width, size.height);

            const line = new Line2(geometry, material);
            line.computeLineDistances();
            groupRef.current.add(line);

            lineRef.current = line;
            geometryRef.current = geometry;
            materialRef.current = material;

            return () => {
                current.remove(line);
                geometry.dispose();
                material.dispose();
            };
        }, [colour, dashSize, dashed, gapSize, linewidth, points, size.height, size.width, worldUnits]);

        return <group ref={groupRef} />;
    }
);

ThickLine.displayName = "ThickLine";
