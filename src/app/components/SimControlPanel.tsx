 "use client";
 
import { useEffect, useRef, useState } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import { usePeer } from "../context/PeerContext";
import { NetMessage, SharedState } from "../includes/types/peer";

export default function SimControlPanel() {
    const { 
        isConfigConfirmed, 
        simIsRunning, 
        carsReady, 
        junction, 
        confirmConfig, 
        resetConfig, 
        startSim, 
        simIsPaused, 
        pauseSim, 
        resumeSim,
        haltSim,
        stats,
        setJunction,
        simConfig,
        setSimConfig,
    } = useJModellerContext();
 
    const {
        isHost,
        hostId,
        connections,
        createHost,
        joinHost,
        send,
        isConnecting,
        connectionError,
        connectedPeerIds
    } = usePeer();


    const [joinCode, setJoinCode] = useState('');

    // Always-fresh ref so the bound data handler never closes over stale functions.
    const clientHandlerRef = useRef<(data: unknown) => void>(null!);
    clientHandlerRef.current = (data: unknown) => {
        const msg = data as NetMessage;
        if (msg.type === "INIT_CONFIG") {
            setJunction(msg.appdata.junctionConfig);
            setSimConfig(msg.appdata.simulationConfig);
        }
        if (msg.type === "START")  { startSim(); }
        if (msg.type === "PAUSE")  { pauseSim(); }
        if (msg.type === "RESUME") { resumeSim(); }
        if (msg.type === "HALT")   { haltSim(); }
    };

    const buildSharedState = (): SharedState => ({
        junctionConfig: junction,
        simulationConfig: simConfig,
    });

    // Client message handler
    useEffect(() => {
        if (isHost) return;

        const conn = connections[0];
        if (!conn) return;

        // Stable wrapper that always delegates to the latest clientHandlerRef.
        const handler = (data: unknown) => clientHandlerRef.current(data);
        conn.on("data", handler);

        return () => {
            conn.off("data", handler);
        };
    }, [connections, isHost])


    useEffect(() => {

        if (!isHost) {
            return;
        }

        connections.forEach(conn => {
            if ((conn as any)._initSent) {
                return;
            }

            const sendInit = () => {
                conn.send({
                    type: "INIT_CONFIG",
                    appdata: buildSharedState(),
                });
                (conn as any)._initSent = true;
            };

            if (conn.open) {
                sendInit();
            } else {
                conn.on("open", sendInit);
            }
        });
    }, [connections, isHost])

    useEffect(() => {
        if (!isHost) return;
        send({ type: 'INIT_CONFIG', appdata: buildSharedState() });
    }, [junction, simConfig]);


    useEffect(() => {
        if (isHost || connections.length === 0) return;

        const interval = setInterval(() => {
            send({ type: "PING" });
        }, 3000);

        return () => clearInterval(interval);
    }, [isHost, connections.length, send]);

    return  (
        <div
            style={{
                position: "absolute",
                top: 10,
                right: 10,
                padding: 10,
                background: "rgba(0,0,0,0.7)",
                color: "white",
                borderRadius: 8,
                minWidth: 320,
                fontFamily: "system-ui, sans-serif"
            }}
        >
            <div style={{ marginBottom: 10 }}>
                {!isHost && !connections.length && (
                    <>
                        <button onClick={createHost}>Host Session</button>
                        <div style={{ marginTop: 10 }}>
                            <input
                                placeholder="Enter host code"
                                value={joinCode}
                                onChange={e => setJoinCode(e.target.value)}
                            />
                            <button onClick={() => joinHost(joinCode)}>Join</button>
                        </div>
                    </>
                )}
            </div>
            <div style={{ marginBottom: 10 }}>
                {isHost && (
                    <div style={{ marginBottom: 10 }}>
                        <p style={{ margin: "0 0 6px 0" }}>
                            <strong>Share this code:</strong><br />
                            <span style={{ 
                                fontFamily: "monospace", 
                                fontSize: 13,
                                background: "rgba(255,255,255,0.1)",
                                padding: "2px 6px",
                                borderRadius: 4
                            }}>
                                {hostId}
                            </span>
                        </p>

                        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
                            {connectedPeerIds.length === 0 
                                ? "No peers connected" 
                                : `${connectedPeerIds.length} peer${connectedPeerIds.length > 1 ? "s" : ""} connected`
                            }
                        </div>

                        {connectedPeerIds.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                {connectedPeerIds.map((peerId, i) => (
                                    <div key={peerId} style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        fontSize: 11,
                                        background: "rgba(255,255,255,0.08)",
                                        borderRadius: 4,
                                        padding: "3px 7px",
                                    }}>
                                        <div style={{
                                            width: 7,
                                            height: 7,
                                            borderRadius: "50%",
                                            background: "#4CAF50",
                                            flexShrink: 0
                                        }} />
                                        <span style={{ opacity: 0.6 }}>Peer {i + 1}</span>
                                        <span style={{ 
                                            marginLeft: "auto", 
                                            opacity: 0.35,
                                            fontFamily: "monospace",
                                            fontSize: 10
                                        }}>
                                            {peerId.slice(0, 8)}...
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {!isHost && connections.length > 0 && (
                    <p>Connected to host</p>
                )}

                {(() => {
                    let label = "No connection";
                    let barColor = "rgba(255,255,255,0.2)";
                    let barWidth = "100%";
                    let animated = false;

                    if (connectionError) {
                        label = connectionError;
                        barColor = "#e53935";
                    } 
                    else if (isConnecting) {
                        label = "Connecting...";
                        barColor = "#4CAF50";
                        animated = true;
                    } 
                    else if (connections.length > 0) {
                        label = "Connected";
                        barColor = "#4CAF50";
                    }

                    return (
                        <>
                            <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.8, color: connectionError ? "#ef9a9a" : "inherit" }}>
                                {label}
                            </div>
                            <div style={{
                                width: "100%",
                                height: 6,
                                background: "rgba(255,255,255,0.1)",
                                borderRadius: 3,
                                overflow: "hidden"
                            }}>
                                <div style={{
                                    width: barWidth,
                                    height: "100%",
                                    background: barColor,
                                    borderRadius: 3,
                                    transition: "background 0.3s ease",
                                    animation: animated ? "loadingPulse 1.5s ease-in-out infinite" : "none"
                                }} />
                            </div>
                        </>
                    );
                })()}
            </div>
            <h1 style={{ margin: "0 0 8px 0", fontSize: 18 }}>Simulation Control</h1>

            {/* Loading indicator */}
            <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.8 }}>
                    {carsReady ? "Car models loaded ✓" : "Loading car models..."}
                </div>
                <div style={{
                    width: "100%",
                    height: 6,
                    background: "rgba(255,255,255,0.2)",
                    borderRadius: 3,
                    overflow: "hidden"
                }}>
                    <div style={{
                        width: carsReady ? "100%" : "30%",
                        height: "100%",
                        background: carsReady 
                            ? "#4CAF50" 
                            : "linear-gradient(90deg, #4CAF50, #8BC34A)",
                        borderRadius: 3,
                        transition: carsReady ? "width 0.3s ease-out" : "none",
                        animation: carsReady ? "none" : "loadingPulse 1.5s ease-in-out infinite"
                    }} />
                </div>
                {!carsReady && (
                    <style>{`
                        @keyframes loadingPulse {
                            0%, 100% { width: 20%; margin-left: 0%; }
                            50% { width: 40%; margin-left: 60%; }
                        }
                    `}</style>
                )}
            </div>
            <fieldset
                style={{
                    fontFamily: "system-ui, sans-serif"
                }}
            >
                {!isConfigConfirmed && (
                    <>
                        <button 
                            disabled={simIsRunning || junction.junctionObjects.length === 0}
                            onClick={() => confirmConfig()}
                            style={{
                                background: junction.junctionObjects.length > 0 ? "#FFA500" : "#666",
                                fontWeight: "bold"
                            }}
                        >
                            Confirm Config
                        </button>
                        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, marginBottom: 8 }}>
                            Configure junctions, then confirm to set spawn rates
                        </div>
                    </>
                )}

                {isConfigConfirmed && !simIsRunning && (
                    <>
                        <button 
                            onClick={() => resetConfig()}
                            style={{ background: "#666", marginBottom: 8 }}
                        >
                            ← Back to Config
                        </button>
                        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
                            Select junctions to configure spawn rates
                        </div>
                    </>
                )}

                <button disabled={simIsRunning || !carsReady || !isConfigConfirmed} onClick={() => 
                            {  
                                send({ type: 'START' }); 
                                startSim();
                            }
                        }>
                    {!isConfigConfirmed ? "Confirm Config First" : carsReady ? "Start Simulation" : "Loading..."}
                </button>
                <br />
                <button disabled={!simIsRunning} onClick={() => 
                            { 
                                if (simIsPaused) {
                                    send({ type: 'RESUME' }); 
                                    resumeSim()
                                }
                                else {
                                    send({ type: 'PAUSE' }); 
                                    pauseSim();
                                }
                            }
                        }>
                    {simIsPaused ? "Resume Simulation" : "Pause Simulation"}
                </button>
                <br />
                <button disabled={!simIsRunning} onClick={() => {
                    send({ type: "HALT" });
                    haltSim();
                }}>
                    Stop Simulation
                </button>

                <hr style={{ margin: "10px 0", opacity: 0.3 }} />

                <h2 style={{ margin: "0 0 8px 0", fontSize: 14, opacity: 0.9 }}>
                    Global Stats
                </h2>

                <div style={{ fontSize: 13, lineHeight: 1.35 }}>
                    <div><b>Active:</b> {stats.active}</div>
                    <div><b>Spawn queue (total):</b> {stats.spawnQueue}</div>
                    {stats.spawnQueueByEntry && Object.keys(stats.spawnQueueByEntry).length > 0 && (
                        <div style={{ marginLeft: 12, fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                            {Object.entries(stats.spawnQueueByEntry)
                                .filter(([_, queue]) => queue > 0)
                                .map(([entryKey, queue]) => {
                                    // Parse the entry key to show junction + exit
                                    const parts = entryKey.split('-');
                                    const exitIndex = parts[parts.length - 1];
                                    const structureID = parts.slice(0, -1).join('-');
                                    const junctionObj = junction.junctionObjects.find(obj => obj.id === structureID);
                                    const junctionType = junctionObj?.type || 'junction';
                                    const shortId = structureID.slice(0, 6);
                                    return (
                                        <div key={entryKey}>
                                            • {junctionType} {shortId} Exit {exitIndex}: {queue}
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                    <div><b>Spawned:</b> {stats.spawned}</div>
                    <div><b>Completed:</b> {stats.completed}</div>
                    <div><b>Routes:</b> {stats.routes}</div>
                    <div><b>Elapsed Time:</b> {stats.elapsedTime.toFixed(1)}s</div>

                    <hr style={{ margin: "8px 0", opacity: 0.2 }} />

                    <div style={{ opacity: 0.9 }}>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                            Junctions ({stats.junctions.global.count})
                        </div>

                        <div>
                            <b>Approaching:</b> {stats.junctions.global.approaching}{" "}
                            <b>Waiting:</b> {stats.junctions.global.waiting}{" "}
                            <b>Inside:</b> {stats.junctions.global.inside}{" "}
                            <b>Exiting:</b> {stats.junctions.global.exiting}
                        </div>

                        <div>
                            <b>Entered:</b> {stats.junctions.global.entered}{" "}
                            <b>Exited:</b> {stats.junctions.global.exited}{" "}
                        </div>
                        
                        <div>
                            <b>Avg Wait Time:</b> {stats.junctions.global.avgWaitTime.toFixed(1)}s
                        </div>
                    </div>
                </div>
            </fieldset>
        </div>
     );
 }
 
 