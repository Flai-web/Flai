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
const GEMINI_API_KEY = 'AIzaSyC2DZXk4Di_Jt-KzIYpyejESm1CWrFhFq0';
const GROQ_API_KEY   = import.meta.env.VITE_GROQ_API_KEY ;

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

const GROQ_MODELS: { id: string; maxTokens: number }[] = [
  { id: 'openai/gpt-oss-120b',                           maxTokens: 8_192  },
  { id: 'openai/gpt-oss-20b',                            maxTokens: 8_192  },
  { id: 'llama-3.3-70b-versatile',                       maxTokens: 8_192  },
  { id: 'qwen/qwen3-32b',                                maxTokens: 8_192  },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct',     maxTokens: 8_192  },
  { id: 'llama-3.1-8b-instant',                          maxTokens: 8_192  },
  { id: 'allam-2-7b',                                    maxTokens: 8_192  },
  { id: 'groq/compound',                                 maxTokens: 4_096  },
  { id: 'groq/compound-mini',                            maxTokens: 4_096  },
];

interface HistoryEntry { role: 'user' | 'assistant'; content: string; }

async function callGroqModel(
  modelId: string,
  maxTokens: number,
  systemPrompt: string,
  history: HistoryEntry[],
): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      max_tokens: maxTokens,
    }),
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
    try { return await callGroqModel(id, maxTokens, systemPrompt, history); }
    catch (err) { lastErr = err; }
  }
  throw lastErr;
}

async function callGeminiWithHistory(systemPrompt: string, history: HistoryEntry[]): Promise<string> {
  const contents = history.map((h) => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }));
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: empty response');
  return text;
}

async function callAI(systemPrompt: string, history: HistoryEntry[]): Promise<string> {
  try { return await callGeminiWithHistory(systemPrompt, history); }
  catch { return await callGroq(systemPrompt, history); }
}

type Intent = 'products' | 'portfolio' | 'coverage' | 'general' | 'reasoning';

// --- FIXED: Added rawJson to AIDecision ---
interface AIDecision {
  intent: Intent;
  address?: string | null;
  text: string;
  productIds?: string[] | 'all' | null;
  showProductsAfter?: boolean;
  portfolioRows?: number | null;
  portfolioIds?: string[] | null;
  rawJson: string; 
}

