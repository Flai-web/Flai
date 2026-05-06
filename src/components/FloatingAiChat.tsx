/**
 * FloatingAiChat.tsx - REWRITTEN
 *
 * Changes from original:
 *  - Centered floating bar (left:50% / transform: translateX(-50%))
 *  - Smooth open animation (spring-in) and close animation (spring-out)
 *  - All 5 intents with full system prompt: coverage, products, portfolio, reasoning, general
 *  - Full data access: products, portfolio, addressZones, siteContent, homeSections, pageCtx
 *  - Design matches site: --primary #0F52BA, --secondary #64A0FF, Inter font, dark neutral bg
 */

import React, {
  useState, useRef, useEffect, useCallback,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useData } from '../contexts/DataContext';
import { isAddressWithinRange, getFormattedDistance } from '../utils/location';
import { CONTENT_KEYS } from 'virtual:content-keys';
import ProductCard from './ProductCard';
import {
  Sparkles, Send, MapPin, Loader2, X, CheckCircle, XCircle,
  ArrowRight, MessageCircle,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { Product } from '../types';
import { DEPLOYED_HOME_SECTIONS } from '../pages/HomePage';

const GEMINI_API_KEY = 'AIzaSyC2DZXk4Di_Jt-KzIYpyejESm1CWrFhFq0';
const GROQ_API_KEY   = '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';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

const GROQ_MODELS = [
  { id: 'openai/gpt-oss-120b',                           maxTokens: 8_192 },
  { id: 'openai/gpt-oss-20b',                            maxTokens: 8_192 },
  { id: 'llama-3.3-70b-versatile',                       maxTokens: 8_192 },
  { id: 'qwen/qwen3-32b',                                maxTokens: 8_192 },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct',     maxTokens: 8_192 },
  { id: 'llama-3.1-8b-instant',                          maxTokens: 8_192 },
  { id: 'allam-2-7b',                                    maxTokens: 8_192 },
  { id: 'groq/compound',                                 maxTokens: 4_096 },
  { id: 'groq/compound-mini',                            maxTokens: 4_096 },
];

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

async function callGroqModel(modelId: string, maxTokens: number, systemPrompt: string, history: HistoryEntry[]): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model: modelId, messages: [{ role: 'system', content: systemPrompt }, ...history], max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`Groq/${modelId} ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Groq/${modelId}: empty`);
  return text;
}

async function callGroq(systemPrompt: string, history: HistoryEntry[]): Promise<string> {
  let lastErr: unknown;
  for (const { id, maxTokens } of GROQ_MODELS) {
    try { return await callGroqModel(id, maxTokens, systemPrompt, history); } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

async function callGeminiWithHistory(systemPrompt: string, history: HistoryEntry[], pageImageBase64?: string): Promise<string> {
  const contents = history.map((h, idx) => {
    const isLast = idx === history.length - 1 && h.role === 'user';
    if (isLast && pageImageBase64) {
      return { role: 'user', parts: [{ text: h.content }, { inline_data: { mime_type: 'image/jpeg', data: pageImageBase64 } }] };
    }
    return { role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] };
  });
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: systemPrompt }] }, contents }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: empty response');
  return text;
}

async function callAI(systemPrompt: string, history: HistoryEntry[], pageImageBase64?: string): Promise<string> {
  try { return await callGeminiWithHistory(systemPrompt, history, pageImageBase64); }
  catch { return await callGroq(systemPrompt, history); }
}

interface PageContext { route: string; title: string; headings: string[]; bodyText: string; }

function scrapePageContext(): PageContext {
  const route = window.location.pathname;
  const title = document.title;
  const headings: string[] = [];
  document.querySelectorAll('h1, h2, h3').forEach((el) => {
    const t = (el as HTMLElement).innerText?.trim();
    if (t && t.length > 2) headings.push(t);
  });
  const textNodes: string[] = [];
  let total = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && total < 800) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent) continue;
    const tag = parent.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) continue;
    const style = window.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const txt = node.textContent?.trim();
    if (txt && txt.length > 20) { textNodes.push(txt.slice(0, 120)); total += txt.length; }
  }
  return { route, title, headings: headings.slice(0, 10), bodyText: textNodes.join(' ').slice(0, 800) };
}

async function capturePageScreenshot(): Promise<string | null> {
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(document.body, { scale: 0.35, useCORS: true, logging: false, allowTaint: true, backgroundColor: '#0a0a0a' });
    return canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
  } catch { return null; }
}

