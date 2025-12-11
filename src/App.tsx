import React, { useState, useMemo, useRef, useEffect, Suspense, useCallback } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  Text3D,
  Center,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- 动态获取照片列表 (自动读取 src/assets/photos 下的所有 .jpg 文件) ---
// 使用 Vite 的 import.meta.glob 动态导入
const photoModules = import.meta.glob('/src/assets/photos/*.jpg', { eager: true, as: 'url' });
const bodyPhotoPaths = Object.values(photoModules);

// 如果没有照片，使用占位符
if (bodyPhotoPaths.length === 0) {
  console.warn("No photos found in src/assets/photos!");
}

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
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
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

// --- Component: Bauble Ornaments (Pastel Spheres) ---
const BaubleOrnaments = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
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

      const color = CONFIG.colors.baubleColors[Math.floor(Math.random() * CONFIG.colors.baubleColors.length)];
      const scale = 0.5 + Math.random() * 0.5; // Random scale for variety
      const rotationSpeed = {
        x: (Math.random() - 0.5) * 0.5,
        y: (Math.random() - 0.5) * 0.5,
        z: (Math.random() - 0.5) * 0.5
      };

      return {
        chaosPos, targetPos, color, scale,
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
      {data.map((obj, i) => (
        <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={state === 'CHAOS' ? obj.chaosRotation : [0, 0, 0]}>
          <meshStandardMaterial
            color={obj.color}
            roughness={0.2}
            metalness={0.5}
            emissive={obj.color}
            emissiveIntensity={0.3} // Subtle glow
          />
        </mesh>
      ))}
    </group>
  );
};

// --- Component: Photo Ornaments (Polaroid Photos) ---
const PhotoOrnaments = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  // Load textures directly from the dynamic paths array
  const textures = useTexture(bodyPhotoPaths);
  const count = CONFIG.counts.photos;
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
      const borderColor = CONFIG.colors.baubleColors[Math.floor(Math.random() * CONFIG.colors.baubleColors.length)];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 0.8,
        y: (Math.random() - 0.5) * 0.8,
        z: (Math.random() - 0.5) * 0.8
      };

      return {
        chaosPos, targetPos, scale: baseScale, weight,
        textureIndex: i % textures.length,
        borderColor,
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
      {data.map((obj, i) => (
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
            <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} />
          </mesh>
        </group>
      ))}
    </group>
  );
};


// --- Component: Christmas Elements ---
const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
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
      let color; let scale = 1;
      if (type === 0) { color = CONFIG.colors.baubleColors[Math.floor(Math.random() * CONFIG.colors.baubleColors.length)]; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { color = CONFIG.colors.baubleColors[Math.floor(Math.random() * CONFIG.colors.baubleColors.length)]; scale = 0.6 + Math.random() * 0.4; }
      else { color = Math.random() > 0.5 ? CONFIG.colors.lightPink : CONFIG.colors.white; scale = 0.7 + Math.random() * 0.3; }


      const rotationSpeed = { x: (Math.random() - 0.5) * 2.0, y: (Math.random() - 0.5) * 2.0, z: (Math.random() - 0.5) * 2.0 };
      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI), rotationSpeed };
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
        return (<mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.4} emissive={obj.color} emissiveIntensity={0.2} />
        </mesh>)
      })}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      const speed = 2 + Math.random() * 3;
      return { chaosPos, targetPos, color, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100 };
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
      {data.map((obj, i) => (<mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
        <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
      </mesh>))}
    </group>
  );
};

// --- Component: Middle Text (3D Customizable Text) ---
const MiddleText = ({ state, text }: { state: 'CHAOS' | 'FORMED', text: string }) => {
  const groupRef = useRef<THREE.Group>(null);
  const [opacity, setOpacity] = useState(0);

  useFrame((_, delta) => {
    if (groupRef.current) {
      // Gentle rotation


      // Fade in/out based on state
      const targetOpacity = state === 'FORMED' ? 1 : 0;
      setOpacity(prev => MathUtils.damp(prev, targetOpacity, 3, delta));

      // Scale animation
      const targetScale = state === 'FORMED' ? 1 : 0.1;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 2);
    }
  });

  if (!text || text.trim() === '') return null;

  return (
    <group ref={groupRef} position={[0, 1, 0]}>
      <Center>
        <Text3D
          font="/fonts/helvetiker_regular.typeface.json"
          size={1.5}
          height={0.3}
          curveSegments={12}
          bevelEnabled
          bevelThickness={0.05}
          bevelSize={0.02}
          bevelSegments={5}
        >
          {text}
          <meshStandardMaterial
            color={CONFIG.colors.textColor}
            emissive={CONFIG.colors.textColor}
            emissiveIntensity={0.8}
            roughness={0.2}
            metalness={0.6}
            transparent
            opacity={opacity}
          />
        </Text3D>
      </Center>
    </group>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
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
    color: CONFIG.colors.starGold,
    emissive: CONFIG.colors.starGold,
    emissiveIntensity: 1.2, // 柔和发光
    roughness: 0.2,
    metalness: 0.8,
  }), []);

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

