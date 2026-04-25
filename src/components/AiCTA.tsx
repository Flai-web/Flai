import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../contexts/DataContext';
import { isAddressWithinRange, getFormattedDistance } from '../utils/location';
import { CONTENT_KEYS } from 'virtual:content-keys';
import ProductCard from './ProductCard';
import {
  Sparkles, Send, MapPin, Loader2, X, CheckCircle, XCircle, ArrowRight,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { Product } from '../types';
import { DEPLOYED_HOME_SECTIONS } from '../pages/HomePage';

// ─── API config ───────────────────────────────────────────────────────────────
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? 'AIzaSyC2DZXk4Di_Jt-KzIYpyejESm1CWrFhFq0';
const GROQ_API_KEY   = import.meta.env.VITE_GROQ_API_KEY ?? '';

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

// Only the most reliable, fastest models — not a 9-model waterfall
const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', maxTokens: 8_192 },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', maxTokens: 8_192 },
  { id: 'llama-3.1-8b-instant', maxTokens: 8_192 },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface HistoryEntry { role: 'user' | 'assistant'; content: string; }

type Intent = 'products' | 'portfolio' | 'coverage' | 'general' | 'reasoning';

interface AIDecision {
  intent: Intent;
  address?: string | null;
  text: string;
  productIds?: string[] | 'all' | null;
  showProductsAfter?: boolean;
  portfolioRows?: number | null;
  portfolioIds?: string[] | null;
}

type MsgType = 'user' | 'ai' | 'products' | 'portfolio' | 'coverage-form' | 'coverage-result';

interface Message {
  id: string;
  type: MsgType;
  text?: string;
  products?: Product[];
  images?: any[];
  portfolioRows?: number | null;
  portfolioIds?: string[] | null;
  coverageResult?: { covered: boolean; distance?: string; address: string };
  isPersonalised?: boolean;
}

// ─── Module-level cache (survives re-renders, cleared on page nav) ────────────
let _cachedProducts: Product[] | null = null;
let _cachedPortfolio: any[] | null = null;

async function fetchProductsCached(): Promise<Product[]> {
  if (_cachedProducts) return _cachedProducts;
  try {
    const { data, error } = await supabase.from('products').select('*');
    if (error || !data) return [];
    _cachedProducts = data as Product[];
    return _cachedProducts;
  } catch { return []; }
}

async function fetchPortfolioCached(): Promise<any[]> {
  if (_cachedPortfolio) return _cachedPortfolio;
  try {
    const { data, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    _cachedPortfolio = data;
    return _cachedPortfolio;
  } catch { return []; }
}

// ─── API callers with timeout ─────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function callGemini(systemPrompt: string, history: HistoryEntry[]): Promise<string> {
  const contents = history.map((h) => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }));
  const res = await withTimeout(fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    }),
  }), 12_000);

  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini empty');
  return text;
}

async function callGroqModel(modelId: string, maxTokens: number, systemPrompt: string, history: HistoryEntry[]): Promise<string> {
  const res = await withTimeout(fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  }), 12_000);
  if (!res.ok) throw new Error(`Groq/${modelId} ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Groq/${modelId} empty`);
  return text;
}

async function callAI(systemPrompt: string, history: HistoryEntry[]): Promise<string> {
  // Try Gemini first (fast + smart), then Groq models in order
  const attempts: Array<() => Promise<string>> = [
    () => callGemini(systemPrompt, history),
    ...GROQ_MODELS.map(({ id, maxTokens }) => () => callGroqModel(id, maxTokens, systemPrompt, history)),
  ];

  for (const attempt of attempts) {
    try { return await attempt(); } catch { /* try next */ }
  }
  throw new Error('All AI providers failed');
}

