precision highp float;

varying vec2 v_texCoord;

uniform sampler2D u_tile;
uniform sampler2D u_colormap;
uniform float u_powerMin;
uniform float u_powerMax;

void main() {
  float power = texture2D(u_tile, v_texCoord).r;

  // Normalize: inspectrum style (powerMax is the "bright" end, powerMin is "dark")
  float normalized = (power - u_powerMax) / (u_powerMin - u_powerMax);
  normalized = clamp(normalized, 0.0, 1.0);

  vec4 color = texture2D(u_colormap, vec2(normalized, 0.5));
  gl_FragColor = color;
}
