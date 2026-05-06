#!/usr/bin/env python3
"""
radar_v13_scraper.py — expressoemprego.pt @ arquivo.pt
=======================================================
Arquitetura: scraper.py (net-empregos) adaptado para expressoemprego.pt
Parsers & fixes: radar_v13 (FIX-1..4)

Saída:
  data/neoexpresso/raw/YYYY/<ts>_<record_id>.json   — um JSON por vaga
  data/neoexpresso/neoexpresso_all.csv              — dataset consolidado
  data/neoexpresso/_state/checkpoint.json           — retoma automática
  data/neoexpresso/_state/run.log

COMO CORRER:
  pip install aiohttp beautifulsoup4 tqdm
  python radar_v13_scraper.py
  python radar_v13_scraper.py --reset          # recomeçar do zero
  python radar_v13_scraper.py --dataset-only   # só consolidar CSV
  python radar_v13_scraper.py --max-rps 2 --concurrency 3   # conservador
"""

import argparse
import asyncio
import csv
import hashlib
import json
import logging
import re
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiohttp
from bs4 import BeautifulSoup
from tqdm import tqdm

# ─── WINDOWS ──────────────────────────────────────────────────────────────────
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ─── PATHS ────────────────────────────────────────────────────────────────────
PROJECT_ROOT  = Path(__file__).resolve().parents[2]
DATA_DIR      = PROJECT_ROOT / "data"

BASE_DIR      = DATA_DIR / "neoexpresso"
RAW_DIR       = BASE_DIR / "raw"
STATE_DIR     = BASE_DIR / "_state"
CHECKPOINT_F  = STATE_DIR / "checkpoint.json"
LOG_FILE      = STATE_DIR / "run.log"
DATASET_CSV   = BASE_DIR / "neoexpresso_all.csv"

# ─── CONSTANTES ───────────────────────────────────────────────────────────────
CDX_ENDPOINT  = "https://arquivo.pt/wayback/cdx"
NOFRAME_BASE  = "https://arquivo.pt/noFrame/replay"
DOMAIN        = "expressoemprego.pt"
SOURCE_LABEL  = "neoexpresso"

YEAR_START    = 2008
YEAR_END      = 2025
PAGE_BATCH    = 5
CHECKPOINT_EVERY = 50
MIN_GAP_DAYS  = 14

# Eras do site
ERA_C_FROM = 2013   # layout moderno (.item / .resultadosBox)
ERA_B_FROM = 2010   # ASPX com ofertasMiddle

# CDX seeds: (padrão CDX, URL base de pág-1)
# FIX-2: aeiou seeds só usadas para anos < 2016 (filtrado em merge)
CDX_SEEDS = [
    (f"{DOMAIN}/ofertas-emprego",        f"http://{DOMAIN}/ofertas-emprego"),
    (f"www.{DOMAIN}/ofertas-emprego",    f"http://www.{DOMAIN}/ofertas-emprego"),
    (f"{DOMAIN}/",                        f"http://{DOMAIN}/"),
    (f"www.{DOMAIN}/",                    f"http://www.{DOMAIN}/"),
    ("aeiou.expressoemprego.pt/",         "http://aeiou.expressoemprego.pt/"),
    ("aeiou.expressoemprego.pt/scripts/vaczoeker",
     "http://aeiou.expressoemprego.pt/scripts/vaczoeker"),
]

TIMEOUT_LISTING = aiohttp.ClientTimeout(total=25)

# FIX-4: hash global — detecta snapshots duplicados cross-year (2023-2025)
_SEEN_HASHES: set[str] = set()


def get_max_snaps(year: int) -> int:
    """FIX-3: anos com subcontagem recebem mais snapshots."""
    if year in (2011, 2012, 2016):
        return 10
    if year in (2023, 2024, 2025):
        return 3
    return 5


# ─── PADRÕES ──────────────────────────────────────────────────────────────────
DATE_RE  = re.compile(r"\b(\d{2}[./-]\d{2}[./-]\d{4})\b")
REF_RE   = re.compile(r"Referência[:\s]*(\d+)", re.I)
DATE_NORM = re.compile(r"(\d{2})[/-](\d{2})[/-](\d{4})")

