/**
 * ASCIIBackground - Animated ASCII art background effect
 * Adapted from exa.ai/request-lens
 */
import { useEffect, useRef, useCallback } from "react";

const GLOBAL_OPACITY = 0.9;

export function ASCIIBackground({ className = "" }) {
  const canvasRef = useRef(null);
  const animationIdRef = useRef(0);
  const startTimeRef = useRef(0);

  const density = "▅▃▁?ab018:. ";

  const { sin, floor, PI } = Math;
  const TAU = PI * 2;

  const getASCIIChar = useCallback(
    (coord, context) => {
      const t = context.time * 0.0001;
      const m = Math.min(context.cols, context.rows);

      const st = {
        x: (2.0 * (coord.x - context.cols / 2)) / m,
        y: (2.0 * (coord.y - context.rows / 2)) / m,
      };

      const verticalFlow = st.y - t * 0.5;
      const wavePattern = sin(verticalFlow * 4) * 0.5 + 0.5;
      const horizontalVariation = sin(st.x * 3) * 0.1;

      const idx = floor((wavePattern + horizontalVariation) * density.length) % density.length;

      return density[Math.abs(idx)];
    },
    [density, sin, floor]
  );

  const lastFrameTimeRef = useRef(0);
  const TARGET_FPS = 20; // Throttle to 20fps for performance
  const FRAME_INTERVAL = 1000 / TARGET_FPS;

  const animate = useCallback(
    (timestamp) => {
      if (!canvasRef.current) return;

      // Throttle frame rate
      const elapsed = timestamp - lastFrameTimeRef.current;
      if (elapsed < FRAME_INTERVAL) {
        animationIdRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrameTimeRef.current = timestamp;

      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);

      const asciiBaseR = 231;
      const asciiBaseG = 235;
      const asciiBaseB = 237;

      const charSize = 6;
      const charSpacing = 7;
      const lineHeight = 6;
      const cols = Math.floor(rect.width / charSpacing);
      const rows = Math.floor(rect.height / lineHeight);

      const context = {
        time: timestamp - startTimeRef.current,
        cols,
        rows,
        aspect: rect.width / rect.height,
      };

      ctx.font = `${charSize}px monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const char = getASCIIChar({ x, y }, context);

          const normalizedY = y / rows;
          let opacity = 0.3;

          const topFadeZoneASCII = 0.15;
          let verticalFade = 1;

          if (normalizedY < topFadeZoneASCII) {
            verticalFade = normalizedY / topFadeZoneASCII;
          }

          opacity *= verticalFade;

          if (opacity > 0.025) {
            const verticalWaveFrequency = 3;
            const waveIntensity = sin(normalizedY * verticalWaveFrequency * TAU) * 0.5 + 0.5;

            const getGradientColor = (t) => {
              if (t <= 0.14) {
                const progress = t / 0.14;
                return {
                  r: 0 + (0 - 0) * progress,
                  g: 17 + (20 - 17) * progress,
                  b: 159 + (164 - 159) * progress,
                };
              } else if (t <= 0.29) {
                const progress = (t - 0.14) / (0.29 - 0.14);
                return {
                  r: 0 + (25 - 0) * progress,
                  g: 20 + (58 - 20) * progress,
                  b: 164 + (242 - 164) * progress,
                };
              } else if (t <= 0.41) {
                const progress = (t - 0.29) / (0.41 - 0.29);
                return {
                  r: 25 + (61 - 25) * progress,
                  g: 58 + (112 - 58) * progress,
                  b: 242 + (251 - 242) * progress,
                };
              } else if (t <= 0.53) {
                const progress = (t - 0.41) / (0.53 - 0.41);
                return {
                  r: 61 + (147 - 61) * progress,
                  g: 112 + (193 - 112) * progress,
                  b: 251 + (251 - 251) * progress,
                };
              } else {
                const progress = (t - 0.53) / (1 - 0.53);
                return {
                  r: 147 + (255 - 147) * progress,
                  g: 193 + (255 - 193) * progress,
                  b: 251 + (255 - 251) * progress,
                };
              }
            };

            const baseColor = { r: asciiBaseR, g: asciiBaseG, b: asciiBaseB };
            const waveColor = getGradientColor(waveIntensity);

            const colorBurn = (base, blend) => {
              const normalizedBase = base / 255;
              const normalizedBlend = blend / 255;

              if (normalizedBlend === 0) return 0;
              if (normalizedBlend === 1) return base;

              const result = 1 - (1 - normalizedBase) / normalizedBlend;
              return Math.max(0, Math.min(255, Math.round(result * 255)));
            };

            const blendStrength = 0.8;
            const burnedColor = {
              r: colorBurn(baseColor.r, waveColor.r),
              g: colorBurn(baseColor.g, waveColor.g),
              b: colorBurn(baseColor.b, waveColor.b),
            };

            const finalColor = {
              r: Math.round(baseColor.r + (burnedColor.r - baseColor.r) * blendStrength),
              g: Math.round(baseColor.g + (burnedColor.g - baseColor.g) * blendStrength),
              b: Math.round(baseColor.b + (burnedColor.b - baseColor.b) * blendStrength),
            };

            ctx.fillStyle = `rgba(${finalColor.r}, ${finalColor.g}, ${finalColor.b}, ${opacity})`;
            ctx.fillText(char, x * charSpacing, y * lineHeight);
          }
        }
      }

      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.restore();

      animationIdRef.current = requestAnimationFrame(animate);
    },
    [getASCIIChar, sin, TAU]
  );

  useEffect(() => {
    if (!canvasRef.current) return;

    animationIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, [animate]);

  useEffect(() => {
    const handleResize = () => {
      startTimeRef.current = 0;
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${className}`}
      style={{
        width: "100%",
        height: "100%",
        opacity: GLOBAL_OPACITY,
      }}
    />
  );
}

export default ASCIIBackground;
