import { useRef, useMemo } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { getExitWorldPosition } from "../includes/utils";
import { ThickLine, ThickLineHandle } from "./ThickLine";
import type { ExitConfig, JunctionLink } from "../includes/types/types";
import type { ExitStructure } from "../includes/types/intersection";
import React from "react"

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

export const LinkComponent = ({ link, config1, config2, yOffset = 0 }: LinkComponentProps) => {
    const { junctionObjectRefs, selectedObjects } = useJModellerContext();

    const prevPositionsRef = useRef<[THREE.Vector3, THREE.Vector3] | null>(null);
    const prevLinkInfoRef = useRef<LinkInfo>(null);
    const prevSelectedRef = useRef<string[]>(null);


    // Precompute lane info
    const linkInfo: LinkInfo | null = useMemo(() => {
        if (!config1 || !config2) return null;
        const laneCount = Math.max(config1.laneCount, config2.laneCount);
        return { laneWidth: config1.laneWidth, laneCount, numLanesIn: config1.numLanesIn };
    }, [config1, config2]);

    const roadRef = useRef<THREE.Mesh>(null);
    const edgeTube1Ref = useRef<THREE.Mesh>(null);
    const edgeTube2Ref = useRef<THREE.Mesh>(null);

    const curveRef = useRef(
        new THREE.CubicBezierCurve3(
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3()
        )
    );

    const laneRefs = useRef<React.RefObject<ThickLineHandle | null>[]>([]);

    if (linkInfo) {
        // Add refs if lane count increased
        while (laneRefs.current.length < linkInfo.laneCount - 1) {
            laneRefs.current.push(React.createRef<ThickLineHandle>());
        }
        // Trim if lane count decreased
        laneRefs.current.length = linkInfo.laneCount - 1;
    }

    // Precompute lane offsets once
    const laneOffsets = useMemo(() => {
        if (!linkInfo) return [];
        const offsets: number[] = [];
        const totalWidth = linkInfo.laneWidth * linkInfo.laneCount;
        for (let k = 1; k < linkInfo.laneCount; k++) offsets.push(-totalWidth / 2 + k * linkInfo.laneWidth);
        return offsets;
    }, [linkInfo]);

    const safePerp = (a: THREE.Vector3, b: THREE.Vector3) => {
        const d = b.clone().sub(a).setY(0);
        if (d.lengthSq() < 1e-6) return new THREE.Vector3(1, 0, 0);
        d.normalize();
        return new THREE.Vector3(-d.z, 0, d.x);
    };

    useFrame(() => {
        if (!linkInfo) return;

        

        const [exitA, exitB] = link.objectPair;
        const groupA = junctionObjectRefs.current.find(g => g.userData.id === exitA.structureID);
        const groupB = junctionObjectRefs.current.find(g => g.userData.id === exitB.structureID);
    
       
        if (!groupA || !groupB) return;



        
        const infoA: ExitStructure = groupA.userData.exitInfo[exitA.exitIndex];
        const infoB: ExitStructure = groupB.userData.exitInfo[exitB.exitIndex];

        const pA = getExitWorldPosition(groupA, infoA, "end").add(new THREE.Vector3(0, yOffset, 0));
        const pB = getExitWorldPosition(groupB, infoB, "end").add(new THREE.Vector3(0, yOffset, 0));

        const prevPositions = prevPositionsRef.current;
        const prevLinkInfo = prevLinkInfoRef.current;

        const positionsChanged = !prevPositions || !pA.equals(prevPositions[0]) || !pB.equals(prevPositions[1]);
        const configChanged = !prevLinkInfo ||
            prevLinkInfo.laneCount !== linkInfo.laneCount ||
            prevLinkInfo.laneWidth !== linkInfo.laneWidth ||
            prevLinkInfo.numLanesIn !== linkInfo.numLanesIn;

        const selectedChanged = !prevSelectedRef.current ||
            prevSelectedRef.current.length !== selectedObjects.length ||
            prevSelectedRef.current.some((id, i) => id !== selectedObjects[i]);


        if (!positionsChanged && !configChanged && !selectedChanged) {
            return; // Nothing changed, skip the frame update
        }

        prevPositionsRef.current = [pA.clone(), pB.clone()];
        prevLinkInfoRef.current = { ...linkInfo };
        prevSelectedRef.current = [...selectedObjects];

        console.log("resaw");

        const dA = pA.clone().sub(getExitWorldPosition(groupA, infoA, "start")).setY(0).normalize();
        const dB = pB.clone().sub(getExitWorldPosition(groupB, infoB, "start")).setY(0).normalize();

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
        laneOffsets.forEach((offset, idx) => {
            const pts = centerPoints.map((p, i) => {
                const perp = i < centerPoints.length - 1
                    ? safePerp(centerPoints[i], centerPoints[i + 1])
                    : safePerp(centerPoints[i - 1], centerPoints[i]);
                return p.clone().add(perp.multiplyScalar(offset)).toArray();
            });

            const ref = laneRefs.current[idx];
            if (ref?.current) {
                ref.current.updatePoints(pts);
                ref.current.setDashed(idx !== linkInfo.laneCount - linkInfo.numLanesIn - 1);
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
    });
    return (
        <group>
            <mesh ref={roadRef}>
                <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} />
            </mesh>

            {laneRefs.current.map((refObj, i) => (
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
