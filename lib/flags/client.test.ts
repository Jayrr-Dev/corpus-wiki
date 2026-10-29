import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FeatureFlagsProvider, useFeatureFlag } from "./client";
import { defaultFeatureFlags, type FeatureFlagKey } from "./registry";

function Probe({ flag }: { flag: FeatureFlagKey }) {
  return createElement("span", null, useFeatureFlag(flag) ? "on" : "off");
}

it("is off outside the provider", () => {
  expect(renderToStaticMarkup(createElement(Probe, { flag: "billing" }))).toBe("<span>off</span>");
});

it("reads the flags the server handed down", () => {
  const flags = { ...defaultFeatureFlags(), gmail_import: true };
  const render = (flag: FeatureFlagKey) => renderToStaticMarkup(createElement(FeatureFlagsProvider, { flags }, createElement(Probe, { flag })));
  expect(render("gmail_import")).toBe("<span>on</span>");
  expect(render("billing")).toBe("<span>off</span>");
});

it("accepts only registered keys", () => {
  // @ts-expect-error: not a registered flag
  void useFeatureFlag.bind(null, "dark_launch");
});
