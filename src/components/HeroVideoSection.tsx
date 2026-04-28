/**
 * HeroVideoSection — v5
 *
 * ─── Changes from v4 ─────────────────────────────────────────────────────────
 *
 * 1. Controls hidden — visually and at the browser level
 *    Added controls={false}, disablePictureInPicture, disableRemotePlayback and
 *    a <style> block that sets `video::-webkit-media-controls { display:none }`
 *    and `video { pointer-events: none }` on the video element.
 *    iOS Safari will show a native overlay play button when autoplay is blocked;
 *    hiding pointer-events prevents taps from toggling that overlay and the CSS
 *    pseudo-element kills the control bar / AirPlay button.
 *
 * 2. Faster first-frame recovery on autoplay block
 *    When video.play() rejects (common on iOS before a gesture), we now also
 *    listen on 'canplaythrough' so the moment the browser signals it has enough
 *    data we re-attempt play — instead of waiting for an arbitrary user click.
 *    This halves the delay on low-end Android Chrome which sometimes fires
 *    'canplaythrough' before the gesture restriction is lifted.
 *
 * 3. onFirstFrame now also fires on 'timeupdate' immediately (currentTime > 0)
 *    Some browsers (old Safari, some WebViews) skip 'playing' and go straight to
 *    updating currentTime. A single 'timeupdate' guard catches that path without
 *    an extra setTimeout.
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

const FILL_STYLE: React.CSSProperties = {
  position:       'absolute',
  inset:          0,
  width:          '100%',
  height:         '100%',
  objectFit:      'cover',
  objectPosition: 'center',
  display:        'block',
  // Suppress any browser-injected play overlay from receiving pointer events.
  // The native control bar is hidden via the CSS pseudo-element below.
  pointerEvents:  'none',
}

// Injected once at module level — hides native video controls cross-browser.
// Using a <style> tag (not inline CSS) because pseudo-elements like
// ::-webkit-media-controls cannot be targeted via the style attribute.
const CONTROL_HIDE_CSS = `
  video::-webkit-media-controls            { display: none !important; }
  video::-webkit-media-controls-enclosure  { display: none !important; }
  video::-webkit-media-controls-panel      { display: none !important; }
  video::-webkit-media-controls-play-button{ display: none !important; }
  video::-webkit-media-controls-start-playback-button { display: none !important; }
  video::--internal-media-controls-button-panel        { display: none !important; }
`

let styleInjected = false
function injectControlHideStyle() {
  if (styleInjected || typeof document === 'undefined') return
  styleInjected = true
  const el = document.createElement('style')
  el.textContent = CONTROL_HIDE_CSS
  document.head.appendChild(el)
}

const HeroVideoSection: React.FC<HeroVideoSectionProps> = ({ className = '', children }) => {
  // Inject the CSS rule once on first render (client only)
  useEffect(() => { injectControlHideStyle() }, [])

  const videoRef = useRef<HTMLVideoElement>(null)

  const [videoReady, setVideoReady] = useState(false)

  const [publicId,    setPublicId]    = useState(() => getHeroVideo().public_id)
  const [posterStamp, setPosterStamp] = useState(() => getHeroVideo().posterStamp)
  const [videoKey,    setVideoKey]    = useState(0)

  // src as a JSX prop — browser and effect start from the same state.
  const videoSrc = useMemo(
    () => videoKey === 0
      ? cloudinaryMp4Url(publicId)
      : `${cloudinaryMp4Url(publicId)}?_cb=${videoKey}`,
    [publicId, videoKey]
  )

  // Listen for CMS-side video replacements
  useEffect(() => {
    const handler = (e: Event) => {
      const { publicId: newId, stamp } =
        (e as CustomEvent<{ publicId: string; stamp: number }>).detail ?? {}

      if (newId) {
        setVideoReady(false)
        if (newId !== publicId) {
          setPublicId(newId)
        } else {
          setVideoKey((k) => k + 1)
        }
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
    // Priority: requestVideoFrameCallback > readyState check > timeupdate tick
    const markReady = () => {
      if (destroyed || destroyedRef.current) return
      setVideoReady(true)
    }

    const onFirstFrame = () => {
      if (destroyed) return
      clearStallTimer()

      // Remove sibling triggers so markReady isn't called twice
      video.removeEventListener('playing',      onFirstFrame)
      video.removeEventListener('canplay',      onFirstFrame)
      video.removeEventListener('timeupdate',   onFirstFrameTimeUpdate)

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

    // Catch browsers that skip 'playing'/'canplay' and go straight to advancing time
    const onFirstFrameTimeUpdate = () => {
      if (destroyed || video.currentTime <= 0) return
      onFirstFrame()
    }

    markVideoReadyRef.current = onFirstFrame

    // ── Autoplay attempt ──────────────────────────────────────────────────────
    const attemptPlay = () => {
      const p = video.play()
      if (!p) return
      p.catch(() => {
        if (destroyed) return

        // Re-attempt as soon as the browser has enough data buffered —
        // faster than waiting for a click on many Android devices.
        const onCanPlayThrough = () => {
          if (destroyed) return
          video.removeEventListener('canplaythrough', onCanPlayThrough)
          video.play().catch(() => {
            // Still blocked — fall back to gesture
            const gestureRetry = () => {
              video.play().catch(() => {})
              document.removeEventListener('touchstart', gestureRetry)
              document.removeEventListener('click',      gestureRetry)
            }
            document.addEventListener('touchstart', gestureRetry, { once: true })
            document.addEventListener('click',      gestureRetry, { once: true })
          })
        }
        video.addEventListener('canplaythrough', onCanPlayThrough)
      })
    }

    // ── Stall / retry logic ───────────────────────────────────────────────────
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
      video.addEventListener('playing',    onFirstFrame,            { once: true })
      video.addEventListener('canplay',    onFirstFrame,            { once: true })
      video.addEventListener('timeupdate', onFirstFrameTimeUpdate)
      armStallTimer()
      attemptPlay()
    }

    const onError = () => {
      if (destroyed) return
      if (video.error === null) return  // 'abort'/'emptied' from src change — ignore
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

    // Attach ALL listeners before touching src/load/play
    video.addEventListener('playing',    onFirstFrame,            { once: true })
    video.addEventListener('canplay',    onFirstFrame,            { once: true })
    video.addEventListener('timeupdate', onFirstFrameTimeUpdate)
    video.addEventListener('playing',    onPlaying)
    video.addEventListener('error',      onError)
    video.addEventListener('stalled',    onStalled)
    video.addEventListener('waiting',    onWaiting)

    // Only call load() if the element hasn't started fetching yet
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
      video.removeEventListener('playing',    onPlaying)
      video.removeEventListener('error',      onError)
      video.removeEventListener('stalled',    onStalled)
      video.removeEventListener('waiting',    onWaiting)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [skipVideo, publicId, videoKey])

  // Tab visibility — show poster immediately on hide, resume on show
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
          // Suppress Picture-in-Picture button (Chrome, Safari)
          disablePictureInPicture
          // Suppress AirPlay / Cast button (Safari, Chrome)
          {...({ disableRemotePlayback: true } as any)}
          // iOS Safari legacy attributes
          {...({ 'webkit-playsinline': 'true', playsinline: 'true' } as any)}
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