const SKIP_PREFIXES    = ['admin-', 'deploy-', 'auth-', 'video-manager', 'address-zones-manager'];
const UI_NOISE_SUFFIXES = ['-btn', '-button', '-label', '-placeholder', '-cta', '-link', '-nav', '-tag', '-badge'];
const UI_NOISE_EXACT    = new Set(['submit', 'cancel', 'close', 'open', 'back', 'next', 'send', 'loading']);
const VALID_INTENTS     = new Set<Intent>(['products', 'portfolio', 'coverage', 'general', 'reasoning']);

function isUINoiseKey(key: string): boolean {
  if (UI_NOISE_EXACT.has(key)) return true;
  if (UI_NOISE_SUFFIXES.some((s) => key.endsWith(s))) return true;
  return false;
}

function summariseSection(section: any): string | null {
  if (section.section_type === 'code' || section.section_type === 'visual_editor') return null;
  const parts: string[] = [`"${section.title}"`];
  if (section.description?.trim()) parts.push(section.description.trim().slice(0, 120));
  return parts.join(': ');
}

function mergeHomeSections(dbSections: any[], isDbLoaded: boolean): any[] {
  if (!isDbLoaded) return DEPLOYED_HOME_SECTIONS;
  const dbIds = new Set(dbSections.map((s: any) => s.id));
  const hardcodedRemainder = DEPLOYED_HOME_SECTIONS.filter((s) => !dbIds.has(s.id));
  return [...dbSections, ...hardcodedRemainder].sort((a, b) => a.order_index - b.order_index);
}

function buildFloatingSystemPrompt(
  products: Product[],
  addressZones: any[],
  siteContent: Record<string, { key: string; value: string; type: string }>,
  homeSections: any[],
  portfolioItems: any[],
  pageCtx: PageContext,
): string {
  const merged = new Map<string, string>();
  Object.values(siteContent).forEach(({ key, value, type }) => {
    if (SKIP_PREFIXES.some((p) => key.startsWith(p))) return;
    if (type === 'image' || type === 'color') return;
    if (isUINoiseKey(key)) return;
    if (value && value.trim().length > 3) merged.set(key, value.trim());
  });
  CONTENT_KEYS.forEach(({ key, fallback }: { key: string; fallback: string }) => {
    if (merged.has(key)) return;
    if (SKIP_PREFIXES.some((p) => key.startsWith(p))) return;
    if (isUINoiseKey(key)) return;
    if (fallback.startsWith('/')) return;
    if (fallback && fallback.trim().length > 3) merged.set(key, fallback.trim());
  });

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
    contentLines.push(`\n  [${prefix.toUpperCase()}]`);
    entries.forEach(([k, v]) => contentLines.push(`  ${k}: ${v}`));
  });

  const zoneLines = (addressZones ?? [])
    .filter((z: any) => z.is_active)
    .map((z: any) => `  - ${z.name}: center="${z.center_address}", radius=${z.radius_km}km`);

  const productList = products.length
    ? products.map((p) => `  id="${p.id}" name="${p.name}" price="${(p as any).price ?? 'se hjemmeside'}" desc="${p.description ?? ''}"`).join('\n')
    : '  (ingen produkter)';

  const portfolioList = portfolioItems.length
    ? portfolioItems
        .sort((a, b) => (b.array ?? 50) - (a.array ?? 50))
        .map((img) => {
          const isYt = img.image_url?.startsWith('youtube:');
          return `  id="${img.id}" title="${img.title ?? ''}" type="${isYt ? 'video' : 'billede'}" tags="${(img.tags ?? []).join(', ')}" desc="${img.description ?? ''}"`;
        })
        .join('\n')
    : '  (ingen portfolio items)';

  const sectionLines = homeSections
    .filter((s) => s.is_active)
    .map(summariseSection)
    .filter(Boolean)
    .join(', ');

  const pageBlock = `
BRUGERENS AKTUELLE SIDE:
Route: ${pageCtx.route} | Titel: ${pageCtx.title}
Overskrifter: ${pageCtx.headings.join(' | ') || '(ingen)'}
Synlig tekst: ${pageCtx.bodyText || '(ingen)'}
${pageCtx.route.includes('portfolio') ? '→ Brugeren er PÅ portfolio-siden.' : ''}
${pageCtx.route.includes('produkt') || pageCtx.route.includes('product') ? '→ Brugeren ser på et produkt/produktside.' : ''}
${pageCtx.route === '/' ? '→ Brugeren er på forsiden.' : ''}`;

  return `Du er Flai AI – en intelligent, venlig assistent for Flai, et dansk dronefirma specialiseret i luftfoto og -video.
Du er aktiv som en FLYDENDE CHAT der hjælper brugeren mens de browser hjemmesiden.

OUTPUT-FORMAT (KUN gyldigt JSON, ingen markdown udenfor JSON):
{
  "thinking": "<din reasoning>",
  "intent": "products" | "portfolio" | "coverage" | "general" | "reasoning",
  "address": "<by/adresse nævnt i beskeden, eller null>",
  "text": "<dit svar på dansk>",
  "productIds": ["id1"] | "all" | null,
  "showProductsAfter": true | false,
  "portfolioRows": <antal rækker eller null>,
  "portfolioIds": ["id1","id2"] | null
}

INTENTS:
"coverage"  → spørger om Flai dækker et sted eller hvilken by der er nærmest
"products"  → vil se produkter, pakker, prisliste
"portfolio" → vil se eksempler, fotos, videoer, arbejde
"reasoning" → spørger om pris, anbefaling, sammenligning, hvad der passer bedst
"general"   → alt andet – spørgsmål om firmaet, Felix, udstyr, proces, leveringstid, etc.

KRITISKE REGLER:
① Læs ALTID Flais data nedenfor FØR du svarer
② Brug siden brugeren er på som kontekst
③ Opfind ALDRIG kontaktinfo eller priser
④ productIds: KUN IDs fra produktlisten
⑤ portfolioIds: KUN IDs fra PORTFOLIO ITEMS
⑥ Svar med substans og på dansk

${pageBlock}

PRODUKTER:
${productList}

PORTFOLIO ITEMS:
${portfolioList}

DÆKNINGSZONER:
${zoneLines.length ? zoneLines.join('\n') : '  (ingen zoner konfigureret)'}

HJEMMESIDENS SEKTIONER: ${sectionLines || '(ingen)'}

HJEMMESIDEINDHOLD:
${contentLines.join('\n')}

Returner KUN gyldigt JSON.`;
}

