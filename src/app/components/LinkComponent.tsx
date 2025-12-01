import { useEffect, useRef, useState } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import { ExitConfig, JunctionLink } from "../includes/types/types";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { getExitWorldPosition } from "../includes/utils";
import { ExitStructure } from "../includes/types/intersection";
import { ThickLine, ThickLineHandle } from "./ThickLine";
import React from "react";

type LinkComponentProps = {
    link: JunctionLink;
    config1: ExitConfig;
    config2: ExitConfig;
};

export const LinkComponent = ({ link, config1, config2 }: LinkComponentProps) => {
    const { junctionObjectRefs } = useJModellerContext();

    const [linkInfo, setLinkInfo] = useState<{
        laneWidth: number;
        laneCount: number;
        numLanesIn: number;
    } | null>(null);

    const roadRef = useRef<THREE.Mesh>(null);
    const edgeTube1 = useRef<THREE.Mesh>(null);
    const edgeTube2 = useRef<THREE.Mesh>(null);

    const curve = useRef(
        new THREE.CubicBezierCurve3(
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3()
        )
    );

    // Initialize refs once, max 10 lanes (adjust as needed)
    const laneRefs = useRef<React.RefObject<ThickLineHandle | null>[]>([]);
    if (laneRefs.current.length === 0) {
        laneRefs.current = Array.from({ length: 10 }, () => React.createRef<ThickLineHandle | null>());
    }

    // Update link info whenever config changes
    useEffect(() => {
        if (!config1 || !config2) return;

        const laneCount = Math.max(config1.laneCount, config2.laneCount);

        setLinkInfo({
            laneWidth: config1.laneWidth,
            laneCount,
            numLanesIn: config1.numLanesIn,
        });
    }, [config1, config2, link]);



    // Update lane lines
    useFrame(() => {
        if (!linkInfo) return;

        const { laneWidth, laneCount, numLanesIn } = linkInfo;
        if (laneCount <= 1) return;

        const totalWidth = laneWidth * laneCount;
        const offsets: number[] = [];
        for (let k = 1; k < laneCount; k++) offsets.push(-totalWidth / 2 + k * laneWidth);

        const steps = 80;
        const centrePoints = curve.current.getPoints(steps);

        const safePerp = (a: THREE.Vector3, b: THREE.Vector3) => {
            const d = b.clone().sub(a).setY(0);
            if (d.lengthSq() < 1e-6) return new THREE.Vector3(1, 0, 0);
            d.normalize();
            return new THREE.Vector3(-d.z, 0, d.x);
        };

        offsets.forEach((offset, idx) => {
            const pts = centrePoints.map((p, i) => {
                const perp = i < centrePoints.length - 1 ? safePerp(centrePoints[i], centrePoints[i + 1]) : safePerp(centrePoints[i - 1], centrePoints[i]);
                return p.clone().add(perp.multiplyScalar(offset)).toArray();
            });

            const ref = laneRefs.current[idx];
            if (ref?.current) {
                ref.current.updatePoints(pts);
                
                // Dividing line should be SOLID (false), others should be DASHED (true)
                if (idx === linkInfo.laneCount - numLanesIn - 1) {
                    ref.current.setDashed(false); // Dividing line = solid
                } 
                else {
                    ref.current.setDashed(true);  // Other lines = dashed
                }
            }
        });

        if (!linkInfo) return;

        const [exitA, exitB] = link.objectPair;

        const groupA = junctionObjectRefs.current.find(g => g.userData.id === exitA.structureID);
        const groupB = junctionObjectRefs.current.find(g => g.userData.id === exitB.structureID);

        if (!groupA || !groupB) return;

        const infoA: ExitStructure = groupA.userData.exitInfo[exitA.exitIndex];
        const infoB: ExitStructure = groupB.userData.exitInfo[exitB.exitIndex];

        const pA = getExitWorldPosition(groupA, infoA, "end");
        const pB = getExitWorldPosition(groupB, infoB, "end");
        const dA = pA.clone().sub(getExitWorldPosition(groupA, infoA, "start")).setY(0).normalize();
        const dB = pB.clone().sub(getExitWorldPosition(groupB, infoB, "start")).setY(0).normalize();

        pA.addScaledVector(dA, -0.1);
        pB.addScaledVector(dB, -0.1);

        const pA2 = pA.clone().addScaledVector(dA, 15);
        const pB2 = pB.clone().addScaledVector(dB, 15);

        curve.current.v0.copy(pA);
        curve.current.v1.copy(pA2);
        curve.current.v2.copy(pB2);
        curve.current.v3.copy(pB);

        if (roadRef.current && linkInfo) {
            const { laneWidth, laneCount } = linkInfo;

            const shape = new THREE.Shape([
                new THREE.Vector2(0, -laneWidth * laneCount / 2),
                new THREE.Vector2(0, -laneWidth * laneCount / 2),
                new THREE.Vector2(0, laneWidth * laneCount / 2),
                new THREE.Vector2(0, laneWidth * laneCount / 2),
            ]);

            const extrudeSettings = {
                steps: 50,
                bevelEnabled: false,
                extrudePath: curve.current, // your CubicBezierCurve3
            };

            const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);

            roadRef.current.geometry.dispose();
            roadRef.current.geometry = geom;
            roadRef.current.position.y = 0;
        }

        // if (edgeTube1.current && edgeTube2.current) {
        //     const geom1 = new THREE.TubeGeometry(offsets., 500, 0.1, 8, false);
        //     edgeTube1.current.geometry.dispose();
        //     edgeTube1.current.geometry = geom1; 
            


        // }

    });

    return (
        <group>
            <mesh ref={roadRef}>
                <meshStandardMaterial color="darkgrey" side={THREE.DoubleSide} />
            </mesh>

            {linkInfo &&
                laneRefs.current.slice(0, linkInfo.laneCount - 1).map((refObj, i) => (
                    <ThickLine
                        key={i}
                        ref={refObj}
                        points={[[0, 0, 0], [0, 0, 0]]}
                        colour="white"
                        linewidth={0.1}
                        dashed={false} // dashed will be updated via ref.current.setDashed()
                        worldUnits={true}
                    />
                ))}
            <mesh
                ref={edgeTube1}
            >
                <meshStandardMaterial color="grey" emissive="black" emissiveIntensity={0.3} />
            </mesh>
            <mesh
                ref={edgeTube2}
            >
                <meshStandardMaterial color="grey" emissive="black" emissiveIntensity={0.3} />
            </mesh>
        </group>
    );
};
