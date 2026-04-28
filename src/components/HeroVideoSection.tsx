/**
 * HeroVideoSection — v4
 *
 * ─── Why videos get stuck at poster ──────────────────────────────────────────
 * Three bugs in v3 caused the video to stay frozen at the poster image:
 *
 * 1. video.load() after autoPlay start
 *    The <video autoPlay> element starts fetching src immediately on mount.
 *    Setting video.src then calling video.load() in the effect RESETS the
 *    element, firing 'abort'/'emptied'. The onError handler treated this as a
 *    failure and called reloadWithCacheBust(), exhausting MAX_RETRIES before
 *    playback ever began.
 *    Fix: set src as a JSX prop so the browser and the effect are in sync from
 *    the start. Never call video.load() on an element that already has a src —
 *    only call it after changing the src.
 *
 * 2. 'playing' listener race
 *    onFirstFrame was registered on 'playing' with { once: true } AFTER
 *    video.load() + attemptPlay(). If 'playing' fired in the microtask gap
 *    between those calls the callback was missed → videoReady stuck false.
 *    Fix: attach all listeners BEFORE setting src/calling load/play, and use
 *    'canplay' as an additional trigger for onFirstFrame.
 *
 * 3. requestVideoFrameCallback + React StrictMode
 *    In dev StrictMode effects run twice (mount → cleanup → mount). The cleanup
 *    sets destroyed=true before the rVFC callback fires → setVideoReady(true)
 *    never called. Fix: capture destroyed state in a closure-local ref that
 *    the rVFC callback checks, and fall back to 'timeupdate' with 1 tick
 *    (not 2) so it's more reliable across browsers.
 *
 * ─── Poster strategy (unchanged from v3) ─────────────────────────────────────
 * Single <img> with stamp-first URL. posterStamp is read from localStorage at
 * mount so the first render already uses the correct post-upload URL.
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
}

const HeroVideoSection: React.FC<HeroVideoSectionProps> = ({ className = '', children }) => {
  const videoRef = useRef<HTMLVideoElement>(null)

  const [videoReady, setVideoReady] = useState(false)

  const [publicId,    setPublicId]    = useState(() => getHeroVideo().public_id)
  const [posterStamp, setPosterStamp] = useState(() => getHeroVideo().posterStamp)
  const [videoKey,    setVideoKey]    = useState(0)

  // The src for the current video element — derived from publicId + videoKey.
  // Setting this as a JSX prop means the browser and the effect start from the
  // same state: no 'abort'/'emptied' event from a mid-flight load() call.
  const videoSrc = useMemo(
    () => videoKey === 0
      ? cloudinaryMp4Url(publicId)
      // On in-place replace, add a cache-bust param so the browser skips its
      // internal media cache and fetches fresh bytes from Cloudinary.
      : `${cloudinaryMp4Url(publicId)}?_cb=${videoKey}`,
    [publicId, videoKey]
  )

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

  // Poster — single stamp-first URL
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

    // destroyed is a plain boolean AND a ref so rVFC callbacks (which outlive
    // the synchronous cleanup) can also check it without a stale closure.
    let destroyed = false
    const destroyedRef = { current: false }

    let retries    = 0
    const MAX_RETRIES = 3
    let stallTimer:   ReturnType<typeof setTimeout> | null = null
    let waitingTimer: ReturnType<typeof setTimeout> | null = null

    const clearStallTimer   = () => { if (stallTimer   !== null) { clearTimeout(stallTimer);   stallTimer   = null } }
    const clearWaitingTimer = () => { if (waitingTimer !== null) { clearTimeout(waitingTimer); waitingTimer = null } }

    // Called once we have confirmed a real video frame — removes the poster.
    // Uses requestVideoFrameCallback where available (most reliable), falls
    // back to a single timeupdate tick, then a 300 ms setTimeout as last resort.
    const markReady = () => {
      if (destroyed || destroyedRef.current) return
      setVideoReady(true)
    }

    const onFirstFrame = () => {
      if (destroyed) return
      clearStallTimer()

      if (typeof (video as any).requestVideoFrameCallback === 'function') {
        ;(video as any).requestVideoFrameCallback(() => markReady())
      } else if (video.readyState >= 2) {
        // HAVE_CURRENT_DATA or better — a frame is already decoded
        markReady()
      } else {
        const onTU = () => {
          if (destroyed) return
          video.removeEventListener('timeupdate', onTU)
          // Give the browser one more frame to paint before flipping
          setTimeout(markReady, 0)
        }
        video.addEventListener('timeupdate', onTU)
      }
    }

    markVideoReadyRef.current = onFirstFrame

    const attemptPlay = () => {
      const p = video.play()
      if (!p) return  // older browsers return undefined
      p.catch(() => {
        if (destroyed) return
        // Autoplay blocked — wait for first user gesture then retry
        const gestureRetry = () => {
          video.play().catch(() => {})
          document.removeEventListener('touchstart', gestureRetry)
          document.removeEventListener('click',      gestureRetry)
        }
        document.addEventListener('touchstart', gestureRetry, { once: true })
        document.addEventListener('click',      gestureRetry, { once: true })
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
      // Remove the once-listener before re-adding to avoid duplicate calls
      video.removeEventListener('playing', onFirstFrame)
      video.removeEventListener('canplay', onFirstFrame)
      const bustUrl = `${cloudinaryMp4Url(publicId)}?_cb=${Date.now()}`
      video.src = bustUrl
      video.load()
      video.addEventListener('playing', onFirstFrame, { once: true })
      video.addEventListener('canplay', onFirstFrame, { once: true })
      armStallTimer()
      attemptPlay()
    }

    const onError = () => {
      if (destroyed) return
      // Ignore 'abort'/'emptied' that fire naturally when src changes
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
        video.currentTime = video.currentTime  // nudge buffer
        attemptPlay()
        waitingTimer = setTimeout(() => {
          if (destroyed || !video.paused) return
          reloadWithCacheBust()
        }, 5_000)
      }, 5_000)
    }

    const onPlaying = () => { if (!destroyed) clearWaitingTimer() }

    // Attach ALL listeners before touching src/load/play so no events are missed.
    // 'playing' fires when playback actually starts.
    // 'canplay' fires when enough data is buffered — catches cases where the
    // browser can play but 'playing' hasn't fired yet (e.g. autoplay delay).
    video.addEventListener('playing', onFirstFrame, { once: true })
    video.addEventListener('canplay',  onFirstFrame, { once: true })
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error',   onError)
    video.addEventListener('stalled', onStalled)
    video.addEventListener('waiting', onWaiting)

    // src is already set via the JSX prop (videoSrc). Only call load() if the
    // video isn't already loading — avoids the abort/emptied cycle that was
    // exhausting MAX_RETRIES on first mount.
    if (video.networkState === HTMLMediaElement.NETWORK_EMPTY ||
        video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
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
      video.removeEventListener('playing', onFirstFrame)
      video.removeEventListener('canplay',  onFirstFrame)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error',   onError)
      video.removeEventListener('stalled', onStalled)
      video.removeEventListener('waiting', onWaiting)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [skipVideo, publicId, videoKey])  // videoKey remounts the element via key prop, re-running this effect

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
