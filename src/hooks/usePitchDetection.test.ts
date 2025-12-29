import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePitchDetection, type OctaveRange } from "./usePitchDetection";

vi.mock("aubiojs/build/aubio.esm.js", () => ({
  default: vi.fn(),
}));

describe("usePitchDetection", () => {
  it("resets state when the target changes from user input", () => {
    const onTargetChange = vi.fn();
    const octaveRange: OctaveRange = { start: 4, end: 4 };
    const { result } = renderHook(() =>
      usePitchDetection({
        targetNote: 60,
        octaveRange,
        onTargetChange,
      })
    );

    act(() => {
      result.current.setTargetFromUser(62, "idle");
    });

    expect(onTargetChange).toHaveBeenCalledWith(62);
    expect(result.current.status).toBe("idle");
    expect(result.current.ringDirection).toBe("neutral");
    expect(result.current.detectedNote).toBe("");
  });
});
