#!/usr/bin/env python3
"""
Salário de Vidro – Scraper Assíncrono via Arquivo.pt (v12)
==========================================================
Mudanças face à v11:
  • CDX multi-source: consulta /ofertas/, /listagem_livre2.asp e / (homepage)
    → cobre 2004-2008 onde /ofertas/ não existia no arquivo
  • Sampling inteligente: máximo 1 timestamp por quinzena (14 dias) por ano
    → elimina redundância de snapshots diários; 5-10x mais rápido
  • Merge de timestamps por seed: preferência para /ofertas/, sem duplicados
    de data entre seeds
  • process_year aceita base_url por timestamp (cada seed usa o seu URL de pág 1)
  • build_dataset: consolida todos os JSON em disco num único ficheiro ao fim
"""

import argparse
import asyncio
import csv
import hashlib
import json
import logging
import re
import sys
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import aiohttp
from bs4 import BeautifulSoup
from tqdm import tqdm

# ─── PATHS ──────────────────────────────────────────────────────────────────
PROJECT_ROOT    = Path(__file__).resolve().parents[2]
DATA_DIR        = PROJECT_ROOT / "data"
RAW_DIR         = DATA_DIR / "raw"
STATE_DIR       = RAW_DIR / "_state"
CHECKPOINT_FILE = STATE_DIR / "checkpoint_listings.json"
LOG_FILE        = STATE_DIR / "run_listings_async.log"
DEBUG_FILE      = STATE_DIR / "debug_last_run.json"
DATASET_FILE    = DATA_DIR / "dataset_all.jsonl"
DATASET_CSV     = DATA_DIR / "dataset_all.csv"

# ─── CONSTANTES ─────────────────────────────────────────────────────────────
CDX_ENDPOINT     = "https://arquivo.pt/wayback/cdx"
NOFRAME_BASE     = "https://arquivo.pt/noFrame/replay"
TARGET_DOMAIN    = "www.net-empregos.com"
YEAR_START       = 2004
YEAR_END         = 2024
PAGE_BATCH       = 5       # páginas em paralelo por lote
CHECKPOINT_EVERY = 50
MIN_GAP_DAYS     = 14      # sampling: 1 timestamp por quinzena

# CDX seeds: (padrão CDX, URL de pág-1 canónico)
# Ordenados por prioridade: em datas iguais, o primeiro vence.
CDX_SEEDS = [
    (f"{TARGET_DOMAIN}/pesquisa-empregos.asp", f"http://{TARGET_DOMAIN}/pesquisa-empregos.asp"),
    (f"{TARGET_DOMAIN}/ofertas/",            f"http://{TARGET_DOMAIN}/ofertas/"),
    (f"{TARGET_DOMAIN}/listagem_livre2.asp", f"http://{TARGET_DOMAIN}/listagem_livre2.asp"),
    (f"{TARGET_DOMAIN}/",                    f"http://{TARGET_DOMAIN}/"),
]

TIMEOUT_LISTING = aiohttp.ClientTimeout(total=20)

# ─── PADRÕES DE URL ──────────────────────────────────────────────────────────
_RE_JOB_NEW  = re.compile(
    r"(?:https?://)?(?:www\.)?net-empregos\.com/(\d{4,8})/([a-z0-9][a-z0-9\-]{2,})/?$",
    re.I,
)
_RE_JOB_OLD  = re.compile(r"detalhe_anuncio[_\w]*\.asp[^\"']*REF=\d+", re.I)
_RE_REPLAY   = re.compile(
    r"(?:https?://[^/]+)?/(?:noFrame/replay|wayback)/\d{14}[a-z_]*/(https?://.+)",
    re.I,
)
_RE_NOISE    = re.compile(
    r"\.(css|js|gif|jpg|jpeg|png|ico|swf|pdf|zip|xml|rss)(\?|$)", re.I
)


def canonical_job_url(href: str) -> Optional[str]:
    url = href.strip()
    for _ in range(3):
        m = _RE_REPLAY.match(url)
        if not m:
            break
        url = m.group(1)
    if _RE_NOISE.search(url):
        return None
    if _RE_JOB_NEW.search(url) or _RE_JOB_OLD.search(url):
        parsed = urlparse(url)
        if "net-empregos.com" not in parsed.netloc:
            return None
        return url
    return None


