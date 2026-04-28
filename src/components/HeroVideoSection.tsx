/**
 * HeroVideoSection — v13
 *
 * Flicker fix: poster layer is ALWAYS mounted (never conditionally removed),
 * it just transitions opacity to 0. This prevents the 1-frame black gap that
 * occurred when poster unmounted and video faded in during the same React paint.
 *
 * Other fixes:
 * - useCallback for setVideoRef no longer depends on videoSrc (prevents
 *   src-reassignment on every render). src is read from a stable ref instead.
 * - z-index model simplified and documented: video=0, poster=1, gradient=2, content=3
 * - markReady() deduped — only one code path calls setVideoReady(true)
 * - visibilitychange handler resets poster correctly via videoReady state
 */

import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from 'react'
import {
  getHeroVideo,
  cloudinaryMp4Url,
  cloudinaryPosterUrl,
} from '../utils/heroPreload'

export interface HeroVideoSectionProps {
  className?: string
  children?: React.ReactNode
}

function getConnectionInfo() {
  if (typeof navigator === 'undefined') return { isSlow: false, saveData: false }
  const conn =
    (navigator as any).connection ??
    (navigator as any).mozConnection ??
    (navigator as any).webkitConnection
  return {
    isSlow:   conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g',
    saveData: conn?.saveData === true,
  }
}

type AutoplayState = 'unknown' | 'allowed' | 'allowed-muted' | 'disallowed'

function getAutoplayState(): AutoplayState {
  if (typeof navigator === 'undefined') return 'unknown'
  if (typeof (navigator as any).getAutoplayPolicy === 'function') {
    return (navigator as any).getAutoplayPolicy('mediaelement') as AutoplayState
  }
  return 'allowed-muted'
}

let _styleInjected = false
function injectControlHideStyle() {
  if (_styleInjected || typeof document === 'undefined') return
  _styleInjected = true
  const el = document.createElement('style')
  el.textContent = `
    [data-hero-video]                                                { pointer-events:none!important; outline:none!important; }
    [data-hero-video]::-webkit-media-controls                        { display:none!important; opacity:0!important; }
    [data-hero-video]::-webkit-media-controls-enclosure             { display:none!important; opacity:0!important; }
    [data-hero-video]::-webkit-media-controls-panel                 { display:none!important; opacity:0!important; }
    [data-hero-video]::-webkit-media-controls-play-button           { display:none!important; opacity:0!important; }
    [data-hero-video]::-webkit-media-controls-overlay-play-button   { display:none!important; opacity:0!important; }
    [data-hero-video]::-webkit-media-controls-start-playback-button { display:none!important; opacity:0!important; }
    [data-hero-video]::--internal-media-controls-button-panel       { display:none!important; opacity:0!important; }
  `
  document.head.prepend(el)
}

const FILL_STYLE: React.CSSProperties = {
  position:       'absolute',
  inset:          0,
  width:          '100%',
  height:         '100%',
  objectFit:      'cover',
  objectPosition: 'center',
  display:        'block',
  pointerEvents:  'none',
  userSelect:     'none',
}

