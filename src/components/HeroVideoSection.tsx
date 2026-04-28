/**
 * HeroVideoSection — v6
 *
 * ─── Speed improvements over v5 ──────────────────────────────────────────────
 *
 * 1. DNS prefetch + preconnect injected at MODULE LOAD TIME (not in useEffect)
 *    The browser resolves res.cloudinary.com DNS and opens a TLS connection
 *    before React even hydrates. On a cold load this saves ~150–300 ms.
 *
 * 2. <link rel="preload" as="video"> injected as early as possible
 *    Called synchronously inside useMemo (first render) so the browser starts
 *    fetching video bytes at highest network priority in parallel with React
 *    rendering. Without this the browser doesn't discover the src until after
 *    the first paint, costing 1–2 full render cycles.
 *
 * 3. readyState fast-path on mount
 *    If the video element already has buffered data (BF-cache restore, or the
 *    preload link caused the browser to buffer before the effect ran) we skip
 *    the event-listener path entirely and call markReady() synchronously.
 *
 * 4. 'loadeddata' cancels the stall timer
 *    The browser has the first frame decoded → a network stall is impossible
 *    at that point. Cancelling the timer avoids a spurious cache-bust reload.
 *
 * 5. Stall timeout 8 s → 5 s
 *    Cloudinary CDN responds in <200 ms under normal conditions. 5 s is still
 *    safe for 3G mobile while recovering ~3 s sooner on a real stall.
 *
 * 6. Controls fully suppressed (carried over from v5)
 *    controls={false}, disablePictureInPicture, disableRemotePlayback,
 *    pointer-events:none, and injected ::-webkit-media-controls CSS.
 */

import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
} from 'react'
import {
  getHeroVideo,
  cloudinaryMp4Url,
  cloudinaryPosterUrl,
} from '../utils/heroPreload'

export interface HeroVideoSectionProps {
  className?: string
  children?: React.ReactNode
  videoUrl?: string
}

// ─── Connection helpers ───────────────────────────────────────────────────────

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

// ─── One-time module-level network hints ─────────────────────────────────────
// Runs before React hydrates — gives the browser maximum lead time.
;(function injectNetworkHints() {
  if (typeof document === 'undefined') return
  const head = document.head
  const CDN  = 'https://res.cloudinary.com'

  const alreadyHas = (rel: string, href: string) =>
    !!head.querySelector(`link[rel="${rel}"][href="${href}"]`)

  if (!alreadyHas('dns-prefetch', CDN)) {
    const el = document.createElement('link')
    el.rel  = 'dns-prefetch'
    el.href = CDN
    head.prepend(el)
  }

  if (!alreadyHas('preconnect', CDN)) {
    const el       = document.createElement('link')
    el.rel         = 'preconnect'
    el.href        = CDN
    el.crossOrigin = 'anonymous'
    head.prepend(el)
  }
})()

// ─── <link rel="preload" as="video"> ─────────────────────────────────────────
// Injected on first render (via useMemo) so the browser fetches video bytes
// at max priority before the <video> element even mounts.
let _preloadEl: HTMLLinkElement | null = null

function injectVideoPreload(src: string) {
  if (typeof document === 'undefined') return
  if (_preloadEl) {
    if (_preloadEl.getAttribute('href') === src) return  // already correct
    _preloadEl.remove()
    _preloadEl = null
  }
  const el       = document.createElement('link')
  el.rel         = 'preload'
  el.as          = 'video'
  el.type        = 'video/mp4'
  el.href        = src
  el.crossOrigin = 'anonymous'
  document.head.prepend(el)
  _preloadEl = el
}

// ─── Control-hide CSS ─────────────────────────────────────────────────────────
// Must be a real stylesheet rule — pseudo-elements can't be targeted via style={}