JOB_URL_RE = re.compile(
    r"/emprego/[a-z0-9][a-z0-9\-/]*/?|/vagas?/\d+|[?&]ref=\d+|/\d{5,}"
    r"|VacancyDet|vacancydet|JobDet|AnuncioDet|vaczoeker",
    re.I,
)

BLACKLIST = re.compile(
    r"(voucher|tablet|assinatura|login|registo|e-learning|rss|digital"
    r"|imobiliário|anunciar|partilhar|newsletter|publicidade|landing page"
    r"|trabalho temporário|divulgar|recrutadores|formação|empreendedor"
    r"|responsabilidade social|dossiers|gerir carreiras)",
    re.I,
)

# FIX-1: blacklist de itens de navegação do portal aeiou
AEIOU_NAV_BLACKLIST = re.compile(
    r"^(my portal|todos os an[úu]ncios|pesquisa avan[çc]ada|empresas\s*rh"
    r"|sal[áa]rios|franchising|registo|login|newsletters?|agenda"
    r"|emprego p[úu]blico|trabalho tempor[áa]rio|gerir cv|cv online"
    r"|alertas? de emprego|criar alerta|mapa do site|contactos?"
    r"|publicitar|anunciar vaga|sobre n[óo]s|quem somos|ajuda|faqs?"
    r"|pol[íi]tica de privacidade|termos|forma[çc][ãa]o|est[áa]gios?"
    r"|empreendedorismo|cursos?|bolsa de emprego|candidatos?"
    r"|recrutadores?|empregadores?|parceiros?|[áa]rea pessoal"
    r"|aceder|entrar|sair|home|in[íi]cio|p[áa]gina principal"
    r"|ver (mais|todos|todas)|mais (ofertas|vagas|an[úu]ncios))$",
    re.I,
)

# FIX-1: filtro de texto editorial (notícias do Expresso misturadas em 2009)
EDITORIAL_RE = re.compile(
    r"(perde \d+ pontos|culpa governo|faz com[íi]cio|\bps\b|\bpsd\b|\bcds\b|\bbe\b"
    r"|freeport|euro(peias|zona)|ministr[ao]|parlamento|presidente da rep[úu]blica"
    r"|premi[êe]r|partidos?|elei[çc][õo]es?|resultado.*jogo|marcador)",
    re.I,
)


def normalise_date(d: str) -> str:
    return DATE_NORM.sub(r"\1.\2.\3", d)


def clean_url(href_raw: str) -> str:
    m = re.search(r"/noFrame/replay/\d{14}[a-z_]*/(.+)", href_raw)
    if m:
        return m.group(1)
    if href_raw.startswith("http"):
        return href_raw
    if href_raw.startswith("/"):
        return f"http://{DOMAIN}{href_raw}"
    return href_raw


def make_record_id(url: str, ts: str) -> str:
    return hashlib.sha256(f"{ts}|{url}".encode()).hexdigest()[:16]


def make_record(titulo, empresa, local, data, url, ts, year, wayback_url) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    rid = make_record_id(url or f"{titulo}|{ts}", ts)
    date_archived = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}" if len(ts) >= 8 else ""
    return {
        "record_id":         rid,
        "year":              year,
        "title":             titulo,
        "company":           empresa if empresa != "Anónimo" else "",
        "location":          local,
        "date_posted":       data,
        "original_url":      url,
        "wayback_url":       wayback_url,
        "arquivo_timestamp": ts,
        "source":            SOURCE_LABEL,
        "scraped_at_utc":    now,
        "date_archived":     date_archived,
    }


# ─── PARSERS ──────────────────────────────────────────────────────────────────

