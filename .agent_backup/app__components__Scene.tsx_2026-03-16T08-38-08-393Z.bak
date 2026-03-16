'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows } from '@react-three/drei'
import { Suspense, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { HeroAsset } from './HeroAsset'
import { Effects } from './Effects'
import { EnvironmentSetup } from './EnvironmentSetup'
import { Lights } from './Lights'
import { Platform } from './Platform'
import { CodeBackground } from './CodeBackground'
import { StarsBackground } from './StarsBackground'
import { useQuality } from '../context/QualityContext'
import { useIntro } from '../context/IntroContext'

function CameraController() {
    const { flightFinished } = useIntro()
    const controlsRef = useRef<any>(null)

    useFrame((state) => {
        // 1. Обновляем демпфирование, если оно включено
        if (controlsRef.current?.enableDamping) {
            controlsRef.current.update()
        }

        // 2. СИНХРОНИЗАЦИЯ TARGET:
        // Вычисляем прогресс на основе Z-позиции камеры (от 4 до 0.01)
        const zStart = 4
        const zEnd = 0.01
        const currentZ = state.camera.position.z

        // Линейный прогресс на основе позиции (0 -> 1)
        const p = THREE.MathUtils.clamp((currentZ - zStart) / (zEnd - zStart), 0, 1)

        // В новой версии всё центрировано по 0
        const startTargetY = 0
        const endTargetY = 0
        const currentTargetY = startTargetY + (endTargetY - startTargetY) * p

        // Прямое обновление target у контроллов без ререндера
        if (controlsRef.current) {
            // Во время полета смотрим в (0, 0, -1) для стабилизации вектора,
            // но после завершения OrbitControls должен вращаться вокруг (0,0,0) или (0,0,-1)?
            // Если мы внутри сферы и хотим вращаться на месте, цель должна быть (0,0,-1)
            controlsRef.current.target.set(0, currentTargetY, flightFinished ? -1 : -1 * p)
        }
    })

    return (
        <OrbitControls
            ref={controlsRef}
            enabled={flightFinished}
            enableDamping={flightFinished}
            dampingFactor={0.05}
            minPolarAngle={0}
            maxPolarAngle={flightFinished ? Math.PI : Math.PI / 2}
            enableZoom={false}
        />
    )
}

// НОВЫЙ КОМПОНЕНТ: Обертка для подиумов (чтобы можно было использовать useFrame)
function PlatformWrapper() {
    const { entered } = useIntro()
    const { shadows } = useQuality()

    const platformRef = useRef<THREE.Group>(null)
    const [unmounted, setUnmounted] = useState(false)

    useFrame((_, delta) => {
        if (entered && platformRef.current && !unmounted) {
            // Топим подиум вниз с такой же скоростью, с которой летит логотип
            platformRef.current.position.y -= 5 * delta
            if (platformRef.current.position.y < -10) {
                setUnmounted(true) // Выгружаем из памяти
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
            <color attach="background" args={['#000000']} />
            <fog attach="fog" args={['#000000', 5, 20]} />
            <Lights />
            <Suspense fallback={null}><EnvironmentSetup /></Suspense>

            <StarsBackground />
            <CodeBackground />

            {/* ИСПОЛЬЗУЕМ НАШУ УМНУЮ ОБЕРТКУ */}
            <PlatformWrapper />

            <Suspense fallback={null}><HeroAsset /></Suspense>

            <CameraController />
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