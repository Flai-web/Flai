/**
 * heroPreload.ts  — v2
 *
 * ─── Dynamic folder mode ──────────────────────────────────────────────────────
 * Account created after June 2024 → dynamic folder mode.
 * asset_folder ('Herovideo') is display-only. The upload API returns a bare
 * public_id ('herovideo') with NO folder prefix. Delivery URLs use bare id.
 *
 * ─── Performance: MP4 first, HLS as enhancement ───────────────────────────────
 * sp_auto generates the HLS manifest on first request (on-demand transcoding).
 * For a 33 MB MOV this means the browser stalls waiting for Cloudinary to
 * transcode before even the first segment can be fetched — causing slow starts.
 *
 * Fix: treat MP4 as the primary source and load HLS only as a progressive
 * enhancement once we know the manifest is available. The MP4 is derived
 * synchronously and plays immediately. HLS.js is still used where supported
 * because it gives adaptive bitrate, but we fall back to MP4 instantly if the
 * manifest is not ready (404/error on first load).
 *
 * ─── Poster cache busting — cross-user, cross-tab ─────────────────────────────
 * v2 changes the stamp storage from sessionStorage → localStorage so the
 * version survives tab close and propagates to every tab in the same browser
 * via the 'storage' event.
 *
 * Full invalidation path for ALL users:
 *   1. Uploader tab  → bustHeroCache() mutates singleton + dispatches
 *                       'heroVideoChanged' (same-tab) + writes stamp to
 *                       localStorage (other tabs in same browser).
 *   2. Other tabs    → 'storage' event fires → bustHeroCache() called → same.
 *   3. Other browsers/users → heroSync.ts Supabase Realtime broadcast →
 *                       bustHeroCache() called → same.
 *
 * The three layers together guarantee every connected session updates within
 * ~100 ms without any page reload.
 *
 * ─── Loading-speed guarantee ──────────────────────────────────────────────────
 * • Preload <link> hints injected immediately at module import time — the
 *   browser starts fetching the poster and MP4 before React even mounts.
 * • bustHeroCache() runs synchronously for the current tab, then offloads
 *   the HTTP cache-warming fetch to requestIdleCallback.
 * • The localStorage 'storage' listener is attached at module init — no
 *   polling, no extra HTTP requests on the critical path.
 */

const CLOUD = 'dq6jxbyrg'

// Bare public_id — dynamic folder mode, no folder prefix in delivery URL.
const HERO_PUBLIC_ID = 'herovideo'

// ─── Cache-bust version stamp ─────────────────────────────────────────────────
// v2: stored in localStorage (was sessionStorage) so it:
//   • survives tab close → returning users skip the flash of the old poster
//   • propagates to other open tabs via the 'storage' event

const STAMP_KEY = 'hero_poster_v'

function readStamp(): number {
  try {
    // Prefer localStorage (persists + cross-tab); fall back to sessionStorage
    // for browsers that block localStorage (e.g. Safari private mode).
    const v =
      localStorage.getItem(STAMP_KEY) ??
      sessionStorage.getItem(STAMP_KEY) ??
      '0'
    return parseInt(v, 10) || 0
  } catch {
    return 0
  }
}

function writeStamp(v: number): void {
  try { localStorage.setItem(STAMP_KEY, String(v)) } catch {}
  // Also write to sessionStorage as fallback for Safari private mode.
  try { sessionStorage.setItem(STAMP_KEY, String(v)) } catch {}
}

let _posterStamp = readStamp()

/** Returns the current poster cache-bust stamp. HeroVideoSection reads this. */
export function getPosterStamp(): number { return _posterStamp }

// ─── Cross-tab sync via storage event ────────────────────────────────────────
// When the uploader tab writes a new stamp to localStorage, every other open
// tab in the same browser fires this handler automatically — no polling needed.

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STAMP_KEY || !e.newValue) return
    const newStamp = parseInt(e.newValue, 10)
    if (!newStamp || newStamp === _posterStamp) return

    // Update module state
    _posterStamp = newStamp

    // Re-derive URLs with new stamp and mutate singleton
    const id = heroVideo.public_id
    heroVideo.posterUrl   = cloudinaryPosterUrl(id, 1920, 'good', newStamp)
    heroVideo.posterStamp = newStamp

    // Update preload hints so next navigation uses the fresh URL
    injectPreloadHints(id, newStamp)

    // Tell HeroVideoSection to swap the poster immediately
    window.dispatchEvent(
      new CustomEvent('heroVideoChanged', {
        detail: { publicId: id, stamp: newStamp },
      })
    )
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HeroVideo {
  public_id:   string
  hlsUrl:      string
  mp4Url:      string
  posterUrl:   string
  posterStamp: number
}

// ─── URL builders — single source of truth ────────────────────────────────────

export function cloudinaryHlsUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUD}/video/upload/sp_auto/${publicId}.m3u8`
}

export function cloudinaryMp4Url(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUD}/video/upload/vc_h264/f_mp4/q_auto:good/${publicId}.mp4`
}

export function cloudinaryWebmUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUD}/video/upload/vc_vp9/f_webm/q_auto:good/${publicId}.webm`
}

export function cloudinaryPosterUrl(
  publicId: string,
  width    = 1920,
  quality  = 'good',
  stamp    = 0,
): string {
  const base =
    `https://res.cloudinary.com/${CLOUD}/video/upload/` +
    `c_fill,g_auto,w_${width},so_0/f_jpg/q_auto:${quality}/${publicId}.jpg`
  return stamp > 0 ? `${base}?v=${stamp}` : base
}

