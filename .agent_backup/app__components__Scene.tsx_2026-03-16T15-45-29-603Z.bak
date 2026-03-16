'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows, Stats } from '@react-three/drei'
import { Suspense, useRef, useState } from 'react'
import * as THREE from 'three'

import { HeroAsset } from './HeroAsset'
import { Effects } from './Effects'
import { EnvironmentSetup } from './EnvironmentSetup'
import { Lights } from './Lights'
import { Platform } from './Platform'
import { CodeBackground } from './CodeBackground'
import { RealStarsBackground } from './RealStarsBackground'
import { RealStars } from './RealStars'
import { useQuality } from '../context/QualityContext'
import { useIntro } from '../context/IntroContext'

function CameraController() {
    const { entered, flightFinished } = useIntro()
    const controlsRef = useRef<any>(null)

    useFrame((state) => {
        // 1. Обновляем инерцию камеры
        if (controlsRef.current?.enableDamping) {
            controlsRef.current.update()
        }

        // 2. === БЫСТРОЕ ОБНОВЛЕНИЕ КООРДИНАТ В ИНТЕРФЕЙСЕ ===
        const coordsElement = document.getElementById('camera-coords')
        if (coordsElement) {
            // Получаем 3D координаты камеры
            const pos = state.camera.position
            const radius = pos.length()

            if (radius > 0) {
                // Переводим декартовы координаты (x,y,z) в сферические
                const phi = Math.acos(pos.y / radius) // угол от "Северного полюса" (от 0 до Пи)
                const theta = Math.atan2(pos.x, pos.z) // угол вокруг экватора

                // Пересчитываем в понятные человеку Широту и Долготу
                const latDeg = 90 - (phi * 180 / Math.PI)
                const latDir = latDeg >= 0 ? 'N' : 'S'

                const lonDeg = theta * 180 / Math.PI
                const lonDir = lonDeg >= 0 ? 'E' : 'W'

                // Напрямую обновляем текст в DOM, минуя React-состояния!
                coordsElement.innerText = `COORDS: ${Math.abs(latDeg).toFixed(2)}° ${latDir}, ${Math.abs(lonDeg).toFixed(2)}° ${lonDir}`
            }
        }
    })

    const isFlying = entered && !flightFinished;

    return (
        <OrbitControls
            ref={controlsRef}
            enabled={!isFlying}
            enableDamping={true}
            dampingFactor={0.05}
            enableZoom={false}
            minPolarAngle={0}
            maxPolarAngle={Math.PI}
        />
    )
}

function PlatformWrapper() {
    const { entered } = useIntro()
    const { shadows } = useQuality()

    const platformRef = useRef<THREE.Group>(null)
    const [unmounted, setUnmounted] = useState(false)

    useFrame((_, delta) => {
        if (entered && platformRef.current && !unmounted) {
            platformRef.current.position.y -= 5 * delta
            if (platformRef.current.position.y < -10) {
                setUnmounted(true)
            }
        }
    })

    if (unmounted) return null

    return (
        <group ref={platformRef}>
            <Platform />
            {shadows && (
                <ContactShadows frames={1} position={[0, -1.1, 0]} opacity={0.5} scale={10} blur={2.5} far={1} />
            )}
        </group>
    )
}

function SceneContent() {
    const { dpr, shadows } = useQuality()

    return (
        <Canvas
            shadows={shadows}
            dpr={dpr}
            camera={{ position: [0, 0, 4], fov: 50, near: 0.1 }}
            gl={{
                antialias: true,
                toneMapping: THREE.ACESFilmicToneMapping,
                toneMappingExposure: 1.0,
            }}
            onCreated={(state) => {
                state.gl.setClearColor('#000000')
            }}

           
        >

            {/* ДОБАВЛЯЕМ СЧЕТЧИК ПРОИЗВОДИТЕЛЬНОСТИ */}
            <Stats className="!absolute !top-auto !bottom-6 !left-6" />

            <color attach="background" args={['#000000']} />

            {/* Туман не будет влиять на звезды, так как мы отключили fog в их материалах */}
            <fog attach="fog" args={['#000000', 5, 20]} />

            <Lights />
            <Suspense fallback={null}><EnvironmentSetup /></Suspense>

            {/* СЛОЙ 1: HDR-Фон (Скайбокс) */}
            <Suspense fallback={null}>
                <RealStarsBackground />
            </Suspense>

            {/* СЛОЙ 2: Реальные звезды (каталог) */}
            <RealStars />

            {/* СЛОЙ 3: Матричный код */}
            {/* <CodeBackground /> */}

            {/* ОБЕРТКА ДЛЯ ПЛАТФОРМЫ */}
            <PlatformWrapper />

            <Suspense fallback={null}><HeroAsset /></Suspense>

            <CameraController />

            {/* СЛОЙ ЭФФЕКТОВ ПОСТ-ОБРАБОТКИ */}
            <Effects />
        </Canvas>
    )
}

export default function Scene() {
    return (
        <div className="h-screen w-full bg-black">
            <SceneContent />
        </div>
    )
}