'use client'

import { MeshReflectorMaterial } from '@react-three/drei'
import { useQuality } from '../context/QualityContext' // Импортируем хук

export function Platform() {
    const { reflections } = useQuality() // Проверяем, включены ли отражения

    return (
        <group position={[0, -1.2, 0]}>

            {/* 1. Верхний диск */}
            <mesh receiveShadow>
                <cylinderGeometry args={[1, 1.05, 0.3, 64]} />
                <meshPhysicalMaterial
                    color="#000000" roughness={0.2} metalness={1.0}
                    clearcoat={0.5} clearcoatRoughness={0.1} envMapIntensity={2}
                />
            </mesh>

           

            {/* ... Кольца и свет оставляем без изменений ... */}
            <mesh position={[0, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.8, 0.9, 64]} />
                <meshBasicMaterial color="#00ffff" toneMapped={false} />
            </mesh>

            <pointLight position={[0, 1, 0]} intensity={10} distance={3} color="#00ffff" />
        </group>
    )
}