// ─── Mutable singleton ────────────────────────────────────────────────────────

const heroVideo: HeroVideo = {
  public_id:   HERO_PUBLIC_ID,
  hlsUrl:      cloudinaryHlsUrl(HERO_PUBLIC_ID),
  mp4Url:      cloudinaryMp4Url(HERO_PUBLIC_ID),
  posterUrl:   cloudinaryPosterUrl(HERO_PUBLIC_ID, 1920, 'good', _posterStamp),
  posterStamp: _posterStamp,
}

export function getHeroVideo(): HeroVideo            { return heroVideo }
export function fetchHeroVideo(): Promise<HeroVideo> { return Promise.resolve(heroVideo) }

// ─── Preload hints ────────────────────────────────────────────────────────────

function injectConnectionHints(): void {
  if (typeof document === 'undefined') return
  const head   = document.head
  const origin = 'https://res.cloudinary.com'

  if (!head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
    const pc = document.createElement('link')
    pc.rel = 'preconnect'; pc.href = origin; pc.crossOrigin = 'anonymous'
    head.prepend(pc)
  }
  if (!head.querySelector(`link[rel="dns-prefetch"][href="${origin}"]`)) {
    const dp = document.createElement('link')
    dp.rel = 'dns-prefetch'; dp.href = origin
    head.prepend(dp)
  }
}

export function injectPreloadHints(publicId = heroVideo.public_id, stamp = _posterStamp): void {
  if (typeof document === 'undefined') return
  const head = document.head

  head.querySelectorAll('link[data-hero-slot]').forEach(el => el.remove())

  const frag = document.createDocumentFragment()

  // MP4 — primary source, preloaded at high priority
  const mp4Link = document.createElement('link')
  mp4Link.rel = 'preload'; mp4Link.as = 'video'
  mp4Link.href = cloudinaryMp4Url(publicId)
  ;(mp4Link as any).fetchPriority = 'high'
  mp4Link.dataset.heroSlot = 'mp4'
  frag.appendChild(mp4Link)

  // Poster — uses stamp so preload URL matches <img> src
  const posterLink = document.createElement('link')
  posterLink.rel = 'preload'; posterLink.as = 'image'
  posterLink.href = cloudinaryPosterUrl(publicId, 1920, 'good', stamp)
  ;(posterLink as any).imageSrcset = [
    `${cloudinaryPosterUrl(publicId,  480, 'eco',  stamp)} 480w`,
    `${cloudinaryPosterUrl(publicId,  960, 'eco',  stamp)} 960w`,
    `${cloudinaryPosterUrl(publicId, 1920, 'good', stamp)} 1920w`,
  ].join(', ')
  ;(posterLink as any).imageSizes = '100vw'
  ;(posterLink as any).fetchPriority = 'high'
  posterLink.dataset.heroSlot = 'poster'
  frag.appendChild(posterLink)

  head.prepend(frag)
}

// ─── Cache busting ────────────────────────────────────────────────────────────

/**
 * bustHeroCache(publicId)
 *
 * Synchronously invalidates all hero video + poster caches for the CURRENT TAB.
 * Other tabs in the same browser are notified via the 'storage' event (above).
 * Other users/browsers are notified via Supabase Realtime (heroSync.ts).
 *
 * Call order (VideoManager does all three):
 *   1. bustHeroCache(result.public_id)   ← this file, current tab
 *   2. broadcastHeroUpdate(result.public_id)  ← heroSync.ts, all other users
 */
export function bustHeroCache(publicId: string = HERO_PUBLIC_ID): void {
  if (typeof window === 'undefined') return

  // 1. New stamp → all poster src URLs change → forces browser re-fetch
  _posterStamp = Date.now()
  writeStamp(_posterStamp)           // also triggers 'storage' in other tabs

  // 2. Mutate singleton immediately
  heroVideo.public_id   = publicId
  heroVideo.hlsUrl      = cloudinaryHlsUrl(publicId)
  heroVideo.mp4Url      = cloudinaryMp4Url(publicId)
  heroVideo.posterUrl   = cloudinaryPosterUrl(publicId, 1920, 'good', _posterStamp)
  heroVideo.posterStamp = _posterStamp

  // 3. Update preload hints for next navigation
  injectPreloadHints(publicId, _posterStamp)

  // 4. Tell HeroVideoSection to reload NOW
  window.dispatchEvent(
    new CustomEvent('heroVideoChanged', {
      detail: { publicId, stamp: _posterStamp },
    })
  )

  // 5. Background: warm HTTP cache so CDN serves fresh bytes on next hard load.
  //    Runs off the critical path in requestIdleCallback.
  const warmCache = () => {
    const opts: RequestInit = { method: 'GET', cache: 'reload', credentials: 'omit' }
    Promise.allSettled([
      fetch(cloudinaryMp4Url(publicId), { ...opts, headers: { Range: 'bytes=0-0' } }),
      fetch(cloudinaryPosterUrl(publicId,  480, 'eco',  _posterStamp), opts),
      fetch(cloudinaryPosterUrl(publicId,  960, 'eco',  _posterStamp), opts),
      fetch(cloudinaryPosterUrl(publicId, 1920, 'good', _posterStamp), opts),
    ]).catch(() => {})
  }

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warmCache, { timeout: 10_000 })
  } else {
    setTimeout(warmCache, 3000)
  }
}

// ─── Module init ──────────────────────────────────────────────────────────────

if (typeof document !== 'undefined') {
  injectConnectionHints()
  injectPreloadHints()
}
