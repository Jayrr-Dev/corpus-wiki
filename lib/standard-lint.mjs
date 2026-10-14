// @shadcn/lint rules for the Standard library (https://jayrr.dev).
//
// Add to eslint.config.mjs:
//
//   import { standardLint } from "./lib/standard-lint.mjs"
//   export default [...yourConfig, ...standardLint()]
//
// Then run `npx eslint .`. Needs @shadcn/lint and ESLint 9.30+.

import { plugin as shadcn } from "@shadcn/lint"

// Contracts match the resolved component name, and only the last matching
// contract applies, so keep the patterns disjoint.
export const containerContracts = [
  // Containers hold other content, so callers set their spacing. Frame styling
  // (border, rounding, background) goes on a wrapper.
  {
    pattern:
      "^(Stack|Masonry|InfiniteScroll|Reveal|Collapsible|CollapsibleContent|ContextMenuTrigger|ResizablePanelGroup|ScrollArea|MessageScroller|MessageScrollerContent|TabsContent|NavigationMenuList|FabStack|Dialslide|Sidebar(Header|Group|Menu|Footer))$",
    allow: ["layout", "spacing"],
  },
  // Boxes whose look is the caller's: Surface paints layers, AspectRatio and
  // Parallax frame media, and Draggable's itemClassName styles each item and
  // its drag overlay, which a wrapper can't reach.
  {
    pattern: "^(Surface|Parallax|ParallaxLayer|AspectRatio|Draggable)$",
    allow: ["layout", "spacing", "shape", "color", "effects"],
  },
  // Steps is laid out by the caller; StepIndicator and StepTitle keep their look.
  {
    pattern: "^(Steps|Step|StepTrigger)$",
    allow: ["layout", "spacing", "shape", "color", "effects", "motion"],
  },
  // A skeleton's shape is its point, and layer effects take their parent's.
  {
    pattern: "^(Skeleton|Distort|ColorGrade|Gradient|Pattern)$",
    allow: ["layout", "shape"],
  },
  // ProgressRing documents recoloring through --progress-ring-color.
  {
    pattern: "^ProgressRing$",
    allow: ["layout", "[--progress-ring-color:*]"],
  },
]

// Fields, selects and buttons share heights through their size prop so they
// line up in a row. Width and margin stay open. size-* isn't denied: entries
// match through variants, so it would also catch [&_svg]:size-4 on the icon.
export const controlContracts = [
  {
    pattern:
      "^(Button|Select|TextField|NumberInput|PhoneInput|AutocompleteInput|Search|DatePicker|TimePicker|Toggle)$",
    allow: ["layout"],
    deny: ["h-*", "min-h-*", "max-h-*"],
    message: {
      layout:
        '<{{component}}> sets its own height, so "{{className}}" is not allowed. Use its size prop, which keeps it in line with the fields and buttons beside it.',
    },
  },
]

/**
 * ESLint flat-config blocks for code that uses the Standard library.
 *
 * @param {object} [options]
 * @param {string | string[]} [options.ui] Import prefixes of your components.
 *   Standard installs to components/standard; add your ui alias if
 *   components.json doesn't already point at it.
 * @param {string[]} [options.files] Files that use the components.
 * @param {string[]} [options.componentFiles] The component directories. They
 *   style themselves, so only the theme rules run there.
 * @param {"error" | "warn"} [options.level] Severity for every rule.
 * @param {string} [options.note] Appended to every message, e.g. a link to
 *   your design rules.
 */
export function standardLint({
  ui = "@/components/standard",
  files = ["**/*.{js,jsx,ts,tsx}"],
  componentFiles = ["components/standard/**", "components/ui/**"],
  level = "error",
  note,
} = {}) {
  const settings = { shadcn: { ui, ...(note ? { note } : {}) } }

  return [
    {
      files,
      plugins: { shadcn },
      settings,
      rules: {
        "shadcn/no-restyle": [
          level,
          {
            allow: ["layout"],
            contracts: [...containerContracts, ...controlContracts],
          },
        ],
        // fill-none is valid Tailwind that the rule reads as a color.
        "shadcn/no-raw-colors": [level, { allow: ["fill-none"] }],
        // One-off sizes and positions are fine; off-scale type, color and
        // shape are not.
        "shadcn/no-arbitrary-values": [
          level,
          { allow: ["layout", "[--progress-ring-color:*]"] },
        ],
        "shadcn/no-inline-styles": "warn",
        "shadcn/no-unknown-classes": level,
        "shadcn/require-static-classes": level,
      },
    },
    {
      files: componentFiles,
      rules: {
        "shadcn/no-restyle": "off",
        "shadcn/no-arbitrary-values": "off",
        "shadcn/no-inline-styles": "off",
        "shadcn/require-static-classes": "off",
      },
    },
  ]
}