def parse_era_a(soup: BeautifulSoup, ts: str, year: int, wayback_url: str) -> list[dict]:
    """
    Era A (2008-2009) — FIX-1 aplicado:
    - Exige JOB_URL_RE no href (sem fallback de contexto)
    - AEIOU_NAV_BLACKLIST + EDITORIAL_RE
    - Título mínimo 8 chars
    """
    vagas = []
    seen_urls: set[str] = set()

    for a in soup.find_all("a", href=True):
        href  = a.get("href", "")
        texto = a.get_text(strip=True)

        if not texto or len(texto) < 8 or len(texto) > 150:
            continue
        if BLACKLIST.search(texto):
            continue
        if AEIOU_NAV_BLACKLIST.search(texto.strip()):
            continue
        if EDITORIAL_RE.search(texto):
            continue
        if not JOB_URL_RE.search(href):
            continue

        job_url = clean_url(href)
        if job_url in seen_urls:
            continue
        seen_urls.add(job_url)

        empresa = ""
        parent  = a.parent
        if parent:
            for sib in list(parent.next_siblings)[:3]:
                t = getattr(sib, "get_text", lambda **k: str(sib))(strip=True)
                if t and 2 < len(t) < 80 and not DATE_RE.search(t):
                    empresa = t[:60]
                    break

        contexto = (parent.get_text(" ", strip=True) if parent else "") + " " + texto
        if EDITORIAL_RE.search(contexto):
            continue

        dm = DATE_RE.search(contexto)
        date_str = normalise_date(dm.group(1)) if dm else ""

        vagas.append(make_record(texto, empresa or "Anónimo", "", date_str, job_url, ts, year, wayback_url))

    return vagas


def parse_item_grid(soup: BeautifulSoup, ts: str, year: int, wayback_url: str) -> list[dict]:
    """Era C 2013-2015: .item com .c1 .c2 .c3 .c4"""
    items = soup.select(".item")
    if not items:
        return []
    vagas = []
    seen_urls: set[str] = set()
    for item in items:
        c1       = item.select_one(".c1")
        link_tag = (c1.select_one("a[href]") if c1 else None) or item.select_one("a[href]")
        href_raw = link_tag["href"] if link_tag else ""
        job_url  = clean_url(href_raw)
        if job_url and job_url in seen_urls:
            continue
        if job_url:
            seen_urls.add(job_url)
        titulo = (c1.get_text(strip=True) if c1 else "") or (link_tag.get_text(strip=True) if link_tag else "")
        if not titulo or len(titulo) < 3 or BLACKLIST.search(titulo):
            continue
        c2 = item.select_one(".c2")
        c3 = item.select_one(".c3")
        c4 = item.select_one(".c4")
        empresa  = c2.get_text(strip=True) if c2 else ""
        local    = c3.get_text(strip=True)[:60] if c3 else ""
        date_str = ""
        if c4:
            dm = DATE_RE.search(c4.get_text(strip=True))
            date_str = normalise_date(dm.group(1)) if dm else c4.get_text(strip=True)[:10]
        if not date_str:
            dm = DATE_RE.search(item.get_text(" ", strip=True))
            date_str = normalise_date(dm.group(1)) if dm else ""
        vagas.append(make_record(titulo, empresa or "Anónimo", local, date_str, job_url, ts, year, wayback_url))
    return vagas


def parse_ofertas_home(soup: BeautifulSoup, ts: str, year: int, wayback_url: str) -> list[dict]:
    """Era B 2010-2012 e fallback 2013: .ofertasMiddle / .ofertasDestaqueMiddle"""
    containers = soup.select(".ofertasMiddle, .ofertasDestaqueMiddle")
    if not containers:
        return []
    vagas = []
    seen_urls: set[str] = set()
    for c in containers:
        link_tag = None
        for a in c.find_all("a", href=True):
            href = a.get("href", "")
            if JOB_URL_RE.search(href) or "/emprego/" in href or "Vacancy" in href:
                link_tag = a
                break
        if not link_tag:
            for a in c.find_all("a", href=True):
                t = a.get_text(strip=True)
                if t and len(t) > 8 and not BLACKLIST.search(t):
                    link_tag = a
                    break
        if not link_tag:
            continue
        job_url = clean_url(link_tag["href"])
        if job_url and job_url in seen_urls:
            continue
        if job_url:
            seen_urls.add(job_url)
        titulo = link_tag.get_text(strip=True)
        if not titulo or len(titulo) < 3 or BLACKLIST.search(titulo):
            continue
        full_text = c.get_text(" ", strip=True)
        dm = DATE_RE.search(full_text)
        date_str = normalise_date(dm.group(1)) if dm else ""
        empresa = ""
        for sibling in link_tag.next_siblings:
            t = getattr(sibling, "get_text", lambda **k: str(sibling))(strip=True)
            if t and len(t) > 2 and not DATE_RE.search(t):
                empresa = t[:60]
                break
        vagas.append(make_record(titulo, empresa or "Anónimo", "", date_str, job_url, ts, year, wayback_url))
    return vagas


