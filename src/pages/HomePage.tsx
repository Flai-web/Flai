import '../utils/heroPreload'
import { initHeroSync } from '../utils/heroSync'
import React, { lazy, Suspense, useMemo } from 'react';
import AiCTA from '../components/AiCTA';
import SEO from '../components/SEO';
import { useNavigate } from 'react-router-dom';
import { Video, Camera, MapPin } from 'lucide-react';
import HeroVideoSection from '../components/HeroVideoSection';
import EditableContent from '../components/EditableContent';
import HomeSectionCard from '../components/HomeSectionCard';
import { useData } from '../contexts/DataContext';
import { useIpCoverage } from '../hooks/useIpCoverage';

// Initialise the Supabase Realtime subscription that pushes hero-video
// cache-bust events to ALL connected browsers/tabs whenever a new video is
// uploaded. Deferred to requestIdleCallback inside initHeroSync — zero impact
// on LCP or first paint.
initHeroSync()

// ---------------------------------------------------------------------------
// DEPLOYED_HOME_SECTIONS — source of truth for hardcoded/deployed sections.
// This array is rewritten by the deploy-home-sections-to-github edge function.
// HomeSectionsManager imports this directly for frontend-side conflict detection.
// ---------------------------------------------------------------------------

// @@INJECTED_SECTIONS_START@@
// Section: Hvorfor Flai? (701f795b-5ff5-40a9-8bc1-ce0ca247b5af)
const Section_701f795b = (() => {
  const HvorforFlai = () => {
    const styles = `
      :root {
        --primary: #0F52BA;
        --secondary: #64A0FF;
      }

      .flai-container {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        padding: 48px 20px 48px 20px;
        font-family: sans-serif;
        box-sizing: border-box;
      }

      .flai-main-title {
        color: #ffffff;
        font-size: 2.25rem;
        font-weight: 700;
        margin: 0 0 40px 0;
        letter-spacing: 0;
        line-height: 1.2;
        text-align: center;
      }

      .flai-card {
        display: flex;
      }

      .flai-subtitle {
        color: var(--secondary);
        font-weight: 600;
        font-size: 1.25rem;
        line-height: 1.2;
        display: flex;
        margin: 0;
        text-align: center;
        justify-content: center;
      }

      .flai-description {
        color: #d4d4d4;
        font-weight: 400;
        font-size: 0.875rem;
        line-height: 1.625;
        margin: 0;
        text-align: center;
      }

      .flai-icon-box {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      @media (max-width: 600px) {
        .flai-container {
          padding: 32px 16px 32px 16px;
        }
        .flai-main-title {
          font-size: 1.875rem;
          margin-bottom: 20px;
          text-align: left;
        }
        .flai-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0;
        }
        .flai-card {
          flex-direction: column;
          align-items: flex-start;
          padding: 20px 0;
        }
        .flai-icon-box {
          height: auto;
          width: auto;
          margin-bottom: 12px;
          justify-content: flex-start;
        }
        .flai-svg {
          width: 40px;
          height: 40px;
        }
        .flai-text-group {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .flai-subtitle {
          font-size: 1rem;
          min-height: unset;
          margin-bottom: 4px;
          text-align: left;
          justify-content: flex-start;
        }
        .flai-description {
          font-size: 0.875rem;
          max-width: 100%;
          text-align: left;
        }
      }

      @media (min-width: 601px) {
        .flai-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 24px;
        }
        .flai-card {
          flex-direction: column;
          align-items: center;
          padding-bottom: 32px;
          border-bottom: none;
        }
        .flai-text-group {
          display: contents;
        }
        .flai-icon-box {
          height: 65px;
          margin-bottom: 16px;
        }
        .flai-svg {
          width: clamp(44px, 6vw, 60px);
          height: clamp(44px, 6vw, 60px);
        }
        .flai-subtitle {
          min-height: 36px;
          align-items: center;
          margin-bottom: 10px;
        }
        .flai-description {
          max-width: 240px;
        }
      }
    `;

    return (
      <>
        <style>{styles}</style>
        <div style={{ backgroundColor: '#262626', width: '100%' }}>
          <div className="flai-container">
            <h1 className="flai-main-title">Hvorfor Flai?</h1>

            <div className="flai-grid">

              {/* Fleksibilitet */}
              <div className="flai-card">
                <div className="flai-icon-box">
                  <svg className="flai-svg" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M52 32C52 43.0457 43.0457 52 32 52C20.9543 52 12 43.0457 12 32C12 20.9543 20.9543 12 32 12" stroke="#0F52BA" strokeWidth="4" strokeLinecap="round"/>
                    <path d="M32 4L44 12L32 20" fill="#64A0FF"/>
                    <circle cx="32" cy="32" r="6" fill="#64A0FF" fillOpacity="0.6"/>
                    <path d="M22 32H42" stroke="#0F52BA" strokeWidth="4" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="flai-text-group">
                  <h3 className="flai-subtitle">Fleksibilitet</h3>
                  <p className="flai-description">Vi tilpasser os efter dine behov.</p>
                </div>
              </div>

              {/* Booking */}
              <div className="flai-card">
                <div className="flai-icon-box">
                  <svg className="flai-svg" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="10" y="16" width="44" height="32" rx="4" stroke="#0F52BA" strokeWidth="4"/>
                    <path d="M10 26H54" stroke="#0F52BA" strokeWidth="4"/>
                    <circle cx="46" cy="46" r="12" fill="#64A0FF"/>
                    <path d="M41 46L44 49L51 42" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="flai-text-group">
                  <h3 className="flai-subtitle">Nem og hurtig booking</h3>
                  <p className="flai-description">Glem alt om komplekse kontrakter. Book direkte via hjemmesiden eller send en besked.</p>
                </div>
              </div>

              {/* Kvalitet */}
              <div className="flai-card">
                <div className="flai-icon-box">
                  <svg className="flai-svg" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M32 8L52 24L32 56L12 24L32 8Z" fill="#0F52BA"/>
                    <path d="M32 8L42 24H22L32 8Z" fill="#64A0FF"/>
                    <path d="M52 24H12L32 32L52 24Z" fill="#64A0FF" fillOpacity="0.5"/>
                    <circle cx="50" cy="14" r="3" fill="#64A0FF"/>
                  </svg>
                </div>
                <div className="flai-text-group">
                  <h3 className="flai-subtitle">Kvalitet</h3>
                  <p className="flai-description">Vi bruger DJI Mini 5 Pro og DaVinci Resolve Studio. Det sikrer dig knivskarpe 4K-optagelser med perfekt farve og klipning.</p>
                </div>
              </div>

              {/* Leveringstid */}
              <div className="flai-card">
                <div className="flai-icon-box">
                  <svg className="flai-svg" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="36" cy="34" r="22" stroke="#0F52BA" strokeWidth="4"/>
                    <path d="M36 22V34L44 42" stroke="#64A0FF" strokeWidth="4" strokeLinecap="round"/>
                    <path d="M6 24H18M4 34H14M6 44H18" stroke="#64A0FF" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="flai-text-group">
                  <h3 className="flai-subtitle">Leverings tid</h3>
                  <p className="flai-description">Vi leverer dine billeder inden for 24-48 timer og færdigredigeret video inden for 3-5 dage.</p>
                </div>
              </div>

            </div>
          </div>
        </div>
      </>
    );
  };
  return HvorforFlai;
})() as React.ComponentType;

