import * as THREE from "three";
import { useMemo } from "react";

type ThickLineProps = {
    line: THREE.Line3
    colour?: string;
    dashed?: string;
    dashSize?: number;
    gapSize?: number;
};

export const ThickLine: React.FC<ThickLineProps> = ({
    line,
    colour = "white",
    dashed = false,
    dashSize = 0.2,
    gapSize = 0.1,
}) => {
    const startVec = useMemo(() => line.start.clone(), [line]);
    const endVec = useMemo(() => line.end.clone(), [line]);


    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry().setFromPoints([startVec, endVec]);
        if (dashed) {
            // Manually compute line distances for dashed material
            const positions = g.attributes.position.array as Float32Array;
            const lineDistances = new Float32Array(positions.length / 3);
            let dist = 0;
            for (let i = 3; i < positions.length; i += 3) {
                const dx = positions[i] - positions[i - 3];
                const dy = positions[i + 1] - positions[i - 2];
                const dz = positions[i + 2] - positions[i - 1];
                dist += Math.sqrt(dx * dx + dy * dy + dz * dz);
                lineDistances[i / 3] = dist;
                lineDistances[i / 3 - 1] = dist - Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
            g.setAttribute("lineDistance", new THREE.BufferAttribute(lineDistances, 1));
        }
        return g;
    }, [startVec, endVec, dashed]);

    return (dashed === "dashed") ? (
        <line geometry={geometry}>
            <lineDashedMaterial color={colour} dashSize={dashSize} gapSize={gapSize} />
        </line>
    ) : (
        <line geometry={geometry}>
            <lineBasicMaterial color={colour} />
        </line>
    );
};
