import { expect, it } from "vitest";
import { uploaderLabel } from "./uploaderLabel";

it("credits the uploader even when AI processes the file", () => {
  expect(uploaderLabel({ person_id: "person", via: "ui", actor: "ai" }, "Jayrr")).toBe("Jayrr");
});
it("does not flash AI while the person's profile loads", () => {
  expect(uploaderLabel({ person_id: "person", via: "ui", actor: "ai" }, null)).toBeNull();
});
it("distinguishes API submissions from autonomous AI sources", () => {
  expect(uploaderLabel({ person_id: null, via: "api", actor: "ai" }, null)).toBe("API key");
  expect(uploaderLabel({ person_id: null, via: null, actor: "ai" }, null)).toBe("AI");
});
it("names an agent key, not the owner it acts as", () => {
  expect(uploaderLabel({ person_id: "person", via: "agent", actor: "ai" }, "Jayrr")).toBe("Agent key");
});