// Section: Testimonials (9009b281-e411-445f-8c58-7b2470ce61b3)
const Section_9009b281 = ((
  useState, useEffect, useCallback
) => {
  // ─── Config ───────────────────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://kzvdgdfxxkxeaihrqigd.supabase.co';
  const SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6dmRnZGZ4eGt4ZWFpaHJxaWdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNDQwNzQsImV4cCI6MjA4MDYyMDA3NH0.ZOmXme0uhK5gi7MTEnzJgY1mHiRGQZIgrvGQ1-nTwsw';
  const PLACE_ID = 'ChIJq5JklwgFuQ0RREPIKUg0EHs';
  const STORAGE_KEY = 'flai_reviews_' + PLACE_ID;
  const EXPIRES_AT_KEY = 'flai_expires_' + PLACE_ID;
  const RATING_KEY = 'flai_rating_' + PLACE_ID;

  // ─── Hardcoded pinned reviewer names ─────────────────────────────────────────
  const PINNED_REVIEW_1: string | null = null;
  const PINNED_REVIEW_2: string | null = null;

  // ─── Cache helpers ────────────────────────────────────────────────────────────
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  function isCacheStale() {
    const exp = localStorage.getItem(EXPIRES_AT_KEY);
    if (!exp) return true;
    return Date.now() >= Number(exp);
  }

  function readCache() {
    const raw    = localStorage.getItem(STORAGE_KEY);
    const rating = localStorage.getItem(RATING_KEY);
    if (!raw || !rating) return null;
    try { return { reviews: JSON.parse(raw) as any[], rating }; }
    catch { return null; }
  }

  function saveToCache(reviews: any[], rating: string | number) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
    localStorage.setItem(RATING_KEY, String(rating));
    localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + CACHE_TTL_MS));
  }

  async function fetchFromApi() {
    const res = await fetch(
      SUPABASE_URL + '/functions/v1/fetch-reviews?place_id=' + PLACE_ID,
      { headers: { Authorization: 'Bearer ' + SUPABASE_KEY } }
    );
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (!data.reviews || !data.reviews.length) throw new Error('Empty');
    saveToCache(data.reviews, data.rating || '0.0');
    return { reviews: data.reviews as any[], rating: String(data.rating || '0.0') };
  }

  async function getReviews(
    onUpdate: (d: { reviews: any[]; rating: string }) => void
  ): Promise<{ reviews: any[]; rating: string } | null> {
    const cached = readCache();
    if (cached && !isCacheStale()) return cached;
    if (cached) {
      fetchFromApi()
        .then((fresh) => {
          if (JSON.stringify(cached.reviews) !== JSON.stringify(fresh.reviews)) {
            onUpdate(fresh);
          }
        })
        .catch(() => {});
      return cached;
    }
    return fetchFromApi();
  }

  function buildDisplayPair(raw: any[]): [any | null, any | null] {
    const fiveStar = raw.filter((r: any) => Number(r.rating) === 5);
    const sorted = [...fiveStar].sort((a: any, b: any) => {
      const aThumb = a.user?.thumbnail ? 1 : 0;
      const bThumb = b.user?.thumbnail ? 1 : 0;
      if (aThumb !== bThumb) return bThumb - aThumb;
      const aText = (a.snippet || '').trim().length > 0 ? 1 : 0;
      const bText = (b.snippet || '').trim().length > 0 ? 1 : 0;
      return bText - aText;
    });

    const findByName = (name: string | null) => {
      if (!name) return null;
      return sorted.find(
        (r: any) =>
          (r.user?.name || '').toLowerCase().trim() === name.toLowerCase().trim()
      ) ?? null;
    };

    const pinned1 = findByName(PINNED_REVIEW_1);
    const pinned2 = findByName(PINNED_REVIEW_2);
    const pinnedSet = new Set([pinned1, pinned2].filter(Boolean));
    const pool = sorted.filter((r) => !pinnedSet.has(r));
    const slot1 = pinned1 ?? pool.shift() ?? null;
    const slot2 = pinned2 ?? pool.shift() ?? null;
    return [slot1, slot2];
  }

  function GoogleG({ size = 14 }: { size?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    );
  }

  function StarIcon() {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#FBBF24" stroke="none">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    );
  }

  function ReviewCard({ review }: { review: any }) {
    const highResThumbnail = review?.user?.thumbnail
      ? review.user.thumbnail.replace(/=s\d+/, '=s400')
      : null;
    const defaultInitials = (review?.user?.name || '?')
      .split(' ')
      .map((n: string) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    const hue =
      (review?.user?.name || '')
        .split('')
        .reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 360;
    const googleReviewLink =
      review?.link ||
      'https://search.google.com/local/writereview?placeid=' + PLACE_ID;

    return (
      <div className="testi-review-card">
        <span className="big-quote" aria-hidden="true">"</span>
        <p className="testi-quote-text">
          {review?.snippet || 'Fantastisk service og oplevelse!'}
        </p>
        <div className="testi-author-row">
          {highResThumbnail ? (
            <img src={highResThumbnail} alt={review?.user?.name} className="author-avatar" />
          ) : (
            <div className="author-avatar-fallback" style={{ backgroundColor: `hsl(${hue}, 35%, 28%)` }}>
              {defaultInitials}
            </div>
          )}
          <div className="author-info">
            <div className="testi-stars">
              {[1, 2, 3, 4, 5].map((i) => <StarIcon key={i} />)}
            </div>
            <p className="author-name">{review?.user?.name || 'Anonym'}</p>
            <p className="author-meta">Verificeret Google-anmeldelse</p>
          </div>
          <a href={googleReviewLink} target="_blank" rel="noopener noreferrer" className="google-badge" title="Se anmeldelse på Google">
            <GoogleG size={14} />
            <span className="google-badge-text">Google</span>
          </a>
        </div>
      </div>
    );
  }

  const Testimonials: React.FC = () => {
    const [review1, setReview1] = useState<any | null>(null);
    const [review2, setReview2] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(false);

    const applyReviews = useCallback((raw: any[]) => {
      const [r1, r2] = buildDisplayPair(raw);
      setReview1(r1);
      setReview2(r2);
    }, []);

    useEffect(() => {
      getReviews((fresh) => applyReviews(fresh.reviews))
        .then((d) => {
          if (!d) return;
          applyReviews(d.reviews);
          setLoading(false);
        })
        .catch(() => {
          setError(true);
          setLoading(false);
        });
    }, [applyReviews]);

    if (loading) {
      return (
        <section className="py-0">
          <style>{`
            @keyframes testi-shimmer {
              0%   { background-position: -600px 0; }
              100% { background-position:  600px 0; }
            }
            .testi-skel {
              background: linear-gradient(90deg, #1e1e1e 25%, #282828 50%, #1e1e1e 75%);
              background-size: 600px 100%;
              animation: testi-shimmer 1.6s infinite linear;
              border-radius: 6px;
            }
          `}</style>
          <div className="container">
            <div className="rounded-xl p-10 flex flex-col gap-6" style={{ background: 'transparent' }}>
              <div className="testi-skel" style={{ height: 40, width: 32 }} />
              <div>
                <div className="testi-skel" style={{ height: 18, marginBottom: 10 }} />
                <div className="testi-skel" style={{ height: 18, marginBottom: 10, width: '88%' }} />
                <div className="testi-skel" style={{ height: 18, width: '70%' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                <div className="testi-skel" style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="testi-skel" style={{ height: 13, width: 110, marginBottom: 8 }} />
                  <div className="testi-skel" style={{ height: 11, width: 80 }} />
                </div>
              </div>
            </div>
          </div>
        </section>
      );
    }

    if (error || !review1) {
      return (
        <section className="py-0">
          <div className="container">
            <div className="rounded-xl p-10 flex items-center justify-center" style={{ background: 'transparent' }}>
              <p style={{ color: '#737373', fontSize: '0.875rem' }}>Kunne ikke indlæse anmeldelser.</p>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="py-0">
        <style>{`
          .testi-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0;
          }
          .testi-grid--solo {
            grid-template-columns: 1fr;
          }
          @media (max-width: 768px) {
            .testi-grid {
              grid-template-columns: 1fr;
            }
            .testi-grid > .testi-review-card:nth-child(2) {
              display: none;
            }
          }
          .testi-review-card {
            background: transparent;
            padding: 48px 0;
            display: flex;
            flex-direction: column;
            position: relative;
          }
          @media (min-width: 769px) {
            .testi-grid:not(.testi-grid--solo) > .testi-review-card:first-child {
              padding-right: 48px;
              border-right: 1px solid #2a2a2a;
            }
            .testi-grid:not(.testi-grid--solo) > .testi-review-card:last-child {
              padding-left: 48px;
            }
          }
          @media (max-width: 768px) {
            .testi-review-card { padding: 24px 0; }
            .big-quote { font-size: 3.5rem !important; }
            .testi-quote-text { font-size: 1rem !important; }
          }
          .big-quote {
            font-size: 5rem;
            line-height: 0.7;
            color: #3B82F6;
            font-family: Georgia, serif;
            font-weight: 700;
            user-select: none;
            display: block;
            margin-bottom: 8px;
          }
          .testi-quote-text {
            font-family: 'Inter', sans-serif;
            font-size: clamp(1.05rem, 1.8vw, 1.35rem);
            font-weight: 400;
            color: #f0f0f0;
            line-height: 1.65;
            letter-spacing: -0.01em;
            margin: 0;
            flex: 1;
          }
          .testi-author-row {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-top: 32px;
            padding-top: 20px;
          }
          .author-avatar {
            width: 56px; height: 56px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
          }
          .author-avatar-fallback {
            width: 56px; height: 56px;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 1.2rem; font-weight: 700; color: white;
            flex-shrink: 0;
          }
          .author-info { flex: 1; min-width: 0; }
          .author-name {
            font-size: 0.9rem;
            font-weight: 700;
            color: #ffffff;
            margin: 0 0 2px 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .author-meta {
            font-size: 0.75rem;
            color: #A3A3A3;
            margin: 0;
          }
          .google-badge {
            display: flex; align-items: center; gap: 5px;
            text-decoration: none;
            padding: 5px 10px;
            border-radius: 6px;
            border: 1px solid #404040;
            background: transparent;
            transition: border-color 0.2s ease;
            flex-shrink: 0;
          }
          .google-badge:hover { border-color: #0F52BA; }
          .google-badge-text {
            font-size: 0.7rem;
            font-weight: 600;
            color: #CCCCCC;
            letter-spacing: 0.04em;
          }
          .testi-stars {
            display: flex;
            gap: 2px;
            margin-bottom: 6px;
          }
        `}</style>
        <div className="w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`testi-grid${!review2 ? ' testi-grid--solo' : ''}`}>
            <ReviewCard review={review1} />
            {review2 && <ReviewCard review={review2} />}
          </div>
        </div>
      </section>
    );
  };
  return Testimonials;
})(
  React.useState, React.useEffect, React.useCallback
) as React.ComponentType;

const CODE_SECTION_COMPONENTS: Record<string, React.ComponentType> = {
  '701f795b-5ff5-40a9-8bc1-ce0ca247b5af': Section_701f795b,
  '9009b281-e411-445f-8c58-7b2470ce61b3': Section_9009b281,
};
// @@INJECTED_SECTIONS_END@@
export const DEPLOYED_HOME_SECTIONS = [
  {
    "id": "701f795b-5ff5-40a9-8bc1-ce0ca247b5af",
    "title": "Hvorfor Flai?",
    "description": "Interactive Code Section",
    "image_url": null,
    "order_index": 0,
    "is_active": true,
    "created_at": null,
    "updated_at": null,
    "section_type": "code",
    "code_content": null,
    "code_language": null,
    "code_files": [
      {
        "content": "const HvorforFlai = () => {\n  const styles = `\n    :root {\n      --primary: #0F52BA;\n      --secondary: #64A0FF;\n    }\n\n    .flai-container {\n      width: 100%;\n      max-width: 1200px;\n      margin: 0 auto;\n      padding: 48px 20px 48px 20px;\n      font-family: sans-serif;\n      box-sizing: border-box;\n    }\n\n    .flai-main-title {\n      color: #ffffff;\n      font-size: 2.25rem;\n      font-weight: 700;\n      margin: 0 0 40px 0;\n      letter-spacing: 0;\n      line-height: 1.2;\n      text-align: center;\n    }\n\n    .flai-card {\n      display: flex;\n    }\n\n    .flai-subtitle {\n      color: var(--secondary);\n      font-weight: 600;\n      font-size: 1.25rem;\n      line-height: 1.2;\n      display: flex;\n      margin: 0;\n      text-align: center;\n      justify-content: center;\n    }\n\n    .flai-description {\n      color: #d4d4d4;\n      font-weight: 400;\n      font-size: 0.875rem;\n      line-height: 1.625;\n      margin: 0;\n      text-align: center;\n    }\n\n    .flai-icon-box {\n      display: flex;\n      align-items: center;\n      justify-content: center;\n    }\n\n    @media (max-width: 600px) {\n      .flai-container {\n        padding: 32px 16px 32px 16px;\n      }\n      .flai-main-title {\n        font-size: 1.875rem;\n        margin-bottom: 20px;\n        text-align: left;\n      }\n      .flai-grid {\n        display: grid;\n        grid-template-columns: 1fr;\n        gap: 0;\n      }\n      .flai-card {\n        flex-direction: column;\n        align-items: flex-start;\n        padding: 20px 0;\n      }\n      .flai-icon-box {\n        height: auto;\n        width: auto;\n        margin-bottom: 12px;\n        justify-content: flex-start;\n      }\n      .flai-svg {\n        width: 40px;\n        height: 40px;\n      }\n      .flai-text-group {\n        display: flex;\n        flex-direction: column;\n        align-items: flex-start;\n      }\n      .flai-subtitle {\n        font-size: 1rem;\n        min-height: unset;\n        margin-bottom: 4px;\n        text-align: left;\n        justify-content: flex-start;\n      }\n      .flai-description {\n        font-size: 0.875rem;\n        max-width: 100%;\n        text-align: left;\n      }\n    }\n\n    @media (min-width: 601px) {\n      .flai-grid {\n        display: grid;\n        grid-template-columns: repeat(4, 1fr);\n        gap: 24px;\n      }\n      .flai-card {\n        flex-direction: column;\n        align-items: center;\n        padding-bottom: 32px;\n        border-bottom: none;\n      }\n      .flai-text-group {\n        display: contents;\n      }\n      .flai-icon-box {\n        height: 65px;\n        margin-bottom: 16px;\n      }\n      .flai-svg {\n        width: clamp(44px, 6vw, 60px);\n        height: clamp(44px, 6vw, 60px);\n      }\n      .flai-subtitle {\n        min-height: 36px;\n        align-items: center;\n        margin-bottom: 10px;\n      }\n      .flai-description {\n        max-width: 240px;\n      }\n    }\n  `;\n\n  return (\n    <>\n      <style>{styles}</style>\n      <div style={{ backgroundColor: '#262626', width: '100%' }}>\n        <div className=\"flai-container\">\n          <h1 className=\"flai-main-title\">Hvorfor Flai?</h1>\n\n          <div className=\"flai-grid\">\n\n            {/* Fleksibilitet */}\n            <div className=\"flai-card\">\n              <div className=\"flai-icon-box\">\n                <svg className=\"flai-svg\" viewBox=\"0 0 64 64\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                  <path d=\"M52 32C52 43.0457 43.0457 52 32 52C20.9543 52 12 43.0457 12 32C12 20.9543 20.9543 12 32 12\" stroke=\"#0F52BA\" strokeWidth=\"4\" strokeLinecap=\"round\"/>\n                  <path d=\"M32 4L44 12L32 20\" fill=\"#64A0FF\"/>\n                  <circle cx=\"32\" cy=\"32\" r=\"6\" fill=\"#64A0FF\" fillOpacity=\"0.6\"/>\n                  <path d=\"M22 32H42\" stroke=\"#0F52BA\" strokeWidth=\"4\" strokeLinecap=\"round\"/>\n                </svg>\n              </div>\n              <div className=\"flai-text-group\">\n                <h3 className=\"flai-subtitle\">Fleksibilitet</h3>\n                <p className=\"flai-description\">Vi tilpasser os efter dine behov.</p>\n              </div>\n            </div>\n\n            {/* Booking */}\n            <div className=\"flai-card\">\n              <div className=\"flai-icon-box\">\n                <svg className=\"flai-svg\" viewBox=\"0 0 64 64\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                  <rect x=\"10\" y=\"16\" width=\"44\" height=\"32\" rx=\"4\" stroke=\"#0F52BA\" strokeWidth=\"4\"/>\n                  <path d=\"M10 26H54\" stroke=\"#0F52BA\" strokeWidth=\"4\"/>\n                  <circle cx=\"46\" cy=\"46\" r=\"12\" fill=\"#64A0FF\"/>\n                  <path d=\"M41 46L44 49L51 42\" stroke=\"white\" strokeWidth=\"3\" strokeLinecap=\"round\" strokeLinejoin=\"round\"/>\n                </svg>\n              </div>\n              <div className=\"flai-text-group\">\n                <h3 className=\"flai-subtitle\">Nem og hurtig booking</h3>\n                <p className=\"flai-description\">Glem alt om komplekse kontrakter. Book direkte via hjemmesiden eller send en besked.</p>\n              </div>\n            </div>\n\n            {/* Kvalitet */}\n            <div className=\"flai-card\">\n              <div className=\"flai-icon-box\">\n                <svg className=\"flai-svg\" viewBox=\"0 0 64 64\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                  <path d=\"M32 8L52 24L32 56L12 24L32 8Z\" fill=\"#0F52BA\"/>\n                  <path d=\"M32 8L42 24H22L32 8Z\" fill=\"#64A0FF\"/>\n                  <path d=\"M52 24H12L32 32L52 24Z\" fill=\"#64A0FF\" fillOpacity=\"0.5\"/>\n                  <circle cx=\"50\" cy=\"14\" r=\"3\" fill=\"#64A0FF\"/>\n                </svg>\n              </div>\n              <div className=\"flai-text-group\">\n                <h3 className=\"flai-subtitle\">Kvalitet</h3>\n                <p className=\"flai-description\">Vi bruger DJI Mini 5 Pro og DaVinci Resolve Studio. Det sikrer dig knivskarpe 4K-optagelser med perfekt farve og klipning.</p>\n              </div>\n            </div>\n\n            {/* Leveringstid */}\n            <div className=\"flai-card\">\n              <div className=\"flai-icon-box\">\n                <svg className=\"flai-svg\" viewBox=\"0 0 64 64\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                  <circle cx=\"36\" cy=\"34\" r=\"22\" stroke=\"#0F52BA\" strokeWidth=\"4\"/>\n                  <path d=\"M36 22V34L44 42\" stroke=\"#64A0FF\" strokeWidth=\"4\" strokeLinecap=\"round\"/>\n                  <path d=\"M6 24H18M4 34H14M6 44H18\" stroke=\"#64A0FF\" strokeWidth=\"3\" strokeLinecap=\"round\"/>\n                </svg>\n              </div>\n              <div className=\"flai-text-group\">\n                <h3 className=\"flai-subtitle\">Leverings tid</h3>\n                <p className=\"flai-description\">Vi leverer dine billeder inden for 24-48 timer og færdigredigeret video inden for 3-5 dage.</p>\n              </div>\n            </div>\n\n          </div>\n        </div>\n      </div>\n    </>\n  );\n};\n\nexport default HvorforFlai;",
        "filename": "component.tsx",
        "language": "tsx"
      }
    ],
    "image_url_2": null,
    "image_url_3": null,
    "used_images": null,
    "visual_editor_images": null
  },
  {
    "id": "9009b281-e411-445f-8c58-7b2470ce61b3",
    "title": "Testimonials",
    "description": "Interactive TSX Section",
    "image_url": null,
    "order_index": 1,
    "is_active": true,
    "created_at": null,
    "updated_at": null,
    "section_type": "code",
    "code_content": null,
    "code_language": null,
    "code_files": [
      {
        "content": "import React, { useEffect, useState, useCallback } from 'react';\n\n// ─── Config ───────────────────────────────────────────────────────────────────\nconst SUPABASE_URL = 'https://kzvdgdfxxkxeaihrqigd.supabase.co';\nconst SUPABASE_KEY =\n  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6dmRnZGZ4eGt4ZWFpaHJxaWdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNDQwNzQsImV4cCI6MjA4MDYyMDA3NH0.ZOmXme0uhK5gi7MTEnzJgY1mHiRGQZIgrvGQ1-nTwsw';\nconst PLACE_ID = 'ChIJq5JklwgFuQ0RREPIKUg0EHs';\nconst STORAGE_KEY = 'flai_reviews_' + PLACE_ID;\nconst EXPIRES_AT_KEY = 'flai_expires_' + PLACE_ID;\nconst RATING_KEY = 'flai_rating_' + PLACE_ID;\n\nexport default Testimonials;",
        "filename": "component.tsx",
        "language": "tsx"
      }
    ],
    "image_url_2": null,
    "image_url_3": null,
    "used_images": null,
    "visual_editor_images": null
  },
  {
    "id": "8bdc2c06-1889-4176-99cc-73a4d626f545",
    "title": "Mød Felix",
    "description": "13-årige Felix er ejeren af Flai og vores dronepilot med en passion for dronefotografering og -optagelser og 3 års erfaring.",
    "image_url": "https://pbqeljimuerxatrtmgsn.supabase.co/storage/v1/object/public/home-sections/1776146104509-08e9fa71.webp",
    "order_index": 2,
    "is_active": true,
    "created_at": null,
    "updated_at": null,
    "section_type": "standard",
    "code_content": null,
    "code_language": null,
    "code_files": null,
    "image_url_2": null,
    "image_url_3": null,
    "used_images": null,
    "visual_editor_images": null
  },
  {
    "id": "47dec4cf-6d52-4568-a3c6-b383229e0631",
    "title": "DJI Mini 5 Pro Drone",
    "description": "Med vores topmoderne DJI Mini 5 Pro leverer vi den højeste 4k billedkvalitet og stabilitet.",
    "image_url": "https://pbqeljimuerxatrtmgsn.supabase.co/storage/v1/object/public/home-sections/1776148441483-4993ac95.webp",
    "order_index": 3,
    "is_active": true,
    "created_at": null,
    "updated_at": null,
    "section_type": "standard",
    "code_content": null,
    "code_language": null,
    "code_files": null,
    "image_url_2": null,
    "image_url_3": null,
    "used_images": null,
    "visual_editor_images": null
  },
  {
    "id": "e370d5a1-443c-47ee-9596-462c13fde9d7",
    "title": "Redigering",
    "description": "Hos Flai bruger vi Davinci Resolve Studio, et professionelt videoredigeringsprogram, der bruges i Hollywood, og som kan klare alle redigeringsopgaver.",
    "image_url": "https://pbqeljimuerxatrtmgsn.supabase.co/storage/v1/object/public/home-sections/1776150374008-27f8cacf.webp",
    "order_index": 4,
    "is_active": true,
    "created_at": null,
    "updated_at": null,
    "section_type": "standard",
    "code_content": null,
    "code_language": null,
    "code_files": null,
    "image_url_2": null,
    "image_url_3": null,
    "used_images": null,
    "visual_editor_images": null
  }
];


const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { getContent, isSiteContentLoaded, homeSections: dbSections, isHomeSectionsLoaded } = useData();
  const { loading: coverageLoading, covered, cityName } = useIpCoverage();

  const heroLogo     = getContent('site-logo',      '/Logo.webp', 'image');
  const heroSubtitle = getContent('hero-subtitle',  'Dronefotografering og -optagelser i Syddanmark. 100% tilfredshedsgaranti.');
  const contactEmail = getContent('contact-email',  'fb@flai.dk');
  const contactPhone = getContent('contact-phone',  '+45 27 29 21 99');
  const heroVideoUrl = '';

  const homeSections = useMemo(() => {
    if (!isHomeSectionsLoaded) return DEPLOYED_HOME_SECTIONS;
    const dbIds = new Set(dbSections.map((s: any) => s.id));
    const hardcodedRemainder = DEPLOYED_HOME_SECTIONS.filter(s => !dbIds.has(s.id));
    return [...dbSections, ...hardcodedRemainder].sort((a, b) => a.order_index - b.order_index);
  }, [dbSections, isHomeSectionsLoaded]);

  return (
    <div className="bg-neutral-900">

      <SEO
        canonical="/"
        description={heroSubtitle}
        schema={{
          '@context': 'https://schema.org',
          '@type': 'LocalBusiness',
          '@id': 'https://flai.dk/#business',
          name: 'Flai',
          description: heroSubtitle,
          url: 'https://flai.dk',
          logo: heroLogo,
          telephone: contactPhone,
          email: contactEmail,
          address: { '@type': 'PostalAddress', addressCountry: 'DK' },
          areaServed: { '@type': 'Country', name: 'Danmark' },
        }}
      />

      <HeroVideoSection videoUrl={heroVideoUrl}>
        <div className="flex flex-col h-full w-full">
          <div className="flex-1" />
          <div className="flex flex-col items-center pb-16 sm:pb-20">
            <div className="mb-6 text-white drop-shadow-2xl">
              <div className="flex flex-col items-center">
                <img
                  src={heroLogo}
                  alt="Flai.dk"
                  width="160"
                  height="64"
                  className="h-16 md:h-16 w-auto transition-all duration-500"
                />
              </div>
            </div>
            <div className="text-xl mb-5 sm:mb-8 text-neutral-100 drop-shadow-lg text-center">
              <EditableContent
                contentKey="hero-subtitle"
                fallback="Dronefoto og video i Trekantsområdet. 100% tilfredshedsgaranti."
              />
            </div>
            <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 w-full px-6 sm:px-0 sm:w-auto">
              <button onClick={() => navigate('/products')} className="btn-primary text-lg px-8 py-4">
                <EditableContent contentKey="hero-button-primary" fallback="Se Vores Tjenester" />
              </button>
              <button onClick={() => navigate('/portfolio')} className="btn-secondary text-lg px-8 py-4 flex items-center justify-center">
                <EditableContent contentKey="hero-button-secondary" fallback="Se Vores Arbejde" />
              </button>
            </div>
          </div>
        </div>
      </HeroVideoSection>

      <div className="h-6 md:h-10 bg-neutral-800" />

      {homeSections.filter(s => s.is_active).map((section, index) => {
        const isCode = section.section_type === 'code' || section.section_type === 'visual_editor';
        if (isCode) {
          const CodeComp = CODE_SECTION_COMPONENTS[section.id];
          if (!CodeComp) return null;
          return (
            <section key={section.id} className="bg-neutral-800 border-0 outline-none">
              <div className="w-full">
                <CodeComp />
              </div>
            </section>
          );
        }
        return (
          <HomeSectionCard key={section.id} section={section} index={index} />
        );
      })}

      {homeSections.length === 0 && DEPLOYED_HOME_SECTIONS.length === 0 && isSiteContentLoaded && (
        <section className="py-10 md:py-20 bg-neutral-800">
          <div className="container">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <div>
                <EditableContent contentKey="drone-section-title" as="h2" className="text-3xl font-bold mb-6 text-white" fallback="DJI Mini 3 Pro Drone" />
                <EditableContent contentKey="drone-section-description" as="p" className="text-neutral-300 mb-8" fallback="Med vores DJI Mini 3 Pro drone leverer vi exceptionel billedkvalitet og stabilitet. Perfekt til ejendomsvisninger, events og personlige projekter." />
                <ul className="space-y-4 text-neutral-300">
                  <li className="flex items-center"><Video className="text-primary mr-3" size={24} /><EditableContent contentKey="drone-feature-video" fallback="4K/60fps videooptagelse" /></li>
                  <li className="flex items-center"><Camera className="text-primary mr-3" size={24} /><EditableContent contentKey="drone-feature-photo" fallback="48MP stillbilleder" /></li>
                  <li className="flex items-center"><MapPin className="text-primary mr-3" size={24} /><EditableContent contentKey="drone-feature-coverage" fallback="Dækker hele områder i Danmark" /></li>
                </ul>
              </div>
              <div className="relative">
                <EditableContent contentKey="drone-section-image" as="img" className="rounded-lg shadow-xl" alt="DJI Mini 3 Pro Drone" fallback="/Drone.png" />
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="py-10 md:py-20 bg-neutral-800">
        <div className="container text-center">
          <EditableContent contentKey="cta-title" as="h2" className="text-3xl md:text-4xl font-bold mb-8 text-white" fallback="Klar til en ny verden fra oven?" />
          <div className="mb-10">
            <AiCTA />
          </div>
          <div className="flex flex-col sm:flex-row justify-center gap-4 mt-2">
            <button onClick={() => navigate('/products')} className="btn-primary text-lg px-8 py-4">
              <EditableContent contentKey="cta-button-primary" fallback="Se Priser og Book" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