function keywordFallback(): AIDecision {
  return { intent: 'general', address: null, text: 'Kontakt os på fb@flai.dk eller +45 27 29 21 99 for svar på dit spørgsmål.' };
}

async function detectFloatingIntent(
  userMessage: string, products: Product[], getContent: (key: string, fallback: string) => string,
  addressZones: any[], siteContent: Record<string, { key: string; value: string; type: string }>,
  homeSections: any[], conversationHistory: HistoryEntry[], portfolioItems: any[],
  pageCtx: PageContext, pageImageBase64?: string,
): Promise<AIDecision> {
  const systemPrompt = buildFloatingSystemPrompt(products, addressZones, siteContent, homeSections, portfolioItems, pageCtx);
  const history: HistoryEntry[] = [...conversationHistory, { role: 'user', content: userMessage }];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callAI(systemPrompt, history, pageImageBase64);
      const jsonMatch = raw.replace(/```[\w]*\n?/g, '').trim().match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);
      if (!VALID_INTENTS.has(parsed.intent)) throw new Error(`Invalid intent: ${parsed.intent}`);
      if (typeof parsed.text !== 'string' || parsed.text.trim().length < 2) throw new Error('Missing text');
      const productIds = parsed.productIds;
      if (productIds !== null && productIds !== 'all' && !Array.isArray(productIds)) throw new Error(`Invalid productIds`);
      return {
        intent: parsed.intent as Intent,
        address: typeof parsed.address === 'string' && parsed.address.trim() ? parsed.address.trim() : null,
        text: parsed.text.trim(),
        productIds: productIds ?? null,
        showProductsAfter: parsed.showProductsAfter === true,
        portfolioRows: typeof parsed.portfolioRows === 'number' ? Math.max(1, Math.round(parsed.portfolioRows)) : null,
        portfolioIds: Array.isArray(parsed.portfolioIds) ? parsed.portfolioIds : null,
      };
    } catch { if (attempt === 1) return keywordFallback(); }
  }
  return keywordFallback();
}

async function fetchProductsDirect(): Promise<Product[]> {
  try {
    const { data, error } = await supabase.from('products').select('*');
    if (error || !data) return [];
    return data as Product[];
  } catch { return []; }
}

async function fetchPortfolioDirect(): Promise<any[]> {
  try {
    const { data, error } = await supabase.from('portfolio_images').select('*').order('created_at', { ascending: false });
    if (error || !data) return [];
    return data;
  } catch { return []; }
}

function formatAI(raw: string): string {
  return raw
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    .replace(/^[*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/((<li>[^<]*<\/li>\n?)+)/g, (m) => `<ul>${m}</ul>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--secondary)">$1</a>')
    .replace(/\n/g, '<br/>');
}

