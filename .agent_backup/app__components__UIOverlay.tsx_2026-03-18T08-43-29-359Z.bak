'use client'

import { useIntro } from '../context/IntroContext'
import { useQuality } from '../context/QualityContext'

type QualityMode = "low" | "medium" | "high";

export function UIOverlay() {
    const { booted } = useIntro()
    const { mode, setMode } = useQuality()

    if (!booted) return null

    return (
        <div className="absolute inset-0 z-20 w-full h-full pointer-events-none flex flex-col justify-between p-6 md:p-12 text-white overflow-hidden">
            <header className="flex justify-between items-start">
                <div className="pointer-events-auto flex flex-col gap-2">
                    <h1 className="text-6xl md:text-8xl font-bold tracking-tighter leading-none select-none drop-shadow-[0_0_10px_rgba(0,255,255,0.5)]">
                        VRRGL
                    </h1>
                    <div className="flex items-center gap-3 px-4 py-1 border border-cyan-500/30 bg-cyan-900/20 rounded-full w-fit backdrop-blur-sm">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                        </span>
                        <span className="text-[10px] md:text-xs font-mono text-cyan-200 tracking-widest">
                            SYSTEM ONLINE
                        </span>
                    </div>
                </div>

                <nav className="pointer-events-auto flex flex-col gap-3 font-mono text-xs md:text-sm">
                    {['ABOUT', 'PROJECTS', 'CONTACT'].map((item) => (
                        <button
                            key={item}
                            onClick={(e) => e.stopPropagation()}
                            className="group relative px-6 py-2 border border-white/20 rounded-lg bg-black/40 backdrop-blur-md overflow-hidden transition-all hover:border-cyan-500/50 hover:shadow-[0_0_15px_rgba(0,255,255,0.2)] text-right"
                        >
                            <span className="relative z-10 transition-colors group-hover:text-cyan-400">
                                // {item}
                            </span>
                            <div className="absolute inset-0 bg-cyan-500/10 translate-x-full group-hover:translate-x-0 transition-transform duration-300" />
                        </button>
                    ))}
                </nav>
            </header>

            <footer className="flex justify-between items-end">
                <div className="font-mono text-[10px] text-white/40 tracking-widest hidden md:block select-none">
                    {/* ДОБАВЛЕН id="camera-coords" и tabular-nums */}
                    <p id="camera-coords" className="tabular-nums">COORDS: 42.87° N, 74.59° E</p>
                    <div className="h-px w-24 bg-white/20 my-1" />
                    <p>GRID: ACTIVE // TRACE: ON</p>
                </div>

                <div className="pointer-events-auto">
                    <div className="text-[10px] text-cyan-500/80 font-mono mb-2 text-right uppercase tracking-widest">
                        Render Settings
                    </div>
                    <div className="flex gap-1 p-1 bg-black/40 backdrop-blur-md border border-white/10 rounded-lg">
                        {(['low', 'medium', 'high'] as QualityMode[]).map((q) => (
                            <button
                                key={q}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setMode(q);
                                }}
                                className={`px-4 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${mode === q ? 'bg-cyan-500 text-black shadow-[0_0_10px_rgba(0,255,255,0.4)]' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
                            >
                                {q}
                            </button>
                        ))}
                    </div>
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-cyan-500 to-transparent mt-2 opacity-50" />
                </div>
            </footer>

            <div className="absolute top-6 left-6 w-8 h-8 border-t-2 border-l-2 border-cyan-500/30 rounded-tl-lg pointer-events-none" />
            <div className="absolute top-6 right-6 w-8 h-8 border-t-2 border-r-2 border-cyan-500/30 rounded-tr-lg pointer-events-none" />
            <div className="absolute bottom-6 left-6 w-8 h-8 border-b-2 border-l-2 border-cyan-500/30 rounded-bl-lg pointer-events-none" />
            <div className="absolute bottom-6 right-6 w-8 h-8 border-b-2 border-r-2 border-cyan-500/30 rounded-br-lg pointer-events-none" />
        </div>
    )
}