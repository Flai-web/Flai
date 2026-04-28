/**
 * HeroVideoSection — v5 (restored)
 *
 * Reverted to the exact logic that was confirmed working.
 * All v6/v7 "speed" changes have been removed — they broke playback.
 *
 * What this version does:
 * - src set as JSX prop so browser and effect start in sync (no abort/emptied)
 * - Listeners attached BEFORE load/play (no race condition)
 * - 'playing' + 'canplay' + timeupdate as three paths to onFirstFrame
 * - canplaythrough retry before falling back to gesture (faster on Android)
 * - controls={false}, disablePictureInPicture, disableRemotePlayback
 * - ::-webkit-media-controls CSS injected via <style> tag (can't use style attr)
 * - pointer-events:none on video prevents tap triggering iOS overlay
 * - overflow:hidden wrapper clips any control bar that bleeds outside bounds
 * - x-webkit-airplay="deny" suppresses AirPlay overlay
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

// Injected once — hides native video controls cross-browser.
// Must be a real <style> rule; ::-webkit-media-controls can't be set via style={}
let _styleInjected = false
function injectControlHideStyle() {
  if (_styleInjected || typeof document === 'undefined') return
  _styleInjected = true
  const el = document.createElement('style')
  el.textContent = `
    [data-hero-video]::-webkit-media-controls                       { display:none!important; }
    [data-hero-video]::-webkit-media-controls-enclosure             { display:none!important; }
    [data-hero-video]::-webkit-media-controls-panel                 { display:none!important; }
    [data-hero-video]::-webkit-media-controls-play-button           { display:none!important; }
    [data-hero-video]::-webkit-media-controls-overlay-play-button   { display:none!important; }
    [data-hero-video]::-webkit-media-controls-start-playback-button { display:none!important; }
    [data-hero-video]::--internal-media-controls-button-panel       { display:none!important; }
    [data-hero-video] { pointer-events:none!important; }
  `
  document.head.appendChild(el)
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
}

const HeroVideoSection: React.FC<HeroVideoSectionProps> = ({ className = '', children }) => {
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

    let retries    = 0
    const MAX_RETRIES = 3
    let stallTimer:   ReturnType<typeof setTimeout> | null = null
    let waitingTimer: ReturnType<typeof setTimeout> | null = null

    const clearStallTimer   = () => { if (stallTimer   !== null) { clearTimeout(stallTimer);   stallTimer   = null } }
    const clearWaitingTimer = () => { if (waitingTimer !== null) { clearTimeout(waitingTimer); waitingTimer = null } }

    const markReady = () => {
      if (destroyed || destroyedRef.current) return
      setVideoReady(true)
    }

    const onFirstFrame = () => {
      if (destroyed) return
      clearStallTimer()

      // Remove sibling triggers so markReady isn't called twice
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

    const attemptPlay = () => {
      const p = video.play()
      if (!p) return
      p.catch(() => {
        if (destroyed) return
        // Try again once buffered — faster than waiting for a gesture on Android
        const onCPT = () => {
          if (destroyed) return
          video.removeEventListener('canplaythrough', onCPT)
          video.play().catch(() => {
            if (destroyed) return
            const gestureRetry = () => {
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

    // Attach ALL listeners before touching src/load/play — no events missed
    video.addEventListener('playing',    onFirstFrame,            { once: true })
    video.addEventListener('canplay',    onFirstFrame,            { once: true })
    video.addEventListener('timeupdate', onFirstFrameTimeUpdate)
    video.addEventListener('playing',    onPlaying)
    video.addEventListener('error',      onError)
    video.addEventListener('stalled',    onStalled)
    video.addEventListener('waiting',    onWaiting)

    // src is already set via JSX prop. Only call load() if browser hasn't
    // started fetching yet — avoids abort/emptied resetting the element.
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
        // overflow:hidden clips any native control bar that bleeds outside
        // the video's own bounds on iOS Safari / Android WebView
        <div
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}
        >
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
            tabIndex={-1}
            {...({
              disableRemotePlayback: true,
              'x-webkit-airplay':    'deny',
              'webkit-playsinline':  'true',
              playsinline:           'true',
              'data-hero-video':     'true',
            } as any)}
            preload="auto"
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
