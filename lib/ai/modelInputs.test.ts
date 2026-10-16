import { describe, expect, it } from "vitest";
import { describeTypes, inputsFromModality, missingTypes, readsAll } from "./modelInputs";
import { ROLE_INPUTS } from "./roles";

describe("model inputs", () => {
  it("reads the data types from Token Factory's modality", () => {
    expect(inputsFromModality("text+image->text")).toEqual(["text", "image"]);
    expect(inputsFromModality("text->text")).toEqual(["text"]);
    expect(inputsFromModality(undefined)).toEqual(["text"]);
  });

  it("offers a role only models that read everything it sends", () => {
    expect(readsAll(["text"], ROLE_INPUTS.media_analyst)).toBe(false);
    expect(readsAll(["text", "image"], ROLE_INPUTS.media_analyst)).toBe(true);
    expect(readsAll(["text", "image"], ROLE_INPUTS.write_articles)).toBe(true);
    expect(readsAll(undefined, ROLE_INPUTS.write_articles)).toBe(true);
    expect(missingTypes(["text"], ROLE_INPUTS.media_analyst)).toEqual(["image"]);
  });

  it("names the types for people", () => {
    expect(describeTypes(["text", "image"])).toBe("Text, images");
  });
});
