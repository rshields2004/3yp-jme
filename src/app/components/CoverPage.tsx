"use client";

import { useEffect, useState } from "react";
import { usePeer } from "../context/PeerContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Settings2 } from "lucide-react";
import { loadSaveFromFile, SaveFile } from "../includes/saveLoad";

type CoverPageProps = {
    onContinueAction: () => void;
    initialSessionCode?: string;
    onLoadSaveAction: (save: SaveFile) => void;
};

export default function CoverPage({ onContinueAction, initialSessionCode = "", onLoadSaveAction }: CoverPageProps) {
    const [joinCode, setJoinCode] = useState<string>(initialSessionCode);
    const [mode, setMode] = useState<"idle" | "join">(initialSessionCode ? "join" : "idle");
    const { joinHost, isConnecting, connectionError, connections } = usePeer();
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        if (initialSessionCode) {
            setJoinCode(initialSessionCode);
            setMode("join");
            joinHost(initialSessionCode);
        }
    }, [initialSessionCode]);

    

    const handleJoin = () => {
        if (!joinCode.trim()) return;
        joinHost(joinCode.trim());
    };

    useEffect(() => {
        if (connectionError) {
            const url = new URL(window.location.href);
            url.searchParams.delete("s");
            window.history.replaceState(null, "", url.toString());
        }
    }, [connectionError]);

    const isConnected = connections.length > 0;

    useEffect(() => {
        if (isConnected) {
            onContinueAction();
        }
    }, [isConnected]);



    const handleLoadSave = async () => {
        setLoadError(null);
        try {
            const save = await loadSaveFromFile();
            onLoadSaveAction(save);
        }
        catch {
            setLoadError("Invalid or unreadable save file");
        }
    };


    return (
        <div className="fixed inset-0 bg-[#080808] flex flex-col items-center justify-center" style={{ zIndex: 100, fontFamily: "var(--font-mono), 'Courier New', monospace", overflow: "hidden" }}>
            {/* Grid background */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    backgroundImage: `
                        linear-gradient(rgba(161,161,170,0.04) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(161,161,170,0.04) 1px, transparent 1px)
                    `,
                    backgroundSize: "40px 40px",
                }}
            />

            {/* Corner accents */}
            {([
                { top: 24, left: 24, borderTop: "1px solid", borderLeft: "1px solid" },
                { top: 24, right: 24, borderTop: "1px solid", borderRight: "1px solid" },
                { bottom: 24, left: 24, borderBottom: "1px solid", borderLeft: "1px solid" },
                { bottom: 24, right: 24, borderBottom: "1px solid", borderRight: "1px solid" },
            ] as React.CSSProperties[]).map((style, i) => (
                <div
                    key={i}
                    className="absolute w-8 h-8"
                    style={{ ...style, borderColor: "rgba(240,240,240,0.57)" }}
                />
            ))}

            {/* Content */}
            <div className="relative flex flex-col items-center max-w-[480px] w-full px-6">
                {/* Label */}
                <div className="text-[11px] tracking-[0.25em] text-zinc-400/60 mb-4 uppercase">
                    Traffic Simulation Platform
                </div>

                {/* Title */}
                <h1 className="text-[clamp(42px,8vw,72px)] font-bold text-white/95 m-0 tracking-tight leading-none text-center">
                    JME
                </h1>

                <div className="text-[13px] text-white/25 mt-2.5 mb-14 tracking-[0.08em] text-center">
                    Junction Modeller Expanded
                </div>

                {/* Divider */}
                <Separator className="mb-12 bg-white/[0.08]" />

                {mode === "idle" && (
                    <div className="flex flex-col gap-3 w-full">
                        <Button
                            onClick={onContinueAction}
                            variant="outline"
                            className="w-full py-3.5 h-auto text-[13px] tracking-[0.12em] uppercase bg-white/[0.08] border-white/25 text-zinc-200 hover:bg-white/[0.14] hover:border-white/50 hover:text-white transition-all duration-150"
                        >
                            New Session
                        </Button>


                        <Button
                            onClick={handleLoadSave}
                            variant="ghost"
                            className="w-full py-3.5 h-auto text-[13px] tracking-[0.12em] uppercase border border-white/[0.1] text-white/50 hover:border-white/25 hover:text-white/80 hover:bg-transparent transition-all duration-150"
                        >
                            Load Save
                        </Button>
                        <Button
                            onClick={() => setMode("join")}
                            variant="ghost"
                            className="w-full py-3.5 h-auto text-[13px] tracking-[0.12em] uppercase border border-white/[0.1] text-white/50 hover:border-white/25 hover:text-white/80 hover:bg-transparent transition-all duration-150"
                        >
                            Join Session
                        </Button>
                        {loadError && (
                            <p className="text-xs text-red-400/80 text-center tracking-wide m-0">{loadError}</p>
                        )}
                    </div>
                )}

                {mode === "join" && (
                    <div className="flex flex-col gap-3 w-full">
                        <div className="text-[11px] tracking-[0.15em] text-white/30 uppercase mb-1">
                            Enter Host Code
                        </div>

                        <Input
                            value={joinCode}
                            onChange={e => setJoinCode(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && !isConnected && handleJoin()}
                            placeholder="xxxxxx"
                            disabled={isConnecting || isConnected}
                            className={cn(
                                "bg-white/[0.04] border-white/[0.1] text-white placeholder:text-white/20 focus-visible:ring-white/20 text-[14px] tracking-[0.1em]",
                                connectionError && "border-red-500/50"
                            )}
                        />

                        {/* Status */}
                        {isConnecting && (
                            <p className="text-xs text-zinc-400/70 tracking-[0.08em] m-0">Connecting...</p>
                        )}
                        {connectionError && (
                            <p className="text-xs text-red-400/80 tracking-[0.05em] m-0">{connectionError}</p>
                        )}
                        {isConnected && (
                            <p className="text-xs text-zinc-200/90 tracking-[0.08em] m-0">✓ Connected to host</p>
                        )}

                        {/* Loading bar while connecting */}
                        <div className={cn("text-[13px] mb-1.5 flex items-center gap-2", connectionError ? "text-red-400" : isConnected ? "text-white" : "text-white/75")}>
                            {isConnecting && !isConnected && (
                                <Settings2
                                    size={13}
                                    className="animate-spin flex-shrink-0"
                                />
                            )}
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="ghost"
                                onClick={() => { setMode("idle"); setJoinCode(""); }}
                                className="flex-1 border border-white/[0.1] text-white/40 hover:text-white/70 hover:bg-white/[0.04] text-xs tracking-[0.1em] uppercase"
                            >
                                Back
                            </Button>

                            
                            <Button
                                onClick={handleJoin}
                                disabled={isConnecting || !joinCode.trim()}
                                variant="outline"
                                className={cn(
                                    "flex-[2] text-xs tracking-[0.1em] uppercase transition-all duration-150",
                                    joinCode.trim()
                                        ? "bg-white/[0.08] border-white/25 text-zinc-200 hover:bg-white/[0.14] hover:border-white/50 hover:text-white"
                                        : "bg-transparent border-white/[0.06] text-white/20"
                                )}
                            >
                                {isConnecting ? "Connecting..." : "Connect"}
                            </Button>
  

        
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
