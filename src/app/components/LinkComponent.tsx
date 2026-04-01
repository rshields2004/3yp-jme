/**
 * LinkComponent.tsx
 *
 * Renders the road link between two junction exits as a bezier
 * curve with lane markings, edge lines, and lane dividers.
 */

"use client";

import { useRef, useMemo, useEffect } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { getExitWorldPosition, getStructureData } from "../includes/utils";
import { ThickLine, ThickLineHandle } from "./ThickLine";
import type { ExitConfig, JunctionLink, LinkStructure } from "../includes/types/types";
import type { ExitStructure } from "../includes/types/intersection";
import React from "react"
import { RoundaboutExitStructure } from "../includes/types/roundabout";
import { Tuple3 } from "../includes/types/simulation";

type LinkComponentProps = {
    link: JunctionLink;
    config1: ExitConfig;
    config2: ExitConfig;
    yOffset?: number;
};

type LinkInfo = {
    laneWidth: number,
    laneCount: number,
    numLanesIn: number,
}

/**
 * Renders the road surface, lane markings, edge tubes, and dashed centre line
 * for a link connecting two junction exits.
 *
 * @param link - the link connecting two exit arms
 * @param config1 - exit config for the first arm
 * @param config2 - exit config for the second arm
 * @param yOffset - vertical offset for the link geometry
 * @returns the rendered link geometry
 */