const ITEMS_PER_ROW = 2;
const DEFAULT_ROWS  = 3;

const PortfolioGrid: React.FC<{ images: any[]; portfolioRows?: number | null; portfolioIds?: string[] | null }> = ({
  images, portfolioRows, portfolioIds,
}) => {
  const navigate = useNavigate();
  let filtered = portfolioIds && portfolioIds.length > 0
    ? portfolioIds.map((id) => images.find((img) => String(img.id) === String(id))).filter(Boolean)
    : [...images].sort((a, b) => (b.array ?? 50) - (a.array ?? 50));
  const maxItems = (portfolioRows ?? DEFAULT_ROWS) * ITEMS_PER_ROW;
  return (
    <div className="w-full">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {filtered.slice(0, maxItems).map((img) => {
          const isYt = img.image_url?.startsWith('youtube:');
          const ytId = isYt ? img.image_url.split(':')[1] : null;
          return (
            <div key={img.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', aspectRatio: '16/9', background: 'var(--neutral-700,#404040)' }}>
              {isYt ? (
                <iframe style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                  src={`https://www.youtube.com/embed/${ytId}`} title={img.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              ) : (
                <img src={img.image_url} alt={img.title} onClick={() => navigate('/portfolio')}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} />
              )}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent,rgba(0,0,0,.75))', fontSize: '.55rem', color: '#fff', padding: '6px 4px 2px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                {img.title}
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
        style={{ fontSize: '.75rem', padding: '7px' }} onClick={() => navigate('/portfolio')}>
        Se hele portfolio <ArrowRight size={12} />
      </button>
    </div>
  );
};

const CoverageForm: React.FC<{ onCheck: (a: string) => void; loading: boolean }> = ({ onCheck, loading }) => {
  const [addr, setAddr] = useState('');
  return (
    <div style={{ background: 'var(--neutral-800,#262626)', borderRadius: 10, padding: 12, width: '100%', border: '1px solid rgba(255,255,255,0.07)' }}>
      <p style={{ fontSize: '.75rem', color: 'var(--neutral-400)', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <MapPin size={12} /> Check din adresse
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="form-input" style={{ fontSize: '.8rem', padding: '6px 10px' }}
          placeholder="F.eks. Vejle, Kolding…" value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addr.trim() && onCheck(addr)} disabled={loading} />
        <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '.75rem', whiteSpace: 'nowrap', flexShrink: 0 }}
          onClick={() => addr.trim() && onCheck(addr)} disabled={loading || !addr.trim()}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : 'Tjek'}
        </button>
      </div>
    </div>
  );
};

const CoverageResult: React.FC<{ result: { covered: boolean; distance?: string; address: string } }> = ({ result }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 10, width: '100%',
    background: result.covered ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
    border: `1px solid ${result.covered ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`,
  }}>
    {result.covered
      ? <CheckCircle size={16} style={{ color: 'var(--success,#10b981)', flexShrink: 0, marginTop: 1 }} />
      : <XCircle size={16} style={{ color: 'var(--error,#ef4444)', flexShrink: 0, marginTop: 1 }} />}
    <div>
      <p style={{ fontWeight: 600, color: '#fff', fontSize: '.8rem', margin: '0 0 2px' }}>
        {result.covered ? 'Vi dækker din adresse! 🎉' : 'Vi dækker desværre ikke denne adresse'}
      </p>
      <p style={{ fontSize: '.7rem', color: 'var(--neutral-400,#a3a3a3)', margin: 0 }}>
        {result.address}{!result.covered && result.distance ? ` — ${result.distance} fra vores base` : ''}
      </p>
    </div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────
const FloatingAiChat: React.FC = () => {
  const navigate  = useNavigate();
  const location  = useLocation();

  const {
    getContent, siteContent, addressZones, isAddressZonesLoaded, refreshAddressZones,
    homeSections: dbHomeSections, isHomeSectionsLoaded, refreshHomeSections,
  } = useData();

  const [open, setOpen]                           = useState(false);
  const [panelVisible, setPanelVisible]           = useState(false); // controls DOM presence
  const [animating, setAnimating]                 = useState<'in' | 'out' | null>(null);
  const [messages, setMessages]                   = useState<Message[]>([]);
  const [conversationHistory, setConvHistory]     = useState<HistoryEntry[]>([]);
  const [input, setInput]                         = useState('');
  const [loading, setLoading]                     = useState(false);
  const [coverageLoading, setCoverageLoading]     = useState(false);
  const [screenshotPending, setScreenshotPending] = useState(false);

  const inputRef    = useRef<HTMLInputElement>(null);
  const msgsContRef = useRef<HTMLDivElement>(null);
  const shouldScroll = useRef(false);

  useEffect(() => {
    if (shouldScroll.current) {
      const el = msgsContRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      shouldScroll.current = false;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (!isAddressZonesLoaded) refreshAddressZones();
    if (!isHomeSectionsLoaded) refreshHomeSections();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  const homeSections = mergeHomeSections(dbHomeSections, isHomeSectionsLoaded);

  const handleOpen = useCallback(() => {
    setPanelVisible(true);
    setOpen(true);
    requestAnimationFrame(() => setAnimating('in'));
  }, []);

  const handleClose = useCallback(() => {
    setAnimating('out');
    setTimeout(() => {
      setOpen(false);
      setPanelVisible(false);
      setAnimating(null);
      setMessages([]);
      setConvHistory([]);
    }, 260);
  }, []);

  const handleToggle = useCallback(() => {
    if (open) handleClose();
    else handleOpen();
  }, [open, handleOpen, handleClose]);

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
          ? 'Super! Vi dækker din adresse. Book direkte herunder.'
          : `Vi dækker desværre ikke ${address} endnu. Skriv til fb@flai.dk – vi finder en løsning!`,
      });
    } catch {
      addMsg({ type: 'ai', text: 'Kunne ikke tjekke adressen. Kontakt os direkte.' });
    } finally {
      setCoverageLoading(false);
    }
  }, [addMsg]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    addMsg({ type: 'user', text: q });
    setLoading(true);
    setScreenshotPending(true);

    try {
      const allProducts  = await fetchProductsDirect();
      const sorted       = allProducts.sort((a, b) => ((b as any).array ?? 50) - ((a as any).array ?? 50));
      const allPortfolio = await fetchPortfolioDirect();
      const pageCtx      = scrapePageContext();

      let pageImage: string | undefined;
      try { const img = await capturePageScreenshot(); if (img) pageImage = img; } catch { /* silent */ }
      setScreenshotPending(false);

      const { intent, address, text, productIds, showProductsAfter, portfolioRows, portfolioIds } =
        await detectFloatingIntent(q, sorted, getContent, addressZones, siteContent, homeSections, conversationHistory, allPortfolio, pageCtx, pageImage);

      setConvHistory((prev) => [...prev, { role: 'user', content: q }, { role: 'assistant', content: text }]);

      if (intent === 'products') {
        let toShow: Product[];
        if (!productIds || productIds === 'all') { toShow = sorted; }
        else {
          const validIds = new Set(sorted.map((p) => String(p.id)));
          const filteredIds = (productIds as string[]).filter((id) => validIds.has(id));
          toShow = filteredIds.length > 0 ? sorted.filter((p) => filteredIds.includes(String(p.id))) : sorted;
        }
        const isPersonalised = Array.isArray(productIds) && toShow.length < sorted.length;
        addMsg({ type: 'ai', text }, true);
        if (toShow.length > 0) addMsg({ type: 'products', products: toShow, isPersonalised }, false);
        else addMsg({ type: 'ai', text: 'Vi har desværre ingen aktive produkter. Kontakt os på fb@flai.dk.' });

      } else if (intent === 'reasoning') {
        addMsg({ type: 'ai', text }, true);
        if (showProductsAfter) {
          let toShow: Product[];
          if (!productIds || productIds === 'all') { toShow = sorted; }
          else {
            const validIds = new Set(sorted.map((p) => String(p.id)));
            const filteredIds = (productIds as string[]).filter((id) => validIds.has(id));
            toShow = filteredIds.length > 0 ? sorted.filter((p) => filteredIds.includes(String(p.id))) : sorted;
          }
          if (toShow.length > 0) {
            const isPersonalised = Array.isArray(productIds) && productIds.length > 0 && toShow.length < sorted.length;
            addMsg({ type: 'products', products: toShow, isPersonalised }, false);
          }
        }

      } else if (intent === 'portfolio') {
        addMsg({ type: 'ai', text });
        if (allPortfolio.length > 0) addMsg({ type: 'portfolio', images: allPortfolio, portfolioRows, portfolioIds }, false);
        else addMsg({ type: 'ai', text: 'Vi har ikke uploadet portfolio endnu. Følg os på Facebook @flai.dk!' });

      } else if (intent === 'coverage') {
        addMsg({ type: 'ai', text });
        if (address) await handleCoverageCheck(address);
        else addMsg({ type: 'coverage-form' });

      } else {
        addMsg({ type: 'ai', text });
      }
    } catch {
      addMsg({ type: 'ai', text: 'Beklager, noget gik galt. Kontakt os på fb@flai.dk eller +45 27 29 21 99.' });
    } finally {
      setLoading(false);
      setScreenshotPending(false);
    }
  };

  const renderMsg = (msg: Message) => {
    if (msg.type === 'user')
      return (
        <div key={msg.id} className="self-end text-white px-3 py-2"
          style={{ background: 'var(--primary)', borderRadius: '10px 10px 2px 10px', fontSize: '.8rem', lineHeight: 1.55, fontWeight: 500, maxWidth: '85%' }}>
          {msg.text}
        </div>
      );
    if (msg.type === 'ai')
      return (
        <div key={msg.id} className="self-start text-neutral-100 px-3 py-2"
          style={{ background: 'var(--neutral-800,#262626)', borderRadius: '2px 10px 10px 10px', border: '1px solid rgba(255,255,255,0.08)', fontSize: '.78rem', lineHeight: 1.65, maxWidth: '92%', textAlign: 'left' }}
          dangerouslySetInnerHTML={{ __html: formatAI(msg.text ?? '') }} />
      );
    if (msg.type === 'products' && msg.products?.length)
      return (
        <div key={msg.id} className="w-full">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            {msg.products.slice(0, 3).map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
          <button className="btn-secondary w-full mt-2 flex items-center justify-center gap-2"
            style={{ fontSize: '.72rem', padding: '6px' }} onClick={() => navigate('/produkter')}>
            {msg.isPersonalised ? 'Se alle produkter' : 'Se produkter'} <ArrowRight size={11} />
          </button>
        </div>
      );
    if (msg.type === 'portfolio' && msg.images?.length)
      return <PortfolioGrid key={msg.id} images={msg.images} portfolioRows={msg.portfolioRows} portfolioIds={msg.portfolioIds} />;
    if (msg.type === 'coverage-form')
      return <CoverageForm key={msg.id} onCheck={handleCoverageCheck} loading={coverageLoading} />;
    if (msg.type === 'coverage-result' && msg.coverageResult)
      return <CoverageResult key={msg.id} result={msg.coverageResult} />;
    return null;
  };

  const SUGGESTIONS = ['Hvad koster det?', 'Se portfolio', 'Dækker I her?', 'Book nu'];
  const aiCount = messages.filter((m) => m.type === 'ai').length;

  if (location.pathname.startsWith('/admin')) return null;

  return (
    <>
      <style>{`
        @keyframes _flai_in  { from{opacity:0;transform:translateY(18px) scale(.95)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes _flai_out { from{opacity:1;transform:translateY(0) scale(1)} to{opacity:0;transform:translateY(18px) scale(.95)} }
        @keyframes _flai_glow {
          0%,100%{box-shadow:0 4px 20px rgba(0,0,0,.5),0 0 0 0 rgba(15,82,186,.35)}
          50%     {box-shadow:0 4px 24px rgba(0,0,0,.6),0 0 0 5px rgba(15,82,186,0)}
        }
        @keyframes _flai_badge{0%{transform:scale(0)}70%{transform:scale(1.25)}100%{transform:scale(1)}}
        @keyframes _flai_dot{0%,80%,100%{opacity:.2}40%{opacity:1}}

        ._flai_panel_in  { animation: _flai_in  .28s cubic-bezier(.16,1,.3,1) forwards; }
        ._flai_panel_out { animation: _flai_out .22s cubic-bezier(.4,0,1,1)    forwards; }

        .flai-bar {
          display:flex; align-items:center; gap:0; height:48px;
          background:rgba(12,12,16,0.94);
          border:1px solid rgba(255,255,255,0.1);
          border-radius:999px;
          backdrop-filter:blur(22px); -webkit-backdrop-filter:blur(22px);
          cursor:pointer; overflow:hidden; pointer-events:all;
          user-select:none; -webkit-user-select:none;
          transition:transform .18s ease, box-shadow .2s ease, border-color .2s ease;
        }
        .flai-bar:not(.flai-bar--open){ animation:_flai_glow 3.5s ease-in-out infinite; }
        .flai-bar:hover{ transform:translateY(-2px); border-color:rgba(15,82,186,.45); box-shadow:0 8px 32px rgba(0,0,0,.65),0 0 0 1px rgba(15,82,186,.18); }
        .flai-bar:active{ transform:scale(.98); }

        .flai-bar__icon{ width:38px;height:38px;border-radius:999px;background:var(--primary,#0F52BA);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin:5px 0 5px 5px;box-shadow:0 2px 8px rgba(15,82,186,.4);transition:background .2s; }
        .flai-bar__label{ padding:0 6px 0 9px;display:flex;flex-direction:column;justify-content:center; }
        .flai-bar__title{ font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fff;line-height:1.2; }
        .flai-bar__sub  { font-size:.58rem;color:rgba(255,255,255,.38);line-height:1.2;margin-top:1px;white-space:nowrap; }
        .flai-bar__div  { width:1px;height:20px;background:rgba(255,255,255,.09);flex-shrink:0;margin:0 2px; }
        .flai-bar__ghost{ flex:1;padding:0 10px;font-size:.75rem;color:rgba(255,255,255,.28);font-family:inherit;white-space:nowrap;min-width:80px; }
        .flai-bar__action{ width:32px;height:32px;border-radius:999px;border:none;background:rgba(255,255,255,.07);display:flex;align-items:center;justify-content:center;margin:0 5px 0 0;color:rgba(255,255,255,.42);flex-shrink:0;cursor:pointer;transition:background .15s,color .15s; }
        .flai-bar__action:hover{ background:rgba(15,82,186,.28);color:#fff; }
        .flai-badge{ min-width:16px;height:16px;border-radius:999px;background:var(--secondary,#64A0FF);color:#fff;font-size:.55rem;font-weight:900;display:flex;align-items:center;justify-content:center;padding:0 4px;margin-right:4px;margin-left:-2px;border:2px solid rgba(12,12,16,.94);animation:_flai_badge .3s cubic-bezier(.16,1,.3,1); }
        .flai-msgs::-webkit-scrollbar{width:3px} .flai-msgs::-webkit-scrollbar-track{background:transparent} .flai-msgs::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:99px}
        .flai-chip{ font-size:.65rem;padding:4px 10px;border-radius:99px;background:rgba(15,82,186,.1);border:1px solid rgba(15,82,186,.25);color:var(--secondary,#64A0FF);cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .15s,border-color .15s; }
        .flai-chip:hover{ background:rgba(15,82,186,.2);border-color:rgba(15,82,186,.45); }
        .flai-dot{ display:inline-block;width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.35);margin:0 2px;animation:_flai_dot 1.2s infinite; }
        .flai-dot:nth-child(2){animation-delay:.2s} .flai-dot:nth-child(3){animation-delay:.4s}
      `}</style>

      {/* Root: fixed, CENTERED horizontally */}
      <div style={{
        position: 'fixed',
        bottom: 18,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 10,
        pointerEvents: 'none',
        width: 'min(380px, calc(100vw - 24px))',
      }}>

        {/* ══ Chat panel (mounted only when open/closing) ══ */}
        {panelVisible && (
          <div
            className={animating === 'out' ? '_flai_panel_out' : '_flai_panel_in'}
            style={{
              background: 'rgba(11,11,15,0.97)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20,
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,.8), 0 0 0 1px rgba(15,82,186,0.08)',
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: animating === 'out' ? 'none' : 'all',
              backdropFilter: 'blur(24px)',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '11px 14px 11px 12px',
              background: 'rgba(15,82,186,0.05)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0F52BA, #64A0FF)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(15,82,186,0.4)',
                }}>
                  <Sparkles size={14} color="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: '.67rem', fontWeight: 800, letterSpacing: '.1em', color: '#fff', textTransform: 'uppercase', lineHeight: 1 }}>Flai AI</div>
                  <div style={{ fontSize: '.57rem', color: 'rgba(255,255,255,.33)', marginTop: 2 }}>
                    {screenshotPending ? 'Analyserer din side…' : 'Klar til at hjælpe'}
                  </div>
                </div>
              </div>
              <button onClick={handleClose}
                style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.07)', color: 'rgba(255,255,255,.4)', cursor: 'pointer', borderRadius: 8, padding: '5px 6px', display: 'flex', transition: 'all .15s' }}
                onMouseEnter={(e) => { (e.currentTarget as any).style.background='rgba(255,255,255,.12)'; (e.currentTarget as any).style.color='#fff'; }}
                onMouseLeave={(e) => { (e.currentTarget as any).style.background='rgba(255,255,255,.06)'; (e.currentTarget as any).style.color='rgba(255,255,255,.4)'; }}
              >
                <X size={13} />
              </button>
            </div>

            {/* Messages */}
            <div ref={msgsContRef} className="flai-msgs"
              style={{ flex:1, overflowY:'auto', padding:'14px 12px 8px', display:'flex', flexDirection:'column', gap:8, minHeight:140, maxHeight:360 }}>
              {messages.length === 0 && !loading && (
                <div style={{ textAlign:'center', padding:'20px 8px 10px' }}>
                  <div style={{ width:44, height:44, borderRadius:'50%', background:'linear-gradient(135deg,#0F52BA,#64A0FF)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px', boxShadow:'0 4px 16px rgba(15,82,186,0.4)' }}>
                    <Sparkles size={20} color="#fff" />
                  </div>
                  <p style={{ fontSize:'.8rem', color:'rgba(255,255,255,.82)', margin:0, fontWeight:600 }}>Hej! Jeg er Flai AI</p>
                  <p style={{ fontSize:'.68rem', color:'rgba(255,255,255,.3)', margin:'6px 0 0', lineHeight:1.55 }}>Spørg om priser, portfolio,<br/>dækning eller book direkte.</p>
                </div>
              )}
              {messages.map(renderMsg)}
              {loading && (
                <div style={{ alignSelf:'flex-start', display:'flex', alignItems:'center', gap:2, padding:'10px 14px', background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.06)', borderRadius:'2px 10px 10px 10px' }}>
                  <span className="flai-dot"/><span className="flai-dot"/><span className="flai-dot"/>
                </div>
              )}
            </div>

            {/* Suggestions */}
            {messages.length === 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:5, padding:'0 12px 10px' }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="flai-chip" onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 30); }}>{s}</button>
                ))}
              </div>
            )}

            {/* Input */}
            <div style={{ borderTop:'1px solid rgba(255,255,255,.06)', padding:'8px 10px 10px', display:'flex', alignItems:'center', gap:7, background:'rgba(15,82,186,0.03)' }}>
              <Sparkles size={13} style={{ color:'var(--secondary,#64A0FF)', flexShrink:0, opacity:.55 }} />
              <input ref={inputRef}
                style={{ flex:1, background:'transparent', border:'none', outline:'none', color:'#fff', fontSize:'.8rem', fontFamily:'inherit', minWidth:0 }}
                placeholder="Stil et spørgsmål…" value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                disabled={loading} />
              <button onClick={handleSend} disabled={loading || !input.trim()}
                style={{
                  width:30, height:30, borderRadius:'50%', border:'none', flexShrink:0,
                  background: input.trim() && !loading ? 'var(--primary,#0F52BA)' : 'rgba(255,255,255,.06)',
                  color: input.trim() && !loading ? '#fff' : 'rgba(255,255,255,.2)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  cursor: input.trim() && !loading ? 'pointer' : 'default',
                  transition:'background .15s, color .15s',
                  boxShadow: input.trim() && !loading ? '0 2px 8px rgba(15,82,186,0.45)' : 'none',
                }}>
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              </button>
            </div>
          </div>
        )}

        {/* ══ Pill bar ══ */}
        <div
          className={`flai-bar ${open ? 'flai-bar--open' : ''}`}
          onClick={handleToggle}
          role="button" aria-label="Åbn Flai AI chat"
          tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleToggle()}
        >
          <div className="flai-bar__icon">
            {open ? <X size={16} color="#fff" /> : <Sparkles size={16} color="#fff" />}
          </div>
          <div className="flai-bar__label">
            <span className="flai-bar__title">Flai AI</span>
            <span className="flai-bar__sub">{open ? 'Luk chat' : 'Spørg mig om alt…'}</span>
          </div>
          <div className="flai-bar__div" />
          <span className="flai-bar__ghost">
            {open
              ? <span style={{ color:'rgba(255,255,255,.14)', fontSize:'.7rem' }}>Åben</span>
              : messages.length > 0
                ? <span style={{ color:'rgba(255,255,255,.48)' }}>{aiCount} svar klar</span>
                : 'Hvad kan jeg hjælpe med?'}
          </span>
          {!open && aiCount > 0 && <span className="flai-badge">{aiCount}</span>}
          <div className="flai-bar__action" onClick={(e) => { e.stopPropagation(); handleToggle(); }}>
            {open ? <X size={12} /> : <MessageCircle size={13} />}
          </div>
        </div>
      </div>
    </>
  );
};

export default FloatingAiChat;
