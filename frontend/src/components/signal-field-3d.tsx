"use client";

import * as React from "react";
import * as THREE from "three";
import { SignalField } from "@/components/signal-field";
import { cn } from "@/lib/utils";

function dotTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.85)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const VERTEX = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vHeight;
  varying float vDepth;

  float wave(vec2 p, float t) {
    return sin(p.x * 0.22 + t * 0.32) * 0.85
         + sin(p.y * 0.30 - t * 0.20) * 0.55
         + sin((p.x + p.y) * 0.11 + t * 0.14) * 0.50;
  }

  void main() {
    vUv = uv;
    vec3 p = position;
    float h = wave(p.xy, uTime);
    p.z += h;
    vHeight = h;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uSignal;
  uniform vec3 uWatch;
  varying vec2 vUv;
  varying float vHeight;
  varying float vDepth;

  float grid(vec2 uv, float scale, float width) {
    vec2 coord = uv * scale;
    vec2 w = fwidth(coord);
    vec2 g = abs(fract(coord) - 0.5) / max(w, vec2(0.0001));
    float line = 1.0 - min(min(g.x, g.y) / width, 1.0);
    return line;
  }

  void main() {
    float fade = smoothstep(120.0, 10.0, vDepth);
    float minor = grid(vUv, 56.0, 1.0);
    float major = grid(vUv, 7.0, 3.0);
    float scanPos = fract(uTime * 0.045);
    float scan = exp(-pow((vUv.y - scanPos) * 26.0, 2.0));
    float crest = smoothstep(0.35, 1.35, vHeight);

    vec3 col = mix(uSignal, uWatch, crest * 0.8);
    float glow = minor * 0.30 + major * 0.95 + scan * 0.55;
    float alpha = glow * fade;

    gl_FragColor = vec4(col, alpha);
  }
`;

export function SignalField3D({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      queueMicrotask(() => setFallback(true));
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05080a, 0.016);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 280);
    camera.position.set(0, 3.1, 11.5);
    camera.lookAt(0, 0.9, -14);

    const uniforms = {
      uTime: { value: reduced ? 14 : 0 },
      uSignal: { value: new THREE.Color("#3fe3c1") },
      uWatch: { value: new THREE.Color("#f3b456") },
    };

    const geometry = new THREE.PlaneGeometry(200, 200, 190, 190);
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const terrain = new THREE.Mesh(geometry, material);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = -1.6;
    terrain.position.z = -22;
    scene.add(terrain);

    const COUNT = window.innerWidth < 720 ? 320 : 720;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 90;
      positions[i * 3 + 1] = Math.random() * 14 - 0.5;
      positions[i * 3 + 2] = -6 - Math.random() * 75;
    }
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pointTexture = dotTexture();
    const pointMaterial = new THREE.PointsMaterial({
      color: 0x3fe3c1,
      size: 0.14,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: pointTexture,
      alphaTest: 0.01,
      fog: true,
    });
    const motes = new THREE.Points(pointGeometry, pointMaterial);
    scene.add(motes);

    const ACCENT = window.innerWidth < 720 ? 60 : 140;
    const accentPositions = new Float32Array(ACCENT * 3);
    for (let i = 0; i < ACCENT; i += 1) {
      accentPositions[i * 3] = (Math.random() - 0.5) * 120;
      accentPositions[i * 3 + 1] = Math.random() * 18 + 1;
      accentPositions[i * 3 + 2] = -15 - Math.random() * 70;
    }
    const accentGeometry = new THREE.BufferGeometry();
    accentGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(accentPositions, 3),
    );
    const accentMaterial = new THREE.PointsMaterial({
      color: 0xf3b456,
      size: 0.22,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: pointTexture,
      alphaTest: 0.01,
      fog: true,
    });
    const accents = new THREE.Points(accentGeometry, accentMaterial);
    scene.add(accents);

    const resize = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(width, height, false);
      if (reduced) render(14);
    };

    const started = performance.now();
    let raf = 0;
    let visible = true;
    let running = true;

    function render(t: number) {
      uniforms.uTime.value = t;
      motes.rotation.y = t * 0.008;
      motes.position.y = Math.sin(t * 0.12) * 0.3;
      accents.rotation.y = -t * 0.012;
      accents.position.y = Math.sin(t * 0.09 + 2) * 0.4;
      camera.position.x = Math.sin(t * 0.055) * 0.9;
      camera.position.y = 3.1 + Math.sin(t * 0.09) * 0.22;
      camera.lookAt(0, 0.5, -7);
      renderer.render(scene, camera);
    }

    const frame = (now: number) => {
      if (!running) return;
      if (visible && !document.hidden) {
        render((now - started) / 1000);
      }
      raf = window.requestAnimationFrame(frame);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    intersection.observe(canvas);

    if (!reduced) raf = window.requestAnimationFrame(frame);

    return () => {
      running = false;
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      geometry.dispose();
      material.dispose();
      pointGeometry.dispose();
      pointMaterial.dispose();
      pointTexture.dispose();
      accentGeometry.dispose();
      accentMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  if (fallback) return <SignalField className={className} />;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("block h-full w-full", className)}
    />
  );
}
