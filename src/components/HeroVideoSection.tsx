/**
 * HeroVideoSection — v7
 *
 * ─── Fixes regression introduced in v6 ───────────────────────────────────────
 *
 * v6 added three changes that together caused "stuck at poster":
 *
 * BUG 1 — onLoadedData calling onFirstFrame too early
 *   onLoadedData fired when readyState >= 2 (HAVE_CURRENT_DATA) and called
 *   onFirstFrame(), which called markReady() immediately. On most browsers
 *   readyState is already >= 2 at loadeddata time even before play() has been
 *   called, so the poster was removed before the video was actually playing,
 *   revealing a frozen first frame. Then onFirstFrame also removed the 'playing'
 *   { once:true } listener — so when play() did start nothing called markReady
 *   again.
 *   Fix: onLoadedData ONLY cancels the stall timer. It never calls onFirstFrame.
 *   onFirstFrame is triggered only by 'playing', 'canplay', or timeupdate > 0.
 *
 * BUG 2 — { once: true } on loadeddata conflicting with manual removeEventListener
 *   onFirstFrame tried to removeEventListener('loadeddata', onLoadedData) but
 *   the listener was registered with { once: true } so the browser may have
 *   already auto-removed it. The removeEventListener call became a no-op on the
 *   second invocation path, leaving ghost state.
 *   Fix: register loadeddata WITHOUT { once: true } and remove it explicitly
 *   in both onFirstFrame and the cleanup function.
 *
 * BUG 3 — Fast-path returned early without attaching recovery listeners
 *   If readyState >= 3 on mount but play() was blocked (autoplay policy), the
 *   early-return cleanup left no 'playing' listener and no canplaythrough retry,
 *   so the video would never transition out of poster state.
 *   Fix: remove the separate fast-path early-return entirely. Instead, check
 *   readyState AFTER attaching all listeners. If >= 3, call markReady() + play()
 *   immediately — but keep all listeners in place for recovery.
 *
 * ─── Speed improvements retained from v6 ────────────────────────────────────
 *   - DNS prefetch + preconnect at module load time
 *   - <link rel="preload" as="video"> injected in useMemo (first render)
 *   - loadeddata cancels stall timer (without triggering markReady)
 *   - Stall timeout 5 s
 *   - Controls fully suppressed
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
// Runs before React hydrates — gives the browser maximum lead time to open
// a connection to Cloudinary before any fetch is issued.
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
// Injected synchronously inside useMemo on first render so the browser starts
// fetching the video at maximum priority before <video> even mounts.
let _preloadEl: HTMLLinkElement | null = null

function injectVideoPreload(src: string) {
  if (typeof document === 'undefined') return
  if (_preloadEl) {
    if (_preloadEl.getAttribute('href') === src) return
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
// Must be a real stylesheet rule — ::-webkit-media-controls can't be targeted
// via the style attribute.
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
  pointerEvents:  'none',
}

// ─── Component ────────────────────────────────────────────────────────────────

const HeroVideoSection: React.FC<HeroVideoSectionProps> = ({ className = '', children }) => {
  useEffect(() => { injectControlHideStyle() }, [])

  const videoRef = useRef<HTMLVideoElement>(null)

  const [videoReady,  setVideoReady]  = useState(false)
  const [publicId,    setPublicId]    = useState(() => getHeroVideo().public_id)
  const [posterStamp, setPosterStamp] = useState(() => getHeroVideo().posterStamp)
  const [videoKey,    setVideoKey]    = useState(0)

  // Inject preload link synchronously on every src change (first render included).
  const videoSrc = useMemo(() => {
    const base = cloudinaryMp4Url(publicId)
    const src  = videoKey === 0 ? base : `${base}?_cb=${videoKey}`
    injectVideoPreload(src)
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
    // markReady() is the ONLY place setVideoReady(true) is called.
    // It must only be called once we are CERTAIN a frame is actually painting.
    const markReady = () => {
      if (destroyed || destroyedRef.current) return
      setVideoReady(true)
    }

    // onFirstFrame is triggered by 'playing', 'canplay', or timeupdate > 0.
    // It deregisters all sibling triggers then waits for a real painted frame.
    const onFirstFrame = () => {
      if (destroyed) return
      clearStallTimer()

      // Deregister all sibling triggers — only the first one to fire wins.
      video.removeEventListener('playing',    onFirstFrame)
      video.removeEventListener('canplay',    onFirstFrame)
      video.removeEventListener('timeupdate', onFirstFrameTimeUpdate)
      video.removeEventListener('loadeddata', onLoadedData)

      // requestVideoFrameCallback = most reliable painted-frame signal.
      // readyState >= 2 fallback = frame is decoded (good enough on most browsers).
      // timeupdate fallback = last resort for old Safari / WebViews.
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

    // Catch browsers that skip 'playing'/'canplay' and advance currentTime first.
    const onFirstFrameTimeUpdate = () => {
      if (destroyed || video.currentTime <= 0) return
      onFirstFrame()
    }

    // 'loadeddata' = first frame is in the decode buffer.
    // ONLY use it to cancel the stall timer — never to call onFirstFrame.
    // Calling onFirstFrame here was the primary bug in v6: the video isn't
    // necessarily playing yet, so removing the poster revealed a frozen frame.
    const onLoadedData = () => {
      if (destroyed) return
      clearStallTimer()
      // Do NOT call onFirstFrame here. Wait for 'playing' or 'canplay'.
    }

    markVideoReadyRef.current = onFirstFrame

    // ── Autoplay ──────────────────────────────────────────────────────────────
    const attemptPlay = () => {
      const p = video.play()
      if (!p) return
      p.catch(() => {
        if (destroyed) return
        // Re-try once the browser has buffered enough — faster than waiting
        // for a user gesture on many Android Chrome builds.
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
      video.addEventListener('loadeddata', onLoadedData)
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

    // ── Attach ALL listeners first, then trigger load/play ────────────────────
    // This order guarantees no events are missed in any browser.
    video.addEventListener('playing',    onFirstFrame,            { once: true })
    video.addEventListener('canplay',    onFirstFrame,            { once: true })
    video.addEventListener('timeupdate', onFirstFrameTimeUpdate)
    video.addEventListener('loadeddata', onLoadedData)
    video.addEventListener('playing',    onPlaying)
    video.addEventListener('error',      onError)
    video.addEventListener('stalled',    onStalled)
    video.addEventListener('waiting',    onWaiting)

    // If the video already has enough data (BF-cache, preload hit) start
    // playing immediately. Listeners are already attached so recovery still
    // works if play() is blocked.
    if (video.readyState >= 3 /* HAVE_FUTURE_DATA */) {
      clearStallTimer()   // no stall possible if data is already buffered
      attemptPlay()
    } else {
      // Only call load() if the browser hasn't started fetching yet.
      // (The preload link may have already started a fetch; load() would reset it.)
      if (
        video.networkState === HTMLMediaElement.NETWORK_EMPTY ||
        video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
      ) {
        video.load()
      }
      armStallTimer()
      attemptPlay()
    }

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
