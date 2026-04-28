/**
 * HeroVideoSection — v12
 *
 * Key changes from v9:
 *  1. preload is always at least "metadata" (was "none" on slow — prevented load)
 *  2. Ref callback calls play() eagerly right after src assignment so iOS Safari
 *     has the best chance of autoplaying without waiting for IntersectionObserver
 *  3. Added "loadeddata" fallback: if "playing" never fires but data is ready,
 *     attempt play() again — covers Firefox and older Safari edge cases
 *  4. play() rejection no longer immediately shows the play button — an 800ms
 *     grace timer is used instead. If 'playing' fires within that window the
 *     timer is cancelled and the button never appears, eliminating the flash
 *     seen on browsers that reject the promise optimistically but still play.
 *  5. Gesture listeners (touchstart + click) both removed after first fire
 *  6. IntersectionObserver threshold lowered to 0 (was 0.01)
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

// ─── Connection speed ─────────────────────────────────────────────────────────

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

// ─── Autoplay policy detection ────────────────────────────────────────────────

type AutoplayState = 'unknown' | 'allowed' | 'allowed-muted' | 'disallowed'

function getAutoplayState(): AutoplayState {
  if (typeof navigator === 'undefined') return 'unknown'
  // Modern API — Chrome 100+, Firefox 112+, Safari 16.4+
  if (typeof (navigator as any).getAutoplayPolicy === 'function') {
    return (navigator as any).getAutoplayPolicy('mediaelement') as AutoplayState
  }
  // Fallback: assume muted autoplay is allowed (true for all major browsers
  // with muted+playsinline, covers the vast majority of real-world cases)
  return 'allowed-muted'
}

// ─── Control-hide CSS ─────────────────────────────────────────────────────────
// Safari renders its own native overlay play button on paused <video> elements
// regardless of controls={false}. We can't reliably suppress it with CSS alone.
// The real fix: keep the <video> element visually hidden (opacity:0, behind the
// poster) while paused — the poster covers it. Once 'playing' fires we fade the
// poster out and the video in. Safari's native button is never visible because
// the element underneath is always covered by our poster layer until it's live.

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

// ─── Shared fill style ────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

const HeroVideoSection: React.FC<HeroVideoSectionProps> = ({ className = '', children }) => {
  useEffect(() => { injectControlHideStyle() }, [])

  const videoRef = useRef<HTMLVideoElement>(null)

  const [videoReady,    setVideoReady]    = useState(false)
  const [publicId,      setPublicId]      = useState(() => getHeroVideo().public_id)
  const [posterStamp,   setPosterStamp]   = useState(() => getHeroVideo().posterStamp)
  const [videoKey,      setVideoKey]      = useState(0)
  // showPlayButton: true when browser has fully blocked autoplay
  const [showPlayButton, setShowPlayButton] = useState(false)

  const { isSlow, saveData } = useMemo(getConnectionInfo, [])
  const skipVideo  = isSlow || saveData
  // Always load at least metadata — 'none' prevents the browser from buffering
  // enough to call play(), which breaks autoplay on slow connections entirely.
  const preloadVal = isSlow ? 'metadata' : 'auto'

  const autoplayState = useMemo(getAutoplayState, [])

  const videoSrc = useMemo(
    () => cloudinaryMp4Url(publicId),
    [publicId]
  )

  // ── Ref callback ─────────────────────────────────────────────────────────────
  // Sets muted as an HTML *attribute* (not just a React prop) before src is
  // assigned, satisfying Safari's parse-time muted-autoplay requirement.
  // Also calls play() eagerly after src assignment — iOS Safari benefits from
  // the play() attempt being as close to src assignment as possible.
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el
    if (!el) return
    // Stamp attributes synchronously, before any src is assigned
    el.setAttribute('muted',            '')
    el.setAttribute('playsinline',      '')
    el.setAttribute('webkit-playsinline', '')
    el.setAttribute('x-webkit-airplay', 'deny')
    el.muted   = true
    el.volume  = 0
    // NOW assign src — browser sees muted attribute already present
    el.src     = videoSrc
    // Eager play attempt immediately after src — best chance on iOS Safari.
    // The main effect's IntersectionObserver will retry if this is too early.
    el.play().catch(() => { /* will retry via IntersectionObserver */ })
  }, [videoSrc])

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
    // If browser says fully disallowed — skip download entirely, show button
    if (autoplayState === 'disallowed') {
      setShowPlayButton(true)
      return
    }

    const video = videoRef.current
    if (!video) return

    video.muted = true
    video.setAttribute('muted', '')

    let destroyed = false

    const markReady = () => {
      if (destroyed) return
      setVideoReady(true)
      setShowPlayButton(false)
    }

    const onPlaying = () => {
      if (destroyed) return
      if (typeof (video as any).requestVideoFrameCallback === 'function') {
        ;(video as any).requestVideoFrameCallback(() => markReady())
      } else {
        markReady()
      }
    }

    let revealTimer: number | undefined

    const attemptPlay = () => {
      video.muted = true
      const p = video.play()
      if (!p) return
      p.then(() => {
        // Play succeeded — ensure button is never shown
        window.clearTimeout(revealTimer)
        setShowPlayButton(false)
      }).catch(() => {
        if (destroyed) return
        // play() rejected. Many browsers fire this even when autoplay will
        // succeed shortly (e.g. data not buffered yet). Wait a grace period
        // before showing the button — if 'playing' fires in the meantime
        // the reveal is cancelled so the button never flashes.
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
        // If video starts playing within grace period, cancel the reveal
        video.addEventListener('playing', () => window.clearTimeout(revealTimer), { once: true })
      })
    }

    // Fallback: if 'playing' never fires but data has arrived, try play() again.
    // Covers Firefox and older Safari where autoPlay attribute alone isn't enough.
    const onLoadedData = () => {
      if (destroyed || !video.paused) return
      attemptPlay()
    }
    video.addEventListener('loadeddata', onLoadedData, { once: true })

    const onError = () => {
      if (destroyed || !video.error) return
      console.warn('[HeroVideo] error', video.error.code, video.error.message)
      // Don't cache-bust in a loop; let the poster show and log the issue
    }

    video.addEventListener('playing', onPlaying, { once: true })
    video.addEventListener('error',   onError)

    if (video.networkState === HTMLMediaElement.NETWORK_EMPTY ||
        video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
      video.load()
    }

    // Use IntersectionObserver so play() fires when element is actually visible.
    // threshold:0 means even 1px visible triggers play — important on mobile
    // where the hero may be partially clipped during initial render.
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
        setVideoReady(false)
      } else if (video.paused) {
        video.muted = true
        video.play().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handle)
    return () => document.removeEventListener('visibilitychange', handle)
  }, [skipVideo])

  // ── Manual play (when autoplay was blocked) ──────────────────────────────────
  const handleManualPlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    video.play()
      .then(() => setShowPlayButton(false))
      .catch(() => {})
  }, [])

  const showPosterLayer = !videoReady || skipVideo

  return (
    <section
      className={`relative h-screen w-full overflow-hidden flex flex-col ${className}`}
      style={{ backgroundColor: '#111' }}
    >
      {!skipVideo && (
        <div
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}
        >
          <video
            key={`${publicId}-${videoKey}`}
            ref={setVideoRef}
            // autoPlay: safe now that muted attribute is guaranteed set before src
            // Omit src here — ref callback assigns it after stamping attributes
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
              // Keep video invisible until actually playing.
              // This ensures Safari's native overlay play button is never
              // visible — the poster image sits on top until 'playing' fires.
              opacity: videoReady ? 1 : 0,
              transition: 'opacity 0.4s ease',
            }}
          />
        </div>
      )}

      {showPosterLayer && (
        /* Poster doubles as the click-to-play target when autoplay is blocked.
           It covers the video element entirely, so Safari's native play button
           is never shown. A subtle tap/click anywhere on the poster triggers
           play() synchronously inside a real user-gesture handler. */
        <div
          onClick={showPlayButton ? handleManualPlay : undefined}
          style={{
            ...FILL_STYLE,
            zIndex:  1,
            cursor:  showPlayButton ? 'pointer' : 'default',
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
          {/* Minimal play hint — shown only when autoplay is truly blocked */}
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
      )}

      {/* Gradient overlay */}
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

      {/* Play hint is now embedded in the poster layer above — no separate overlay needed */}

      <div className="relative w-full h-full" style={{ zIndex: 3 }}>
        {children}
      </div>
    </section>
  )
}

export default HeroVideoSection
