import React, { forwardRef, useRef, useImperativeHandle, useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export type ThickLineHandle = {
    updatePoints: (points: [number, number, number][]) => void;
    setDashed(isDashed: boolean): void;
    setRed: () => void;
    setRedAmber: () => void;
    setGreen: () => void;
    setAmber: () => void;
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
    ({ points, colour, linewidth, dashed, worldUnits, dashSize = 0.5, gapSize = 0.5 }, ref) => {
        const groupRef = useRef<THREE.Group>(null);
        const { size } = useThree();
        const lineRef = useRef<Line2>(null);
        const geometryRef = useRef<LineGeometry>(null);
        const materialRef = useRef<LineMaterial>(null);

        useImperativeHandle(ref, () => ({
            updatePoints(newPoints: [number, number, number][]) {
                if (!geometryRef.current || !lineRef.current) return;
                geometryRef.current.setPositions(newPoints.flat());
                lineRef.current.computeLineDistances();
            },
            setDashed(isDashed: boolean) {
                if (!materialRef.current) return;
                materialRef.current.dashed = isDashed;
                materialRef.current.needsUpdate = true;
            },
            setRed: () => { if (!materialRef.current) return; materialRef.current.color.set("red"); },
            setRedAmber: () => { if (!materialRef.current) return; materialRef.current.color.set("orange"); },
            setGreen: () => { if (!materialRef.current) return; materialRef.current.color.set("green"); },
            setAmber: () => { if (!materialRef.current) return; materialRef.current.color.set("yellow"); },
        }));

        // Create line once on mount, never recreate
        useEffect(() => {
            if (!groupRef.current) return;

            const current = groupRef.current;

            const geometry = new LineGeometry();
            const material = new LineMaterial();
            const line = new Line2(geometry, material);
            
            current.add(line);

            lineRef.current = line;
            geometryRef.current = geometry;
            materialRef.current = material;

            return () => {
                current.remove(line);
                geometry.dispose();
                material.dispose();
                lineRef.current = null;
                geometryRef.current = null;
                materialRef.current = null;
            };
        }, []); // Only run once on mount

        // Update all properties whenever they change
        useEffect(() => {
            if (!geometryRef.current || !materialRef.current || !lineRef.current) return;

            // Update geometry
            if (geometryRef.current) {
                const flat = points.flat();

                const geom = geometryRef.current;

                // If the number of points changed, we MUST recreate geometry
                const oldLength = geom.attributes.position.array.length;

                if (oldLength !== flat.length) {
                    geom.dispose();
                    const newGeom = new LineGeometry();
                    newGeom.setPositions(flat);
                    lineRef.current.geometry = newGeom;
                    geometryRef.current = newGeom;
                } else {
                    geom.setPositions(flat);
                }

                lineRef.current.computeLineDistances();
            }

            // Update material properties
            materialRef.current.color.set(colour ?? 'white');
            materialRef.current.linewidth = linewidth ?? 1;
            materialRef.current.dashed = dashed ?? false;
            materialRef.current.dashSize = dashSize;
            materialRef.current.gapSize = gapSize;
            materialRef.current.worldUnits = worldUnits ?? false;
            materialRef.current.resolution.set(size.width, size.height);
            materialRef.current.needsUpdate = true;

        }, [points, colour, linewidth, dashed, worldUnits, dashSize, gapSize, size.width, size.height]);

        return <group ref={groupRef} />;
    }
);

ThickLine.displayName = "ThickLine";