def parse_resultados_box(soup: BeautifulSoup, ts: str, year: int, wayback_url: str) -> list[dict]:
    """Era C 2016+: .resultadosBox"""
    containers = soup.select(".resultadosBox")
    if not containers:
        return []
    vagas = []
    seen_urls: set[str] = set()
    for c in containers:
        link_tag = None
        for a in c.find_all("a", href=True):
            if JOB_URL_RE.search(a.get("href", "")):
                link_tag = a
                break
        if not link_tag:
            for a in c.find_all("a", href=True):
                h = a.get("href", "")
                if DOMAIN in h or h.startswith("/emprego") or h.startswith("/vagas"):
                    link_tag = a
                    break
        href_raw = link_tag["href"] if link_tag else ""
        job_url  = clean_url(href_raw)
        if job_url and job_url in seen_urls:
            continue
        if job_url:
            seen_urls.add(job_url)
        full_text = c.get_text(" ", strip=True)
        if BLACKLIST.search(full_text[:80]):
            continue
        date_match = DATE_RE.search(full_text)
        date_str   = normalise_date(date_match.group(1)) if date_match else ""
        pre_date   = full_text[:date_match.start()].strip() if date_match else full_text
        post_date  = full_text[date_match.end():].strip() if date_match else ""
        local, ref = "", ""
        if post_date:
            parts = [p.strip() for p in post_date.split("|")]
            if parts:
                local = parts[0][:60]
        titulo, empresa = "", ""
        for sel in ["h2", "h3", "h4", ".titulo", ".title", ".cargo"]:
            el = c.select_one(sel)
            if el:
                t = el.get_text(strip=True)
                if t and len(t) > 3:
                    titulo = t
                    break
        for sel in [".empresa", ".company", ".entidade", ".empregador"]:
            el = c.select_one(sel)
            if el:
                e = el.get_text(strip=True)
                if e and len(e) > 1:
                    empresa = e
                    break
        if not titulo and link_tag:
            titulo = link_tag.get_text(strip=True)
        if not titulo and pre_date:
            titulo = pre_date[:120].strip()
        if not titulo or len(titulo) < 3:
            continue
        vagas.append(make_record(titulo, empresa or "Anónimo", local, date_str, job_url, ts, year, wayback_url))
    return vagas


def parse_page(soup: BeautifulSoup, ts: str, year: int, wayback_url: str) -> list[dict]:
    if year >= 2016:
        return parse_resultados_box(soup, ts, year, wayback_url) or parse_item_grid(soup, ts, year, wayback_url)
    if year >= ERA_C_FROM:
        return parse_item_grid(soup, ts, year, wayback_url) or parse_ofertas_home(soup, ts, year, wayback_url)
    if year >= ERA_B_FROM:
        return parse_ofertas_home(soup, ts, year, wayback_url) or parse_item_grid(soup, ts, year, wayback_url)
    # Era A
    return parse_era_a(soup, ts, year, wayback_url) or parse_ofertas_home(soup, ts, year, wayback_url)


