"use client";

import { useState } from "react";
import { usePeer } from "../context/PeerContext";

type CoverPageProps = {
    onContinueAction: () => void;
};

export default function CoverPage({ onContinueAction }: CoverPageProps) {
    const [joinCode, setJoinCode] = useState("");
    const [mode, setMode] = useState<"idle" | "join">("idle");
    const { joinHost, isConnecting, connectionError, connections } = usePeer();

    const handleJoin = () => {
        if (!joinCode.trim()) return;
        joinHost(joinCode.trim());
    };

    // Once connected, allow proceeding
    const isConnected = connections.length > 0;

    return (
        <div style={{
            position: "fixed",
            inset: 0,
            background: "#080808",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            fontFamily: "var(--font-mono), 'Courier New', monospace",
            overflow: "hidden",
        }}>
            {/* Grid background */}
            <div style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `
                    linear-gradient(rgba(161,161,170,0.04) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(161,161,170,0.04) 1px, transparent 1px)
                `,
                backgroundSize: "40px 40px",
                pointerEvents: "none",
            }} />


            {/* Corner accents */}
            {[
                { top: 24, left: 24, borderTop: "1px solid", borderLeft: "1px solid" },
                { top: 24, right: 24, borderTop: "1px solid", borderRight: "1px solid" },
                { bottom: 24, left: 24, borderBottom: "1px solid", borderLeft: "1px solid" },
                { bottom: 24, right: 24, borderBottom: "1px solid", borderRight: "1px solid" },
            ].map((style, i) => (
                <div key={i} style={{
                    ...style,
                    position: "absolute",
                    width: 32,
                    height: 32,
                    borderColor: "#f0f0f091",
                }} />
            ))}

            {/* Content */}
            <div style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0,
                maxWidth: 480,
                width: "100%",
                padding: "0 24px",
            }}>
                {/* Label */}
                <div style={{
                    fontSize: 11,
                    letterSpacing: "0.25em",
                    color: "rgba(161,161,170,0.6)",
                    marginBottom: 16,
                    textTransform: "uppercase",
                }}>
                    Traffic Simulation Platform
                </div>

                {/* Title */}
                <h1 style={{
                    fontSize: "clamp(42px, 8vw, 72px)",
                    fontWeight: 700,
                    color: "#f0f0f0",
                    margin: 0,
                    letterSpacing: "-0.02em",
                    lineHeight: 1,
                    textAlign: "center",
                }}>
                    JME
                </h1>

                <div style={{
                    fontSize: 13,
                    color: "rgba(255,255,255,0.25)",
                    marginTop: 10,
                    marginBottom: 56,
                    letterSpacing: "0.08em",
                    textAlign: "center",
                }}>
                    Junction Modeller Expanded
                </div>

                {/* Divider */}
                <div style={{
                    width: "100%",
                    height: 1,
                    background: "linear-gradient(90deg, transparent, rgba(161,161,170,0.15), transparent)",
                    marginBottom: 48,
                }} />

                {mode === "idle" && (
                    <div style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        width: "100%",
                    }}>
                        <button
                            onClick={onContinueAction}
                            style={{
                                width: "100%",
                                padding: "14px 24px",
                                background: "rgba(161,161,170,0.1)",
                                border: "1px solid rgba(161,161,170,0.35)",
                                borderRadius: 6,
                                color: "rgb(212,212,216)",
                                fontSize: 13,
                                letterSpacing: "0.12em",
                                textTransform: "uppercase",
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "all 0.15s ease",
                            }}
                            onMouseEnter={e => {
                                (e.target as HTMLElement).style.background = "rgba(161,161,170,0.18)";
                                (e.target as HTMLElement).style.borderColor = "rgba(161,161,170,0.6)";
                            }}
                            onMouseLeave={e => {
                                (e.target as HTMLElement).style.background = "rgba(161,161,170,0.1)";
                                (e.target as HTMLElement).style.borderColor = "rgba(161,161,170,0.35)";
                            }}
                        >
                            New Session
                        </button>

                        <button
                            onClick={() => setMode("join")}
                            style={{
                                width: "100%",
                                padding: "14px 24px",
                                background: "transparent",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: 6,
                                color: "rgba(255,255,255,0.5)",
                                fontSize: 13,
                                letterSpacing: "0.12em",
                                textTransform: "uppercase",
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "all 0.15s ease",
                            }}
                            onMouseEnter={e => {
                                (e.target as HTMLElement).style.borderColor = "rgba(255,255,255,0.25)";
                                (e.target as HTMLElement).style.color = "rgba(255,255,255,0.8)";
                            }}
                            onMouseLeave={e => {
                                (e.target as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
                                (e.target as HTMLElement).style.color = "rgba(255,255,255,0.5)";
                            }}
                        >
                            Join Session
                        </button>
                    </div>
                )}

                {mode === "join" && (
                    <div style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        width: "100%",
                    }}>
                        <div style={{
                            fontSize: 11,
                            letterSpacing: "0.15em",
                            color: "rgba(255,255,255,0.3)",
                            textTransform: "uppercase",
                            marginBottom: 4,
                        }}>
                            Enter Host Code
                        </div>

                        <input
                            value={joinCode}
                            onChange={e => setJoinCode(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && !isConnected && handleJoin()}
                            placeholder="xxxxxx"
                            disabled={isConnecting || isConnected}
                            style={{
                                width: "100%",
                                padding: "12px 16px",
                                background: "rgba(255,255,255,0.04)",
                                border: `1px solid ${connectionError ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)"}`,
                                borderRadius: 6,
                                color: "#f0f0f0",
                                fontSize: 14,
                                letterSpacing: "0.1em",
                                fontFamily: "inherit",
                                outline: "none",
                                boxSizing: "border-box",
                            }}
                        />

                        {/* Status */}
                        {isConnecting && (
                            <div style={{ fontSize: 12, color: "rgba(161,161,170,0.7)", letterSpacing: "0.08em" }}>
                                Connecting...
                            </div>
                        )}
                        {connectionError && (
                            <div style={{ fontSize: 12, color: "rgba(239,68,68,0.8)", letterSpacing: "0.05em" }}>
                                {connectionError}
                            </div>
                        )}
                        {isConnected && (
                            <div style={{ fontSize: 12, color: "rgba(212,212,216,0.9)", letterSpacing: "0.08em" }}>
                                ✓ Connected to host
                            </div>
                        )}

                        <div style={{ display: "flex", gap: 8 }}>
                            <button
                                onClick={() => { setMode("idle"); setJoinCode(""); }}
                                style={{
                                    flex: 1,
                                    padding: "12px",
                                    background: "transparent",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: 6,
                                    color: "rgba(255,255,255,0.4)",
                                    fontSize: 12,
                                    letterSpacing: "0.1em",
                                    textTransform: "uppercase",
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                }}
                            >
                                Back
                            </button>

                            {!isConnected ? (
                                <button
                                    onClick={handleJoin}
                                    disabled={isConnecting || !joinCode.trim()}
                                    style={{
                                        flex: 2,
                                        padding: "12px",
                                        background: joinCode.trim() ? "rgba(161,161,170,0.1)" : "rgba(255,255,255,0.04)",
                                        border: `1px solid ${joinCode.trim() ? "rgba(161,161,170,0.35)" : "rgba(255,255,255,0.08)"}`,
                                        borderRadius: 6,
                                        color: joinCode.trim() ? "rgb(212,212,216)" : "rgba(255,255,255,0.2)",
                                        fontSize: 12,
                                        letterSpacing: "0.1em",
                                        textTransform: "uppercase",
                                        cursor: joinCode.trim() ? "pointer" : "not-allowed",
                                        fontFamily: "inherit",
                                        opacity: isConnecting ? 0.6 : 1,
                                    }}
                                >
                                    {isConnecting ? "Connecting..." : "Connect"}
                                </button>
                            ) : (
                                <button
                                    onClick={onContinueAction}
                                    style={{
                                        flex: 2,
                                        padding: "12px",
                                        background: "rgba(34,197,94,0.12)",
                                        border: "1px solid rgba(34,197,94,0.45)",
                                        borderRadius: 6,
                                        color: "rgb(134,239,172)",
                                        fontSize: 12,
                                        letterSpacing: "0.1em",
                                        textTransform: "uppercase",
                                        cursor: "pointer",
                                        fontFamily: "inherit",
                                    }}
                                >
                                    Enter →
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}