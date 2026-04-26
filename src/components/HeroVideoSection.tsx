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

  const [videoReady,  setVideoReady]  = useState(false)
  const [posterReady, setPosterReady] = useState(false)

  const [publicId,    setPublicId]    = useState(() => getHeroVideo().public_id)
  const [posterStamp, setPosterStamp] = useState(() => getHeroVideo().posterStamp)

  useEffect(() => {
    const handler = (e: Event) => {
      const { publicId: newId, stamp } =
        (e as CustomEvent<{ publicId: string; stamp: number }>).detail ?? {}
      if (newId && newId !== publicId) {
        setVideoReady(false)
        setPosterReady(false)
        setPublicId(newId)
      }
      if (typeof stamp === 'number') {
        setPosterReady(false)
        setPosterStamp(stamp)
      }
    }
    window.addEventListener('heroVideoChanged', handler)
    return () => window.removeEventListener('heroVideoChanged', handler)
  }, [publicId])

  // Cached poster (stamp=0) — already in browser cache, shows instantly
  const cachedPosterUrl = useMemo(
    () => cloudinaryPosterUrl(publicId, 1920, 'good', 0),
    [publicId]
  )

  // Fresh poster — may include ?v=stamp if cache was busted after an upload
  const freshPosterUrl    = useMemo(() => cloudinaryPosterUrl(publicId, 1920, 'good', posterStamp), [publicId, posterStamp])
  const freshPoster480    = useMemo(() => cloudinaryPosterUrl(publicId,  480, 'eco',  posterStamp), [publicId, posterStamp])
  const freshPoster960    = useMemo(() => cloudinaryPosterUrl(publicId,  960, 'eco',  posterStamp), [publicId, posterStamp])
  const freshPosterSrcSet = useMemo(
    () => `${freshPoster480} 480w, ${freshPoster960} 960w, ${freshPosterUrl} 1920w`,
    [freshPoster480, freshPoster960, freshPosterUrl]
  )

  const [skipVideo] = useState(() => {
    const { isSlow, saveData } = getConnectionInfo()
    return isSlow || saveData
  })

  // Ref so the visibility handler (below) can re-attach onFirstFrame without
  // being inside the video setup effect's closure.
  const markVideoReadyRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (skipVideo) return
    const video = videoRef.current
    if (!video) return

    let destroyed  = false
    let retries    = 0
    const MAX_RETRIES = 3
    let stallTimer:   ReturnType<typeof setTimeout> | null = null
    let waitingTimer: ReturnType<typeof setTimeout> | null = null

    const clearStallTimer = () => {
      if (stallTimer !== null) { clearTimeout(stallTimer); stallTimer = null }
    }

    const clearWaitingTimer = () => {
      if (waitingTimer !== null) { clearTimeout(waitingTimer); waitingTimer = null }
    }

    // Remove poster only after a real frame is painted — no black flash
    const onFirstFrame = () => {
      if (destroyed) return
      clearStallTimer()
      if (typeof (video as any).requestVideoFrameCallback === 'function') {
        ;(video as any).requestVideoFrameCallback(() => {
          if (!destroyed) setVideoReady(true)
        })
      } else {
        let ticks = 0
        const onTU = () => {
          if (destroyed) return
          if (++ticks >= 2) { video.removeEventListener('timeupdate', onTU); setVideoReady(true) }
        }
        video.addEventListener('timeupdate', onTU)
      }
    }

    // Expose to the visibility handler so it can re-attach this after tab wake
    markVideoReadyRef.current = onFirstFrame

    // Shared helper to attempt play and set up gesture fallback
    const attemptPlay = () => {
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

    // Reload with a cache-busted URL to recover from stale/corrupt cached responses
    const reloadWithCacheBust = () => {
      if (destroyed || retries >= MAX_RETRIES) return
      retries++
      clearStallTimer()
      clearWaitingTimer()
      video.removeEventListener('playing', onFirstFrame)
      const cacheBustedUrl = `${cloudinaryMp4Url(publicId)}?_cb=${Date.now()}`
      video.src = cacheBustedUrl
      video.load()
      video.addEventListener('playing', onFirstFrame, { once: true })
      armStallTimer()
      attemptPlay()
    }

    // If the video hasn't started playing within 8 s, treat it as a stall and retry
    const armStallTimer = () => {
      clearStallTimer()
      stallTimer = setTimeout(() => {
        if (!destroyed && !videoRef.current?.currentTime) {
          reloadWithCacheBust()
        }
      }, 8_000)
    }

    // Network/decode error — retry immediately with a cache-busted URL
    const onError = () => {
      if (destroyed) return
      reloadWithCacheBust()
    }

    // 'stalled' fires when the browser stops fetching mid-stream.
    // Only rearm the initial-load timer if playback hasn't started yet;
    // mid-playback stalls are handled by the 'waiting' event below.
    const onStalled = () => {
      if (destroyed) return
      if (!video.currentTime) {
        armStallTimer()
      }
    }

    // 'waiting' fires when playback pauses mid-stream due to insufficient buffer.
    // Give the browser 5 s to recover on its own, then nudge the current position
    // to kick the pipeline back into motion. If still stuck after another 5 s,
    // reload entirely with a cache-busted URL.
    const onWaiting = () => {
      if (destroyed) return
      clearWaitingTimer()
      waitingTimer = setTimeout(() => {
        if (destroyed || !video.paused) return
        // First recovery: seek to current position to re-trigger buffering
        const pos = video.currentTime
        video.currentTime = pos
        attemptPlay()

        // Second recovery: full reload if still frozen
        waitingTimer = setTimeout(() => {
          if (destroyed || !video.paused) return
          reloadWithCacheBust()
        }, 5_000)
      }, 5_000)
    }

    // Clear the waiting timer as soon as playback resumes so a brief,
    // self-recovering buffer stall doesn't trigger a spurious reload.
    const onPlaying = () => {
      if (destroyed) return
      clearWaitingTimer()
    }

    video.addEventListener('playing', onFirstFrame, { once: true })
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error',   onError)
    video.addEventListener('stalled', onStalled)
    video.addEventListener('waiting', onWaiting)

    video.src = cloudinaryMp4Url(publicId)
    video.load()
    armStallTimer()
    attemptPlay()

    return () => {
      destroyed = true
      markVideoReadyRef.current = null
      clearStallTimer()
      clearWaitingTimer()
      video.removeEventListener('playing', onFirstFrame)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error',   onError)
      video.removeEventListener('stalled', onStalled)
      video.removeEventListener('waiting', onWaiting)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipVideo, publicId])

  // ── Tab visibility: restore poster when tab is hidden ───────────────────
  // Browsers pause (and often discard the decoded frame buffer of) a video
  // when the tab is hidden. When the user returns, `videoReady` is still true
  // so the poster layer stays hidden — but the video element shows a black
  // frame until playback resumes.
  //
  // Fix: on tab hide → drop videoReady to false so the poster covers immediately.
  //      on tab show → re-attach a one-shot 'playing' listener that sets
  //      videoReady true again once a real frame is actually painted, then
  //      attempt to resume playback.
  useEffect(() => {
    if (skipVideo) return
    const handleVisibility = () => {
      const video = videoRef.current
      if (!video) return

      if (document.visibilityState === 'hidden') {
        // Show poster immediately — prevents a black frame on return
        setVideoReady(false)
      } else {
        // Re-attach frame-ready callback so videoReady flips back to true
        // once the browser paints a real video frame (not just a black one).
        const onReady = markVideoReadyRef.current
        if (onReady) {
          video.addEventListener('playing', onReady, { once: true })
        }
        if (video.paused) {
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
        <video
          key={publicId}
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          {...({ 'webkit-playsinline': 'true', playsinline: 'true' } as any)}
          preload="auto"
          style={{ ...FILL_STYLE, zIndex: 0 }}
        />
      )}

      {/* Poster layer — two images stacked:
          cached (stamp=0) shows instantly from browser cache,
          fresh (current stamp) silently takes over once loaded.
          Both removed the moment the first real video frame is painted. */}
      {showPosterLayer && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
          <img
            key={`poster-cached-${publicId}`}
            src={cachedPosterUrl}
            alt=""
            aria-hidden="true"
            {...({ fetchpriority: 'high' } as any)}
            decoding="sync"
            style={{ ...FILL_STYLE, zIndex: 0, opacity: posterReady ? 0 : 1 }}
          />
          <img
            key={`poster-fresh-${publicId}-${posterStamp}`}
            src={freshPosterUrl}
            srcSet={freshPosterSrcSet}
            sizes="100vw"
            alt=""
            aria-hidden="true"
            {...({ fetchpriority: 'high' } as any)}
            decoding="async"
            onLoad={() => setPosterReady(true)}
            style={{ ...FILL_STYLE, zIndex: 1, opacity: posterReady ? 1 : 0 }}
          />
        </div>
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