const CONTROL_HIDE_CSS = `
  video::-webkit-media-controls                       { display: none !important; }
  video::-webkit-media-controls-enclosure             { display: none !important; }
  video::-webkit-media-controls-panel                 { display: none !important; }
  video::-webkit-media-controls-play-button           { display: none !important; }
  video::-webkit-media-controls-start-playback-button { display: none !important; }
  video::--internal-media-controls-button-panel       { display: none !important; }
`
let _styleInjected = false
function injectControlHideStyle() {
  if (_styleInjected || typeof document === 'undefined') return
  _styleInjected = true
  const el = document.createElement('style')
  el.textContent = CONTROL_HIDE_CSS
  document.head.appendChild(el)
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const FILL_STYLE: React.CSSProperties = {
  position:       'absolute',
  inset:          0,
  width:          '100%',
  height:         '100%',
  objectFit:      'cover',
  objectPosition: 'center',
  display:        'block',
  pointerEvents:  'none',   // prevent tap from triggering iOS overlay play button
}

// ─── Component ────────────────────────────────────────────────────────────────

const HeroVideoSection: React.FC<HeroVideoSectionProps> = ({ className = '', children }) => {
  useEffect(() => { injectControlHideStyle() }, [])

  const videoRef = useRef<HTMLVideoElement>(null)

  const [videoReady,  setVideoReady]  = useState(false)
  const [publicId,    setPublicId]    = useState(() => getHeroVideo().public_id)
  const [posterStamp, setPosterStamp] = useState(() => getHeroVideo().posterStamp)
  const [videoKey,    setVideoKey]    = useState(0)

  // Derive video src. Injects preload link immediately on every src change.
  const videoSrc = useMemo(() => {
    const base = cloudinaryMp4Url(publicId)
    const src  = videoKey === 0 ? base : `${base}?_cb=${videoKey}`
    injectVideoPreload(src)   // called synchronously — browser starts fetching now
    return src
  }, [publicId, videoKey])

  // CMS-side video replacement events
  useEffect(() => {
    const handler = (e: Event) => {
      const { publicId: newId, stamp } =
        (e as CustomEvent<{ publicId: string; stamp: number }>).detail ?? {}

      if (newId) {
        setVideoReady(false)
        if (newId !== publicId) setPublicId(newId)
        else                    setVideoKey((k) => k + 1)
      }
      if (typeof stamp === 'number' && stamp !== posterStamp) {
        setPosterStamp(stamp)
      }
    }
    window.addEventListener('heroVideoChanged', handler)
    return () => window.removeEventListener('heroVideoChanged', handler)
  }, [publicId, posterStamp])

  // Poster URLs
  const posterUrl    = useMemo(() => cloudinaryPosterUrl(publicId, 1920, 'good', posterStamp), [publicId, posterStamp])
  const poster480    = useMemo(() => cloudinaryPosterUrl(publicId,  480, 'eco',  posterStamp), [publicId, posterStamp])
  const poster960    = useMemo(() => cloudinaryPosterUrl(publicId,  960, 'eco',  posterStamp), [publicId, posterStamp])
  const posterSrcSet = useMemo(
    () => `${poster480} 480w, ${poster960} 960w, ${posterUrl} 1920w`,
    [poster480, poster960, posterUrl]
  )

  const [skipVideo] = useState(() => {
    const { isSlow, saveData } = getConnectionInfo()
    return isSlow || saveData
  })

  const markVideoReadyRef = useRef<(() => void) | null>(null)

  // ── Main playback effect ────────────────────────────────────────────────────
  useEffect(() => {
    if (skipVideo) return
    const video = videoRef.current
    if (!video) return

    let destroyed = false
    const destroyedRef = { current: false }

    let retries = 0
    const MAX_RETRIES = 3

    let stallTimer:   ReturnType<typeof setTimeout> | null = null
    let waitingTimer: ReturnType<typeof setTimeout> | null = null

    const clearStallTimer   = () => { if (stallTimer   !== null) { clearTimeout(stallTimer);   stallTimer   = null } }
    const clearWaitingTimer = () => { if (waitingTimer !== null) { clearTimeout(waitingTimer); waitingTimer = null } }

    // ── First-frame detection ─────────────────────────────────────────────────
    const markReady = () => {
      if (destroyed || destroyedRef.current) return
      setVideoReady(true)
    }

    const onFirstFrame = () => {
      if (destroyed) return
      clearStallTimer()

      // Deregister all sibling triggers to prevent double-firing
      video.removeEventListener('playing',    onFirstFrame)
      video.removeEventListener('canplay',    onFirstFrame)
      video.removeEventListener('timeupdate', onFirstFrameTimeUpdate)
      video.removeEventListener('loadeddata', onLoadedData)

      if (typeof (video as any).requestVideoFrameCallback === 'function') {
        ;(video as any).requestVideoFrameCallback(() => markReady())
      } else if (video.readyState >= 2) {
        markReady()
      } else {
        const onTU = () => {
          if (destroyed) return
          video.removeEventListener('timeupdate', onTU)
          setTimeout(markReady, 0)
        }
        video.addEventListener('timeupdate', onTU)
      }
    }

    // Browsers that skip 'playing'/'canplay' and advance currentTime directly
    const onFirstFrameTimeUpdate = () => {
      if (destroyed || video.currentTime <= 0) return
      onFirstFrame()
    }

    // 'loadeddata' = first frame decoded and in buffer.
    // Cancel stall timer immediately; fire onFirstFrame if we have data.
    const onLoadedData = () => {
      if (destroyed) return
      clearStallTimer()
      if (video.readyState >= 2) onFirstFrame()
    }

    markVideoReadyRef.current = onFirstFrame

    // ── Autoplay ──────────────────────────────────────────────────────────────
    const attemptPlay = () => {
      const p = video.play()
      if (!p) return
      p.catch(() => {
        if (destroyed) return
        // Re-try when buffered enough — faster than waiting for a gesture
        // on many Android Chrome builds
        const onCPT = () => {
          if (destroyed) return
          video.removeEventListener('canplaythrough', onCPT)
          video.play().catch(() => {
            if (destroyed) return
            const retry = () => {
              video.play().catch(() => {})
              document.removeEventListener('touchstart', retry)
              document.removeEventListener('click',      retry)
            }
            document.addEventListener('touchstart', retry, { once: true })
            document.addEventListener('click',      retry, { once: true })
          })
        }
        video.addEventListener('canplaythrough', onCPT)
      })
    }

    // ── Stall / retry ─────────────────────────────────────────────────────────
    const armStallTimer = () => {
      clearStallTimer()
      stallTimer = setTimeout(() => {
        if (destroyed || (videoRef.current?.currentTime ?? 0) > 0) return
        reloadWithCacheBust()
      }, 5_000)
    }

    const reloadWithCacheBust = () => {
      if (destroyed || retries >= MAX_RETRIES) return
      retries++
      clearStallTimer()
      clearWaitingTimer()
      video.removeEventListener('playing',    onFirstFrame)
      video.removeEventListener('canplay',    onFirstFrame)
      video.removeEventListener('timeupdate', onFirstFrameTimeUpdate)
      video.removeEventListener('loadeddata', onLoadedData)
      const bustUrl = `${cloudinaryMp4Url(publicId)}?_cb=${Date.now()}`
      injectVideoPreload(bustUrl)
      video.src = bustUrl
      video.load()
      video.addEventListener('playing',    onFirstFrame,            { once: true })
      video.addEventListener('canplay',    onFirstFrame,            { once: true })
      video.addEventListener('timeupdate', onFirstFrameTimeUpdate)
      video.addEventListener('loadeddata', onLoadedData,            { once: true })
      armStallTimer()
      attemptPlay()
    }

    const onError = () => {
      if (destroyed) return
      if (video.error === null) return  // natural abort from src change — ignore
      reloadWithCacheBust()
    }

    const onStalled = () => {
      if (destroyed || (video.currentTime ?? 0) > 0) return
      armStallTimer()
    }

    const onWaiting = () => {
      if (destroyed) return
      clearWaitingTimer()
      waitingTimer = setTimeout(() => {
        if (destroyed || !video.paused) return
        video.currentTime = video.currentTime  // nudge buffer
        attemptPlay()
        waitingTimer = setTimeout(() => {
          if (destroyed || !video.paused) return
          reloadWithCacheBust()
        }, 5_000)
      }, 5_000)
    }

    const onPlaying = () => { if (!destroyed) clearWaitingTimer() }

    // ── Fast-path: video already buffered (BF-cache / preload hit) ────────────
    if (video.readyState >= 3 /* HAVE_FUTURE_DATA */) {
      markReady()
      attemptPlay()
      return () => {
        destroyed = true
        destroyedRef.current = true
        markVideoReadyRef.current = null
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }

    // ── Normal path: attach listeners, then trigger load/play ─────────────────
    video.addEventListener('playing',    onFirstFrame,            { once: true })
    video.addEventListener('canplay',    onFirstFrame,            { once: true })
    video.addEventListener('timeupdate', onFirstFrameTimeUpdate)
    video.addEventListener('loadeddata', onLoadedData,            { once: true })
    video.addEventListener('playing',    onPlaying)
    video.addEventListener('error',      onError)
    video.addEventListener('stalled',    onStalled)
    video.addEventListener('waiting',    onWaiting)

    if (
      video.networkState === HTMLMediaElement.NETWORK_EMPTY ||
      video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
    ) {
      video.load()
    }

    armStallTimer()
    attemptPlay()

    return () => {
      destroyed = true
      destroyedRef.current = true
      markVideoReadyRef.current = null
      clearStallTimer()
      clearWaitingTimer()
      video.removeEventListener('playing',    onFirstFrame)
      video.removeEventListener('canplay',    onFirstFrame)
      video.removeEventListener('timeupdate', onFirstFrameTimeUpdate)
      video.removeEventListener('loadeddata', onLoadedData)
      video.removeEventListener('playing',    onPlaying)
      video.removeEventListener('error',      onError)
      video.removeEventListener('stalled',    onStalled)
      video.removeEventListener('waiting',    onWaiting)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [skipVideo, publicId, videoKey])

  // ── Tab visibility ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (skipVideo) return
    const handleVisibility = () => {
      const video = videoRef.current
      if (!video) return
      if (document.visibilityState === 'hidden') {
        setVideoReady(false)
      } else {
        const onReady = markVideoReadyRef.current
        if (onReady) video.addEventListener('playing', onReady, { once: true })
        if (video.paused) video.play().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [skipVideo])

  const showPosterLayer = !videoReady || skipVideo

  return (
    <section
      className={`relative h-screen w-full overflow-hidden flex flex-col ${className}`}
      style={{ backgroundColor: '#111' }}
    >
      {!skipVideo && (
        <video
          key={`${publicId}-${videoKey}`}
          ref={videoRef}
          src={videoSrc}
          autoPlay
          muted
          loop
          playsInline
          controls={false}
          disablePictureInPicture
          {...({ disableRemotePlayback: true }  as any)}
          {...({ 'webkit-playsinline': 'true',
                 playsinline:          'true' } as any)}
          preload="auto"
          style={{ ...FILL_STYLE, zIndex: 0 }}
        />
      )}

      {showPosterLayer && (
        <img
          key={`poster-${publicId}-${posterStamp}`}
          src={posterUrl}
          srcSet={posterSrcSet}
          sizes="100vw"
          alt=""
          aria-hidden="true"
          {...({ fetchpriority: 'high' } as any)}
          decoding="sync"
          style={{ ...FILL_STYLE, zIndex: 1 }}
        />
      )}

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

      <div className="relative w-full h-full" style={{ zIndex: 3 }}>
        {children}
      </div>
    </section>
  )
}

export default HeroVideoSection