# ─── CDX ──────────────────────────────────────────────────────────────────────
async def get_timestamps_for_seed(session, url_pattern: str, L) -> list[str]:
    params = {
        "url": url_pattern, "output": "json",
        "fl": "timestamp,statuscode", "filter": "statuscode:200", "limit": "100000",
    }
    try:
        async with session.get(CDX_ENDPOINT, params=params,
                               timeout=aiohttp.ClientTimeout(total=60)) as resp:
            if resp.status != 200:
                L.warning(f"CDX HTTP {resp.status} para '{url_pattern}'")
                return []
            raw = (await resp.text()).strip()
        out = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                ts  = obj[0] if isinstance(obj, list) else obj.get("timestamp")
                if ts:
                    out.append(str(ts))
            except json.JSONDecodeError:
                continue
        return sorted(out)
    except Exception as e:
        L.error(f"CDX excepção '{url_pattern}': {e}")
        return []


def merge_timestamps_by_year(
    seed_results: list[tuple[str, list[str]]],
    year_start: int, year_end: int, L,
) -> dict[int, list[tuple[str, str]]]:
    """
    FIX-2: descarta seeds aeiou.* para anos >= 2016.
    Sem sampling estático — feito dinamicamente em process_year.
    """
    by_year_date: dict[int, dict[str, tuple[str, str]]] = defaultdict(dict)
    for base_url, timestamps in seed_results:
        is_aeiou = "aeiou" in base_url
        for ts in timestamps:
            yr = int(ts[:4]) if len(ts) >= 4 else 0
            if not (year_start <= yr <= year_end):
                continue
            if is_aeiou and yr >= 2016:
                continue  # FIX-2
            date8 = ts[:8]
            if date8 not in by_year_date[yr]:
                by_year_date[yr][date8] = (ts, base_url)

    result: dict[int, list[tuple[str, str]]] = {}
    for yr in sorted(by_year_date):
        all_pairs = sorted(by_year_date[yr].values(), key=lambda p: p[0])
        result[yr] = all_pairs

    return result


# ─── RATE LIMITER + CIRCUIT BREAKER ───────────────────────────────────────────
class RateLimiter:
    def __init__(self, rps: float, pause_secs: float = 30.0):
        self._interval     = 1.0 / max(rps, 0.1)
        self._pause_secs   = pause_secs
        self._lock         = asyncio.Lock()
        self._next_token   = 0.0
        self._paused_until = 0.0

    async def acquire(self):
        async with self._lock:
            now  = asyncio.get_event_loop().time()
            wait = max(self._next_token - now, self._paused_until - now, 0)
            if wait > 0:
                await asyncio.sleep(wait)
            self._next_token = asyncio.get_event_loop().time() + self._interval

    def trigger_429(self, L):
        until = asyncio.get_event_loop().time() + self._pause_secs
        if until > self._paused_until:
            self._paused_until = until
            L.warning(f"[CB] 429 → pausa global de {self._pause_secs:.0f}s")


# ─── FETCH COM BACKOFF ─────────────────────────────────────────────────────────
async def fetch_with_backoff(
    session, url: str, L, rl: RateLimiter,
    max_tries: int = 3, base_delay: float = 1.0,
    year: Optional[int] = None,
) -> tuple[int, Optional[bytes]]:
    for attempt in range(max_tries):
        await rl.acquire()
        try:
            async with session.get(url, timeout=TIMEOUT_LISTING, allow_redirects=True) as resp:
                if resp.status == 429:
                    rl.trigger_429(L)
                    await asyncio.sleep(base_delay * (2 ** attempt) + 5.0)
                    continue
                if resp.status == 200:
                    content = await resp.read()
                    # FIX-4: rejeita conteúdo já visto cross-year
                    fingerprint = hashlib.md5(content[:4096]).hexdigest()
                    if fingerprint in _SEEN_HASHES:
                        L.debug(f"[DEDUP-HASH] snapshot duplicado: {url[:80]}")
                        return -1, None   # -1 = duplicado detectado
                    _SEEN_HASHES.add(fingerprint)
                    return 200, content
                return resp.status, None
        except asyncio.TimeoutError:
            L.debug(f"Timeout (tent.{attempt+1}) {url[:80]}")
        except aiohttp.ClientError as e:
            L.debug(f"ClientError (tent.{attempt+1}) {url[:80]}: {e}")
        if attempt < max_tries - 1:
            await asyncio.sleep(base_delay * (2 ** attempt))
    return 0, None