const HeroVideoSection: React.FC<HeroVideoSectionProps> = ({ className = '', children }) => {
  useEffect(() => { injectControlHideStyle() }, [])

  const videoRef    = useRef<HTMLVideoElement>(null)
  // Stable ref for the current video src — avoids re-running setVideoRef on every render
  const videoSrcRef = useRef<string>('')

  const [videoReady,     setVideoReady]     = useState(false)
  const [publicId,       setPublicId]       = useState(() => getHeroVideo().public_id)
  const [posterStamp,    setPosterStamp]    = useState(() => getHeroVideo().posterStamp)
  const [videoKey,       setVideoKey]       = useState(0)
  const [showPlayButton, setShowPlayButton] = useState(false)

  const { isSlow, saveData } = useMemo(getConnectionInfo, [])
  const skipVideo  = isSlow || saveData
  const preloadVal = isSlow ? 'metadata' : 'auto'
  const autoplayState = useMemo(getAutoplayState, [])

  const videoSrc = useMemo(() => cloudinaryMp4Url(publicId), [publicId])
  // Keep src ref in sync so the ref callback always reads the latest value
  videoSrcRef.current = videoSrc

  // ── Ref callback ─────────────────────────────────────────────────────────────
  // Stable (no deps) — reads src from ref to avoid re-running on every render,
  // which was causing a brief src-reassignment flicker on Chrome.
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el
    if (!el) return
    el.setAttribute('muted',              '')
    el.setAttribute('playsinline',        '')
    el.setAttribute('webkit-playsinline', '')
    el.setAttribute('x-webkit-airplay',   'deny')
    el.muted  = true
    el.volume = 0
    el.src    = videoSrcRef.current
    el.play().catch(() => {})
  }, []) // intentionally stable — reads src from ref

  // CMS replacement listener
  useEffect(() => {
    const handler = (e: Event) => {
      const { publicId: newId, stamp } =
        (e as CustomEvent<{ publicId: string; stamp: number }>).detail ?? {}
      if (newId) {
        setVideoReady(false)
        setShowPlayButton(false)
        if (newId !== publicId) setPublicId(newId)
        else                    setVideoKey((k) => k + 1)
      }
      if (typeof stamp === 'number' && stamp !== posterStamp) setPosterStamp(stamp)
    }
    window.addEventListener('heroVideoChanged', handler)
    return () => window.removeEventListener('heroVideoChanged', handler)
  }, [publicId, posterStamp])

  // Posters
  const posterUrl    = useMemo(() => cloudinaryPosterUrl(publicId, 1920, 'good', posterStamp), [publicId, posterStamp])
  const poster480    = useMemo(() => cloudinaryPosterUrl(publicId,  480, 'eco',  posterStamp), [publicId, posterStamp])
  const poster960    = useMemo(() => cloudinaryPosterUrl(publicId,  960, 'eco',  posterStamp), [publicId, posterStamp])
  const posterSrcSet = useMemo(
    () => `${poster480} 480w, ${poster960} 960w, ${posterUrl} 1920w`,
    [poster480, poster960, posterUrl]
  )

  // ── Main playback effect ─────────────────────────────────────────────────────
  useEffect(() => {
    if (skipVideo) return
    if (autoplayState === 'disallowed') {
      setShowPlayButton(true)
      return
    }

    const video = videoRef.current
    if (!video) return

    video.muted = true
    video.setAttribute('muted', '')

    let destroyed = false

    // Single path to "ready" — wait for a real painted frame before revealing.
    // This is the core flicker fix: we only drop the poster once a frame is
    // actually on screen, so there is never a black gap.
    const markReady = () => {
      if (destroyed) return
      if (typeof (video as any).requestVideoFrameCallback === 'function') {
        ;(video as any).requestVideoFrameCallback(() => {
          if (!destroyed) {
            setVideoReady(true)
            setShowPlayButton(false)
          }
        })
      } else {
        setVideoReady(true)
        setShowPlayButton(false)
      }
    }

    let revealTimer: number | undefined

    const attemptPlay = () => {
      video.muted = true
      const p = video.play()
      if (!p) return
      p.then(() => {
        window.clearTimeout(revealTimer)
        setShowPlayButton(false)
      }).catch(() => {
        if (destroyed) return
        revealTimer = window.setTimeout(() => {
          if (destroyed || !video.paused) return
          setShowPlayButton(true)
          const gesturePlay = () => {
            video.muted = true
            video.play()
              .then(() => setShowPlayButton(false))
              .catch(() => {})
            document.removeEventListener('touchstart', gesturePlay)
            document.removeEventListener('click',      gesturePlay)
          }
          document.addEventListener('touchstart', gesturePlay, { once: true })
          document.addEventListener('click',      gesturePlay, { once: true })
        }, 800)
        video.addEventListener('playing', () => window.clearTimeout(revealTimer), { once: true })
      })
    }

    const onPlaying  = () => markReady()
    const onLoadedData = () => { if (!destroyed && video.paused) attemptPlay() }
    const onError = () => {
      if (destroyed || !video.error) return
      console.warn('[HeroVideo] error', video.error.code, video.error.message)
    }

    video.addEventListener('playing',    onPlaying,     { once: true })
    video.addEventListener('loadeddata', onLoadedData,  { once: true })
    video.addEventListener('error',      onError)

    if (
      video.networkState === HTMLMediaElement.NETWORK_EMPTY ||
      video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
    ) {
      video.load()
    }

    let observer: IntersectionObserver | null = null
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            observer?.disconnect()
            attemptPlay()
          }
        },
        { threshold: 0 }
      )
      observer.observe(video)
    } else {
      attemptPlay()
    }

    return () => {
      destroyed = true
      window.clearTimeout(revealTimer)
      observer?.disconnect()
      video.removeEventListener('playing',    onPlaying)
      video.removeEventListener('error',      onError)
      video.removeEventListener('loadeddata', onLoadedData)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [skipVideo, autoplayState, publicId, videoKey])

  // ── Tab visibility ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (skipVideo) return
    const handle = () => {
      const video = videoRef.current
      if (!video) return
      if (document.visibilityState === 'hidden') {
        // Drop ready state so poster re-covers on tab return (avoids stale frame)
        setVideoReady(false)
      } else {
        video.muted = true
        video.play().catch(() => {})
        // markReady will fire again via 'playing' event
      }
    }
    document.addEventListener('visibilitychange', handle)
    return () => document.removeEventListener('visibilitychange', handle)
  }, [skipVideo])

  const handleManualPlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    video.play()
      .then(() => setShowPlayButton(false))
      .catch(() => {})
  }, [])

  // Poster is ALWAYS rendered — opacity animates to 0 when video is ready.
  // This keeps a pixel-perfect cover over the video at all times, eliminating
  // the 1-frame black gap that occurred when the poster unmounted during the
  // same React paint cycle as the video fade-in.
  const posterOpaque = !videoReady || skipVideo

  return (
    <section
      className={`relative h-screen w-full overflow-hidden flex flex-col ${className}`}
      style={{ backgroundColor: '#111' }}
    >
      {/* z=0 — video layer */}
      {!skipVideo && (
        <div
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}
        >
          <video
            key={`${publicId}-${videoKey}`}
            ref={setVideoRef}
            autoPlay
            muted
            loop
            playsInline
            controls={false}
            disablePictureInPicture
            preload={preloadVal}
            {...({
              disableRemotePlayback:  true,
              'webkit-playsinline':   'true',
              'x-webkit-airplay':     'deny',
              'data-hero-video':      'true',
            } as any)}
            style={{
              ...FILL_STYLE,
              // Video is always opacity:1 — the poster on top controls visibility.
              // No transition needed here; the crossfade lives entirely in the poster.
              opacity: 1,
            }}
          />
        </div>
      )}

      {/* z=1 — poster layer (always mounted, fades out when video is playing) */}
      <div
        onClick={showPlayButton ? handleManualPlay : undefined}
        aria-hidden="true"
        style={{
          ...FILL_STYLE,
          zIndex:     1,
          cursor:     showPlayButton ? 'pointer' : 'default',
          // Fade out poster to reveal video. Stay mounted so there is never
          // a frame where neither layer covers the background.
          opacity:    posterOpaque ? 1 : 0,
          transition: posterOpaque ? 'none' : 'opacity 0.5s ease',
          // Once fully transparent, stop intercepting pointer events
          pointerEvents: posterOpaque ? 'auto' : 'none',
        }}
      >
        <img
          key={`poster-${publicId}-${posterStamp}`}
          src={posterUrl}
          srcSet={posterSrcSet}
          sizes="100vw"
          alt=""
          aria-hidden="true"
          {...({ fetchpriority: 'high' } as any)}
          decoding="sync"
          style={{ ...FILL_STYLE }}
        />

        {showPlayButton && (
          <div
            aria-label="Play video"
            style={{
              position:       'absolute',
              inset:          0,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              background:     'rgba(0,0,0,0.25)',
            }}
          >
            <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
              <circle cx="36" cy="36" r="36" fill="rgba(255,255,255,0.15)" />
              <polygon points="29,22 54,36 29,50" fill="white" />
            </svg>
          </div>
        )}
      </div>

      {/* z=2 — gradient overlay */}
      <div
        aria-hidden="true"
        style={{
          position:      'absolute',
          inset:         0,
          zIndex:        2,
          background:    'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* z=3 — content */}
      <div className="relative w-full h-full" style={{ zIndex: 3 }}>
        {children}
      </div>
    </section>
  )
}

export default HeroVideoSection
