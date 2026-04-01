/**
 * TutorialOverlay.tsx
 *
 * Full-screen tutorial overlay with spotlight highlighting, tooltip
 * positioning, and step-by-step navigation controls.
 */

"use client";

import React, { CSSProperties, FC, useRef, useEffect, useState } from "react";
import { TutorialStep, TooltipPosition } from "../includes/tutorialSteps";
import { TOOLTIP_GAP, TOOLTIP_WIDTH, VIEWPORT_MARGIN } from "../includes/constants";

/**
 * SVG-based spotlight overlay that dims the viewport except for the highlighted element region.
 *
 * @param highlightRect - bounding rect of the highlighted element
 * @returns the rendered spotlight overlay
 */
const TutorialSpotlight: FC<{ highlightRect: DOMRect | null }> = ({ highlightRect }) => (
    <svg
        style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 9998,
            pointerEvents: "none",
        }}
    >
        <defs>
            <mask id="tutorial-spotlight-mask">
                <rect width="100%" height="100%" fill="white" />
                {highlightRect && (
                    <rect
                        x={highlightRect.left}
                        y={highlightRect.top}
                        width={highlightRect.width}
                        height={highlightRect.height}
                        rx={6}
                        fill="black"
                        style={{ transition: "all 0.25s ease" }}
                    />
                )}
            </mask>
        </defs>
        <rect
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.55)"
            mask="url(#tutorial-spotlight-mask)"
        />
    </svg>
);

/**
 * Compute absolute CSS positioning for the tutorial tooltip
 * based on the desired placement and the highlighted element's rect.
 * @param position - desired tooltip placement relative to the highlight
 * @param rect - bounding rect of the highlighted element (null if none)
 * @returns CSSProperties for the tooltip container
 */
const getTooltipStyle = (position: TooltipPosition, rect: DOMRect | null): CSSProperties => {
    if (position === "top-right") {
        return { top: TOOLTIP_GAP, right: TOOLTIP_GAP };
    }
    if (!rect || position === "center") {
        return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    switch (position) {
        case "bottom":
            return { top: rect.bottom + TOOLTIP_GAP, left: rect.left };
        case "top":
            return { top: rect.top - TOOLTIP_GAP, left: rect.left, transform: "translateY(-100%)" };
        case "right":
            return { top: rect.top, left: rect.right + TOOLTIP_GAP };
        case "left":
            return { top: rect.top, left: rect.left - TOOLTIP_WIDTH - TOOLTIP_GAP };
        default:
            return { top: rect.bottom + TOOLTIP_GAP, left: rect.left };
    }
}

/**
 * Floating tooltip card that displays the current tutorial step's content, with navigation and skip controls.
 */
const TutorialTooltip: FC<{
    step: TutorialStep;
    stepIndex: number;
    totalSteps: number;
    highlightRect: DOMRect | null;
    onNext: () => void;
    onSkip: () => void;
}> = ({ step, stepIndex, totalSteps, highlightRect, onNext, onSkip }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [clamped, setClamped] = useState<CSSProperties>({});

    // Clamp the tooltip position so it stays within the viewport margins
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const fix: CSSProperties = {};
        if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
            fix.left = window.innerWidth - VIEWPORT_MARGIN - rect.width;
        }
        if (rect.left < VIEWPORT_MARGIN) {
            fix.left = VIEWPORT_MARGIN;
        }
        if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
            fix.top = window.innerHeight - VIEWPORT_MARGIN - rect.height;
        }
        if (rect.top < VIEWPORT_MARGIN) {
            fix.top = VIEWPORT_MARGIN;
        }
        if (fix.left !== undefined || fix.top !== undefined) {
            fix.transform = "none";
            setClamped(fix);
        } else {
            setClamped({});
        }
    }, [step, highlightRect]);

    return (
    <div
        ref={ref}
        style={{
            position: "fixed",
            zIndex: 9999,
            width: TOOLTIP_WIDTH,
            background: "#18181b",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            padding: "18px 20px",
            ...getTooltipStyle(step.position, highlightRect),
            ...clamped,
        }}
    >
        {/* Progress dots */}
        <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
            {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                    key={i}
                    style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: i === stepIndex ? "#818CF8" : "#3f3f46",
                        transition: "background 0.2s",
                    }}
                />
            ))}
        </div>

        <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "#f5f5f5" }}>
            {step.title}
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#a1a1aa", lineHeight: 1.6 }}>
            {step.description}
        </p>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button
                onClick={onSkip}
                style={{
                    background: "none",
                    border: "none",
                    color: "#71717a",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: 0,
                }}
            >
                Skip tutorial
            </button>

            {!step.autoAdvance && (
                <button
                    onClick={onNext}
                    style={{
                        background: "#4F46E5",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        padding: "7px 14px",
                        fontSize: 13,
                        cursor: "pointer",
                        fontWeight: 500,
                    }}
                >
                    {step.nextLabel ?? "Next \u2192"}
                </button>
            )}
        </div>
    </div>
    );
};

// Overlay (public)
export interface TutorialOverlayProps {
    currentStep: TutorialStep | null;
    stepIndex: number;
    totalSteps: number;
    highlightRect: DOMRect | null;
    onNext: () => void;
    onSkip: () => void;
}

/**
 * Semi-transparent overlay with a spotlight cutout, tooltip, and navigation buttons for the guided tutorial.
 * @returns the rendered tutorial overlay
 */
export const TutorialOverlay: FC<TutorialOverlayProps> = ({
    currentStep,
    stepIndex,
    totalSteps,
    highlightRect,
    onNext,
    onSkip,
}) => {
    if (!currentStep) return null;

    return (
        <>
            <TutorialSpotlight highlightRect={highlightRect} />
            <TutorialTooltip
                step={currentStep}
                stepIndex={stepIndex}
                totalSteps={totalSteps}
                highlightRect={highlightRect}
                onNext={onNext}
                onSkip={onSkip}
            />
        </>
    );
};