# ─── PARSER DE LISTAGEM ──────────────────────────────────────────────────────
def parse_listing_page(
    html_bytes: bytes,
    year_ts: str,
    year: int,
    page_wayback_url: str,
) -> list[dict]:
    _L = logging.getLogger("salario")
    _L.debug(
        f"[PARSE] url={page_wayback_url[:100]} | ts={year_ts} | bytes={len(html_bytes)}"
    )

    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
    except Exception as exc:
        _L.warning(f"[PARSE] BeautifulSoup falhou: {exc}")
        return []

    jobs: dict[str, dict] = {}
    now  = datetime.now(timezone.utc).isoformat()

    CONTAINER_SELECTORS = [
        "li.oferta", "div.oferta",
        "li.anuncio", "div.anuncio",
        "li.job", "div.job",
        "li.job-item", "div.job-item",
        "div.oferta-emprego", "li.oferta-emprego",
        "div.resultado", "li.resultado",
        "tr.oferta", "tr.anuncio",
        "div.vaga", "li.vaga",
    ]

    matched_selector: Optional[str] = None
    for sel in CONTAINER_SELECTORS:
        containers = soup.select(sel)
        if not containers:
            continue

        _L.debug(f"[PARSE] selector='{sel}' → {len(containers)} containers")
        matched_selector = sel
        rejected_replay = rejected_domain = rejected_noise = skipped_no_link = 0

        for container in containers:
            link = container.find("a", href=True)
            if not link:
                skipped_no_link += 1
                continue

            href = link.get("href", "").strip()
            raw_href = href

            # Links absolutos do Arquivo.pt (começam por http) ficam intactos.
            # Só adicionamos o domínio a links relativos.
            if not href.startswith("http"):
                if not href.startswith("/"):
                    href = "/" + href
                href = f"http://{TARGET_DOMAIN}{href}"
            canon = canonical_job_url(href)
            if not canon or canon in jobs:
                if canon is None:
                    parsed_tmp = urlparse(href)
                    if _RE_NOISE.search(href):
                        rejected_noise += 1
                    elif "net-empregos.com" not in parsed_tmp.netloc:
                        rejected_domain += 1
                        _L.debug(
                            f"[PARSE] domain-reject netloc='{parsed_tmp.netloc}' "
                            f"raw='{raw_href[:80]}' resolved='{href[:80]}'"
                        )
                    else:
                        rejected_replay += 1
                        _L.debug(
                            f"[PARSE] pattern-reject raw='{raw_href[:80]}' "
                            f"resolved='{href[:80]}'"
                        )
                continue

            title    = _extract_text(container, [
                ".titulo", ".title", "h1", "h2", "h3", "h4", ".nome", ".cargo",
            ]) or link.get_text(strip=True)

            company  = _extract_text(container, [
                ".empresa", ".company", ".entidade", ".empregador",
                ".employerName", ".employer",
            ])
            location = _extract_text(container, [
                ".local", ".localidade", ".location", ".cidade",
                ".distrito", ".zona",
            ])
            date_p   = _extract_text(container, [
                ".data", ".date", ".publicacao", ".publicado",
                ".datapub", ".dt",
            ])

            if not title:
                title = link.get_text(strip=True)

            rid = hashlib.sha256(canon.encode()).hexdigest()[:16]
            jobs[canon] = _make_record(
                rid, canon, title, company, location, date_p,
                year_ts, year, page_wayback_url, now,
            )

        _L.debug(
            f"[PARSE] selector='{matched_selector}' → {len(jobs)} jobs "
            f"| no-link={skipped_no_link} domain-rej={rejected_domain} "
            f"noise-rej={rejected_noise} replay-rej={rejected_replay}"
        )

        if jobs:
            break

    if not jobs:
        _L.debug(
            f"[PARSE] Nenhum selector estruturado funcionou — fallback: "
            f"varredura de todos os <a> | url={page_wayback_url[:80]}"
        )
        all_anchors = soup.find_all("a", href=True)
        _L.debug(f"[PARSE] fallback: {len(all_anchors)} âncoras encontradas")
        fb_domain = fb_noise = fb_replay = 0

        for a in all_anchors:
            href = a.get("href", "").strip()
            raw_href = href

            # Links absolutos do Arquivo.pt (começam por http) ficam intactos.
            # Só adicionamos o domínio a links relativos.
            if not href.startswith("http"):
                if not href.startswith("/"):
                    href = "/" + href
                href = f"http://{TARGET_DOMAIN}{href}"
            canon = canonical_job_url(href)
            if not canon or canon in jobs:
                if canon is None:
                    parsed_tmp = urlparse(href)
                    if _RE_NOISE.search(href):
                        fb_noise += 1
                    elif "net-empregos.com" not in parsed_tmp.netloc:
                        fb_domain += 1
                        _L.debug(
                            f"[PARSE][fb] domain-reject netloc='{parsed_tmp.netloc}' "
                            f"raw='{raw_href[:80]}'"
                        )
                    else:
                        fb_replay += 1
                continue

            parent = a.parent or a
            gp     = parent.parent or parent

            title    = (a.get_text(strip=True)
                        or _extract_text(parent, ["h2", "h3", "h4", ".titulo"])
                        or "")
            company  = _extract_text(gp, [".empresa", ".company", ".entidade"]) or ""
            location = _extract_text(gp, [".local", ".localidade", ".location"]) or ""
            date_p   = _extract_text(gp, [".data", ".date", ".publicacao"]) or ""

            rid = hashlib.sha256(canon.encode()).hexdigest()[:16]
            jobs[canon] = _make_record(
                rid, canon, title, company, location, date_p,
                year_ts, year, page_wayback_url, now,
            )

        _L.debug(
            f"[PARSE][fb] fallback concluído → {len(jobs)} jobs "
            f"| domain-rej={fb_domain} noise-rej={fb_noise} replay-rej={fb_replay}"
        )

    if not jobs:
        _L.debug(
            f"[PARSE] 0 jobs extraídos | selector={matched_selector!r} "
            f"url={page_wayback_url[:100]}"
        )
    else:
        _L.debug(f"[PARSE] TOTAL {len(jobs)} jobs extraídos | ts={year_ts}")

    return list(jobs.values())