function keywordFallback(): AIDecision {
  return {
    intent: 'general',
    address: null,
    text: 'Kontakt os på fb@flai.dk eller +45 27 29 21 99 for svar på dit spørgsmål.',
    rawJson: '{"intent":"general","address":null,"text":"Kontakt os på fb@flai.dk eller +45 27 29 21 99 for svar på dit spørgsmål.","productIds":null,"showProductsAfter":false,"portfolioRows":null,"portfolioIds":null}'
  };
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

const SKIP_PREFIXES = ['admin-', 'deploy-', 'auth-', 'video-manager', 'address-zones-manager'];

const UI_NOISE_SUFFIXES = ['-btn', '-button', '-label', '-placeholder', '-cta', '-link', '-nav', '-tag', '-badge'];
const UI_NOISE_EXACT    = new Set(['submit', 'cancel', 'close', 'open', 'back', 'next', 'send', 'loading']);
function isUINoiseKey(key: string): boolean {
  if (UI_NOISE_EXACT.has(key)) return true;
  if (UI_NOISE_SUFFIXES.some((s) => key.endsWith(s))) return true;
  return false;
}

const VALID_INTENTS = new Set<Intent>(['products', 'portfolio', 'coverage', 'general', 'reasoning']);

function buildIntentPrompt(
  products: Product[],
  addressZones: any[],
  siteContent: Record<string, { key: string; value: string; type: string }>,
  homeSections: any[],
  portfolioItems: any[],
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
    entries.forEach(([k, v]) => {
      contentLines.push(`  ${k}: ${v}`);
    });
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
  return `Du er Flai AI – en intelligent, venlig assistent for Flai, et dansk dronefirma specialiseret i luftfoto og -video.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIN TÆNKEMÅDE – LÆS DETTE GRUNDIGT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Du skal tænke og svare som en RIGTIG intelligent assistent – ikke som en simpel chatbot der bare genkender nøgleord.
Tænk som ChatGPT: grundig, nuanceret, hjælpsom, med dybde i svarene.
TRIN 1 – LÆS FLAIS DATA FØRSTE (ALTID):
Før du bruger din generelle viden, SKAL du gennemlæse og aktivt bruge:
  • HJEMMESIDEINDHOLDET nedenfor (mission, værdier, tilgang, ejeren Felix, udstyr, etc.)
  • PRODUKTLISTEN med priser og beskrivelser
  • DÆKNINGSZONER
  • HJEMMESIDENS SEKTIONER
Disse data er din PRIMÆRE kilde.
Brug dem aktivt i dit svar – ikke bare som baggrundsviden.
TRIN 2 – KOMBINER MED DIN GENERELLE VIDEN:
Når du har læst Flais data, kombiner det med din generelle viden om:
  • Dansk geografi, byer, afstande
  • Dronebranchen, luftfoto, -video generelt
  • Priser og markedsforhold (kun som kontekst – brug ALTID Flais egne priser først)
  • Hvad kunder typisk bekymrer sig om

TRIN 3 – GENSVAR GRUNDIGT OG NYTTIGT:
Dit svar skal:
  • Direkte besvare det brugeren spørger om
  • Bruge konkrete detaljer fra Flais data
  • Tilføje nyttig kontekst fra din generelle viden
  • Være engagerende og personligt – ikke robotagtig
  • Undgå at sige "kontakt os" som erstatning for et rigtigt svar, medmindre det er absolut nødvendigt

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT-FORMAT (KUN gyldigt JSON, ingen markdown udenfor JSON)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "thinking": "<din reasoning – 2-5 sætninger: hvad spørger brugeren, hvad finder jeg i Flais data, hvad tilføjer min generelle viden, hvad er det bedste svar>",
  "intent": "products" | "portfolio" | "coverage" | "general" | "reasoning",
  "address": "<by/adresse nævnt i beskeden, eller null>",
  "text": "<dit svar på dansk – grundigt, engagerende, med detaljer fra data>",
  "productIds": ["id1"] | "all" | null,
  "showProductsAfter": true | false,
  "portfolioRows": <antal rækker at vise (2 items pr. række), eller null for standard>,
  "portfolioIds": ["id1","id2"] | null
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"coverage"  → spørger om Flai dækker et sted eller hvilken by der er nærmest
"products"  → vil se produkter, pakker, prisliste
"portfolio" → vil se eksempler, fotos, videoer, arbejde
"reasoning" → spørger om pris, anbefaling, sammenligning, hvad der passer bedst
"general"   → alt andet – spørgsmål om firmaet, Felix, udstyr, proces, leveringstid, etc.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PORTFOLIO-REGLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Du har adgang til den fulde liste af portfolio items nedenfor (under PORTFOLIO ITEMS).
Hvert item har: id, title, type (billede/video), tags og description.
• portfolioRows: Vælg antal rækker der passer til konteksten (2 items pr. række).
Standard er 5 rækker desktop / 4 rækker mobil (sæt null for standard).
Du KAN sætte fx 3 for en hurtig preview, eller 8 for et bredt udvalg.
• portfolioIds: Brug dette til at filtrere relevante items når brugeren spørger om
  NOGET SPECIFIKT – fx "vis mig jeres drone-videoer", "boligfotos", "erhvervsbilleder".
Gennemlæs portfolio-listen og vælg KUN items der matcher brugerens spørgsmål baseret
  på title, type og tags.
Sæt de relevante IDs i portfolioIds.
  
  Hvis brugeren bare vil "se jeres arbejde" / "vis portfolio" uden specifik forespørgsel:
  sæt portfolioIds til null – lad systemet vise i standard rækkefølge.
ALDRIG opfind IDs – brug kun IDs fra PORTFOLIO ITEMS listen nedenfor.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KRITISKE REGLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
① LÆS ALTID FLAIS DATA FØR DU SVARER – brug konkrete detaljer derfra
② BLAND ALDRIG indhold fra forskellige sektioner – hver [SEKTION] er selvstændig
③ Hvis en specifik information IKKE fremgår af data: sig "det ved jeg ikke præcist" og henvis til kontakt — opfind det ALDRIG
④ Brug din generelle viden om Danmark frit (geografi, byer, afstande, kultur)
③ coverage-intent: sæt den efterspurgte by i "address" – systemet tjekker dækning selv.
ALDRIG spekuler om en adresse er dækket i dit "text"-svar.
④ Opfind ALDRIG kontaktinfo eller priser der ikke fremgår af data nedenfor
⑤ productIds: KUN IDs fra produktlisten – aldrig opfundne IDs
⑤ Brug kun produkt navne i din forklaring.
⑥ Ukendte svar: "Kontakt os på fb@flai.dk eller +45 27 29 21 99"
⑥ Før du arkender du ikke kender svaret skal du sikre dig at du aboslut ikke kan give brugeren et nyttigt svar.
⑦ Svar MED SUBSTANS – undgå 1-linje svar til spørgsmål der fortjener mere
⑦ Hvis du ikke kunne svare på et tidligere spøgsmål skal du ignorere det
svar og forsøge at svar så godt som så muligt på brugerens svar.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FÅ-SKUD EKSEMPLER (følg reasoning-dybden)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bruger: "Dækker I Aarhus?"
{"thinking":"Brugeren vil vide om Flai servicerer Aarhus. Jeg ser i dækningszoner at Flai opererer fra Trekantsområdet. Jeg sender Aarhus som adresse og lader systemet tjekke den præcise afstand.","intent":"coverage","address":"Aarhus","text":"Lad mig tjekke om vi dækker Aarhus for dig!","productIds":null,"showProductsAfter":false,"portfolioRows":null,"portfolioIds":null}

Bruger: "Hvad er specielt ved jer?"
{"thinking":"Brugeren vil vide hvad der adskiller Flai. Jeg læser hjemmesideindholdet: der er info om Felix (ejeren), udstyr, tilgang, passion. Kombinerer det med hvad der generelt gør et dronefirma unikt: personlig service, kvalitetsudstyr, hurtig levering. Giver et substansfuldt svar baseret på Flais konkrete data.","intent":"general","address":null,"text":"Flai skiller sig ud på flere måder. For det første er det et personligt drevet firma – Felix, der ejer og driver Flai, er dybt passioneret for faget og er selv med på alle opgaver. Du får altså ikke en anonym servicevirksomhed, men en dedikeret fotograf der sætter en ære i resultatet.\n\nFor det andet bruger Flai topmoderne droneudstyr, hvilket betyder skarp bildkvalitet og professionelle optagelser uanset om det er til ejendomssalg, erhvervspræsentation eller events.\n\nEndelig er Flai lokalt forankret i Trekantsområdet, hvilket giver hurtig responstid og god kendskab til de lokale forhold.","productIds":null,"showProductsAfter":false,"portfolioRows":null,"portfolioIds":null}

Bruger: "Hvad koster et boligfoto?"
{"thinking":"Brugeren vil vide hvad luftfoto til boligsalg koster. Jeg scanner produktlisten for relevante pakker og priser. Giver et konkret svar med priser og hvad der er inkluderet, så brugeren kan tage en informeret beslutning.","intent":"reasoning","address":null,"text":"Prisen for boligfoto afhænger af hvilken pakke der passer til din bolig. Vi har pakker til både mindre og større ejendomme – se mulighederne herunder for præcise priser og hvad der er inkluderet i hver pakke.","productIds":"all","showProductsAfter":true,"portfolioRows":null,"portfolioIds":null}

Bruger: "Vis mig jeres arbejde"
{"thinking":"Brugeren vil se eksempler. Standard portfolio-visning. Viser 5 rækker (10 items) som god oversigt.","intent":"portfolio","address":null,"text":"Her er et udvalg af vores seneste arbejde – luftfoto og -video fra opgaver i området:","productIds":null,"showProductsAfter":false,"portfolioRows":5,"portfolioIds":null}

Bruger: "Vis mig jeres drone-videoer"
{"thinking":"Brugeren vil specifikt se videoer. Jeg gennemlæser PORTFOLIO ITEMS og finder alle med type='video'. Returnerer deres IDs i portfolioIds så kun videoer vises.","intent":"portfolio","address":null,"text":"Her er vores drone-videoer:","productIds":null,"showProductsAfter":false,"portfolioRows":null,"portfolioIds":["<id1>","<id2>"]}

Bruger: "Har I lavet boligfotos?"
{"thinking":"Brugeren spørger om boligfotos. Jeg gennemlæser PORTFOLIO ITEMS og finder items med title/tags der matcher bolig, ejendom, hus. Returnerer relevante IDs.","intent":"portfolio","address":null,"text":"Ja! Her er eksempler på vores boligfoto-arbejde:","productIds":null,"showProductsAfter":false,"portfolioRows":null,"portfolioIds":["<id1>","<id2>"]}

Bruger: "Vis mig arbejde"
{"thinking":"Brugeren vil blot se portfolio generelt uden specifik forespørgsel. Sætter portfolioIds til null og lader systemet vise i standard rækkefølge.","intent":"portfolio","address":null,"text":"Her er et udvalg af vores seneste arbejde:","productIds":null,"showProductsAfter":false,"portfolioRows":5,"portfolioIds":null}

Bruger: "Hvad er leveringstiden?"
{"thinking":"Brugeren spørger om leveringstid. Jeg søger i hjemmesideindholdet efter info om leveringstid/redigeringstid. Bruger konkrete detaljer hvis de findes, ellers kombinerer med branchekendskab om typisk leveringstid for droneoptagelser (1-3 dage er standard i branchen).","intent":"general","address":null,"text":"Leveringstiden hos Flai er typisk [X dage] efter optagelsen – du får de færdigrettede billeder og/eller videoer direkte tilsendt. Har du en deadline, er du velkommen til at nævne det ved bestilling, så gør vi vores bedste for at imødekomme den. Kontakt os på fb@flai.dk eller +45 27 29 21 99 for at høre mere om din specifikke opgave.","productIds":null,"showProductsAfter":false,"portfolioRows":null,"portfolioIds":null}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLAIS DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRODUKTER:
${productList}

PORTFOLIO ITEMS (brug disse IDs i portfolioIds når brugeren beder om noget specifikt):
${portfolioList}

DÆKNINGSZONER:
${zoneLines.length ? zoneLines.join('\n') : '  (ingen zoner konfigureret)'}

HJEMMESIDENS SEKTIONER: ${sectionLines || '(ingen)'}

HJEMMESIDEINDHOLD (din PRIMÆRE kilde – læs dette grundigt før du svarer):
VIGTIGT: Indholdet er grupperet i sektioner markeret med [SEKTIONSNAVN].
Hver nøgle tilhører KUN sin sektion. Bland ALDRIG indhold på tværs af sektioner.
Brug kun det indhold der faktisk er relevant for brugerens spørgsmål.
Hvis en information ikke fremgår af data nedenfor, så sig det ærligt fremfor at gætte.
${contentLines.join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SLUT – Returner KUN gyldigt JSON. "thinking"-feltet er påkrævet og skal vise reel reasoning.
Ingen markdown, ingen tekst udenfor JSON.`;
}

async function detectIntentWithAI(
  userMessage: string,
  products: Product[],
  getContent: (key: string, fallback: string) => string,
  addressZones: any[],
  siteContent: Record<string, { key: string; value: string; type: string }>,
  homeSections: any[],
  conversationHistory: HistoryEntry[],
  portfolioItems: any[],
): Promise<AIDecision> {
  const systemPrompt = buildIntentPrompt(products, addressZones, siteContent, homeSections, portfolioItems);
  const history: HistoryEntry[] = [...conversationHistory, { role: 'user', content: userMessage }];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callAI(systemPrompt, history);
      const jsonMatch = raw
        .replace(/```[\w]*\n?/g, '')
        .trim()
        .match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]);

      if (!VALID_INTENTS.has(parsed.intent)) throw new Error(`Invalid intent: ${parsed.intent}`);
      if (typeof parsed.text !== 'string' || parsed.text.trim().length < 2) throw new Error('Missing text');

      const productIds = parsed.productIds;
      if (productIds !== null && productIds !== 'all' && !Array.isArray(productIds)) {
        throw new Error(`Invalid productIds: ${typeof productIds}`);
      }

      // --- FIXED: Included rawJson in the return payload ---
      return {
        intent: parsed.intent as Intent,
        address: typeof parsed.address === 'string' && parsed.address.trim() ? parsed.address.trim() : null,
        text: parsed.text.trim(),
        productIds: productIds ?? null,
        showProductsAfter: parsed.showProductsAfter === true,
        portfolioRows: typeof parsed.portfolioRows === 'number' ? Math.max(1, Math.round(parsed.portfolioRows)) : null,
        portfolioIds: Array.isArray(parsed.portfolioIds) ? parsed.portfolioIds : null,
        rawJson: jsonMatch[0],
      };
    } catch {
      if (attempt === 1) return keywordFallback();
    }
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
    const { data, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data;
  } catch { return []; }
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
const DEFAULT_ROWS_DESKTOP = 5;
const DEFAULT_ROWS_MOBILE  = 4;

const PortfolioGrid: React.FC<{ images: any[]; portfolioRows?: number | null; portfolioIds?: string[] | null }> = ({
  images,
  portfolioRows,
  portfolioIds,
}) => {
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
        @media (max-width: 639px) {
          .aicta-portfolio-item--mobile-hidden { display: none; }
        }
      `}</style>
      <div className="aicta-portfolio-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
        {filtered.map((img, idx) => {
          const hiddenOnMobile  = idx >= mobileItems;
          const hiddenOnDesktop = idx >= desktopItems;
          if (hiddenOnDesktop) return null;

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
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent,rgba(0,0,0,.7)', fontSize: '.6rem', color: '#fff', padding: '8px 4px 3px', pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
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
      <p className="form-label flex items-center gap-2 mb-2" style={{ fontSize: '.8rem' }}><MapPin size={13} /> Check din adresse</p>
      <div className="flex gap-2">
        <input className="form-input" placeholder="F.eks. Vejle, Kolding…" value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addr.trim() && onCheck(addr)} disabled={loading} />
        <button className="btn-primary flex items-center gap-1 whitespace-nowrap" style={{ padding: '8px 16px', fontSize: '.875rem' }}
          onClick={() => addr.trim() && onCheck(addr)} disabled={loading || !addr.trim()}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : 'Tjek'}
        </button>
      </div>
    </div>
  );
};

const CoverageResult: React.FC<{ result: { covered: boolean; distance?: string; address: string } }> = ({ result }) => (
  <div className="flex items-start gap-3 p-3 rounded-xl w-full"
    style={{ background: result.covered ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)', border: `1px solid ${result.covered ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`, textAlign: 'left' }}>
    {result.covered
      ? <CheckCircle size={20} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--success,#10b981)' }} />
      : <XCircle size={20} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--error,#ef4444)' }} />}
    <div>
      <p className="font-semibold text-white" style={{ fontSize: '.875rem', margin: '0 0 2px' }}>
        {result.covered ? 'Vi dækker din adresse! 🎉' : 'Vi dækker desværre ikke denne adresse'}
      </p>
      <p style={{ fontSize: '.74rem', color: 'var(--neutral-400,#a3a3a3)', margin: 0 }}>
        {result.address}{!result.covered && result.distance ? ` — ${result.distance} fra vores base` : ''}
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
  const [messages, setMessages]               = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput]                     = useState('');
  const [loading, setLoading]                 = useState(false);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [expanded, setExpanded]               = useState(false);
  const inputRef    = useRef<HTMLInputElement>(null);
  const msgsEndRef  = useRef<HTMLDivElement>(null);
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
  }, []);
  // eslint-disable-line

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
    setExpanded(true);
    addMsg({ type: 'user', text: q });
    setLoading(true);

    try {
      const allProducts = await fetchProductsDirect();
      const sorted = allProducts.sort((a, b) => (b.array ?? 50) - (a.array ?? 50));

      const allPortfolio = await fetchPortfolioDirect();
      
      // --- FIXED: Destructured rawJson here ---
      const { intent, address, text, productIds, showProductsAfter, portfolioRows, portfolioIds, rawJson } = await detectIntentWithAI(
        q, sorted, getContent, addressZones, siteContent, homeSections, conversationHistory, allPortfolio,
      );

      // --- FIXED: Passed rawJson back into the assistant history so Gemini keeps outputting JSON ---
      setConversationHistory((prev) => [
        ...prev,
        { role: 'user', content: q },
        { role: 'assistant', content: rawJson }, 
      ]);

      if (intent === 'products') {
        let toShow: Product[];
        if (!productIds || productIds === 'all') {
          toShow = sorted;
        } else {
          const validIds = new Set(sorted.map((p) => String(p.id)));
          const filteredIds = (productIds as string[]).filter((id) => validIds.has(id));
          toShow = filteredIds.length > 0 ? sorted.filter((p) => filteredIds.includes(String(p.id))) : sorted;
        }
        const isPersonalised = Array.isArray(productIds) && toShow.length < sorted.length;
        addMsg({ type: 'ai', text }, true);
        if (toShow.length > 0) {
          addMsg({ type: 'products', products: toShow, isPersonalised }, false);
        } else {
          addMsg({ type: 'ai', text: 'Vi har desværre ingen aktive produkter lige nu. Kontakt os på fb@flai.dk.' });
        }

      } else if (intent === 'reasoning') {
        addMsg({ type: 'ai', text }, true);
        if (showProductsAfter) {
          let toShow: Product[];
          if (!productIds || productIds === 'all') {
            toShow = sorted;
          } else {
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
        if (allPortfolio.length > 0) {
          addMsg({ type: 'portfolio', images: allPortfolio, portfolioRows, portfolioIds }, false);
        } else {
          addMsg({ type: 'ai', text: 'Vi har ikke uploadet portfolio endnu. Følg os på Facebook @flai.dk!' });
        }

      } else if (intent === 'coverage') {
        addMsg({ type: 'ai', text });
        if (address) {
          await handleCoverageCheck(address);
        } else {
          addMsg({ type: 'coverage-form' });
        }

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
        <div key={msg.id} className="self-end bg-primary text-white px-4 py-3 max-w-xs"
          style={{ borderRadius: '12px 12px 2px 12px', fontSize: '.875rem', lineHeight: 1.55, fontWeight: 500 }}>
          {msg.text}
        </div>
      );
    if (msg.type === 'ai')
      return (
        <div key={msg.id} className="self-start text-neutral-100 px-4 py-3"
          style={{ background: 'var(--neutral-800,#262626)', borderRadius: '2px 12px 12px 12px', border: '1px solid rgba(255,255,255,0.08)', fontSize: '.875rem', lineHeight: 1.7, maxWidth: '88%', textAlign: 'left' }}
          dangerouslySetInnerHTML={{ __html: formatAI(msg.text ?? '') }} />
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
            style={{ fontSize: '.8rem', padding: '8px' }} onClick={() => navigate('/produkter')}>
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
    if (msg.type === 'coverage-form') return <CoverageForm key={msg.id} onCheck={handleCoverageCheck} loading={coverageLoading} />;
    if (msg.type === 'coverage-result' && msg.coverageResult) return <CoverageResult key={msg.id} result={msg.coverageResult} />;
    return null;
  };

  const inputBar = (
    <div className="flex items-center gap-2 rounded-xl"
      style={{ background: 'var(--neutral-800,#262626)', border: '1px solid rgba(255,255,255,0.10)', padding: '8px 8px 8px 18px', maxWidth: 680, margin: '0 auto' }}>
      <Sparkles size={17} style={{ color: 'var(--secondary)', flexShrink: 0 }} />
      <input ref={inputRef} className="flex-1 bg-transparent border-none outline-none text-neutral-50 min-w-0"
        style={{ fontSize: '.9375rem', fontFamily: 'inherit' }}
        placeholder="Spørg om priser, se portfolio, tjek adresse…"
        value={input} onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }} disabled={loading} />
      <button className="btn-primary flex items-center gap-2 whitespace-nowrap"
        style={{ padding: '9px 18px', fontSize: '.85rem', borderRadius: 9, flexShrink: 0 }}
        onClick={handleSend} disabled={loading || !input.trim()}>
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
              <button key={s} className="btn-secondary whitespace-nowrap"
                style={{ fontSize: '.78rem', padding: '6px 13px', borderRadius: 8 }}
                onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 30); }}>
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      {expanded && messages.length > 0 && (
        <div className="rounded-2xl overflow-hidden"
          style={{ maxWidth: 680, margin: '12px auto 0', background: 'var(--neutral-900,#171717)', border: '1px solid rgba(255,255,255,0.09)', animation: 'aicta-in .22s ease' }}>

          <div className="flex items-center justify-between px-4 py-3"
            style={{ background: 'var(--neutral-800,#262626)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span className="flex items-center gap-2 font-bold uppercase tracking-widest" 
              style={{ fontSize: '.7rem', color: 'var(--secondary)' }}>
              <Sparkles size={11} /> Flai AI
            </span>
            <button style={{ background: 'none', border: 'none', color: 'var(--neutral-500,#737373)', cursor: 'pointer', borderRadius: 6, padding: 4 }}
              title="Luk" onClick={() => { setExpanded(false); setMessages([]); setConversationHistory([]); }}>
              <X size={15} />
            </button>
          </div>

          <div ref={msgsContRef} className="flex flex-col gap-3 p-4 overflow-y-auto" style={{ maxHeight: 560 }}>
            {messages.map(renderMsg)}
            {loading && (
              <div className="self-start flex items-center gap-2 px-4 py-3"
                style={{ background: 'var(--neutral-800,#262626)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '2px 12px 12px 12px', color: 'var(--neutral-500,#737373)', fontSize: '.85rem' }}>
                <Loader2 size={13} className="animate-spin" /> Tænker…
              </div>
            )}
            <div ref={msgsEndRef} />
          </div>

          <div style={{ background: 'var(--neutral-800,#262626)', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px 8px' }}>
            {inputBar}
          </div>

          <div className="flex flex-wrap gap-2 px-4 pb-4 pt-2" style={{ background: 'var(--neutral-800,#262626)' }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="btn-secondary whitespace-nowrap"
                style={{ fontSize: '.72rem', padding: '4px 10px', borderRadius: 7 }}
                onClick={() => { setInput(s); inputRef.current?.focus(); }}>
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