// --- Main Scene Experience ---
const Experience = ({ sceneState, rotationSpeed, customText }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number, customText: string }) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={120} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
          {bodyPhotoPaths.length > 0 && <PhotoOrnaments state={sceneState} />}
          <BaubleOrnaments state={sceneState} />
          <ChristmasElements state={sceneState} />
          <FairyLights state={sceneState} />
          <MiddleText state={sceneState} text={customText} />
          <TopStar state={sceneState} />
        </Suspense>
        <Sparkles count={600} scale={50} size={8} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
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
              const deadzone = 0.1; // 20% deadzone in middle
              const sensitivity = 0.25;

              if (Math.abs(rawOffset) > deadzone) {
                // Remap 0.1 -> 0.5 to 0 -> 0.4(ish)
                const effectiveOffset = rawOffset > 0 ? rawOffset - deadzone : rawOffset + deadzone;
                targetSpeed = -effectiveOffset * sensitivity; // Inverted direction
                if (debugMode) onStatus(`ROTATING: ${targetSpeed > 0 ? 'LEFT' : 'RIGHT'}`);
              } else {
                if (debugMode) onStatus("CENTER: PAUSED");
              }

              // Throttle movement updates to max 10fps to save CPU/GPU
              if (!callbacksRef.current.lastMoveTime || now - callbacksRef.current.lastMoveTime > 100) {
                onMove(targetSpeed);
                callbacksRef.current.lastMoveTime = now;
              }

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
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);
  const [customText, setCustomText] = useState('STUDIO CITY');
  const [focusedPhoto, setFocusedPhoto] = useState<{ index: number, position: THREE.Vector3 } | null>(null);

  // Handle pinch gesture - Hold to view random photo (CHAOS only)
  const handlePinch = useCallback((isPinching: boolean) => {
    if (isPinching) {
      // Only show photo in CHAOS state
      if (sceneState === 'CHAOS' && CONFIG.counts.photos > 0) {
        const randomIndex = Math.floor(Math.random() * CONFIG.counts.photos);
        setFocusedPhoto({ index: randomIndex, position: new THREE.Vector3(0, 0, 0) });
      }
    } else {
      // Always allow hiding photo, regardless of state
      setFocusedPhoto(null);
    }
  }, [sceneState]);

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
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
          <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} customText={customText} />
        </Canvas>
      </div>
      <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} onPinch={handlePinch} debugMode={debugMode} />

      {/* UI - Stats */}
      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Photos</p>
          <p style={{ fontSize: '24px', color: '#B8E6D5', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.photos.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Foliage</p>
          <p style={{ fontSize: '24px', color: '#A8D5C5', fontWeight: 'bold', margin: 0 }}>
            {(CONFIG.counts.foliage / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>MINT NEEDLES</span>
          </p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
          {debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
          {sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}
        </button>
      </div>

      {/* UI - AI Status */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>

      {/* UI - Text Input */}
      <div style={{ position: 'absolute', top: '30px', left: '40px', zIndex: 10 }}>
        <label style={{ display: 'block', color: '#B8E6D5', fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '8px', fontFamily: 'sans-serif' }}>Custom Text</label>
        <input
          type="text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value.toUpperCase())}
          maxLength={20}
          placeholder="ENTER TEXT"
          style={{
            padding: '10px 15px',
            backgroundColor: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(184, 230, 213, 0.5)',
            color: '#B8E6D5',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            fontWeight: 'bold',
            letterSpacing: '2px',
            cursor: 'text',
            backdropFilter: 'blur(4px)',
            borderRadius: '4px',
            outline: 'none',
            width: '200px'
          }}
        />
      </div>

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
              src={bodyPhotoPaths[focusedPhoto.index % bodyPhotoPaths.length]}
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
    </div>
  );
}