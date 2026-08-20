import { Filter, GlProgram } from "pixi.js";
import type { Rgba } from "@motion/core";

// Standard PixiJS v8 default filter vertex shader (see defaultFilter.vert).
const VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uKeyColor;
uniform float uSimilarity;
uniform float uSmoothness;

void main() {
    vec4 color = texture(uTexture, vTextureCoord);
    float dist = length(color.rgb - uKeyColor);
    float alpha = smoothstep(uSimilarity - uSmoothness, uSimilarity + uSmoothness, dist);
    finalColor = vec4(color.rgb, color.a * alpha);
}
`;

/**
 * Pixels within `similarity - smoothness` of the key color become fully
 * transparent; beyond `similarity + smoothness` they stay opaque.
 * similarity: 0..1 distance threshold. smoothness: 0..1 transition band.
 */
export function makeChromaKeyFilter(color: Rgba, similarity: number, smoothness: number): Filter {
  return new Filter({
    glProgram: new GlProgram({
      vertex: VERTEX,
      fragment: FRAGMENT,
    }),
    resources: {
      uKeyColor: { value: [color.r, color.g, color.b], type: "vec3" },
      uSimilarity: { value: similarity, type: "f32" },
      uSmoothness: { value: smoothness, type: "f32" },
    },
    padding: 2,
  });
}
