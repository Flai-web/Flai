/**
 * HeroVideoSection — v8
 *
 * ─── Why Safari shows a play button and how we stop it ───────────────────────
 *
 * Safari renders its native play-button overlay whenever a <video> element
 * enters a "waiting for user gesture" state. This happens in three ways:
 *
 *   1. The `autoPlay` JSX prop emits autoplay="" in the HTML. Safari sees this
 *      and immediately decides autoplay policy applies, shows the overlay while
 *      it decides whether to allow it.
 *
 *   2. The `muted` JSX prop is applied as a React property, not an HTML
 *      attribute. Safari reads the *attribute* at parse time to decide if
 *      muted-autoplay is allowed. If the attribute isn't present in the initial
 *      HTML Safari blocks autoplay and shows the overlay.
 *
 *   3. Any gap between the video element mounting and play() being called gives
 *      Safari time to render the overlay.
 *
 * Fix:
 *   - Remove the `autoPlay` JSX prop entirely — never let Safari see autoplay=""
 *   - Set `muted` as both prop AND attribute via a ref callback so the attribute
 *     is present before the browser parses the element
 *   - Call video.play() synchronously inside the effect, before any await/tick
 *   - Keep all the ::-webkit-media-controls CSS, pointer-events:none,
 *     overflow:hidden wrapper, x-webkit-airplay="deny", disablePictureInPicture,
 *     disableRemotePlayback, and controls={false}
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
  videoUrl?: string
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

// ─── Control-hide CSS ─────────────────────────────────────────────────────────
// Injected once as a real <style> block — pseudo-elements can't be set inline.
// Scoped to [data-hero-video] to avoid affecting other video elements.

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
  // Prepend so it wins over any later generic `video` rules
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
  // Inject control-hide CSS before first paint
  useEffect(() => { injectControlHideStyle() }, [])

  const videoRef = useRef<HTMLVideoElement>(null)

  const [videoReady,  setVideoReady]  = useState(false)
  const [publicId,    setPublicId]    = useState(() => getHeroVideo().public_id)
  const [posterStamp, setPosterStamp] = useState(() => getHeroVideo().posterStamp)
  const [videoKey,    setVideoKey]    = useState(0)

  const videoSrc = useMemo(
    () => videoKey === 0
      ? cloudinaryMp4Url(publicId)
      : `${cloudinaryMp4Url(publicId)}?_cb=${videoKey}`,
    [publicId, videoKey]
  )

  // Ref callback: sets muted as an *attribute* (not just a React prop) before
  // Safari parses the element, satisfying the muted-autoplay requirement.
  // Also stamps every required attribute directly so there's no gap.
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el
    if (!el) return
    el.setAttribute('muted', '')
    el.setAttribute('playsinline', '')
    el.setAttribute('webkit-playsinline', '')
    el.setAttribute('x-webkit-airplay', 'deny')
    el.muted = true   // IDL property as well — belt and suspenders
  }, [])

  // CMS-side video replacement
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

  // Poster
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

    // Ensure muted attribute is set even if ref callback was missed (SSR hydration)
    video.muted = true
    video.setAttribute('muted', '')

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
      video.removeEventListener('playing',    onFirstFrame)
      video.removeEventListener('canplay',    onFirstFrame)
      video.removeEventListener('timeupdate', onFirstFrameTimeUpdate)

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

    const onFirstFrameTimeUpdate = () => {
      if (destroyed || video.currentTime <= 0) return
      onFirstFrame()
    }

    markVideoReadyRef.current = onFirstFrame

    // ── Play — called directly, no autoPlay prop ──────────────────────────────
    // Not using the `autoPlay` JSX prop because Safari renders its overlay the
    // moment it sees autoplay="" while deciding whether to allow it.
    // Calling play() from JS skips that state entirely on muted videos.
    const attemptPlay = () => {
      // Re-assert muted every attempt — some browsers reset it
      video.muted = true
      const p = video.play()
      if (!p) return
      p.catch(() => {
        if (destroyed) return
        // Wait for enough data, then retry — works on many Android builds
        // without needing a gesture
        const onCPT = () => {
          if (destroyed) return
          video.removeEventListener('canplaythrough', onCPT)
          video.muted = true
          video.play().catch(() => {
            if (destroyed) return
            // Genuinely blocked — wait for first gesture
            const gestureRetry = () => {
              video.muted = true
              video.play().catch(() => {})
              document.removeEventListener('touchstart', gestureRetry)
              document.removeEventListener('click',      gestureRetry)
            }
            document.addEventListener('touchstart', gestureRetry, { once: true })
            document.addEventListener('click',      gestureRetry, { once: true })
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
      }, 8_000)
    }

    const reloadWithCacheBust = () => {
      if (destroyed || retries >= MAX_RETRIES) return
      retries++
      clearStallTimer()
      clearWaitingTimer()
      video.removeEventListener('playing',    onFirstFrame)
      video.removeEventListener('canplay',    onFirstFrame)
      video.removeEventListener('timeupdate', onFirstFrameTimeUpdate)
      const bustUrl = `${cloudinaryMp4Url(publicId)}?_cb=${Date.now()}`
      video.src = bustUrl
      video.load()
      video.addEventListener('playing',    onFirstFrame,          { once: true })
      video.addEventListener('canplay',    onFirstFrame,          { once: true })
      video.addEventListener('timeupdate', onFirstFrameTimeUpdate)
      armStallTimer()
      attemptPlay()
    }

    const onError = () => {
      if (destroyed) return
      if (video.error === null) return
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
        video.currentTime = video.currentTime
        attemptPlay()
        waitingTimer = setTimeout(() => {
          if (destroyed || !video.paused) return
          reloadWithCacheBust()
        }, 5_000)
      }, 5_000)
    }

    const onPlaying = () => { if (!destroyed) clearWaitingTimer() }

    // Attach ALL listeners before load/play — no events missed
    video.addEventListener('playing',    onFirstFrame,          { once: true })
    video.addEventListener('canplay',    onFirstFrame,          { once: true })
    video.addEventListener('timeupdate', onFirstFrameTimeUpdate)
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
    attemptPlay()   // <-- JS-driven play, no autoPlay attribute

    return () => {
      destroyed = true
      destroyedRef.current = true
      markVideoReadyRef.current = null
      clearStallTimer()
      clearWaitingTimer()
      video.removeEventListener('playing',    onFirstFrame)
      video.removeEventListener('canplay',    onFirstFrame)
      video.removeEventListener('timeupdate', onFirstFrameTimeUpdate)
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
        if (video.paused) {
          video.muted = true
          video.play().catch(() => {})
        }
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
        // overflow:hidden clips any native control bar that bleeds outside
        // the video bounds on iOS Safari / Android WebView
        <div
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}
        >
          <video
            key={`${publicId}-${videoKey}`}
            ref={setVideoRef}
            src={videoSrc}
            // NO autoPlay prop — play() is called from JS to avoid Safari
            // rendering its overlay while deciding autoplay policy
            muted
            loop
            playsInline
            controls={false}
            disablePictureInPicture
            preload="auto"
            {...({
              disableRemotePlayback: true,
              'data-hero-video':     'true',
            } as any)}
            style={{ ...FILL_STYLE }}
          />
        </div>
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
