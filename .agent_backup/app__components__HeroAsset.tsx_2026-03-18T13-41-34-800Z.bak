'use client'

import { LogoModel } from './LogoModel'
import { GlobeModel } from './GlobeModel'
import { GlobeGrid } from './GlobeGrid'
import { HeroRig } from './HeroRig'
import { useIntro } from '../context/IntroContext'
import { useFrame } from '@react-three/fiber'
import { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'

export function HeroAsset() {
    const { booted, entered, setEntered, flightFinished, setFlightFinished } = useIntro()

    const group = useRef<THREE.Group>(null)
    const logoRef = useRef<THREE.Group>(null)
    const solidGlobeRef = useRef<THREE.Group>(null)

    const [logoUnmounted, setLogoUnmounted] = useState(false)
    const [globeUnmounted, setGlobeUnmounted] = useState(false)
    const flightTime = useRef(0)

    useEffect(() => {
        if (!booted || entered) return

        const handleInteract = (e: any) => {
            if (e.type === 'wheel' && Math.abs(e.deltaY) < 20) return
            if (setEntered) setEntered(true)
        }

        const timer = setTimeout(() => {
            window.addEventListener('wheel', handleInteract, { passive: true })
            window.addEventListener('click', handleInteract)
            // Убрали touchstart, чтобы свайп на телефоне вращал камеру, а не запускал полет
        }, 1000)

        return () => {
            clearTimeout(timer)
            window.removeEventListener('wheel', handleInteract)
            window.removeEventListener('click', handleInteract)
        }
    }, [booted, entered, setEntered])

    useFrame((state, delta) => {
        if (!group.current) return

        const targetScale = booted ? 1 : 0
        group.current.scale.setScalar(THREE.MathUtils.lerp(group.current.scale.x, targetScale, 4 * delta))

        // ЗАПУСКАЕМ АНИМАЦИЮ ПОСЛЕ "ВХОДА", НО ТОЛЬКО ЕСЛИ ПОЛЕТ НЕ ЗАВЕРШЕН
        if (entered && !flightFinished) {
            // Защита от больших скачков времени (delta)
            const dt = Math.min(delta, 0.05)
            const flightDuration = 1.5 // Секунды
            flightTime.current = Math.min(flightTime.current + dt / flightDuration, 1)

            // Элементарный Smoothstep (Ease-In-Out)
            const t = flightTime.current * flightTime.current * (3 - 2 * flightTime.current)

            const startPos = new THREE.Vector3(0, 0, 4)
            const endPos = new THREE.Vector3(0, 0, 0)

            // 1. Устанавливаем позицию камеры через интерполяцию
            state.camera.position.lerpVectors(startPos, endPos, t)

            // 2. Стабилизируем взгляд на фиксированную точку
            state.camera.lookAt(0, 0, -1)

            // ПРОВЕРЯЕМ ЗАВЕРШЕНИЕ
            if (flightTime.current >= 1) {
                setFlightFinished(true)
            }
        }

        if (entered) {
            // 2. Логотип летит медленно и плавно (+= вместо lerp дает стабильную скорость)
            if (logoRef.current && !logoUnmounted) {
                logoRef.current.position.z += 5 * delta
                if (logoRef.current.position.z > 10) {
                    setLogoUnmounted(true) // Удаляем при достижении 10
                }
            }

            // 3. Сплошная Земля: плавно растворяем все материалы внутри нее
            if (solidGlobeRef.current && !globeUnmounted) {
                let allFaded = true
                solidGlobeRef.current.traverse((child: any) => {
                    if (child.isMesh && child.material) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material]
                        // ИСПРАВЛЕНО: добавлено (mat: any)
                        materials.forEach((mat: any) => {
                            mat.transparent = true
                            if (mat.opacity === undefined) mat.opacity = 1
                            // Гасим прозрачность
                            mat.opacity = THREE.MathUtils.lerp(mat.opacity, 0, 4 * delta)
                            if (mat.opacity > 0.05) allFaded = false
                        })
                    }
                })
                // Как только материалы стали полностью прозрачными — выгружаем объект
                if (allFaded) setGlobeUnmounted(true)
            }
        }
    })

    return (
        <group position={[0, 0, 0]}>
            <group ref={group} scale={[0, 0, 0]}>

                {/* ЛОГОТИП */}
                {!logoUnmounted && (
                    <HeroRig>
                        <group ref={logoRef} rotation={[0, -Math.PI / 2, 0]} position={[0.1, 0, 0.35]}>
                            <LogoModel />
                        </group>
                    </HeroRig>
                )}

                <group position={[0, 0, 0]}>
                    {/* СПЛОШНАЯ ЗЕМЛЯ (растворяется и удаляется) */}
                    {!globeUnmounted && (
                        <group ref={solidGlobeRef}>
                            <GlobeModel />
                        </group>
                    )}

                    {/* СЕТКА (Остается всегда) */}
                    <GlobeGrid />
                </group>

            </group>
        </group>
    )
}