def _extract_text(tag, selectors: list[str]) -> str:
    for sel in selectors:
        el = tag.select_one(sel)
        if el:
            txt = el.get_text(strip=True)
            if txt:
                return txt
    return ""


def _make_record(rid, canon, title, company, location, date_p,
                 year_ts, year, page_wayback_url, now) -> dict:
    return {
        "record_id":          rid,
        "original_url":       canon,
        "wayback_url":        page_wayback_url,
        "arquivo_timestamp":  year_ts,
        "year":               year,
        "title":              title,
        "company":            company,
        "location":           location,
        "date_posted":        date_p,
        "source":             "listagem",
        "scraped_at_utc":     now,
        "http_status":        200,
        "error":              None,
    }


# ─── DEBUG STATS ─────────────────────────────────────────────────────────────
@dataclass
class YearStats:
    year:        int
    pages_ok:    int  = 0
    pages_err:   int  = 0
    jobs_found:  int  = 0
    saved:       int  = 0
    skipped:     int  = 0
    rate_429:    int  = 0
    timeouts:    int  = 0
    http_codes:  dict = field(default_factory=dict)


@dataclass
class DebugStats:
    started_at:     str  = ""
    finished_at:    str  = ""
    years:          dict = field(default_factory=dict)
    total_429:      int  = 0
    total_timeouts: int  = 0
    total_saved:    int  = 0
    total_errors:   int  = 0

    def year(self, y: int) -> YearStats:
        if y not in self.years:
            self.years[y] = YearStats(year=y)
        return self.years[y]

    def inc_429(self, y: Optional[int] = None):
        self.total_429 += 1
        if y:
            self.year(y).rate_429 += 1

    def inc_timeout(self, y: Optional[int] = None):
        self.total_timeouts += 1
        if y:
            self.year(y).timeouts += 1

    def to_dict(self) -> dict:
        d = asdict(self)
        d["years"] = {str(k): asdict(v) for k, v in self.years.items()}
        return d


# ─── TOKEN BUCKET + CIRCUIT BREAKER ─────────────────────────────────────────
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

    def trigger_429(self, L: logging.Logger):
        until = asyncio.get_event_loop().time() + self._pause_secs
        if until > self._paused_until:
            self._paused_until = until
            L.warning(f"[CB] 429 → pausa global de {self._pause_secs:.0f}s")


# ─── CHECKPOINT ──────────────────────────────────────────────────────────────
@dataclass
class Checkpoint:
    years_done:   list = field(default_factory=list)
    fetched_ids:  list = field(default_factory=list)
    total_saved:  int  = 0
    total_errors: int  = 0
    last_updated: str  = ""

    def year_done(self, y):     return y in self.years_done
    def mark_year(self, y):
        if y not in self.years_done:
            self.years_done.append(y)
    def is_fetched(self, rid):  return rid in self.fetched_ids
    def mark_fetched(self, rid):
        if rid not in self.fetched_ids:
            self.fetched_ids.append(rid)


