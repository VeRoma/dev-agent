'use client'

import { useFrame } from '@react-three/fiber'
import { useRef, useMemo, useState, useEffect } from 'react'
import * as THREE from 'three'
import { useQuality } from '../context/QualityContext'
import { useIntro } from '../context/IntroContext'

const SNIPPETS = [
    "import { Canvas, useFrame } from '@react-three/fiber'",
    "import { OrbitControls, Environment, useGLTF } from '@react-three/drei'",
    "function Scene() { return <Logo /> }",
    "const x = Math.sin(time) * 0.5",
    "<MeshReflectorMaterial blur={[400, 100]} resolution={2048} />",
    "export default function Page()",
    "const [hovered, set] = useState(false)",
    "useFrame((state, delta) => { ref.current.rotation.y += delta * 0.5 })",
    "// Optimization: GPU based particles system",
    "console.log('VRRGL System Initialized')",
    "interface Props { position: [number, number, number]; scale?: number }",
    "const { nodes, materials } = useGLTF('/model.glb')",
    "const vec = new THREE.Vector3(0, 0, 0)",
    "camera.position.lerp(vec, 0.1)",
    "gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);",
    "void main() { vec2 uv = vUv; }",
    "const material = new THREE.MeshStandardMaterial({ color: '#00ffff' })",
    "return <group dispose={null}>{children}</group>",
    "const { camera, gl } = useThree()",
    "gl.setPixelRatio(window.devicePixelRatio)",
    "type GLTFResult = GLTF & { nodes: Record<string, THREE.Mesh> }",
    "// TODO: Refactor lighting setup for better performance",
    "const spring = useSpring({ scale: active ? 1.5 : 1 })",
    "<EffectComposer><Bloom luminanceThreshold={1.1} /></EffectComposer>",
    "ambientLight intensity={0.5} color='#ffffff'",
    "spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} castShadow",
    "if (mesh.current) mesh.current.position.y = Math.sin(t)",
    "const roughness = 0.4; const metalness = 0.8;",
    "scene.background = new THREE.Color('#050505')",
    "import { VRRGL } from '@/lib/vrrgl-core'",
    "const handleClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation() }",
    "return <Suspense fallback={<Loader />}>",
    "const data = useLoader(TextureLoader, '/texture.jpg')",
    "export const dynamic = 'force-dynamic'",
    "// Connecting to neural interface...",
    "const geometry = new THREE.BoxGeometry(1, 1, 1)",
    "mesh.current.material.uniforms.uTime.value = state.clock.elapsedTime",
    "attribute vec3 position;",
    "varying vec2 vUv;",
    "const PI = Math.PI;",
    "camera.lookAt(0, 0, 0)",
    "const [location, setLocation] = useLocation()",
    "// Initializing geometry buffers",
    "const columns = useMemo(() => Array.from({ length: 10 }), [])",
    "gl.toneMapping = THREE.NoToneMapping",
    "<Sparkles count={50} scale={5} color='#00ffff' />",
    "const target = new THREE.Vector3(0, -1.6, 0)",
    "useLayoutEffect(() => { scene.traverse(obj => { ... }) }, [])",
    "// System ready. Waiting for input.",
    "export interface State { count: number; theme: 'dark' | 'light' }"
]

function createCodeTexture(): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;

    const context = canvas.getContext('2d');
    if (!context) return null;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 20px "Courier New", monospace';
    context.fillStyle = '#00ffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const lineHeight = 40;
    const linesCount = Math.floor(canvas.height / lineHeight);

    for (let i = 0; i < linesCount; i++) {
        const text = SNIPPETS[Math.floor(Math.random() * SNIPPETS.length)];
        context.fillText(text, canvas.width / 2, i * lineHeight + lineHeight / 2);
    }

    return new THREE.CanvasTexture(canvas);
}

function CodeColumn({ x, y, z, speed, opacity, texture, entered }: { x: number, y: number, z: number, speed: number, opacity: number, texture: THREE.CanvasTexture, entered: boolean }) {
    const mesh = useRef<THREE.Mesh>(null)
    const mat = useRef<THREE.MeshBasicMaterial>(null)

    useFrame((_, delta) => {
        if (!mesh.current || !mat.current) return

        if (entered) {
            // ЭТАП ПОГРУЖЕНИЯ: Плавно гасим прозрачность до нуля
            mat.current.opacity = THREE.MathUtils.lerp(mat.current.opacity, 0, 4 * delta)
        } else {
            // ШТАТНЫЙ РЕЖИМ: Код падает вниз
            mesh.current.position.y += speed * delta
            if (mesh.current.position.y > 15) {
                mesh.current.position.y = -15
            }
        }
    })

    return (
        <mesh ref={mesh} position={[x, y, z]}>
            <planeGeometry args={[5, 10]} />
            <meshBasicMaterial
                ref={mat}
                map={texture}
                transparent
                opacity={opacity}
                side={THREE.DoubleSide}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
            />
        </mesh>
    )
}

export function CodeBackground() {
    const { mode } = useQuality()
    const { entered } = useIntro()

    // Состояние для полного удаления (unmount)
    const [unmounted, setUnmounted] = useState(false)

    // ГЕНЕРИРУЕМ ТЕКСТУРУ 1 РАЗ ДЛЯ ВСЕХ! Это спасет FPS.
    const sharedTexture = useMemo(() => createCodeTexture(), [])

    // Таймер: через 2 секунды после начала погружения удаляем фон из памяти
    useEffect(() => {
        if (entered) {
            const timer = setTimeout(() => setUnmounted(true), 2000)
            return () => clearTimeout(timer)
        }
    }, [entered])

    const columns = useMemo(() => [
        { x: -5, y: 0, z: -8, speed: 0.5, opacity: 0.15 },
        { x: -3, y: -8, z: -10, speed: 0.8, opacity: 0.1 },
        { x: 3, y: 5, z: -12, speed: 0.7, opacity: 0.1 },
        { x: 6, y: -3, z: -9, speed: 0.4, opacity: 0.15 },
        { x: 0, y: -10, z: -15, speed: 0.3, opacity: 0.05 },
        { x: -7, y: 8, z: -11, speed: 0.6, opacity: 0.08 },
        { x: 4, y: -12, z: -14, speed: 0.5, opacity: 0.08 },
    ], [])

    // Если низкое качество, нет текстуры ИЛИ включился unmounted — выгружаем
    if (mode === 'low' || !sharedTexture || unmounted) return null

    return (
        <>
            {columns.map((col, i) => (
                <CodeColumn key={i} {...col} texture={sharedTexture} entered={entered} />
            ))}
        </>
    )
}