// ─── JSON extraction — robust against markdown fences and leading text ─────────
function extractJSON(raw: string): string | null {
  // Strip markdown fences
  const stripped = raw.replace(/```[\w]*\n?/g, '').trim();
  // Find outermost { }
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

// ─── Fallback when AI fails completely ───────────────────────────────────────
function keywordFallback(): AIDecision {
  return {
    intent: 'general',
    address: null,
    text: 'Beklager, jeg kunne ikke besvare det. Kontakt os på fb@flai.dk eller +45 27 29 21 99.',
  };
}

// ─── Content helpers ──────────────────────────────────────────────────────────
const SKIP_PREFIXES   = ['admin-', 'deploy-', 'auth-', 'video-manager', 'address-zones-manager'];
const UI_NOISE_EXACT  = new Set(['submit', 'cancel', 'close', 'open', 'back', 'next', 'send', 'loading']);
const UI_NOISE_SUFFIX = ['-btn', '-button', '-label', '-placeholder', '-cta', '-link', '-nav', '-tag', '-badge'];

function isUINoiseKey(key: string) {
  return UI_NOISE_EXACT.has(key) || UI_NOISE_SUFFIX.some((s) => key.endsWith(s));
}

function mergeHomeSections(dbSections: any[], isDbLoaded: boolean): any[] {
  if (!isDbLoaded) return DEPLOYED_HOME_SECTIONS;
  const dbIds = new Set(dbSections.map((s: any) => s.id));
  return [...dbSections, ...DEPLOYED_HOME_SECTIONS.filter((s) => !dbIds.has(s.id))]
    .sort((a, b) => a.order_index - b.order_index);
}

const VALID_INTENTS = new Set<Intent>(['products', 'portfolio', 'coverage', 'general', 'reasoning']);

// ─── System prompt — tighter, clearer, JSON-first ────────────────────────────
function buildSystemPrompt(
  products: Product[],
  addressZones: any[],
  siteContent: Record<string, { key: string; value: string; type: string }>,
  homeSections: any[],
  portfolioItems: any[],
): string {
  // Build content map
  const merged = new Map<string, string>();
  Object.values(siteContent).forEach(({ key, value, type }) => {
    if (SKIP_PREFIXES.some((p) => key.startsWith(p))) return;
    if (type === 'image' || type === 'color') return;
    if (isUINoiseKey(key)) return;
    if (value?.trim().length > 3) merged.set(key, value.trim());
  });
  CONTENT_KEYS.forEach(({ key, fallback }: { key: string; fallback: string }) => {
    if (merged.has(key)) return;
    if (SKIP_PREFIXES.some((p) => key.startsWith(p))) return;
    if (isUINoiseKey(key)) return;
    if (fallback.startsWith('/')) return;
    if (fallback?.trim().length > 3) merged.set(key, fallback.trim());
  });

  // Group by prefix, skip seo/meta
  const grouped = new Map<string, Array<[string, string]>>();
  Array.from(merged.entries())
    .filter(([k]) => !k.includes('meta') && !k.includes('seo'))
    .forEach(([k, v]) => {
      const prefix = k.split('-')[0] ?? 'other';
      if (!grouped.has(prefix)) grouped.set(prefix, []);
      grouped.get(prefix)!.push([k, v]);
    });

  const contentLines: string[] = [];
  grouped.forEach((entries, prefix) => {
    contentLines.push(`[${prefix.toUpperCase()}]`);
    entries.forEach(([k, v]) => contentLines.push(`  ${k}: ${v}`));
  });

  const zones = (addressZones ?? [])
    .filter((z: any) => z.is_active)
    .map((z: any) => `  ${z.name}: center="${z.center_address}" radius=${z.radius_km}km`)
    .join('\n') || '  (ingen konfigureret)';

  const productList = products.length
    ? products
        .sort((a, b) => (b as any).array - (a as any).array || 0)
        .map((p) => `  [${p.id}] ${p.name} | pris: ${(p as any).price ?? 'se hjemmeside'} | ${p.description ?? ''}`)
        .join('\n')
    : '  (ingen produkter)';

  const portfolioList = portfolioItems.length
    ? portfolioItems
        .sort((a, b) => (b.array ?? 50) - (a.array ?? 50))
        .map((img) => {
          const type = img.image_url?.startsWith('youtube:') ? 'video' : 'billede';
          return `  [${img.id}] "${img.title ?? ''}" type=${type} tags="${(img.tags ?? []).join(', ')}"`;
        })
        .join('\n')
    : '  (ingen)';

  const activeSections = homeSections
    .filter((s) => s.is_active)
    .map((s) => `  ${s.title ?? s.id}`)
    .join('\n') || '  (ingen)';

  return `Du er Flai AI — assistent for Flai, et dansk dronefirma (luftfoto/video i Trekantsområdet).
Ejeren hedder Felix. Kontakt: fb@flai.dk | +45 27 29 21 99.

OUTPUT: KUN gyldigt JSON. Ingen tekst uden for JSON. Ingen markdown-fences.

SCHEMA:
{
  "intent": "products"|"portfolio"|"coverage"|"general"|"reasoning",
  "address": "<by eller adresse nævnt af brugeren, eller null>",
  "text": "<dit danske svar — grundigt og konkret>",
  "productIds": ["id"]|"all"|null,
  "showProductsAfter": true|false,
  "portfolioRows": <tal eller null>,
  "portfolioIds": ["id"]|null
}

INTENT-REGLER:
• "coverage"  → spørger om Flai dækker en by/adresse. Sæt by i "address". Skriv kort svar i "text".
• "products"  → vil se produkter/pakker/priser. Sæt productIds.
• "portfolio" → vil se eksempler/fotos/videoer. Sæt portfolioRows og evt. portfolioIds.
• "reasoning" → vil have anbefaling, sammenligning, hvad passer bedst. Brug showProductsAfter hvis relevant.
• "general"   → alt andet: firma, Felix, udstyr, leveringstid, proces, spørgsmål.

PRODUKT-REGLER:
• productIds="all" → vis alle produkter.
• productIds=["id1","id2"] → vis kun disse. Brug KUN IDs fra listen nedenfor.
• showProductsAfter=true → vis produkter efter tekst-svar (brug ved "reasoning").

PORTFOLIO-REGLER:
• portfolioIds=null → standard rækkefølge.
• portfolioIds=["id1"] → filtrer til specifikke items (brug ved specifikke forespørgsler).
• portfolioRows: antal rækker à 2 items. Null = standard (5 desktop / 4 mobil).
• Brug KUN IDs fra PORTFOLIO-listen nedenfor.

SVAR-REGLER:
• Svar ALTID på dansk.
• Brug konkrete detaljer fra FLAIS DATA — ikke generiske svar.
• Skriv substansfulde svar. Undgå 1-linje svar på komplekse spørgsmål.
• Hvis du ikke kender svaret: henvis til fb@flai.dk / +45 27 29 21 99.
• Til "coverage": skriv ALDRIG om adressen er dækket — systemet tjekker det. Sig bare "Lad mig tjekke…".
• Opfind ALDRIG priser, kontaktinfo eller IDs.

EKSEMPLER:
Bruger: "Dækker I Aarhus?"
{"intent":"coverage","address":"Aarhus","text":"Lad mig tjekke det for dig!","productIds":null,"showProductsAfter":false,"portfolioRows":null,"portfolioIds":null}

Bruger: "Hvad koster luftfoto?"
{"intent":"reasoning","address":null,"text":"Prisen afhænger af opgaven. Her er vores pakker:","productIds":"all","showProductsAfter":true,"portfolioRows":null,"portfolioIds":null}

Bruger: "Vis drone-videoer"
{"intent":"portfolio","address":null,"text":"Her er vores drone-videoer:","productIds":null,"showProductsAfter":false,"portfolioRows":null,"portfolioIds":["<video-id-1>","<video-id-2>"]}

─── FLAIS DATA ───────────────────────────────────────────────

PRODUKTER:
${productList}

PORTFOLIO:
${portfolioList}

DÆKNINGSZONER:
${zones}

AKTIVE SEKTIONER:
${activeSections}

HJEMMESIDEINDHOLD:
${contentLines.join('\n')}`;
}

// ─── Core AI call with robust JSON parsing ────────────────────────────────────
const MAX_HISTORY = 10; // Keep last 5 exchanges to avoid context overflow

async function detectIntent(
  userMessage: string,
  products: Product[],
  addressZones: any[],
  siteContent: Record<string, { key: string; value: string; type: string }>,
  homeSections: any[],
  history: HistoryEntry[],
  portfolioItems: any[],
  getContent: (key: string, fallback: string) => string,
): Promise<AIDecision> {
  const systemPrompt = buildSystemPrompt(products, addressZones, siteContent, homeSections, portfolioItems);

  // Trim history to avoid context overflow — keep last N entries
  const trimmedHistory = history.slice(-MAX_HISTORY);
  const callHistory: HistoryEntry[] = [...trimmedHistory, { role: 'user', content: userMessage }];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // On retry, add a hint to the last user message
      const finalHistory = attempt === 0
        ? callHistory
        : [
            ...callHistory.slice(0, -1),
            {
              role: 'user' as const,
              content: `${userMessage}\n\n[VIGTIGT: Svar KUN med et gyldigt JSON-objekt. Ingen markdown. Ingen tekst uden for {}.] `,
            },
          ];

      const raw = await callAI(systemPrompt, finalHistory);
      const jsonStr = extractJSON(raw);
      if (!jsonStr) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      if (!VALID_INTENTS.has(parsed.intent)) throw new Error(`Invalid intent: ${parsed.intent}`);
      if (typeof parsed.text !== 'string' || parsed.text.trim().length < 2) throw new Error('Missing text');

      const productIds = parsed.productIds ?? null;
      if (productIds !== null && productIds !== 'all' && !Array.isArray(productIds)) {
        parsed.productIds = null; // Coerce bad value rather than throwing
      }

      return {
        intent: parsed.intent as Intent,
        address: typeof parsed.address === 'string' && parsed.address.trim() ? parsed.address.trim() : null,
        text: parsed.text.trim(),
        productIds: parsed.productIds ?? null,
        showProductsAfter: parsed.showProductsAfter === true,
        portfolioRows: typeof parsed.portfolioRows === 'number' ? Math.max(1, Math.round(parsed.portfolioRows)) : null,
        portfolioIds: Array.isArray(parsed.portfolioIds) && parsed.portfolioIds.length > 0 ? parsed.portfolioIds : null,
      };
    } catch {
      if (attempt === 1) return keywordFallback();
    }
  }

  return keywordFallback();
}

// ─── Formatting ───────────────────────────────────────────────────────────────
function formatAI(raw: string): string {
  return raw
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    .replace(/^[*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/((<li>[^<]*<\/li>\n?)+)/g, (m) => `<ul>${m}</ul>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--secondary)">$1</a>')
    .replace(/\n/g, '<br/>');
}