def noframe_url(ts: str, target: str) -> str:
    return f"{NOFRAME_BASE}/{ts}/{target}"


def page_target(page: int, base_url: str, year: int) -> str:
    if year < ERA_B_FROM:
        return base_url  # Era A: sem paginação fiável
    if page == 1:
        return base_url
    return f"http://{DOMAIN}/ofertas-emprego?page={page}"


# ─── CHECKPOINT ───────────────────────────────────────────────────────────────
@dataclass
class Checkpoint:
    years_done:  list = field(default_factory=list)
    fetched_ids: list = field(default_factory=list)
    total_saved: int  = 0
    total_errors: int = 0
    last_updated: str = ""

    def year_done(self, y): return y in self.years_done
    def mark_year(self, y):
        if y not in self.years_done:
            self.years_done.append(y)
    def is_fetched(self, rid): return rid in self.fetched_ids
    def mark_fetched(self, rid):
        if rid not in self.fetched_ids:
            self.fetched_ids.append(rid)


def load_cp(L) -> Checkpoint:
    if CHECKPOINT_F.exists():
        try:
            cp = Checkpoint(**json.loads(CHECKPOINT_F.read_text(encoding="utf-8")))
            L.info(f"[CP] Retomando: anos={len(cp.years_done)}, guardados={cp.total_saved}")
            return cp
        except Exception as e:
            L.warning(f"[CP] Inválido ({e}) – a começar do zero.")
    return Checkpoint()


def save_cp(cp: Checkpoint):
    cp.last_updated = datetime.now(timezone.utc).isoformat()
    CHECKPOINT_F.write_text(json.dumps(asdict(cp), ensure_ascii=False, indent=2), encoding="utf-8")


def maybe_save_cp(cp: Checkpoint):
    if (cp.total_saved + cp.total_errors) % CHECKPOINT_EVERY == 0:
        save_cp(cp)


# ─── GUARDAR REGISTO ──────────────────────────────────────────────────────────
def save_record(rec: dict):
    d = RAW_DIR / str(rec["year"])
    d.mkdir(parents=True, exist_ok=True)
    fname = f"{rec['arquivo_timestamp']}_{rec['record_id']}.json"
    (d / fname).write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")


# ─── LOGGING ──────────────────────────────────────────────────────────────────
class TqdmHandler(logging.StreamHandler):
    def emit(self, record):
        try:
            tqdm.write(self.format(record), file=sys.stdout)
        except Exception:
            self.handleError(record)


def setup_logging() -> logging.Logger:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    L = logging.getLogger("neoexpresso")
    if L.handlers:
        return L
    L.setLevel(logging.DEBUG)
    fmt = logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%Y-%m-%dT%H:%M:%SZ")
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    L.addHandler(fh)
    ch = TqdmHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    L.addHandler(ch)
    return L


