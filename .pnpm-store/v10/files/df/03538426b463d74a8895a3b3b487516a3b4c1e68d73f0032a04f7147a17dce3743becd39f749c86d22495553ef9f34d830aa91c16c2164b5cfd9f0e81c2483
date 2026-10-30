import { type ShaderComponentProps } from '../shader-mount.js';
import { type ImageShaderPreset, type PaperTextureParams } from '@paper-design/shaders';
export interface PaperTextureProps extends ShaderComponentProps, PaperTextureParams {
    /** @deprecated use `fiberSize` instead */
    fiberScale?: number;
    /** @deprecated use `crumpleCount` instead */
    foldsNumber?: number;
}
type PaperTexturePreset = ImageShaderPreset<PaperTextureParams>;
export declare const defaultPreset: PaperTexturePreset;
export declare const creasedPreset: PaperTexturePreset;
export declare const spreadPreset: PaperTexturePreset;
export declare const flatPreset: PaperTexturePreset;
export declare const paperTexturePresets: PaperTexturePreset[];
export declare const PaperTexture: React.FC<PaperTextureProps>;
export {};
