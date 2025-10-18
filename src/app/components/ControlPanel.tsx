"use client";

import { useJunction } from "../context/JunctionContext";
import { LaneColour, LanePattern } from "../includes/types";

const lanePatterns: LanePattern[] = ["solid", "dashed"];
const laneColours: LaneColour[] = ["white", "green", "red"];

export default function ControlPanel() {
    const { junctionConfig, setJunctionConfig } = useJunction();

    return (
        <div style={{
            position: "absolute",
            top: 10,
            left: 10,
            padding: 10,
            background: "rgba(0,0,0,0.7)",
            color: "white",
            borderRadius: 8,
            maxHeight: "90vh",
            overflowY: "auto",
            fontFamily: "sans-serif",
        }}>
            
            {junctionConfig.map((exit, exitIdx) => (
                <div key={exitIdx}>
                    <p>{`Exit ${exitIdx + 1}`}</p>
                    {exit.lanes.map((lane, laneIdx) => (
                        <p key={laneIdx}>{`Lane ${laneIdx + 1}: ${lane.properties.pattern}, ${lane.properties.colour}, ${lane.properties.thickness}`}</p>
                    ))}
                </div>
            ))}
        </div>
    );
}
