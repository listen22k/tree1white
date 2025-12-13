import React, { useState, useMemo, useRef, useEffect, Suspense, useCallback } from 'react';
import './App.css';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { SpeedInsights } from "@vercel/speed-insights/react"; // Adjusted for Vite
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";


// --- 动态获取照片列表 (自动读取 src/assets/photos 下的所有 .jpg 文件) ---
// 使用 Vite 的 import.meta.glob 懒加载导入
const photoModules = import.meta.glob('/src/assets/photos/*.jpg', { eager: true, query: '?url', import: 'default' });
const bodyPhotoPaths: string[] = Object.values(photoModules) as string[];

// 如果没有照片，使用占位符
if (bodyPhotoPaths.length === 0) {
  console.warn("No photos found in src/assets/photos!");
}

// 预加载图片的工具函数
const preloadImages = (paths: string[]): Promise<void[]> => {
  return Promise.all(
    paths.map(path => new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve(); // 即使失败也继续
      img.src = path;
    }))
  );
};

// --- 视觉配置 ---
const CONFIG = {
  colors: {
    // 柔和薄荷绿系列
    mintGreen: '#B8E6D5',
    foliageBase: '#A8D5C5',
    // 柔和装饰色
    cream: '#FFF8E7',
    white: '#FFFFFF',
    lightPink: '#FFE4E1',
    lightBlue: '#E0F4FF',
    paleMint: '#D5F5E8',
    softGold: '#F5DEB3',
    // 文字和星星
    textColor: '#FFFFFF',
    starGold: '#F5DEB3',
    // 柔和灯光
    warmLight: '#FFF4E0',
    lights: ['#FFE4E1', '#E0F4FF', '#FFF8E7', '#D5F5E8'], // 柔和彩灯
    // 装饰球颜色池
    baubleColors: ['#FFF8E7', '#FFFFFF', '#FFE4E1', '#E0F4FF', '#D5F5E8', '#F5DEB3', '#B8E6D5'],
    // 兼容性颜色 (for other components)
    gold: '#F5DEB3',
    silver: '#E0F4FF',
    red: '#FFE4E1',
  },
  counts: {
    foliage: 15000,
    photos: bodyPhotoPaths.length,       // 动态使用照片真实数量
    baubles: 250,     // 装饰球数量 (稍微增加以填补空缺)
    elements: 150,    // 圣诞元素数量
    lights: 500       // 彩灯数量
  },
  tree: { height: 22, radius: 9 }, // 树体尺寸
};

const THEMES = {
  modern: {
    foliageBase: '#A8D5C5',
    baubleColors: ['#FFF8E7', '#FFFFFF', '#FFE4E1', '#E0F4FF', '#D5F5E8', '#F5DEB3', '#B8E6D5'],
    lights: ['#FFE4E1', '#E0F4FF', '#FFF8E7', '#D5F5E8'],
    starGold: '#F5DEB3',
    textColor: '#FFFFFF',
    warmLight: '#FFF4E0',
    flowerColorA: '#FFE4E1', // lightPink
    flowerColorB: '#FFFFFF'
  },
  classic: {
    foliageBase: '#004225', // Emerald
    baubleColors: ['#D32F2F', '#FFD700', '#ECEFF1', '#2E7D32', '#FFFFFF'], // Red, Gold, Silver, Green, White
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'], // RGBY
    starGold: '#FFD700',
    textColor: '#FFD700',
    warmLight: '#FFD54F',
    flowerColorA: '#D32F2F', // Red
    flowerColorB: '#FFD700'  // Gold
  },
  silverIce: {
    foliageBase: '#E8EEF2', // Shimmering Silver White
    baubleColors: ['#FFFFFF', '#D1E8F5', '#A4C8E0', '#C0C0C0', '#F0F8FF'],
    lights: ['#FFFFFF', '#E0FFFF', '#B0E0E6', '#F0FFFF'], // Cool whites and cyans
    starGold: '#E0E0E0', // Silver Star
    textColor: '#E0FFFF',
    warmLight: '#D0E0FF', // Cool Blue Light
    flowerColorA: '#A4C8E0',
    flowerColorB: '#FFFFFF'
  }
};