# ─── PROCESSAR UM ANO ─────────────────────────────────────────────────────────
async def process_year(
    session, sem, cp: Checkpoint, L,
    year: int, timestamps: list[tuple[str, str]],
    rl: RateLimiter, delay: float, pb_anos: tqdm,
):
    if cp.year_done(year):
        pb_anos.update(1)
        return

    era_label = "A (ASP)" if year < ERA_B_FROM else ("B (ASPX)" if year < ERA_C_FROM else "C (moderno)")
    L.info(f"\n{'='*60}\nAno {year} | era: {era_label} | {len(timestamps)} timestamps\n{'='*60}")

    max_pages = 2 if year < ERA_B_FROM else 60
    max_snaps = get_max_snaps(year)
    last_success_dt: Optional[datetime] = None
    snaps_used = 0

    def save_jobs(jobs: list[dict]) -> tuple[int, int]:
        new = skipped = 0
        for job in jobs:
            rid = job["record_id"]
            if cp.is_fetched(rid):
                skipped += 1
                continue
            save_record(job)
            cp.mark_fetched(rid)
            cp.total_saved += 1
            new += 1
            maybe_save_cp(cp)
        return new, skipped

    for ts_idx, (ts, base_url) in enumerate(timestamps):
        if snaps_used >= max_snaps:
            L.debug(f"  [{year}] atingido max_snaps={max_snaps} — parando")
            break

        current_dt = datetime.strptime(ts[:8], "%Y%m%d")
        if last_success_dt and (current_dt - last_success_dt).days < MIN_GAP_DAYS:
            continue

        async def fetch_page(page: int, _ts: str = ts, _base: str = base_url) -> tuple[Optional[bytes], str]:
            async with sem:
                await asyncio.sleep(delay)
                target = page_target(page, _base, year)
                url    = noframe_url(_ts, target)
                status, body = await fetch_with_backoff(session, url, L, rl, year=year)
                return body, url

        body1, wb1 = await fetch_page(1)
        if body1 is None:
            L.debug(f"  ts[{ts_idx}]={ts}: sem conteúdo/duplicado")
            continue

        soup1 = BeautifulSoup(body1, "html.parser")
        jobs1 = parse_page(soup1, ts, year, wb1)
        n1, _ = save_jobs(jobs1)
        L.info(f"  ts[{ts_idx}]={ts} | pág 1: {len(jobs1)} vagas, {n1} novas")

        if not jobs1:
            continue

        last_success_dt = current_dt
        snaps_used += 1

        if year < ERA_B_FROM:
            continue  # Era A: sem paginação

        page = 2
        with tqdm(total=None, desc=f"  📄 {year}[{ts_idx}]", unit="pág",
                  leave=False, position=1) as pb_pags:
            while True:
                batch = list(range(page, page + PAGE_BATCH))
                tasks = [asyncio.create_task(fetch_page(p)) for p in batch]
                results = await asyncio.gather(*tasks)
                pb_pags.update(len(batch))

                jobs_in_batch = 0
                for body, wb_url in results:
                    if not body:
                        continue
                    soup  = BeautifulSoup(body, "html.parser")
                    jobs  = parse_page(soup, ts, year, wb_url)
                    jobs_in_batch += len(jobs)
                    save_jobs(jobs)

                if jobs_in_batch == 0:
                    L.debug(f"  ts[{ts_idx}] págs {page}–{page+PAGE_BATCH-1}: vazias → fim")
                    break
                page += PAGE_BATCH

    cp.mark_year(year)
    save_cp(cp)
    pb_anos.update(1)


# ─── CONSOLIDAR DATASET ───────────────────────────────────────────────────────
FIELDS = [
    "record_id", "year", "title", "company", "location",
    "date_posted", "original_url", "wayback_url",
    "arquivo_timestamp", "source", "scraped_at_utc", "date_archived",
]


