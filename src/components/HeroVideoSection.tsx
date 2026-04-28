/**
 * HeroVideoSection — v3
 *
 * ─── Poster strategy ──────────────────────────────────────────────────────────
 * v2 used two stacked <img> elements: a "cached" one (stamp=0, no ?v= param)
 * that showed instantly from the HTTP cache, and a "fresh" one (?v=stamp) that
 * faded in once loaded. The intent was zero-flicker on first load.
 *
 * The problem: after a video replacement the stamp=0 URL is still in the
 * browser's HTTP cache (Cache Storage delete only removes our own bucket, not
 * the browser's opaque disk cache). So the "instant" bottom image was always
 * the OLD poster — users saw the stale frame briefly before the fresh one
 * faded in.
 *
 * v3 fix — single poster, stamp-first:
 *   • posterStamp is read from localStorage on every mount (written by
 *     bustHeroCache after each upload). So even on a fresh page load the URL
 *     already carries the correct ?v=<stamp> and the browser fetches the new
 *     poster directly — no stale hit, no flash.
 *   • stamp=0 (no ?v= param) is only used on the very first ever load before
 *     any upload has happened, which is correct: there is nothing stale yet.
 *   • The <link rel="preload"> injected by heroPreload.ts at module-init time
 *     also uses the persisted stamp, so the browser starts fetching the correct
 *     poster before React even mounts — LCP is unaffected.
 *   • A single <img> means no cross-fade complexity and no z-index race.
 *
 * ─── Loading guarantee ────────────────────────────────────────────────────────
 * 1. heroPreload.ts injects <link rel="preload" href="poster?v=stamp"> at
 *    module init (before React mounts) — poster fetch starts immediately.
 * 2. HeroVideoSection renders that same stamped URL synchronously on mount —
 *    browser hits the in-flight preload, no second request.
 * 3. Video element starts loading MP4 in parallel.
 * 4. Poster shown until first real video frame is confirmed painted, then
 *    removed — no black flash, no stale frame.
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
  // posterStamp is read from the heroVideo singleton which loaded it from
  // localStorage at module-init time. So the very first render already uses
  // the persisted stamp — the poster URL is correct from the start.
  const [posterStamp, setPosterStamp] = useState(() => getHeroVideo().posterStamp)

  // Bumped when the same publicId is replaced in place, forcing the <video>
  // element to remount and discard any cached bytes.
  const [videoKey, setVideoKey] = useState(0)

  useEffect(() => {
    const handler = (e: Event) => {
      const { publicId: newId, stamp } =
        (e as CustomEvent<{ publicId: string; stamp: number }>).detail ?? {}

      if (newId) {
        setVideoReady(false)
        if (newId !== publicId) {
          setPublicId(newId)
        } else {
          // Same publicId — file replaced in place. Bump videoKey to remount
          // the <video> element so it re-fetches from Cloudinary.
          setVideoKey((k) => k + 1)
        }
      }

      // Always update the stamp. The img key includes the stamp so React
      // replaces the element and the browser fetches the new URL
      // (already primed in Cache Storage by bustHeroCache).
      if (typeof stamp === 'number' && stamp !== posterStamp) {
        setPosterStamp(stamp)
      }
    }
    window.addEventListener('heroVideoChanged', handler)
    return () => window.removeEventListener('heroVideoChanged', handler)
  }, [publicId, posterStamp])

  // ── Single poster URL — stamp-first ──────────────────────────────────────
  // stamp=0 only on very first load (before any upload). After any upload
  // the persisted stamp is used and the URL carries ?v=<stamp>, so the
  // browser never hits the stale stampless entry in its HTTP cache.
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

  // Ref so the visibility handler can re-attach onFirstFrame after tab wake
  // without being captured in a stale closure.
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

    const clearStallTimer   = () => { if (stallTimer   !== null) { clearTimeout(stallTimer);   stallTimer   = null } }
    const clearWaitingTimer = () => { if (waitingTimer !== null) { clearTimeout(waitingTimer); waitingTimer = null } }

    // Remove poster only after a real frame is confirmed painted — no black flash.
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

    markVideoReadyRef.current = onFirstFrame

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

    const reloadWithCacheBust = () => {
      if (destroyed || retries >= MAX_RETRIES) return
      retries++
      clearStallTimer()
      clearWaitingTimer()
      video.removeEventListener('playing', onFirstFrame)
      video.src = `${cloudinaryMp4Url(publicId)}?_cb=${Date.now()}`
      video.load()
      video.addEventListener('playing', onFirstFrame, { once: true })
      armStallTimer()
      attemptPlay()
    }

    const armStallTimer = () => {
      clearStallTimer()
      stallTimer = setTimeout(() => {
        if (!destroyed && !videoRef.current?.currentTime) reloadWithCacheBust()
      }, 8_000)
    }

    const onError   = () => { if (!destroyed) reloadWithCacheBust() }
    const onStalled = () => { if (!destroyed && !video.currentTime) armStallTimer() }

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
  // publicId and videoKey changes both remount the <video> via its key prop,
  // which re-runs this effect automatically.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipVideo, publicId, videoKey])

  // ── Tab visibility: restore poster when tab is hidden ───────────────────
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
          autoPlay
          muted
          loop
          playsInline
          {...({ 'webkit-playsinline': 'true', playsinline: 'true' } as any)}
          preload="auto"
          style={{ ...FILL_STYLE, zIndex: 0 }}
        />
      )}

      {/*
        Single poster — stamp-first.

        The key includes both publicId and posterStamp so React replaces the
        element (cancelling the old network request) the moment heroVideoChanged
        fires with a new stamp. The new URL is already primed in Cache Storage
        by bustHeroCache, so the browser returns it instantly.

        decoding="sync" ensures the image is decoded before the browser paints
        so there is no blank frame between the old poster disappearing and
        the new one appearing.
      */}
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
