import { describe, expect, it } from "bun:test";

import { cubeTransform, faceLight, faceTransform, turnTo } from "./cube";

describe("the workspace cube", () => {
  describe("faces", () => {
    it("sit a half width out from the center, a quarter turn apart", () => {
      expect(faceTransform(1, 1000, "outside")).toBe(
        "rotateY(90deg) translateZ(500px)",
      );
    });

    it("face the center when the cube is seen from inside", () => {
      expect(faceTransform(1, 1000, "inside")).toBe(
        "rotateY(90deg) translateZ(-500px)",
      );
    });
  });

  describe("the cube", () => {
    it("puts the shown face in the page's plane", () => {
      expect(cubeTransform(-90, 1000, "outside")).toBe(
        "translateZ(-500px) rotateY(-90deg)",
      );
      expect(cubeTransform(-90, 1000, "inside")).toBe(
        "translateZ(500px) rotateY(-90deg)",
      );
    });

    it("turns the short way to a workspace", () => {
      expect(turnTo(0, 1)).toBe(-90);
      expect(turnTo(0, 3)).toBe(90);
      expect(turnTo(-270, 0)).toBe(-360);
    });
  });

  describe("light", () => {
    it("is full on the face toward the viewer and none on those beside it", () => {
      expect(faceLight(1, -90)).toBeCloseTo(1);
      expect(faceLight(0, -90)).toBeCloseTo(0);
    });

    it("is none on a face turned away", () => {
      expect(faceLight(3, -90)).toBe(0);
    });
  });
});
