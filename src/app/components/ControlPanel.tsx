"use client";

import { useJunction } from "../context/JunctionContext";
import { defaultJunctionConfig } from "../includes/defaults";
import { ExitConfig } from "../includes/types";

export default function ControlPanel() {
    const { junctionConfig, setJunctionConfig, junctionStructure } = useJunction();

    const handleExitCountChange = (newNum: number) => {
        const currentExits = junctionConfig.exitConfig; // array of ExitConfig
        const currentNum = currentExits.length;

        let updatedExits: ExitConfig[] = [];

        if (newNum > currentNum) {
            // Add new exits
            const additionalExits = Array.from({ length: newNum - currentNum }, () => ({
                laneCount: 2,
                laneWidth: 1.5,
                exitLength: 400,
                stopLineOffset: 2,
            }));
            updatedExits = [...currentExits, ...additionalExits];
        } else {
            updatedExits = currentExits.slice(0, newNum);
        }

        setJunctionConfig({
            ...junctionConfig,
            numExits: newNum,
            exitConfig: updatedExits,
        });
    };

    const handleLaneCountChange = (exitIdx: number, newLaneCount: number) => {
        const updatedExitConfig = junctionConfig.exitConfig.map((exitCfg, idx) => {
            if (idx === exitIdx) {
                return {
                    ...exitCfg,
                    laneCount: newLaneCount,
                };
            }
            return exitCfg;
        });

        setJunctionConfig({
            ...junctionConfig,
            exitConfig: updatedExitConfig,
        });
    };

    const handleReset = () => {
        setJunctionConfig(defaultJunctionConfig);
    };

    const handleGlobalLaneCount = (newNum: number) => {
        const updatedExitConfig = junctionConfig.exitConfig.map((exitCfg, _) => {
            return {
                ...exitCfg,
                laneCount: newNum,
            };
        });

        setJunctionConfig({
            ...junctionConfig,
            exitConfig: updatedExitConfig,
        });
    };


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

            <h3>Exits</h3>
            <input
                type="button"
                value="Reset"
                onClick={() => handleReset()}
            />
            <label style={{ display: "block", marginBottom: 4 }}>
                Number of Exits: <strong>{junctionStructure.exitInfo.length}</strong>
            </label>
            <input
                type="number"
                min={2}
                max={100}
                value={junctionConfig.numExits}
                onChange={(e) => handleExitCountChange(Number(e.target.value))}
                style={{
                    width: "80%",
                    padding: "4px 6px",
                    background: "#222",
                    color: "white",
                    border: "1px solid #444",
                    borderRadius: 4,
                }}
            />
            <label style={{ display: "block", marginBottom: 4 }}>
                Global Lane Num: <strong>{Math.max(...junctionConfig.exitConfig.map(e => e.laneCount))}</strong>
            </label>
            <input
                type="number"
                min={2}
                step={1}
                max={100}
                value={Math.max(...junctionConfig.exitConfig.map(e => e.laneCount))}
                onChange={(e) => handleGlobalLaneCount(Number(e.target.value))}
                style={{
                    width: "80%",
                    padding: "4px 6px",
                    background: "#222",
                    color: "white",
                    border: "1px solid #444",
                    borderRadius: 4,
                }}
            />
            
            {junctionConfig.exitConfig.map((exitCfg, idx) => (
                <div
                    key={idx}
                    style={{
                        background: "rgba(255,255,255,0.05)",
                        padding: 8,
                        borderRadius: 6,
                        marginBottom: 8,
                    }}
                >
                    <strong>Exit {idx + 1}</strong>
                    <div style={{ marginTop: 6 }}>
                        <label style={{ display: "block", marginBottom: 4 }}>
                            Lane Count: <strong>{exitCfg.laneCount}</strong>
                        </label>
                        <input
                            type="number"
                            min={2}
                            max={100}
                            value={exitCfg.laneCount}
                            onChange={(e) =>
                                handleLaneCountChange(idx, Number(e.target.value))
                            }
                            style={{
                                width: "100%",
                                padding: "4px 6px",
                                background: "#222",
                                color: "white",
                                border: "1px solid #444",
                                borderRadius: 4,
                            }}
                        />
                    </div>
                </div>
            ))}
            
        </div>
    );
}
