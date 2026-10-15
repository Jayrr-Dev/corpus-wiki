import "server-only";

import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import {
  buildDescribeImageMessages,
  describeImageAnswerJsonSchema,
  describeImageAnswerSchema,
  describeImageAnswerToText,
  type ImageDescriber,
  requireDescribableImage,
  resolveVisionModel,
} from "./describeMedia";

// THE IMAGE DESCRIBER the app uses: the vision model on Token Factory, logged like every AI call.
// Null without a key (an image cannot be read then, and the Upload screen says so).
export function imageDescriberFrom(settings: TokenFactorySettings | null, env: NodeJS.ProcessEnv = process.env): ImageDescriber | null {
  if (!settings) return null;
  const vision = { ...settings, model: resolveVisionModel(env) };
  return async (image) => {
    requireDescribableImage(image);
    const answer = await chatJson(vision, {
      name: "describe_image",
      subject: image.fileName,
      schema: describeImageAnswerSchema,
      jsonSchema: describeImageAnswerJsonSchema,
      messages: buildDescribeImageMessages(image),
      maxTokens: 4_000,
    });
    return describeImageAnswerToText(answer.value);
  };
}