def load_cp(L) -> Checkpoint:
    if CHECKPOINT_FILE.exists():
        try:
            cp = Checkpoint(**json.loads(CHECKPOINT_FILE.read_text(encoding="utf-8")))
            L.info(f"[CP] Retomando: anos={len(cp.years_done)}, guardados={cp.total_saved}")
            return cp
        except Exception as e:
            L.warning(f"[CP] Inválido ({e}) – a começar do zero.")
            CHECKPOINT_FILE.unlink(missing_ok=True)
    return Checkpoint()


def save_cp(cp: Checkpoint):
    cp.last_updated = datetime.now(timezone.utc).isoformat()
    CHECKPOINT_FILE.write_text(
        json.dumps(asdict(cp), ensure_ascii=False, indent=2), encoding="utf-8")


def maybe_save_cp(cp: Checkpoint):
    if (cp.total_saved + cp.total_errors) % CHECKPOINT_EVERY == 0:
        save_cp(cp)


# ─── LOGGING ─────────────────────────────────────────────────────────────────
class TqdmHandler(logging.StreamHandler):
    def emit(self, record):
        try:
            tqdm.write(self.format(record), file=sys.stdout)
        except Exception:
            self.handleError(record)


def setup_logging() -> logging.Logger:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    L = logging.getLogger("salario")
    if L.handlers:
        return L
    L.setLevel(logging.DEBUG)
    fmt = logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s",
                            datefmt="%Y-%m-%dT%H:%M:%SZ")
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    L.addHandler(fh)
    ch = TqdmHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    L.addHandler(ch)
    return L


