"use client";

import { useJModellerContext } from "../context/JModellerContext";
import { defaultIntersection } from "../includes/defaults";
import { Exit, LaneLine } from "../includes/types";
import * as THREE from "three";

export default function DebugPanel() {
    const { junction, setJunction } = useJModellerContext();


    const handleExitNumChange = (intersectionIndex: number, newExitNum: number) => {
        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: prevJunction.intersections.map((intersection, index) => {
                if (index === intersectionIndex) {
                    return {
                        ...intersection,
                        intersectionConfig: {
                            ...intersection.intersectionConfig,
                            numExits: newExitNum,
                            exitConfig: Array.from({ length: newExitNum }, () => ({
                                laneCount: 2,
                                laneWidth: 1.5,
                                exitLength: 40,
                            })),
                        },
                    };
                }
                return intersection;
            }),
        }));
    };

    const handleLaneNumChange = (intersectionIndex: number, exitIndex: number, newLaneNum: number) => {
        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: prevJunction.intersections.map((intersection, i) => {
                if (i === intersectionIndex) {
                    return {
                        ...intersection,
                        intersectionConfig: {
                            ...intersection.intersectionConfig,
                            exitConfig: intersection.intersectionConfig.exitConfig.map(
                                (exit, j) => {
                                    if (j === exitIndex) {
                                        return {
                                            ...exit,
                                            laneCount: newLaneNum, // update the lane count
                                        };
                                    }
                                    return exit;
                                }
                            ),
                        },
                    };
                }
                return intersection;
            }),
        }));
    };

    const handleAddIntersection = () => {
        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: [
                ...prevJunction.intersections,
                defaultIntersection
            ]
        }))
    };

    return (
        <>
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
                    const { intersectionConfig, intersectionStructure } = intersection;

                    return (
                        <div key={`intersection-${intersectionIndex}`} style={{ marginBottom: "1rem" }}>
                            <h3>{`Intersection #${intersectionIndex}`}</h3>

                            {/* Intersection Config */}
                            <h4>Config</h4>
                            <span># Exit: </span><input
                                type="number"
                                value={junction.intersections[intersectionIndex].intersectionConfig.numExits}
                                onChange={(e) => handleExitNumChange(intersectionIndex, Number(e.target.value))}
                            />


                            {/* Intersection Structure */}
                            {intersectionStructure && (
                                <>
                                    <h4>Structure</h4>

                                    {intersectionStructure.exitInfo.map((_: Exit, exitIndex: number) => (
                                        <div key={`intersection-${intersectionIndex}-exit-${exitIndex}`}>
                                            <h3>Exit {exitIndex}</h3>
                                            <span># Lanes: </span>
                                            <input
                                                type="number"
                                                value={junction.intersections[intersectionIndex].intersectionConfig.exitConfig[exitIndex].laneCount}
                                                onChange={(e) => handleLaneNumChange(intersectionIndex, exitIndex, Number(e.target.value))}
                                            />
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
            <div
                style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
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
                <h1>Add</h1>
                <input
                    type="button"
                    value="Add Intersection"
                    onClick={() => handleAddIntersection()}
                />
            </div>
        </>
    );
};