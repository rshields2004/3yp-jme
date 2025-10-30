"use client";

import { useJModellerContext } from "../context/JModellerContext";
import { ExitConfig } from "../includes/types";

export default function DebugPanel() {
    const { junction, setJunction } = useJModellerContext();


    const handleExitNumChange = (intersectionIndex: number, newExitNum: number) => {
        if (newExitNum <= 1) {
            return;
        }

        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: prevJunction.intersections.map((intersection, index) => {
                if (index === intersectionIndex) {
                    return {
                        ...intersection,
                        numExits: newExitNum,
                        exitConfig: Array.from({ length: newExitNum }, () => ({
                            laneCount: 2,
                            laneWidth: 1.5,
                            exitLength: 40,
                        })),
                    };
                }
                return intersection;
            }),
        }));
    };

    const handleLaneNumChange = (intersectionIndex: number, exitIndex: number, newLaneNum: number) => {
        
        if (newLaneNum <= 1) {
            return;
        }

        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: prevJunction.intersections.map((intersection, i) => {
                if (i === intersectionIndex) {
                    return {
                        ...intersection,
                        exitConfig: intersection.exitConfig.map((exit, j) =>
                            j === exitIndex ? { ...exit, laneCount: newLaneNum } : exit
                        ),
                    };
                }
                return intersection;
            }),
        }));
    };

    const handleExitLengthChange = (intersectionIndex: number, exitIndex: number, newExitLength: number) => {
        if (newExitLength < 10) {
            return;
        }

        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: prevJunction.intersections.map((intersection, i) => {
                if (i === intersectionIndex) {
                    return {
                        ...intersection,
                        exitConfig: intersection.exitConfig.map((exit, j) =>
                            j === exitIndex ? { ...exit, exitLength: newExitLength } : exit
                        ),
                    };
                }
                return intersection;
            }),
        }));
    };

    return (
        <div
            style={{
                position: "absolute",
                top: 10,
                left: 10,
                padding: 10,
                background: "rgba(0,0,0,0.7)",
                color: "white",
                borderRadius: 8,
                maxHeight: "40vh",
                overflowY: "auto",
                fontFamily: "sans-serif",
                minWidth: 400,
            }}
        >
            <h1>Junction Debug Panel</h1>
            <h2>Intersections</h2>

            {junction.intersections.map((intersection, intersectionIndex) => {

                return (
                    <div key={`intersection-${intersectionIndex}`} style={{ marginBottom: "1rem" }}>
                        <h3>{`Intersection #${intersectionIndex}`}</h3>

                        {/* Intersection Config */}
                        <h4>Config</h4>
                        <span># Exit: </span>
                        <input
                            type="number"
                            min={2}
                            value={intersection.numExits}
                            onChange={(e) => handleExitNumChange(intersectionIndex, Number(e.target.value))}
                        />

                        {/* Intersection Structure */}

                        <h4>Structure</h4>

                        {intersection.exitConfig.map((exitConfig: ExitConfig, exitIndex: number) => {
                            

                            return (
                                <div key={`intersection-${intersectionIndex}-exit-${exitIndex}`}>
                                    <h3>Exit {exitIndex}</h3>
                                    <span># Lanes: </span>
                                    <input
                                        type="number"
                                        min={2}
                                        value={exitConfig.laneCount}
                                        onChange={(e) => handleLaneNumChange(intersectionIndex, exitIndex, Number(e.target.value))}
                                    />
                                    <span>Exit length: </span>
                                    <input
                                        type="number"
                                        min={10}
                                        value={exitConfig.exitLength}
                                        onChange={(e) => handleExitLengthChange(intersectionIndex, exitIndex, Number(e.target.value))}
                                    />
                                </div>
                            );
                        })}

                    </div>
                );
            })}
        </div>
    );
};