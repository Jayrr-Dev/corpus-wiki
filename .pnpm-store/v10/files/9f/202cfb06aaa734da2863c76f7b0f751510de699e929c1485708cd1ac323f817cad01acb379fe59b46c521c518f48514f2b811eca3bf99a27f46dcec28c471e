import type { ShaderMotionParams } from '../shader-mount.js';
import { type ShaderSizingParams, type ShaderSizingUniforms } from '../shader-sizing.js';
export declare const paperTextureMeta: {
    readonly maxCrumpleCount: 15;
};
/**
 * Static paper-like texture built from a combination of grain, noise and multiple fold patterns.
 * Works as an image filter or as a standalone texture.
 *
 * Fragment shader uniforms:
 * - u_image (sampler2D): Optional source image texture
 * - u_isImage (bool): Whether a source image was provided
 * - u_imageAspectRatio (float): Aspect ratio of the source image
 * - u_colorBack (vec4): Color behind the paper sheet in RGBA
 * - u_colorPaper (vec4): Color of the paper sheet in RGBA
 * - u_colorShadow (vec4): Color of the patterns over the paper sheet in RGBA
 * - u_blending (float): Amount of image-to-paper blending, needs image (0 to 1)
 * - u_distortion (float): How much the image bends with the paper surface, needs image (-1 to 1)
 * - u_clip (bool): Cuts the paper sheet to the image frame, needs image
 * - u_angle (float): Direction the surface is lit from in degrees, also the roughness rows direction, needs crumples, wrinkles, folds, roughnessRows or drops > 0 (0 to 360)
 * - u_seed (float): Seed applied to every pattern (0 to 1000)
 * - u_roughness (float): Fine grain covering the surface evenly (0 to 1)
 * - u_roughnessSize (float): Scale of the roughness grain, needs roughness > 0 (0 to 1)
 * - u_roughnessRows (float): Lines the roughness up into stripes, 0 = even scatter, 1 = laid-paper rows, needs roughness > 0 (0 to 1)
 * - u_fiber (float): Curly thread-like noise covering the surface evenly (0 to 1)
 * - u_fiberSize (float): Scale of the fiber noise, needs fiber > 0 (0 to 1)
 * - u_folds (float): Straight vertical and horizontal fold lines producing ridges and valleys (0 to 1)
 * - u_foldSizeX (float): Size of the vertical folds, needs folds > 0 (0 to 1)
 * - u_foldSizeY (float): Size of the horizontal folds, needs folds > 0 (0 to 1)
 * - u_foldOffsetX (float): Shifts the vertical folds across the surface, needs folds > 0 (0 to 1)
 * - u_foldOffsetY (float): Shifts the horizontal folds across the surface, needs folds > 0 (0 to 1)
 * - u_wrinkles (float): Crumple-like facets repeating across the surface (0 to 1)
 * - u_wrinkleSize (float): Scale of the wrinkle facets, needs wrinkles > 0 (0 to 1)
 * - u_crumples (float): A set of irregular folding lines (0 to 1)
 * - u_crumpleCount (float): Number of facets in the crumple field, needs crumples > 0 (2 to 15)
 * - u_drops (float): Visibility of the speckle pattern, darkens the image instead of coloring it (0 to 1)
 * - u_noiseTexture (sampler2D): Pre-computed randomizer source texture
 *
 * Vertex shader outputs (used in fragment shader):
 * - v_imageUV (vec2): UV coordinates for sampling the source image, with fit, scale, rotation, and offset applied
 *
 * Vertex shader uniforms:
 * - u_resolution (vec2): Canvas resolution in pixels
 * - u_pixelRatio (float): Device pixel ratio
 * - u_originX (float): Reference point for positioning world width in the canvas (0 to 1)
 * - u_originY (float): Reference point for positioning world height in the canvas (0 to 1)
 * - u_fit (float): How to fit the rendered shader into the canvas dimensions (0 = none, 1 = contain, 2 = cover)
 * - u_scale (float): Overall zoom level of the graphics (0.01 to 4)
 * - u_rotation (float): Overall rotation angle of the graphics in degrees (0 to 360)
 * - u_offsetX (float): Horizontal offset of the graphics center (-1 to 1)
 * - u_offsetY (float): Vertical offset of the graphics center (-1 to 1)
 * - u_imageAspectRatio (float): Aspect ratio of the source image
 *
 */
export declare const paperTextureFragmentShader: string;
export interface PaperTextureUniforms extends ShaderSizingUniforms {
    u_image: HTMLImageElement | string | undefined;
    u_isImage: boolean;
    u_colorBack: [number, number, number, number];
    u_colorPaper: [number, number, number, number];
    u_colorShadow: [number, number, number, number];
    u_blending: number;
    u_distortion: number;
    u_clip: boolean;
    u_angle: number;
    u_seed: number;
    u_roughness: number;
    u_roughnessSize: number;
    u_roughnessRows: number;
    u_fiber: number;
    u_fiberSize: number;
    u_folds: number;
    u_foldSizeX: number;
    u_foldSizeY: number;
    u_foldOffsetX: number;
    u_foldOffsetY: number;
    u_wrinkles: number;
    u_wrinkleSize: number;
    u_crumples: number;
    u_crumpleCount: number;
    u_drops: number;
    u_noiseTexture?: HTMLImageElement;
}
export interface PaperTextureParams extends ShaderSizingParams, ShaderMotionParams {
    image?: HTMLImageElement | string;
    colorBack?: string;
    colorPaper?: string;
    colorShadow?: string;
    blending?: number;
    distortion?: number;
    clip?: boolean;
    angle?: number;
    seed?: number;
    roughness?: number;
    roughnessSize?: number;
    roughnessRows?: number;
    fiber?: number;
    fiberSize?: number;
    folds?: number;
    foldSizeX?: number;
    foldSizeY?: number;
    foldOffsetX?: number;
    foldOffsetY?: number;
    wrinkles?: number;
    wrinkleSize?: number;
    crumples?: number;
    crumpleCount?: number;
    drops?: number;
}