export const LinkComponent = ({ link, config1, config2, yOffset = 0 }: LinkComponentProps) => {
    const { junctionObjectRefs, registerJunctionObject, junction } = useJModellerContext();
    const groupRef = useRef<THREE.Group>(null);
    const prevPositionsRef = useRef<[THREE.Vector3, THREE.Vector3] | null>(null);
    const prevLinkInfoRef = useRef<LinkInfo>(null);


    // Precompute lane info (width, count, inbound lanes) from the two linked exit configs
    const linkInfo: LinkInfo | null = useMemo(() => {
        if (!config1 || !config2) {
            return null;
        }
        const laneCount = Math.max(config1.laneCount, config2.laneCount);
        return { 
            laneWidth: junction.laneWidth, 
            laneCount, 
            numLanesIn: config1.numLanesIn 
        };
    }, [config1, config2]);

    const roadRef = useRef<THREE.Mesh>(null);
    const edgeTube1Ref = useRef<THREE.Mesh>(null);
    const edgeTube2Ref = useRef<THREE.Mesh>(null);
    const needsUpdateRef = useRef(true);

    const curveRef = useRef(
        new THREE.CubicBezierCurve3(
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3()
        )
    );

    const laneRefsPool = useRef<React.RefObject<ThickLineHandle | null>[]>([]);

    // Create or reuse refs for each lane line's ThickLine handle, expanding the pool as needed
    const laneRefs = useMemo(() => {
        if (!linkInfo) return [];

        const count = linkInfo.laneCount + 1;

        // Expand pool if needed
        while (laneRefsPool.current.length < count) {
            laneRefsPool.current.push(React.createRef<ThickLineHandle>());
        }

        // Return slice without modifying the pool
        return laneRefsPool.current.slice(0, count);
    }, [linkInfo]);

    // Precompute lateral offsets for each lane divider line
    const laneOffsets = useMemo(() => {
        if (!linkInfo) return [];
        const offsets: number[] = [];
        const totalWidth = linkInfo.laneWidth * linkInfo.laneCount;
        for (let k = 0; k <= linkInfo.laneCount; k++) offsets.push(-totalWidth / 2 + k * linkInfo.laneWidth);
        return offsets;
    }, [linkInfo]);

    /**
     * Compute the perpendicular direction (in the XZ plane) between two points.
     * Returns a unit vector pointing "left" of the a→b direction.
     * Falls back to (1,0,0) when the points are coincident.
     *
     * @param a - first angle in radians
     * @param b - second angle in radians
     * @returns a unit vector perpendicular to the input direction
     */
    const safePerp = (a: THREE.Vector3, b: THREE.Vector3) => {
        const d = b.clone().sub(a).setY(0);
        if (d.lengthSq() < 1e-6) return new THREE.Vector3(1, 0, 0);
        d.normalize();
        // Cross product with UP vector gives consistent left/right
        const up = new THREE.Vector3(0, 1, 0);
        return new THREE.Vector3().crossVectors(up, d).normalize();
    };

    // Flag that geometry needs rebuilding on every render (consumed by useFrame)
    useEffect(() => {
        needsUpdateRef.current = true;
    });

    useFrame(() => {
        if (!linkInfo) return;



        const [exitA, exitB] = link.objectPair;
        const groupA = junctionObjectRefs.current.find(g => getStructureData(g)?.id === exitA.structureID);
        const groupB = junctionObjectRefs.current.find(g => getStructureData(g)?.id === exitB.structureID);


        if (!groupA || !groupB) return;

        const infoA = getStructureData(groupA)?.type === "roundabout" ? groupA.userData.roundaboutStructure.exitStructures : groupA.userData.intersectionStructure.exitInfo;
        const infoB = getStructureData(groupB)?.type === "roundabout" ? groupB.userData.roundaboutStructure.exitStructures : groupB.userData.intersectionStructure.exitInfo;

        const exitInfoA = infoA[exitA.exitIndex];
        const exitInfoB = infoB[exitB.exitIndex];

        const pA = getExitWorldPosition(groupA, exitInfoA, "end").add(new THREE.Vector3(0, yOffset, 0));
        const pB = getExitWorldPosition(groupB, exitInfoB, "end").add(new THREE.Vector3(0, yOffset, 0));

        const prevPositions = prevPositionsRef.current;
        const prevLinkInfo = prevLinkInfoRef.current;

        const positionsChanged = !prevPositions || !pA.equals(prevPositions[0]) || !pB.equals(prevPositions[1]);
        const configChanged = !prevLinkInfo ||
            prevLinkInfo.laneCount !== linkInfo.laneCount ||
            prevLinkInfo.laneWidth !== linkInfo.laneWidth ||
            prevLinkInfo.numLanesIn !== linkInfo.numLanesIn;


        prevPositionsRef.current = [pA.clone(), pB.clone()];
        prevLinkInfoRef.current = { ...linkInfo };


        const shouldUpdate = needsUpdateRef.current || positionsChanged || configChanged;
        needsUpdateRef.current = false; // Clear the flag after checking

        if (!shouldUpdate) {
            return;
        }

        const dA = pA.clone().sub(getExitWorldPosition(groupA, exitInfoA, "start")).setY(0).normalize();
        const dB = pB.clone().sub(getExitWorldPosition(groupB, exitInfoB, "start")).setY(0).normalize();

        const pA2 = pA.clone().addScaledVector(dA, 15);
        const pB2 = pB.clone().addScaledVector(dB, 15);

        const curve = curveRef.current;
        curve.v0.copy(pA);
        curve.v1.copy(pA2);
        curve.v2.copy(pB2);
        curve.v3.copy(pB);

        // update road mesh
        if (roadRef.current) {
            const { laneWidth, laneCount } = linkInfo;
            const shape = new THREE.Shape([
                new THREE.Vector2(0, -laneWidth * laneCount / 2),
                new THREE.Vector2(0, -laneWidth * laneCount / 2),
                new THREE.Vector2(0, laneWidth * laneCount / 2),
                new THREE.Vector2(0, laneWidth * laneCount / 2),
            ]);
            const geom = new THREE.ExtrudeGeometry(shape, { steps: 50, bevelEnabled: false, extrudePath: curve });
            roadRef.current.geometry.dispose();
            roadRef.current.geometry = geom;
            roadRef.current.position.y = yOffset;
        }

        // compute lane line points
        const centerPoints = curve.getPoints(500);
        const laneCurves: Tuple3[][] = [];

        laneOffsets.forEach((offset, idx) => {
            const pts: Tuple3[] = centerPoints.map((p, i) => {
                const perp = i < centerPoints.length - 1
                    ? safePerp(centerPoints[i], centerPoints[i + 1])
                    : safePerp(centerPoints[i - 1], centerPoints[i]);
                return p.clone().add(perp.multiplyScalar(offset)).toArray() as Tuple3;
            });

            // Store the points in the array
            laneCurves[idx] = pts;

            // Update ThickLine if exists
            const ref = laneRefs[idx];
            if (ref?.current) {
                ref.current.updatePoints(pts);
                ref.current.setDashed(idx !== linkInfo.numLanesIn);
            }
        });

        // update edge tubes
        if (edgeTube1Ref.current && edgeTube2Ref.current) {
            const halfWidth = (linkInfo.laneWidth * linkInfo.laneCount) / 2;
            const edge1Points: THREE.Vector3[] = [];
            const edge2Points: THREE.Vector3[] = [];
            centerPoints.forEach((p, i) => {
                const perp = i < centerPoints.length - 1
                    ? safePerp(centerPoints[i], centerPoints[i + 1])
                    : safePerp(centerPoints[i - 1], centerPoints[i]);
                edge1Points.push(p.clone().add(perp.clone().multiplyScalar(halfWidth)));
                edge2Points.push(p.clone().add(perp.clone().multiplyScalar(-halfWidth)));
            });
            [edgeTube1Ref.current, edgeTube2Ref.current].forEach((tubeRef, i) => {
                const points = i === 0 ? edge1Points : edge2Points;
                const tubeCurve = new THREE.CatmullRomCurve3(points);
                const geom = new THREE.TubeGeometry(tubeCurve, 500, 0.1, 8, false);
                tubeRef.geometry.dispose();
                tubeRef.geometry = geom;
            });
        }
        if (!groupRef.current) {
            return;
        }

        const linkStructure: LinkStructure = { id: link.id, laneCurves };

        groupRef.current.userData.id = link.id;
        groupRef.current.userData.linkStructure = linkStructure;
        registerJunctionObject(groupRef.current);
    });
    
    return (
        <group
            ref={groupRef}
        >
            <mesh ref={roadRef}>
                <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
            </mesh>

            {laneRefs.slice(1, -1).map((refObj, i) => (
                <ThickLine
                    key={`lane-${i}`}
                    ref={refObj}
                    points={[[0, yOffset, 0], [0, yOffset, 0]]}
                    colour="white"
                    linewidth={2.5}
                    dashed={false} // updated in useFrame
                    worldUnits={false}
                />
            ))}


            <mesh ref={edgeTube1Ref}>
                <meshStandardMaterial color="grey" emissive="black" emissiveIntensity={0.3} />
            </mesh>
            <mesh ref={edgeTube2Ref}>
                <meshStandardMaterial color="grey" emissive="black" emissiveIntensity={0.3} />
            </mesh>
        </group>
    );
};