def build_dataset(L):
    L.info("\n" + "="*65 + "\nCONSOLIDANDO DATASET\n" + "="*65)
    BASE_DIR.mkdir(parents=True, exist_ok=True)

    seen_ids: set[str] = set()
    all_records: list[dict] = []

    for year_dir in sorted(d for d in RAW_DIR.iterdir() if d.is_dir()):
        for fpath in sorted(year_dir.glob("*.json")):
            try:
                rec = json.loads(fpath.read_text(encoding="utf-8"))
                rid = rec.get("record_id", "")
                if rid and rid in seen_ids:
                    continue
                seen_ids.add(rid)
                all_records.append(rec)
            except Exception as e:
                L.debug(f"Erro a ler {fpath}: {e}")

    if not all_records:
        L.info("Nenhum registo encontrado.")
        return

    with DATASET_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_records)

    by_yr: dict[int, int] = defaultdict(int)
    for rec in all_records:
        by_yr[rec.get("year", 0)] += 1

    L.info(f"  CSV → {DATASET_CSV}  ({len(all_records):,} registos)")
    max_c = max(by_yr.values()) if by_yr else 1
    for yr in sorted(by_yr):
        bar = "█" * min(40, max(1, by_yr[yr] * 40 // max_c))
        L.info(f"  {yr:<6} {by_yr[yr]:>6,}  {bar}")
    L.info(f"\n  TOTAL: {len(all_records):,} vagas únicas")


# ─── MAIN ─────────────────────────────────────────────────────────────────────
async def run_discovery(session, cp, L, years, concurrency, delay, max_rps):
    L.info("="*70)
    L.info("RADAR V13 — CDX multi-seed | FIX-1 era-A | FIX-2 aeiou≥2016 | FIX-3 snaps/ano | FIX-4 hash-dedup")
    L.info(f"Seeds: {[s[0] for s in CDX_SEEDS]}")
    L.info("="*70)

    seed_results: list[tuple[str, list[str]]] = []
    for cdx_pattern, base_url in CDX_SEEDS:
        L.info(f"CDX → {cdx_pattern}")
        ts_list = await get_timestamps_for_seed(session, cdx_pattern, L)
        L.info(f"  {len(ts_list)} timestamps")
        seed_results.append((base_url, ts_list))

    by_year = merge_timestamps_by_year(seed_results, years[0], years[-1], L)
    if not by_year:
        L.error("Nenhum timestamp. Abortando.")
        return

    years_with_data = sorted(by_year)
    for y in years_with_data:
        sources = set(b for _, b in by_year[y])
        L.info(f"  {y}: {len(by_year[y])} ts | seeds: {sources} | max_snaps: {get_max_snaps(y)}")

    rl  = RateLimiter(rps=max_rps, pause_secs=30.0)
    sem = asyncio.Semaphore(concurrency)

    with tqdm(total=len(years_with_data), desc="📆 Anos", unit="ano", position=0,
              bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}]") as pb_anos:
        for year in years_with_data:
            if cp.year_done(year):
                pb_anos.update(1)
                continue
            await process_year(session, sem, cp, L, year, by_year[year], rl, delay, pb_anos)


def main():
    parser = argparse.ArgumentParser(description="Radar V13 — expressoemprego.pt scraper")
    parser.add_argument("--year-start",   type=int,   default=YEAR_START)
    parser.add_argument("--year-end",     type=int,   default=YEAR_END)
    parser.add_argument("--concurrency",  type=int,   default=5)
    parser.add_argument("--max-rps",      type=float, default=4.0)
    parser.add_argument("--delay",        type=float, default=0.3)
    parser.add_argument("--reset",        action="store_true", help="Recomeçar do zero")
    parser.add_argument("--dataset-only", action="store_true", help="Só consolidar CSV")
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    L = setup_logging()

    if args.dataset_only:
        build_dataset(L)
        return

    if args.reset and CHECKPOINT_F.exists():
        CHECKPOINT_F.unlink()
        _SEEN_HASHES.clear()
        L.info("[RESET] Checkpoint removido.")

    cp    = load_cp(L)
    years = list(range(args.year_start, args.year_end + 1))
    L.info(f"Anos: {years[0]}–{years[-1]} | rps={args.max_rps} | conc={args.concurrency}")

    headers = {"User-Agent": "RadarV13/1.0 (academic research)"}

    async def _run():
        connector = aiohttp.TCPConnector(limit=args.concurrency * 4, ttl_dns_cache=300, ssl=False)
        async with aiohttp.ClientSession(connector=connector, headers=headers) as session:
            try:
                await run_discovery(session, cp, L, years, args.concurrency, args.delay, args.max_rps)
                build_dataset(L)
            except asyncio.CancelledError:
                L.warning("Cancelado.")
            finally:
                tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
                for t in tasks:
                    t.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                save_cp(cp)
                L.info(f"Total guardado: {cp.total_saved:,} vagas")

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        L.warning("\nInterrompido. Checkpoints guardados.")
        sys.exit(0)


if __name__ == "__main__":
    main()
