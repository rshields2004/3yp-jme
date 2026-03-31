/**
 * useTutorial.ts
 *
 * Custom hook that drives an interactive step-by-step tutorial overlay.
 * Tracks the current step, highlights the target element, and supports
 * manual or auto-advance on user interaction.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { TUTORIAL_STEPS, TutorialStep } from "../includes/tutorialSteps";
import { TUTORIAL_STORAGE_KEY, TUTORIAL_HIGHLIGHT_PADDING } from "../includes/constants";

/**
 * Shallow equality check for two DOMRects (within 1 px tolerance).
 *
 * @param a - first angle in radians
 * @param b - second angle in radians
 * @returns `true` if the condition holds
 */
const rectsEqual = (a: DOMRect | null, b: DOMRect | null): boolean => {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
        Math.abs(a.x - b.x) < 1 &&
        Math.abs(a.y - b.y) < 1 &&
        Math.abs(a.width - b.width) < 1 &&
        Math.abs(a.height - b.height) < 1
    );
};

export type UseTutorialReturn = {
    isActive: boolean;
    currentStep: TutorialStep | null;
    stepIndex: number;
    highlightRect: DOMRect | null;
    totalSteps: number;
    start: () => void;
    next: () => void;
    skip: () => void;
    advanceIfMatch: (action: string) => void;
};

/**
 * Hook providing interactive tutorial state and navigation controls.
 * @returns tutorial state, navigation functions, and highlight rect
 */
export const useTutorial = (): UseTutorialReturn => {
    const [isActive, setIsActive] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
    const lastRectRef = useRef<DOMRect | null>(null);

    const currentStep = isActive ? TUTORIAL_STEPS[stepIndex] ?? null : null;

    useEffect(() => {
        if (!currentStep?.target) {
            setHighlightRect(null);
            lastRectRef.current = null;
            return;
        }

        const updateRect = () => {
            const el = document.querySelector<HTMLElement>(currentStep.target);
            if (el) {
                const rect = el.getBoundingClientRect();
                const next = new DOMRect(
                    rect.left - TUTORIAL_HIGHLIGHT_PADDING,
                    rect.top - TUTORIAL_HIGHLIGHT_PADDING,
                    rect.width + TUTORIAL_HIGHLIGHT_PADDING * 2,
                    rect.height + TUTORIAL_HIGHLIGHT_PADDING * 2,
                );
                if (!rectsEqual(next, lastRectRef.current)) {
                    lastRectRef.current = next;
                    setHighlightRect(next);
                }
            } else {
                if (lastRectRef.current !== null) {
                    lastRectRef.current = null;
                    setHighlightRect(null);
                }
            }
        };

        updateRect();
        // Re-measure periodically in case the element appears after a state change
        const interval = setInterval(updateRect, 300);
        window.addEventListener("resize", updateRect);
        window.addEventListener("scroll", updateRect, true);

        return () => {
            clearInterval(interval);
            window.removeEventListener("resize", updateRect);
            window.removeEventListener("scroll", updateRect, true);
        };
    }, [currentStep]);

    const start = useCallback(() => {
        setStepIndex(0);
        setIsActive(true);
    }, []);

    const next = useCallback(() => {
        if (stepIndex >= TUTORIAL_STEPS.length - 1) {
            setIsActive(false);
            localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
        } else {
            setStepIndex(i => i + 1);
        }
    }, [stepIndex]);

    // Auto-advance on click / dblclick: when the user interacts with the current step's target
    useEffect(() => {
        if (!currentStep?.autoAdvance) return;
        const action = currentStep.action;
        if (action !== "click" && action !== "dblclick") return;

        const advance = () => {
            setTimeout(() => setStepIndex(i => {
                const nextIdx = i + 1;
                if (nextIdx >= TUTORIAL_STEPS.length) {
                    setIsActive(false);
                    localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
                    return i;
                }
                return nextIdx;
            }), 150);
        };

        const handler = (e: MouseEvent) => {
            const target = currentStep.target;
            if (!target) return;
            const el = document.querySelector<HTMLElement>(target);
            if (el && (el === e.target || el.contains(e.target as Node))) {
                advance();
            }
        };

        const eventName = action === "dblclick" ? "dblclick" : "click";
        document.addEventListener(eventName, handler, true);
        return () => document.removeEventListener(eventName, handler, true);
    }, [currentStep]);

    const skip = useCallback(() => {
        setIsActive(false);
        localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
    }, []);

    const advanceIfMatch = useCallback(
        (action: string) => {
            if (currentStep?.autoAdvance && currentStep.action === action) {
                next();
            }
        },
        [currentStep, next],
    );

    return {
        isActive,
        currentStep,
        stepIndex,
        highlightRect,
        totalSteps: TUTORIAL_STEPS.length,
        start,
        next,
        skip,
        advanceIfMatch,
    };
};