# ─── GUARDAR REGISTO ─────────────────────────────────────────────────────────
def save_record(rec: dict):
    d = RAW_DIR / str(rec["year"])
    d.mkdir(parents=True, exist_ok=True)
    fname = f"{rec['arquivo_timestamp']}_{rec['record_id']}.json"
    (d / fname).write_text(
        json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")


# ─── DEBUG REPORT ────────────────────────────────────────────────────────────
def print_debug_report(dbg: DebugStats, L: logging.Logger):
    L.info("")
    L.info("=" * 72)
    L.info("RELATÓRIO DE DEBUG")
    L.info("=" * 72)
    L.info(f"  Início     : {dbg.started_at}")
    L.info(f"  Fim        : {dbg.finished_at or datetime.now(timezone.utc).isoformat()}")
    L.info(f"  Guardados  : {dbg.total_saved:>6,}")
    L.info(f"  429s       : {dbg.total_429:>6,}")
    L.info(f"  Timeouts   : {dbg.total_timeouts:>6,}")
    L.info("")
    hdr = (f"  {'Ano':<6} {'Págs OK':>8} {'Págs ERR':>9} "
           f"{'Found':>8} {'Saved':>7} {'Skip':>6} {'429s':>5} {'T/O':>4}")
    L.info(hdr)
    L.info("  " + "─" * 65)
    for y in sorted(dbg.years):
        s = dbg.years[y]
        codes = " | ".join(f"{k}:{v}" for k, v in sorted(s.http_codes.items()))
        L.info(
            f"  {y:<6} {s.pages_ok:>8,} {s.pages_err:>9,} "
            f"{s.jobs_found:>8,} {s.saved:>7,} {s.skipped:>6,} "
            f"{s.rate_429:>5,} {s.timeouts:>4,}"
            + (f"  [{codes}]" if codes else "")
        )
    L.info("  " + "─" * 65)
    DEBUG_FILE.write_text(
        json.dumps(dbg.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    L.info(f"  JSON de debug guardado em: {DEBUG_FILE}")
    L.info("=" * 72)


# ─── CDX ─────────────────────────────────────────────────────────────────────
async def get_timestamps_for_url(session, url_pattern: str, L) -> list[str]:
    params = {
        "url":    url_pattern,
        "output": "json",
        "fl":     "timestamp,original,statuscode",
        "filter": "statuscode:200",
        "limit":  "100000",
    }
    try:
        async with session.get(
            CDX_ENDPOINT, params=params,
            timeout=aiohttp.ClientTimeout(total=60),
        ) as resp:
            if resp.status != 200:
                L.warning(f"CDX HTTP {resp.status} para '{url_pattern}'")
                return []
            raw = (await resp.text()).strip()

        timestamps = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                ts  = obj[0] if isinstance(obj, list) else obj.get("timestamp")
                if ts:
                    timestamps.append(str(ts))
            except json.JSONDecodeError:
                continue
        return sorted(timestamps)
    except Exception as e:
        L.error(f"CDX excepção '{url_pattern}': {e}")
        return []


# ─── SAMPLING DE TIMESTAMPS ──────────────────────────────────────────────────
def sample_timestamps(ts_list: list[str], min_gap_days: int = MIN_GAP_DAYS) -> list[str]:
    """
    Filtra a lista de timestamps mantendo no máximo 1 por 'min_gap_days' dias.
    Preserva o primeiro de cada janela temporal.
    """
    selected: list[str] = []
    last_dt: Optional[datetime] = None
    for ts in sorted(ts_list):
        try:
            dt = datetime.strptime(ts[:8], "%Y%m%d")
        except ValueError:
            continue
        if last_dt is None or (dt - last_dt).days >= min_gap_days:
            selected.append(ts)
            last_dt = dt
    return selected


# ─── MERGE DE TIMESTAMPS POR ANO (MULTI-SEED) ───────────────────────────────
def merge_timestamps_by_year(
    seed_results: list[tuple[str, list[str]]],
    year_start: int,
    year_end: int,
    L,
) -> dict[int, list[tuple[str, str]]]:
    """
    Recebe lista de (base_url, [timestamps]) por seed.
    Devolve {year: [(ts, base_url), ...]} sem duplicados de data, ordenados cronologicamente.
    Prioridade: seed anterior na lista vence em colisões de data.
    O sampling de MIN_GAP_DAYS é feito dinamicamente em process_year (só avança após sucesso).
    """
    # {year: {date_8: (ts, base_url)}}  — prioridade por ordem de seed
    by_year_date: dict[int, dict[str, tuple[str, str]]] = defaultdict(dict)

    for base_url, timestamps in seed_results:
        for ts in timestamps:
            y = year_of(ts)
            if not (year_start <= y <= year_end):
                continue
            date8 = ts[:8]
            # Mantém apenas a lógica de prioridade de seeds para o mesmo dia
            if date8 not in by_year_date[y]:
                by_year_date[y][date8] = (ts, base_url)

    result: dict[int, list[tuple[str, str]]] = {}
    for y in sorted(by_year_date):
        # Devolve todos os pares cronologicamente, SEM SAMPLING PRÉVIO.
        # O sampling dinâmico (14 dias só em caso de sucesso) é feito em process_year.
        all_pairs = sorted(by_year_date[y].values(), key=lambda p: p[0])
        result[y] = all_pairs

    return result


# ─── FETCH COM BACKOFF + RATE LIMITER ────────────────────────────────────────
async def fetch_with_backoff(
    session,
    url: str,
    timeout,
    L,
    rl: RateLimiter,
    max_tries: int = 3,
    base_delay: float = 1.0,
    year: Optional[int] = None,
    dbg: Optional[DebugStats] = None,
) -> tuple[int, Optional[bytes]]:
    for attempt in range(max_tries):
        await rl.acquire()
        try:
            async with session.get(url, timeout=timeout, allow_redirects=True) as resp:
                if resp.status == 429:
                    if dbg:
                        dbg.inc_429(year)
                    rl.trigger_429(L)
                    await asyncio.sleep(base_delay * (2 ** attempt) + 5.0)
                    continue
                body = await resp.read() if resp.status == 200 else None
                return resp.status, body
        except asyncio.TimeoutError:
            if dbg:
                dbg.inc_timeout(year)
            L.debug(f"Timeout (tent.{attempt + 1}) {url[:80]}")
        except aiohttp.ClientError as e:
            L.debug(f"ClientError (tent.{attempt + 1}) {url[:80]}: {e}")

        if attempt < max_tries - 1:
            await asyncio.sleep(base_delay * (2 ** attempt))

    return 0, None


# ─── HELPERS ─────────────────────────────────────────────────────────────────
def noframe_replay(ts: str, url: str) -> str:
    return f"{NOFRAME_BASE}/{ts}/{url}"

def year_of(ts: str) -> int:
    return int(ts[:4]) if len(ts) >= 4 else 0


# ─── PROCESSAR UM ANO ────────────────────────────────────────────────────────
async def process_year(
    session,
    sem_listings,
    cp: Checkpoint,
    L,
    dbg: DebugStats,
    year: int,
    timestamps: list[tuple[str, str]],   # (ts, base_url)
    rl: RateLimiter,
    delay: float,
    pb_anos: tqdm,
):
    if cp.year_done(year):
        pb_anos.update(1)
        return

    ys = dbg.year(year)
    last_success_dt: Optional[datetime] = None  # controlo do sampling dinâmico

    def target_url(page: int, base_url: str) -> str:
        if page == 1:
            return base_url
        return f"http://{TARGET_DOMAIN}/listagem_livre2.asp?page={page}"

    def save_jobs(jobs: list[dict]) -> tuple[int, int]:
        new = skipped = 0
        for job in jobs:
            rid = job["record_id"]
            if cp.is_fetched(rid):
                skipped += 1
                ys.skipped += 1
                continue
            save_record(job)
            cp.mark_fetched(rid)
            cp.total_saved += 1
            ys.saved       += 1
            new            += 1
            maybe_save_cp(cp)
        return new, skipped

    L.info("\n" + "=" * 60 +
           f"\nAno {year} | {len(timestamps)} timestamps (sampling dinâmico activo)\n" + "=" * 60)

    for ts_idx, (ts, base_url) in enumerate(timestamps):
        current_dt = datetime.strptime(ts[:8], "%Y%m%d")

        # SAMPLING DINÂMICO: só saltamos se o snapshot anterior foi BOM.
        # Se foi um iframe/vazio (0 jobs), last_success_dt não avança e tentamos o próximo.
        if last_success_dt and (current_dt - last_success_dt).days < MIN_GAP_DAYS:
            continue

        async def fetch_page(
            page: int,
            _ts: str = ts,
            _base: str = base_url,
        ) -> tuple[Optional[bytes], str]:
            async with sem_listings:
                await asyncio.sleep(delay)
                url = noframe_replay(_ts, target_url(page, _base))
                status, body = await fetch_with_backoff(
                    session, url, TIMEOUT_LISTING, L, rl, year=year, dbg=dbg)
                if status == 200 and body:
                    return body, url
                code = str(status) if status else "0"
                ys.http_codes[code] = ys.http_codes.get(code, 0) + 1
                return None, url

        body1, wb1 = await fetch_page(1)
        if not body1:
            L.debug(f"  ts[{ts_idx}]={ts} ({base_url}): sem conteúdo — a saltar.")
            continue

        jobs1 = parse_listing_page(body1, ts, year, wb1)
        ys.pages_ok   += 1
        ys.jobs_found += len(jobs1)
        n1, _ = save_jobs(jobs1)
        L.info(f"  ts[{ts_idx}]={ts} | pág 1: {len(jobs1)} jobs, {n1} novos")

        if not jobs1:
            L.debug(f"  ts[{ts_idx}]={ts} ({base_url}) deu 0 jobs. Sampling dinâmico: a tentar próximo snapshot...")
            continue

        # Snapshot válido — registamos a data para activar o cooldown de 14 dias
        last_success_dt = current_dt

        page = 2
        with tqdm(
            total=None,
            desc=f"  📄 {year}[{ts_idx}]",
            unit="pág",
            leave=False,
            position=1,
        ) as pb_pags:
            while True:
                batch_pages = list(range(page, page + PAGE_BATCH))
                tasks = [asyncio.create_task(fetch_page(p)) for p in batch_pages]
                results = await asyncio.gather(*tasks)
                pb_pags.update(len(batch_pages))

                jobs_in_batch = 0
                for (body, wb_url) in results:
                    if not body:
                        continue
                    jobs = parse_listing_page(body, ts, year, wb_url)
                    ys.pages_ok   += 1
                    ys.jobs_found += len(jobs)
                    jobs_in_batch += len(jobs)
                    save_jobs(jobs)

                if jobs_in_batch == 0:
                    L.debug(
                        f"  ts[{ts_idx}] págs {page}–{page+PAGE_BATCH-1}: "
                        f"vazias → fim ({page+PAGE_BATCH-2} págs)"
                    )
                    break

                L.debug(
                    f"  ts[{ts_idx}] págs {page}–{page+PAGE_BATCH-1}: "
                    f"+{jobs_in_batch} jobs (saved total: {cp.total_saved})"
                )
                page += PAGE_BATCH

    L.info(
        f"  Ano {year} TOTAL ✓{ys.saved} skip:{ys.skipped} "
        f"págs:{ys.pages_ok} ts:{len(timestamps)} "
        f"429s:{ys.rate_429} T/O:{ys.timeouts}"
    )
    cp.mark_year(year)
    save_cp(cp)
    pb_anos.update(1)


# ─── FASE PRINCIPAL ──────────────────────────────────────────────────────────
async def run_discovery(
    session,
    cp: Checkpoint,
    L,
    dbg: DebugStats,
    years: list[int],
    concurrency: int,
    delay: float,
    max_rps: float,
):
    L.info("=" * 70)
    L.info("FASE DE DESCOBERTA – CDX multi-seed (v12)")
    L.info(f"Seeds: {[s[0] for s in CDX_SEEDS]}")
    L.info(f"Sampling dinâmico: cooldown de {MIN_GAP_DAYS} dias só após snapshot com vagas")
    L.info("=" * 70)

    # ── Recolher timestamps de todos os seeds ────────────────────────────────
    seed_results: list[tuple[str, list[str]]] = []
    for cdx_pattern, base_url in CDX_SEEDS:
        L.info(f"CDX → {cdx_pattern}")
        ts_list = await get_timestamps_for_url(session, cdx_pattern, L)
        L.info(f"  {len(ts_list)} timestamps encontrados")
        seed_results.append((base_url, ts_list))

    # ── Merge (sem sampling — é feito dinamicamente em process_year) ─────────
    by_year = merge_timestamps_by_year(
        seed_results, years[0], years[-1], L
    )

    if not by_year:
        L.error("Nenhum timestamp para os anos pedidos. Abortando.")
        return

    years_with_data = sorted(by_year)
    L.info(f"Anos com capturas: {years_with_data}")
    for y in years_with_data:
        sources = set(base for _, base in by_year[y])
        L.info(f"  {y}: {len(by_year[y])} ts | seeds: {sources}")
    L.info(f"Rate limiter: {max_rps} req/s | concorrência: {concurrency}")

    rl           = RateLimiter(rps=max_rps, pause_secs=30.0)
    sem_listings = asyncio.Semaphore(concurrency)

    with tqdm(
        total=len(years_with_data),
        desc="📆 Anos",
        unit="ano",
        position=0,
        bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}]",
    ) as pb_anos:
        for year in years_with_data:
            if cp.year_done(year):
                pb_anos.update(1)
                continue
            await process_year(
                session, sem_listings, cp, L, dbg,
                year, by_year[year], rl, delay, pb_anos,
            )

    dbg.total_saved  = cp.total_saved
    L.info(f"Descoberta concluída: ✓{cp.total_saved}")


# ─── ESTATÍSTICAS ────────────────────────────────────────────────────────────
def run_stats(L):
    L.info("\n" + "=" * 65)
    L.info("ESTATÍSTICAS DOS FICHEIROS EM DISCO")
    L.info("=" * 65)
    by_year: dict[int, int] = {}
    for d in sorted(RAW_DIR.iterdir()):
        if not d.is_dir() or d.name.startswith("_"):
            continue
        try:
            yr = int(d.name)
        except ValueError:
            continue
        files = list(d.glob("*.json"))
        if files:
            by_year[yr] = len(files)
    if not by_year:
        L.info("Nenhum ficheiro em disco.")
        return
    total   = sum(by_year.values())
    max_bar = max(by_year.values())
    L.info(f"  {'Ano':<8} {'Ficheiros':>10}  Barra")
    L.info("  " + "─" * 55)
    for yr in sorted(by_year):
        bar = "█" * min(35, max(1, by_year[yr] * 35 // max_bar))
        L.info(f"  {yr:<8} {by_year[yr]:>10,}  {bar}")
    L.info("  " + "─" * 55)
    L.info(f"  {'TOTAL':<8} {total:>10,}")


# ─── CONSOLIDAÇÃO DO DATASET ─────────────────────────────────────────────────
def build_dataset(L):
    """
    Lê todos os JSON em RAW_DIR/YYYY/*.json e consolida num único
    dataset_all.jsonl (linha por registo) e dataset_all.csv.
    Deduplication global por record_id.
    """
    L.info("\n" + "=" * 65)
    L.info("CONSOLIDANDO DATASET ÚNICO")
    L.info("=" * 65)

    DATASET_FILE.parent.mkdir(parents=True, exist_ok=True)

    seen_ids:   set[str]  = set()
    all_records: list[dict] = []

    year_dirs = sorted(
        (d for d in RAW_DIR.iterdir() if d.is_dir() and not d.name.startswith("_")),
        key=lambda d: d.name,
    )

    for year_dir in year_dirs:
        try:
            yr = int(year_dir.name)
        except ValueError:
            continue

        files = sorted(year_dir.glob("*.json"))
        for fpath in files:
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
        L.info("Nenhum registo encontrado em disco.")
        return

    # ── JSONL ────────────────────────────────────────────────────────────────
    with DATASET_FILE.open("w", encoding="utf-8") as f:
        for rec in all_records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    L.info(f"  JSONL → {DATASET_FILE}  ({len(all_records):,} registos)")

    # ── CSV ──────────────────────────────────────────────────────────────────
    FIELDS = [
        "record_id", "year", "title", "company", "location",
        "date_posted", "original_url", "wayback_url",
        "arquivo_timestamp", "source", "scraped_at_utc",
    ]
    with DATASET_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_records)
    L.info(f"  CSV  → {DATASET_CSV}  ({len(all_records):,} registos)")

    # ── Resumo por ano ───────────────────────────────────────────────────────
    by_yr: dict[int, int] = defaultdict(int)
    for rec in all_records:
        by_yr[rec.get("year", 0)] += 1
    L.info("\n  Registos únicos por ano:")
    for yr in sorted(by_yr):
        bar = "█" * min(40, max(1, by_yr[yr] * 40 // max(by_yr.values())))
        L.info(f"    {yr:<6} {by_yr[yr]:>7,}  {bar}")
    L.info(f"\n  TOTAL ÚNICO: {len(all_records):,}")
    L.info("=" * 65)


# ─── CLI ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Salário de Vidro – Scraper Assíncrono (v12)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Sugestões para evitar 429 no Arquivo.pt:
  --max-rps 2 --concurrency 3   (conservador, quase sem 429)
  --max-rps 4 --concurrency 5   (default equilibrado)
  --max-rps 8 --concurrency 8   (agressivo – espere 429s)

Modo só-dataset (sem scraping):
  --dataset-only                (consolida ficheiros existentes)
        """,
    )
    parser.add_argument("--year-start",    type=int,   default=YEAR_START)
    parser.add_argument("--year-end",      type=int,   default=YEAR_END)
    parser.add_argument("--concurrency",   type=int,   default=5)
    parser.add_argument("--max-rps",       type=float, default=4.0)
    parser.add_argument("--delay",         type=float, default=0.3)
    parser.add_argument("--reset",         action="store_true",
                        help="Limpar checkpoint e recomeçar do zero")
    parser.add_argument("--dataset-only",  action="store_true",
                        help="Não faz scraping – apenas consolida o dataset em disco")
    parser.add_argument("--no-dataset",    action="store_true",
                        help="Não consolidar dataset no fim")
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)

    L   = setup_logging()
    dbg = DebugStats(started_at=datetime.now(timezone.utc).isoformat())

    # ── Modo dataset-only ────────────────────────────────────────────────────
    if args.dataset_only:
        build_dataset(L)
        return

    if args.reset and CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()
        L.info("[RESET] Checkpoint removido.")

    cp    = load_cp(L)
    years = list(range(args.year_start, args.year_end + 1))
    L.info(f"Anos: {years[0]}–{years[-1]} | rps={args.max_rps} | conc={args.concurrency}")

    headers = {"User-Agent": "SalarioDeVidro/12.0 (academic research)"}

    async def _run():
        connector = aiohttp.TCPConnector(
            limit=args.concurrency * 4,
            ttl_dns_cache=300,
            ssl=False,
        )
        async with aiohttp.ClientSession(
            connector=connector, headers=headers,
        ) as session:
            try:
                await run_discovery(
                    session, cp, L, dbg, years,
                    concurrency=args.concurrency,
                    delay=args.delay,
                    max_rps=args.max_rps,
                )
                run_stats(L)
                if not args.no_dataset:
                    build_dataset(L)
            except asyncio.CancelledError:
                L.warning("Cancelado – a fechar tasks...")
            finally:
                tasks = [t for t in asyncio.all_tasks()
                         if t is not asyncio.current_task()]
                for t in tasks:
                    t.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                dbg.finished_at  = datetime.now(timezone.utc).isoformat()
                dbg.total_saved  = cp.total_saved
                print_debug_report(dbg, L)
                save_cp(cp)

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        L.warning("\nInterrompido pelo utilizador.")
        sys.exit(0)


if __name__ == "__main__":
    main()