// ─── Sub-components ───────────────────────────────────────────────────────────
const ITEMS_PER_ROW      = 2;
const DEFAULT_ROWS_DESKTOP = 5;
const DEFAULT_ROWS_MOBILE  = 4;

const PortfolioGrid: React.FC<{
  images: any[];
  portfolioRows?: number | null;
  portfolioIds?: string[] | null;
}> = ({ images, portfolioRows, portfolioIds }) => {
  const navigate = useNavigate();

  let filtered = portfolioIds && portfolioIds.length > 0
    ? portfolioIds.map((id) => images.find((img) => String(img.id) === String(id))).filter(Boolean)
    : [...images].sort((a, b) => (b.array ?? 50) - (a.array ?? 50));

  const desktopItems = portfolioRows != null ? portfolioRows * ITEMS_PER_ROW : DEFAULT_ROWS_DESKTOP * ITEMS_PER_ROW;
  const mobileItems  = portfolioRows != null ? portfolioRows * ITEMS_PER_ROW : DEFAULT_ROWS_MOBILE  * ITEMS_PER_ROW;

  return (
    <div className="w-full">
      <style>{`
        @media (min-width: 640px) {
          .aicta-portfolio-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .aicta-portfolio-item--mobile-hidden { display: block !important; }
        }
        @media (max-width: 639px) { .aicta-portfolio-item--mobile-hidden { display: none; } }
      `}</style>
      <div className="aicta-portfolio-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
        {filtered.map((img, idx) => {
          if (idx >= desktopItems) return null;
          const hiddenOnMobile = idx >= mobileItems;
          const isYt = img.image_url?.startsWith('youtube:');
          const ytId = isYt ? img.image_url.split(':')[1] : null;

          return (
            <div
              key={img.id}
              className={hiddenOnMobile ? 'aicta-portfolio-item--mobile-hidden' : ''}
              style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', aspectRatio: '16/9', background: 'var(--neutral-700,#404040)' }}
            >
              {isYt ? (
                <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%' }}>
                  <iframe
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                    src={`https://www.youtube.com/embed/${ytId}`}
                    title={img.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <img
                  src={img.image_url}
                  alt={img.title}
                  onClick={() => navigate('/portfolio')}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                />
              )}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(transparent,rgba(0,0,0,.7))',
                fontSize: '.6rem', color: '#fff', padding: '8px 4px 3px',
                pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {img.title}
              </div>
            </div>
          );
        })}
      </div>
      <button
        className="btn-primary w-full mt-3 flex items-center justify-center gap-2"
        style={{ fontSize: '.875rem', padding: '10px' }}
        onClick={() => navigate('/portfolio')}
      >
        Se hele portfolio <ArrowRight size={15} />
      </button>
    </div>
  );
};

const CoverageForm: React.FC<{ onCheck: (a: string) => void; loading: boolean }> = ({ onCheck, loading }) => {
  const [addr, setAddr] = useState('');
  return (
    <div className="card p-4 w-full">
      <p className="form-label flex items-center gap-2 mb-2" style={{ fontSize: '.8rem' }}>
        <MapPin size={13} /> Check din adresse
      </p>
      <div className="flex gap-2">
        <input
          className="form-input"
          placeholder="F.eks. Vejle, Kolding…"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addr.trim() && onCheck(addr)}
          disabled={loading}
        />
        <button
          className="btn-primary flex items-center gap-1 whitespace-nowrap"
          style={{ padding: '8px 16px', fontSize: '.875rem' }}
          onClick={() => addr.trim() && onCheck(addr)}
          disabled={loading || !addr.trim()}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : 'Tjek'}
        </button>
      </div>
    </div>
  );
};