type ThemeType = typeof THEMES.modern | typeof THEMES.silverIce;

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.foliageBase), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h / 2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state, theme }: { state: 'CHAOS' | 'FORMED', theme: ThemeType }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = spherePoints[i * 3]; positions[i * 3 + 1] = spherePoints[i * 3 + 1]; positions[i * 3 + 2] = spherePoints[i * 3 + 2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i * 3] = tx; targetPositions[i * 3 + 1] = ty; targetPositions[i * 3 + 2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      materialRef.current.uColor.set(theme.foliageBase);
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Component: BaubleOrnaments (Pastel Spheres) ---
const BaubleOrnaments = ({ state, theme }: { state: 'CHAOS' | 'FORMED', theme: ThemeType }) => {
  const count = CONFIG.counts.baubles;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []); // Smaller sphere for baubles

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      // Adjust radius slightly for baubles to sit on the tree
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) * 0.9; // Slightly inside the foliage
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const colorIndex = Math.floor(Math.random() * 100);
      const scale = 0.5 + Math.random() * 0.5; // Random scale for variety
      const rotationSpeed = {
        x: (Math.random() - 0.5) * 0.5,
        y: (Math.random() - 0.5) * 0.5,
        z: (Math.random() - 0.5) * 0.5
      };

      return {
        chaosPos, targetPos, colorIndex, scale,
        currentPos: chaosPos.clone(),
        chaosRotation: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;

      objData.currentPos.lerp(target, delta * (isFormed ? 1.0 : 0.7)); // Faster formation for baubles
      mesh.position.copy(objData.currentPos);

      if (isFormed) {
        // Gentle wobble and rotation
        mesh.rotation.x += delta * objData.rotationSpeed.x * 0.5;
        mesh.rotation.y += delta * objData.rotationSpeed.y * 0.5;
        mesh.rotation.z += delta * objData.rotationSpeed.z * 0.5;

        const wobbleX = Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.02;
        const wobbleY = Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) * 0.02;
        mesh.position.x += wobbleX;
        mesh.position.y += wobbleY;
      } else {
        // Chaos rotation
        mesh.rotation.x += delta * objData.rotationSpeed.x;
        mesh.rotation.y += delta * objData.rotationSpeed.y;
        mesh.rotation.z += delta * objData.rotationSpeed.z;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        const color = theme.baubleColors[obj.colorIndex % theme.baubleColors.length];
        return (
          <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={state === 'CHAOS' ? obj.chaosRotation : [0, 0, 0]}>
            <meshStandardMaterial
              color={color}
              roughness={0.2}
              metalness={0.5}
              emissive={color}
              emissiveIntensity={0.3} // Subtle glow
            />
          </mesh>
        );
      })}
    </group>
  );
};

// --- Component: Photo Ornaments (Polaroid Photos) ---
const PhotoOrnaments = ({ state, photos, theme }: { state: 'CHAOS' | 'FORMED', photos: string[], theme: ThemeType }) => {
  // Load textures directly from the dynamic paths array
  const textures = useTexture(photos);
  const count = photos.length;
  const groupRef = useRef<THREE.Group>(null);

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const isBig = Math.random() < 0.15;
      const baseScale = isBig ? 2.0 : 0.7 + Math.random() * 0.5;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColorIndex = Math.floor(Math.random() * 100);

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 0.8,
        y: (Math.random() - 0.5) * 0.8,
        z: (Math.random() - 0.5) * 0.8
      };

      return {
        chaosPos, targetPos, scale: baseScale, weight,
        textureIndex: i % textures.length,
        borderColorIndex,
        currentPos: chaosPos.clone(),
        chaosRotation: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [textures, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;

      objData.currentPos.lerp(target, delta * (isFormed ? 0.8 * objData.weight : 0.5));
      group.position.copy(objData.currentPos);

      if (isFormed) {
        const targetLookPos = new THREE.Vector3(group.position.x * 2, group.position.y + 0.5, group.position.z * 2);
        group.lookAt(targetLookPos);

        const wobbleX = Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.04;
        const wobbleZ = Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) * 0.04;
        group.rotation.x += wobbleX;
        group.rotation.z += wobbleZ;
      } else {
        group.rotation.x += delta * objData.rotationSpeed.x;
        group.rotation.y += delta * objData.rotationSpeed.y;
        group.rotation.z += delta * objData.rotationSpeed.z;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        const borderColor = theme.baubleColors[obj.borderColorIndex % theme.baubleColors.length];
        return (
          <group
            key={i}
            scale={[obj.scale, obj.scale, obj.scale]}
            rotation={state === 'CHAOS' ? obj.chaosRotation : [0, 0, 0]}
          >
            {/* Photo with border */}
            <mesh geometry={photoGeometry} position={[0, 0.15, 0.01]}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white}
                emissiveIntensity={0.3}
              />
            </mesh>
            <mesh geometry={borderGeometry}>
              <meshStandardMaterial color={borderColor} roughness={0.9} metalness={0} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};


// --- Component: Christmas Elements ---
const ChristmasElements = ({ state, theme }: { state: 'CHAOS' | 'FORMED', theme: ThemeType }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;

      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const type = Math.floor(Math.random() * 3);
      let scale = 1;
      let colorType = 0; // 0: baubleColor, 1: flowerA, 2: flowerB

      if (type === 0) { colorType = 0; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { colorType = 0; scale = 0.6 + Math.random() * 0.4; }
      else { colorType = Math.random() > 0.5 ? 1 : 2; scale = 0.7 + Math.random() * 0.3; }

      const rotationSpeed = { x: (Math.random() - 0.5) * 2.0, y: (Math.random() - 0.5) * 2.0, z: (Math.random() - 0.5) * 2.0 };
      const colorIndex = Math.floor(Math.random() * 100);
      return { type, chaosPos, targetPos, colorType, colorIndex, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI), rotationSpeed };
    });
  }, [boxGeometry, sphereGeometry, caneGeometry]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x; mesh.rotation.y += delta * objData.rotationSpeed.y; mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry; if (obj.type === 0) geometry = boxGeometry; else if (obj.type === 1) geometry = sphereGeometry; else geometry = caneGeometry;

        let color;
        if (obj.colorType === 0) color = theme.baubleColors[obj.colorIndex % theme.baubleColors.length];
        else if (obj.colorType === 1) color = theme.flowerColorA;
        else color = theme.flowerColorB;

        return (<mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.4} emissive={color} emissiveIntensity={0.2} />
        </mesh>)
      })}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state, theme }: { state: 'CHAOS' | 'FORMED', theme: ThemeType }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const colorIndex = Math.floor(Math.random() * 100);
      const speed = 2 + Math.random() * 3;
      return { chaosPos, targetPos, colorIndex, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100 };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) { (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed ? 3 + intensity * 4 : 0; }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        const color = theme.lights[obj.colorIndex % theme.lights.length];
        return (<mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0} toneMapped={false} />
        </mesh>)
      })}
    </group>
  );
};