const CoverageResult: React.FC<{ result: { covered: boolean; distance?: string; address: string } }> = ({ result }) => (
  <div
    className="flex items-start gap-3 p-3 rounded-xl w-full"
    style={{
      background: result.covered ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
      border: `1px solid ${result.covered ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`,
      textAlign: 'left',
    }}
  >
    {result.covered
      ? <CheckCircle size={20} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--success,#10b981)' }} />
      : <XCircle    size={20} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--error,#ef4444)' }} />}
    <div>
      <p className="font-semibold text-white" style={{ fontSize: '.875rem', margin: '0 0 2px' }}>
        {result.covered ? 'Vi dækker din adresse! 🎉' : 'Vi dækker desværre ikke denne adresse'}
      </p>
      <p style={{ fontSize: '.74rem', color: 'var(--neutral-400,#a3a3a3)', margin: 0 }}>
        {result.address}
        {!result.covered && result.distance ? ` — ${result.distance} fra vores base` : ''}
      </p>
    </div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────
const AiCTA: React.FC = () => {
  const navigate = useNavigate();
  const {
    getContent, siteContent, addressZones, isAddressZonesLoaded, refreshAddressZones,
    homeSections: dbHomeSections, isHomeSectionsLoaded, refreshHomeSections,
  } = useData();

  const [messages, setMessages]             = useState<Message[]>([]);
  const [input, setInput]                   = useState('');
  const [loading, setLoading]               = useState(false);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [expanded, setExpanded]             = useState(false);

  // Use ref for history to avoid stale closures in async handlers
  const historyRef     = useRef<HistoryEntry[]>([]);
  const inputRef       = useRef<HTMLInputElement>(null);
  const msgsContRef    = useRef<HTMLDivElement>(null);
  const shouldScroll   = useRef(false);

  // Prefetch data in the background so first message is fast
  useEffect(() => {
    fetchProductsCached();
    fetchPortfolioCached();
    if (!isAddressZonesLoaded) refreshAddressZones();
    if (!isHomeSectionsLoaded) refreshHomeSections();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (shouldScroll.current) {
      const el = msgsContRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      shouldScroll.current = false;
    }
  }, [messages, loading]);

  const homeSections = mergeHomeSections(dbHomeSections, isHomeSectionsLoaded);

  const addMsg = useCallback((msg: Omit<Message, 'id'>, scroll = true) => {
    shouldScroll.current = scroll;
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID() }]);
  }, []);

  const handleCoverageCheck = useCallback(async (address: string) => {
    setCoverageLoading(true);
    try {
      const covered  = await isAddressWithinRange(address);
      const distance = covered ? undefined : await getFormattedDistance(address);
      addMsg({ type: 'coverage-result', coverageResult: { covered, distance, address } });
      addMsg({
        type: 'ai',
        text: covered
          ? 'Super! Vi dækker din adresse. Skriv gerne for at høre mere eller book direkte.'
          : `Vi dækker desværre ikke ${address} endnu. Skriv til fb@flai.dk – vi finder en løsning!`,
      });
    } catch {
      addMsg({ type: 'ai', text: 'Kunne ikke tjekke adressen. Kontakt os direkte på fb@flai.dk.' });
    } finally {
      setCoverageLoading(false);
    }
  }, [addMsg]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || loading) return;

    setInput('');
    setExpanded(true);
    addMsg({ type: 'user', text: q });
    setLoading(true);

    try {
      // Both fetches resolve from cache after the first call
      const [allProducts, allPortfolio] = await Promise.all([
        fetchProductsCached(),
        fetchPortfolioCached(),
      ]);

      const sorted = [...allProducts].sort((a, b) => ((b as any).array ?? 50) - ((a as any).array ?? 50));

      const decision = await detectIntent(
        q, sorted, addressZones, siteContent, homeSections,
        historyRef.current, allPortfolio, getContent,
      );

      // Update conversation history IMMEDIATELY after response (use text, not raw JSON)
      // This ensures multi-turn works correctly
      historyRef.current = [
        ...historyRef.current.slice(-MAX_HISTORY),
        { role: 'user', content: q },
        { role: 'assistant', content: decision.text },
      ];

      const { intent, address, text, productIds, showProductsAfter, portfolioRows, portfolioIds } = decision;

      // ── products intent ──
      if (intent === 'products') {
        let toShow: Product[];
        if (!productIds || productIds === 'all') {
          toShow = sorted;
        } else {
          const validIds = new Set(sorted.map((p) => String(p.id)));
          const ids = (productIds as string[]).filter((id) => validIds.has(id));
          toShow = ids.length > 0 ? sorted.filter((p) => ids.includes(String(p.id))) : sorted;
        }
        const isPersonalised = Array.isArray(productIds) && toShow.length < sorted.length;
        addMsg({ type: 'ai', text });
        if (toShow.length > 0) addMsg({ type: 'products', products: toShow, isPersonalised }, false);
        else addMsg({ type: 'ai', text: 'Vi har ingen aktive produkter for øjeblikket. Kontakt os på fb@flai.dk.' });

      // ── reasoning intent ──
      } else if (intent === 'reasoning') {
        addMsg({ type: 'ai', text });
        if (showProductsAfter) {
          let toShow: Product[];
          if (!productIds || productIds === 'all') {
            toShow = sorted;
          } else {
            const validIds = new Set(sorted.map((p) => String(p.id)));
            const ids = (productIds as string[]).filter((id) => validIds.has(id));
            toShow = ids.length > 0 ? sorted.filter((p) => ids.includes(String(p.id))) : sorted;
          }
          if (toShow.length > 0) {
            const isPersonalised = Array.isArray(productIds) && productIds.length > 0 && toShow.length < sorted.length;
            addMsg({ type: 'products', products: toShow, isPersonalised }, false);
          }
        }

      // ── portfolio intent ──
      } else if (intent === 'portfolio') {
        addMsg({ type: 'ai', text });
        if (allPortfolio.length > 0) {
          addMsg({ type: 'portfolio', images: allPortfolio, portfolioRows, portfolioIds }, false);
        } else {
          addMsg({ type: 'ai', text: 'Vi har ikke uploadet portfolio endnu. Følg os på Facebook @flai.dk!' });
        }

      // ── coverage intent ──
      } else if (intent === 'coverage') {
        addMsg({ type: 'ai', text });
        if (address) {
          await handleCoverageCheck(address);
        } else {
          // AI couldn't extract an address — show form
          addMsg({ type: 'coverage-form' });
        }

      // ── general / fallback ──
      } else {
        addMsg({ type: 'ai', text });
      }

    } catch {
      addMsg({ type: 'ai', text: 'Beklager, noget gik galt. Kontakt os på fb@flai.dk eller +45 27 29 21 99.' });
    } finally {
      setLoading(false);
    }
  };

  const SUGGESTIONS = [
    'Hvad koster jeres tjenester?',
    'Vis mig jeres portfolio',
    'Hvad dækker I?',
    'Hvad er leveringstiden?',
  ];

  const renderMsg = (msg: Message) => {
    if (msg.type === 'user')
      return (
        <div
          key={msg.id}
          className="self-end bg-primary text-white px-4 py-3 max-w-xs"
          style={{ borderRadius: '12px 12px 2px 12px', fontSize: '.875rem', lineHeight: 1.55, fontWeight: 500 }}
        >
          {msg.text}
        </div>
      );

    if (msg.type === 'ai')
      return (
        <div
          key={msg.id}
          className="self-start text-neutral-100 px-4 py-3"
          style={{
            background: 'var(--neutral-800,#262626)',
            borderRadius: '2px 12px 12px 12px',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: '.875rem', lineHeight: 1.7, maxWidth: '88%', textAlign: 'left',
          }}
          dangerouslySetInnerHTML={{ __html: formatAI(msg.text ?? '') }}
        />
      );

    if (msg.type === 'products' && msg.products?.length)
      return (
        <div key={msg.id} className="w-full">
          <style>{`@media (min-width: 640px) { .aicta-products-grid { grid-template-columns: repeat(2, 1fr) !important; } }`}</style>
          <div className="aicta-products-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            {msg.products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
          <button
            className="btn-secondary w-full mt-3 flex items-center justify-center gap-2"
            style={{ fontSize: '.8rem', padding: '8px' }}
            onClick={() => navigate('/produkter')}
          >
            {msg.isPersonalised ? 'Se alle produkter' : 'Se produkter på hjemmesiden'} <ArrowRight size={13} />
          </button>
        </div>
      );

    if (msg.type === 'portfolio' && msg.images?.length)
      return (
        <PortfolioGrid
          key={msg.id}
          images={msg.images}
          portfolioRows={msg.portfolioRows}
          portfolioIds={msg.portfolioIds}
        />
      );

    if (msg.type === 'coverage-form')
      return <CoverageForm key={msg.id} onCheck={handleCoverageCheck} loading={coverageLoading} />;

    if (msg.type === 'coverage-result' && msg.coverageResult)
      return <CoverageResult key={msg.id} result={msg.coverageResult} />;

    return null;
  };

  const inputBar = (
    <div
      className="flex items-center gap-2 rounded-xl"
      style={{
        background: 'var(--neutral-800,#262626)',
        border: '1px solid rgba(255,255,255,0.10)',
        padding: '8px 8px 8px 18px',
        maxWidth: 680, margin: '0 auto',
      }}
    >
      <Sparkles size={17} style={{ color: 'var(--secondary)', flexShrink: 0 }} />
      <input
        ref={inputRef}
        className="flex-1 bg-transparent border-none outline-none text-neutral-50 min-w-0"
        style={{ fontSize: '.9375rem', fontFamily: 'inherit' }}
        placeholder="Spørg om priser, se portfolio, tjek adresse…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
        disabled={loading}
      />
      <button
        className="btn-primary flex items-center gap-2 whitespace-nowrap"
        style={{ padding: '9px 18px', fontSize: '.85rem', borderRadius: 9, flexShrink: 0 }}
        onClick={handleSend}
        disabled={loading || !input.trim()}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
      </button>
    </div>
  );

  return (
    <>
      {!expanded && (
        <>
          {inputBar}
          <div className="flex flex-wrap gap-2 justify-center" style={{ maxWidth: 680, margin: '12px auto 0' }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="btn-secondary whitespace-nowrap"
                style={{ fontSize: '.78rem', padding: '6px 13px', borderRadius: 8 }}
                onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 30); }}
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      {expanded && messages.length > 0 && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            maxWidth: 680, margin: '12px auto 0',
            background: 'var(--neutral-900,#171717)',
            border: '1px solid rgba(255,255,255,0.09)',
            animation: 'aicta-in .22s ease',
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: 'var(--neutral-800,#262626)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
          >
            <span
              className="flex items-center gap-2 font-bold uppercase tracking-widest"
              style={{ fontSize: '.7rem', color: 'var(--secondary)' }}
            >
              <Sparkles size={11} /> Flai AI
            </span>
            <button
              style={{ background: 'none', border: 'none', color: 'var(--neutral-500,#737373)', cursor: 'pointer', borderRadius: 6, padding: 4 }}
              title="Luk"
              onClick={() => {
                setExpanded(false);
                setMessages([]);
                historyRef.current = [];
              }}
            >
              <X size={15} />
            </button>
          </div>

          <div
            ref={msgsContRef}
            className="flex flex-col gap-3 p-4 overflow-y-auto"
            style={{ maxHeight: 560 }}
          >
            {messages.map(renderMsg)}
            {loading && (
              <div
                className="self-start flex items-center gap-2 px-4 py-3"
                style={{
                  background: 'var(--neutral-800,#262626)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '2px 12px 12px 12px',
                  color: 'var(--neutral-500,#737373)',
                  fontSize: '.85rem',
                }}
              >
                <Loader2 size={13} className="animate-spin" /> Tænker…
              </div>
            )}
          </div>

          <div style={{ background: 'var(--neutral-800,#262626)', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px 8px' }}>
            {inputBar}
          </div>

          <div className="flex flex-wrap gap-2 px-4 pb-4 pt-2" style={{ background: 'var(--neutral-800,#262626)' }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="btn-secondary whitespace-nowrap"
                style={{ fontSize: '.72rem', padding: '4px 10px', borderRadius: 7 }}
                onClick={() => { setInput(s); inputRef.current?.focus(); }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <style>{`@keyframes aicta-in { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }`}</style>
    </>
  );
};

export default AiCTA;