// --- Component: TextureText (Canvas Texture based 3D Text) ---
// Renders text to a 2D canvas and uses it as a texture on a plane for instant "loading"
const TextureText = ({ text, fontSize = 60, color = 'white', outlineColor = 'black', outlineWidth = 0, opacity = 1, position = [0, 0, 0], scale = 1 }: any) => {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Handle multiline
    const lines = text.split('\n');
    const lineHeight = fontSize * 1.2;
    const width = 1024; // Fixed high res width
    const height = lines.length * lineHeight + fontSize; // Basic height estimate

    canvas.width = width;
    canvas.height = height;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Font settings
    ctx.font = `bold ${fontSize}px "Microsoft YaHei", "SimHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw Text
    const cx = width / 2;
    let cy = height / 2 - ((lines.length - 1) * lineHeight) / 2;

    lines.forEach((line: string) => {
      if (outlineWidth > 0) {
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = outlineWidth;
        ctx.strokeText(line, cx, cy);
      }
      ctx.fillStyle = color;
      ctx.fillText(line, cx, cy);
      cy += lineHeight;
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, [text, fontSize, color, outlineColor, outlineWidth]);

  // Calculate aspect ratio for the plane
  const aspect = texture && texture.image ? texture.image.width / texture.image.height : 1;
  const planeWidth = 5 * scale; // Base width unit
  const planeHeight = (planeWidth / aspect);

  return (
    <mesh position={position} scale={[1, 1, 1]}>
      <planeGeometry args={[planeWidth, planeHeight]} />
      <meshStandardMaterial
        map={texture}
        transparent={true}
        opacity={opacity}
        side={THREE.DoubleSide}
        alphaTest={0.1}
        emissive={color}
        emissiveIntensity={0.5}
        toneMapped={false} // Keep colors bright
      />
    </mesh>
  );
};

// --- Component: MiddleText (3D Customizable Text) ---
const MiddleText = ({ state, text, theme: _theme }: { state: 'CHAOS' | 'FORMED', text: string, theme: ThemeType }) => {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) {
      const targetScale = state === 'FORMED' ? 1 : 0.1;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 2);
    }
  });

  if (!text || text.trim() === '') return null;

  return (
    <group ref={groupRef} position={[0, 8, 2]} rotation={[-Math.PI / 12, 0, 0]}>
      {/* Background glow layer handled by outline in TextureText for simplicity or distinct layer */}
      {/* For best bloom effect, we use one bright layer */}
      <TextureText
        text={text}
        fontSize={120}
        color="#FFFFFF"
        outlineColor="#000000"
        outlineWidth={4}
        scale={2.5}
      />
    </group>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state, theme }: { state: 'CHAOS' | 'FORMED', theme: ThemeType }) => {
  const groupRef = useRef<THREE.Group>(null);

  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3; const innerRadius = 0.7; const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(radius * Math.cos(angle), radius * Math.sin(angle)) : shape.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
    }
    shape.closePath();
    return shape;
  }, []);

  const starGeometry = useMemo(() => {
    return new THREE.ExtrudeGeometry(starShape, {
      depth: 0.4, // 增加一点厚度
      bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3,
    });
  }, [starShape]);

  // 柔和金色材质
  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: theme.starGold,
    emissive: theme.starGold,
    emissiveIntensity: 1.2, // 柔和发光
    roughness: 0.2,
    metalness: 0.8,
  }), [theme.starGold]);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      const targetScale = state === 'FORMED' ? 1 : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3);
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- Component: Snowman (雪人) ---
const Snowman = ({ state, position = [-10, -10, 6], scale = 1 }: { state: 'CHAOS' | 'FORMED', position?: [number, number, number], scale?: number }) => {
  const groupRef = useRef<THREE.Group>(null);
  const armRef1 = useRef<THREE.Mesh>(null);
  const armRef2 = useRef<THREE.Mesh>(null);

  useFrame((stateObj, delta) => {
    if (groupRef.current) {
      const targetScale = state === 'FORMED' ? scale : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 2);
    }
    // Arm waving animation
    if (armRef1.current && state === 'FORMED') {
      armRef1.current.rotation.z = Math.PI / 4 + Math.sin(stateObj.clock.elapsedTime * 2) * 0.2;
    }
    if (armRef2.current && state === 'FORMED') {
      armRef2.current.rotation.z = -Math.PI / 4 + Math.sin(stateObj.clock.elapsedTime * 2 + Math.PI) * 0.15;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Bottom sphere (body) */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[2, 16, 16]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.9} />
      </mesh>

      {/* Middle sphere (torso) */}
      <mesh position={[0, 2.5, 0]}>
        <sphereGeometry args={[1.5, 16, 16]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.9} />
      </mesh>

      {/* Top sphere (head) */}
      <mesh position={[0, 4.3, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.9} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.3, 4.5, 0.85]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[0.3, 4.5, 0.85]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>

      {/* Carrot nose */}
      <mesh position={[0, 4.2, 1]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.1, 0.6, 8]} />
        <meshStandardMaterial color="#FF6B35" roughness={0.7} />
      </mesh>

      {/* Smile (coal pieces) */}
      {[...Array(5)].map((_, i) => {
        const angle = (i - 2) * 0.2;
        return (
          <mesh key={`smile-${i}`} position={[Math.sin(angle) * 0.5, 3.9 - Math.abs(i - 2) * 0.05, 0.9]}>
            <sphereGeometry args={[0.06, 6, 6]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
        );
      })}

      {/* Top hat */}
      <group position={[0, 5.3, 0]}>
        {/* Hat brim */}
        <mesh>
          <cylinderGeometry args={[0.9, 0.9, 0.1, 16]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        {/* Hat top */}
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.6, 0.6, 1, 16]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        {/* Hat ribbon */}
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.62, 0.62, 0.15, 16]} />
          <meshStandardMaterial color="#D32F2F" roughness={0.5} />
        </mesh>
      </group>

      {/* Scarf */}
      <mesh position={[0, 3.3, 0.3]} rotation={[0.1, 0, 0]}>
        <torusGeometry args={[0.8, 0.15, 8, 16, Math.PI * 1.5]} />
        <meshStandardMaterial color="#D32F2F" roughness={0.6} />
      </mesh>
      <mesh position={[0.6, 2.8, 0.5]} rotation={[0.3, 0, 0.5]}>
        <boxGeometry args={[0.3, 1, 0.1]} />
        <meshStandardMaterial color="#D32F2F" roughness={0.6} />
      </mesh>

      {/* Buttons */}
      {[0, 0.6, 1.2].map((y, i) => (
        <mesh key={`button-${i}`} position={[0, 1.8 + y, 1.4]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      ))}

      {/* Arms (sticks) */}
      <mesh ref={armRef1} position={[1.5, 2.5, 0]} rotation={[0, 0, Math.PI / 4]}>
        <cylinderGeometry args={[0.06, 0.08, 2.5, 6]} />
        <meshStandardMaterial color="#4A3728" roughness={0.9} />
      </mesh>
      <mesh ref={armRef2} position={[-1.5, 2.5, 0]} rotation={[0, 0, -Math.PI / 4]}>
        <cylinderGeometry args={[0.06, 0.08, 2.5, 6]} />
        <meshStandardMaterial color="#4A3728" roughness={0.9} />
      </mesh>
    </group>
  );
};

// --- Component: Tree Base (Podium) ---
const TreeBase = ({ theme }: { theme: ThemeType }) => {
  // Base cylinder
  const baseGeometry = useMemo(() => new THREE.CylinderGeometry(14, 14, 2, 32), []);
  // Surrounding spheres
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(1.5, 32, 32), []);
  const sphereCount = 150;

  const spheres = useMemo(() => {
    return new Array(sphereCount).fill(0).map((_, i) => {
      // Random angle
      const angle = Math.random() * Math.PI * 2;
      // Varied radius to create depth (not just a single ring)
      const radius = 13 + Math.random() * 4;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      // Varied scale for "Big and Small" look - Reduced size
      const scale = 0.3 + Math.random() * 0.9; // Range: 0.3 - 1.2

      // 40% chance of being "Foam" (snowy/matte), 60% Silver/Shiny
      const isFoam = Math.random() < 0.4;

      return {
        position: [x, 0.5 * scale, z] as [number, number, number],
        scale,
        colorIndex: i,
        isFoam
      };
    });
  }, []);

  return (
    <group position={[0, -CONFIG.tree.height / 2 - 1, 0]}>
      {/* Main White Podium */}
      <mesh geometry={baseGeometry} position={[0, 0, 0]}>
        <meshStandardMaterial color="#FFFFFF" roughness={0.2} metalness={0.1} />
      </mesh>

      {/* Decorative Spheres around base */}
      {spheres.map((s, i) => (
        <mesh key={i} geometry={sphereGeometry} position={s.position} scale={s.scale}>
          <meshStandardMaterial
            color={s.isFoam ? '#FFFFFF' : theme.baubleColors[s.colorIndex % theme.baubleColors.length]}
            // Foam is rough (matte), Silver is smooth (shiny)
            roughness={s.isFoam ? 0.9 : 0.1}
            metalness={s.isFoam ? 0.0 : 0.8}
            envMapIntensity={s.isFoam ? 0 : 1.5}
            // Emissive only for non-foam to catch light? Or keep separate.
            emissive={s.isFoam ? "#F0F8FF" : "#000000"}
            emissiveIntensity={s.isFoam ? 0.2 : 0}
          />
        </mesh>
      ))}
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({ sceneState, rotationSpeed, customText, photos, theme }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number, customText: string, photos: string[], theme: ThemeType }) => {
  const controlsRef = useRef<any>(null);
  const { viewport } = useThree();

  // Responsive Camera Position
  // Default FOV 45. Tree Height ~25. Width ~18.
  // In portrait (width < height), horizontal FOV shrinks. 
  // We need to push back to ensure tree fits horizontally.
  const isPortrait = viewport.width < viewport.height;
  const cameraZ = isPortrait ? 100 : 60; // Push back significantly on portrait

  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, cameraZ]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={150} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />


      <ambientLight intensity={0.6} color="#E0F4FF" />
      <pointLight position={[30, 30, 30]} intensity={80} color={theme.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color="#FFFFFF" />
      <pointLight position={[0, -20, 10]} intensity={40} color="#E0FFFF" />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} theme={theme} />
        <Suspense fallback={null}>
          {photos.length > 0 && <PhotoOrnaments state={sceneState} photos={photos} theme={theme} />}
          <BaubleOrnaments state={sceneState} theme={theme} />
          <ChristmasElements state={sceneState} theme={theme} />
          <FairyLights state={sceneState} theme={theme} />
          <TopStar state={sceneState} theme={theme} />
          {/* Tree Base */}
          <TreeBase theme={theme} />

          {/* Left side decorations - snowmen */}
          <Snowman state={sceneState} />
          {/* Small snowman - 小雪人 */}
          <Snowman state={sceneState} position={[-11, -11, 8]} scale={0.5} />
        </Suspense>

        <MiddleText state={sceneState} text={customText} theme={theme} />

        <Sparkles count={800} scale={60} size={10} speed={0.2} opacity={0.6} color="#E0FFFF" />

        {/* Footer text - lily2025 */}
        <Suspense fallback={null}>
          <TextureText
            text="lily2025"
            fontSize={180}
            color="#FFFFFF"
            outlineColor="#333333"
            outlineWidth={2}
            position={[0, -12, 22]}
            scale={1.0}
          />
        </Suspense>
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GestureController = React.memo(({ onGesture, onMove, onStatus, onPinch, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Use refs for callbacks to avoid re-initializing the AI model when callbacks change
  const callbacksRef = useRef<{
    onGesture: any,
    onMove: any,
    onStatus: any,
    onPinch: any,
    lastMoveTime?: number
  }>({ onGesture, onMove, onStatus, onPinch });

  // Use ref to track pinch state across renders
  const isPinchingRef = useRef(false);

  useEffect(() => {
    callbacksRef.current = {
      ...callbacksRef.current,
      onGesture, onMove, onStatus, onPinch
    };
  }, [onGesture, onMove, onStatus, onPinch]);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;
    let mounted = true;

    const setup = async () => {
      callbacksRef.current.onStatus("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");

        if (!mounted) return;

        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });

        if (!mounted) return;

        callbacksRef.current.onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });

          if (!mounted) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            callbacksRef.current.onStatus("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else {
          callbacksRef.current.onStatus("ERROR: CAMERA PERMISSION DENIED");
        }
      } catch (err: any) {
        if (mounted) callbacksRef.current.onStatus(`ERROR: ${err.message || 'MODEL FAILED'}`);
      }
    };

    const predictWebcam = () => {
      if (!mounted) return;

      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0 && videoRef.current.readyState >= 2) {
          const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
          const ctx = canvasRef.current.getContext("2d");

          // Access current debug mode directly via prop (since it triggers re-render anyway) or ref if we wanted absolute stability
          // Here we use the prop 'debugMode' directly in the render, but since this effect depends on debugMode, 
          // we should be careful. Actually, let's keep debugMode in dependency but make sure setup() doesn't re-run.
          // WAIT: If debugMode changes, this whole effect re-runs. That is BAD.
          // We should also ref debugMode or accept that debugMode toggling restarts AI (acceptable but not ideal).
          // Better: Use a ref for debugMode too or just read the latest value if we can.
          // For now, let's allow debugMode to restart it (as it's rare), but callbacks changing happens ALL THE TIME.

          if (ctx && debugMode) {
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
            if (results.landmarks) for (const landmarks of results.landmarks) {
              const drawingUtils = new DrawingUtils(ctx);
              drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
              drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
            }
          } else if (ctx && !debugMode) {
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          }

          const { onGesture, onMove, onStatus, onPinch } = callbacksRef.current;
          const now = Date.now();

          if (results.gestures.length > 0) {
            const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
            if (score > 0.4) {
              if (name === "Open_Palm") onGesture("CHAOS"); if (name === "Closed_Fist") onGesture("FORMED");
              // Theme switching removed
              if (debugMode) onStatus(`DETECTED: ${name}`);
            }
            if (results.landmarks.length > 0) {
              const landmarks = results.landmarks[0];
              const handX = landmarks[0].x; // 0 (left) to 1 (right)
              // Center is 0.5. Range is -0.5 (left) to 0.5 (right)
              // We want: standard mirroring means hand on visual right is x < 0.5
              // Let's use 0.5 - handX: positive = hand on left (rotate left), negative = hand on right (rotate right)
              const rawOffset = 0.5 - handX;

              let targetSpeed = 0;
              const deadzone = 0.05; // Reduced deadzone for responsiveness
              const sensitivity = 1.5; // Increased sensitivity

              if (Math.abs(rawOffset) > deadzone) {
                // Remap 0.05 -> 0.5 
                const effectiveOffset = rawOffset > 0 ? rawOffset - deadzone : rawOffset + deadzone;
                // Inverted direction as requested
                targetSpeed = -effectiveOffset * sensitivity;
                if (debugMode) onStatus(`ROTATING: ${targetSpeed > 0 ? 'LEFT' : 'RIGHT'}`);
              } else {
                if (debugMode) onStatus("CENTER: PAUSED");
              }

              // Removed throttling for instant feedback
              onMove(targetSpeed);
              callbacksRef.current.lastMoveTime = now;

              const thumbTip = landmarks[4];
              const indexTip = landmarks[8];
              const distance = Math.sqrt(
                Math.pow(thumbTip.x - indexTip.x, 2) +
                Math.pow(thumbTip.y - indexTip.y, 2) +
                Math.pow(thumbTip.z - indexTip.z, 2)
              );

              if (distance < 0.05 && name !== "Closed_Fist") {
                if (!isPinchingRef.current) {
                  isPinchingRef.current = true;
                  if (onPinch) onPinch(true); // Pinch start
                  if (debugMode) onStatus(`PINCH START: ${distance.toFixed(3)}`);
                }
              } else {
                if (isPinchingRef.current && distance > 0.08) {
                  isPinchingRef.current = false;
                  if (onPinch) onPinch(false); // Pinch end
                  if (debugMode) onStatus("PINCH RELEASED");
                }
              }
            }
          } else {
            onMove(0);
            if (isPinchingRef.current) {
              isPinchingRef.current = false;
              if (onPinch) onPinch(false); // Ensure pinch ends if hand is lost
            }
            if (debugMode) onStatus("AI READY: NO HAND");
          }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      } else {
        // Retry if not ready yet
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };

    setup();

    return () => {
      mounted = false;
      cancelAnimationFrame(requestRef);
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      if (gestureRecognizer) gestureRecognizer.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugMode]); // Only re-run if debugMode changes. Callbacks are handled via refs.

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
});

// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('FORMED');
  const [themeMode] = useState<'modern' | 'classic' | 'silverIce'>('silverIce');
  const currentTheme = THEMES[themeMode];
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [_aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, _setDebugMode] = useState(false);
  const [customText] = useState(`新濠天地
CITY IF DREAMS`);
  const [focusedPhoto, setFocusedPhoto] = useState<{ index: number, position: THREE.Vector3 } | null>(null);

  // 懒加载照片：先渲染树，延迟加载照片
  const [photosReady, setPhotosReady] = useState(false);
  const photos = photosReady ? bodyPhotoPaths : [];

  // 延迟加载照片，让树先渲染出来
  useEffect(() => {
    // 延迟500ms后开始预加载照片
    const timer = setTimeout(() => {
      preloadImages(bodyPhotoPaths).then(() => {
        setPhotosReady(true);
        console.log(`Photos loaded: ${bodyPhotoPaths.length} images ready`);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Commented out: upload state - restore when upload UI is implemented
  // const [isUploading, setIsUploading] = useState(false);
  // const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  // const fileInputRef = useRef<HTMLInputElement>(null);

  // Login State


  // Fetch uploaded photos on load - disabled for faster loading
  // useEffect(() => {
  //   const fetchPhotos = async () => {
  //     try {
  //       const response = await fetch('/api/photos');
  //       if (response.ok) {
  //         const uploadedPhotos = await response.json();
  //         if (uploadedPhotos && uploadedPhotos.length > 0) {
  //           console.log("Found uploaded photos, replacing local default.");
  //           setPhotos(uploadedPhotos);
  //         }
  //       }
  //     } catch (e) {
  //       console.log("Could not fetch uploaded photos (likely waiting for Vercel deployment). Using local default.");
  //     }
  //   };
  //   fetchPhotos();
  // }, []);

  // Upload handler - currently unused, uncomment when upload UI is implemented
  // const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
  //   if (!event.target.files || event.target.files.length === 0) return;
  //   setIsUploading(true);
  //   const file = event.target.files[0];
  //   try {
  //     const response = await fetch('/api/upload', {
  //       method: 'POST',
  //       headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': file.name },
  //       body: file,
  //     });
  //     if (!response.ok) throw new Error('Upload failed');
  //     const newBlob = await response.json();
  //     setPhotos(prev => {
  //       const isUsingLocal = prev.length > 0 && !prev[0].startsWith('http');
  //       return isUsingLocal ? [newBlob.url] : [...prev, newBlob.url];
  //     });
  //     setAiStatus("UPLOAD SUCCESS");
  //     setTimeout(() => setAiStatus("AI READY: SHOW HAND"), 3000);
  //   } catch (error) {
  //     console.error('Upload Error:', error);
  //     setAiStatus("UPLOAD FAILED");
  //   } finally {
  //     setIsUploading(false);
  //     if (fileInputRef.current) fileInputRef.current.value = '';
  //   }
  // };

  // Delete handler - currently unused, uncomment when delete UI is implemented
  // const handleDelete = async (url: string, e: React.MouseEvent) => {
  //   e.stopPropagation();
  //   if (!confirm("Are you sure you want to delete this photo?")) return;
  //   if (url.startsWith('/src') || !url.startsWith('http')) {
  //     alert("Cannot delete built-in photos.");
  //     return;
  //   }
  //   try {
  //     const res = await fetch('/api/photos', {
  //       method: 'DELETE',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ url })
  //     });
  //     if (res.ok) {
  //       setPhotos(prev => {
  //         const updated = prev.filter(p => p !== url);
  //         return updated.length === 0 ? bodyPhotoPaths : updated;
  //       });
  //     } else {
  //       throw new Error('Delete failed');
  //     }
  //   } catch (error) {
  //     console.error('Delete error', error);
  //     alert("Failed to delete photo.");
  //   }
  //};

  // Handle pinch gesture - Hold to view random photo (CHAOS only)
  const handlePinch = useCallback((isPinching: boolean) => {
    if (isPinching) {
      // Only show photo in CHAOS state
      if (sceneState === 'CHAOS' && photos.length > 0) {
        const randomIndex = Math.floor(Math.random() * photos.length);
        setFocusedPhoto({ index: randomIndex, position: new THREE.Vector3(0, 0, 0) });
      }
    } else {
      // Always allow hiding photo, regardless of state
      setFocusedPhoto(null);
    }
  }, [sceneState, photos]);

  // ESC key to close focused photo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusedPhoto) {
        setFocusedPhoto(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedPhoto]);

  // Force clear photo when switching to FORMED state
  useEffect(() => {
    if (sceneState === 'FORMED') {
      setFocusedPhoto(null);
    }
  }, [sceneState]);



  return (
    <div className="ui-container">
      <SpeedInsights />
      <div className="canvas-container">
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
          <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} customText={customText} photos={photos} theme={currentTheme} />
        </Canvas>
      </div>
      <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} onPinch={handlePinch} debugMode={debugMode} />

      {/* UI - Stats */}
      {/* <div className="stats-panel">
        <div className="stat-item">
          <p>Photos</p>
          <p style={{ color: currentTheme.foliageBase }}>
            {photos.length.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span>
          </p>
        </div>
        <div className="stat-item">
          <p>Foliage</p>
          <p style={{ color: currentTheme.foliageBase }}>
            {(CONFIG.counts.foliage / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>NEEDLES</span>
          </p>
        </div>
      </div> */}

      {/* UI - Buttons */}
      {/* <div className="controls-panel">
        <button onClick={() => setDebugMode(!debugMode)} className={`btn btn-debug ${debugMode ? 'active' : ''}`}>
          {debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}
        </button>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleUpload}
          accept="image/*"
        />
        <button onClick={() => fileInputRef.current?.click()} className="btn btn-upload">
          {isUploading ? 'UPLOADING...' : '📷 UPLOAD'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} className="btn btn-action">
          {sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}
        </button>
        <button onClick={() => setIsGalleryOpen(true)} className="btn btn-gallery">
          🖼 GALLERY
        </button>
      </div> */}

      {/* UI - AI Status */}
      {/* <div className="ai-status-panel">
        <div className={`ai-status-badge ${aiStatus.includes('ERROR') ? 'error' : ''}`}>
          {aiStatus}
        </div>
      </div> */}

      {/* Photo Focus Overlay (Pinch to Peek) */}
      {focusedPhoto && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none', // Allow seeing through
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{
            pointerEvents: 'auto',
            transform: 'rotate(-5deg)',
            transition: 'transform 0.3s ease-out',
            filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.5))'
          }}>
            <img
              src={photos[focusedPhoto.index % photos.length]}
              alt={`Photo ${focusedPhoto.index + 1}`}
              style={{
                width: '400px', // Fixed smaller size
                maxWidth: '80vw',
                height: 'auto',
                objectFit: 'contain',
                border: '15px solid #FFF8E7',
                borderRadius: '4px'
              }}
            />
            {/* Removed Text Hint since it's gesture controlled now */}
          </div>
        </div>
      )}

      {/* Gallery Modal */}
      {/* {isGalleryOpen && (
        <div className="gallery-modal-overlay">
          <div style={{ width: '100%', maxWidth: '1000px', display: 'flex', justifyContent: 'space-between', marginBottom: '30px', alignItems: 'center' }}>
            <h2 style={{ color: currentTheme.foliageBase, fontFamily: 'serif', margin: 0 }}>Photo Gallery</h2>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                style={{ padding: '10px 20px', backgroundColor: currentTheme.foliageBase, border: 'none', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {isUploading ? 'UPLOADING...' : 'UPLOAD NEW'}
              </button>
              <button onClick={() => setIsGalleryOpen(false)} style={{ padding: '10px 20px', backgroundColor: 'transparent', border: '1px solid #FFF', color: '#FFF', cursor: 'pointer' }}>
                CLOSE
              </button>
            </div>
          </div>

          <div className="gallery-container">
            {photos.map((url, i) => (
              <div key={i} style={{ position: 'relative', aspectRatio: '1', border: '1px solid #333' }}>
                <img src={url} alt="Gallery" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {(url.startsWith('http')) && (
                  <button
                    onClick={(e) => handleDelete(url, e)}
                    style={{
                      position: 'absolute', top: '5px', right: '5px',
                      backgroundColor: 'rgba(0,0,0,0.7)', color: '#FF4444',
                      border: 'none', borderRadius: '50%', width: '30px', height: '30px',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )} */}
    </div>
  );
}