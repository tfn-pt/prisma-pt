#!/usr/bin/env python3
"""
Carga de Trabalhos – Scraper Assíncrono via Arquivo.pt (Corrigido)
==========================================================
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

# ─── PATHS ──────────────────────────────────────────────────────────────────
PROJECT_ROOT    = Path(__file__).resolve().parents[2]
DATA_DIR        = PROJECT_ROOT / "data"

RAW_DIR         = DATA_DIR / "cargadetrabalhos" / "raw"
STATE_DIR       = RAW_DIR / "_state"
CHECKPOINT_FILE = STATE_DIR / "checkpoint_carga.json"
DATASET_CSV     = DATA_DIR / "cargadetrabalhos" / "cargadetrabalhos_all.csv"

# ─── CONSTANTES ─────────────────────────────────────────────────────────────
CDX_ENDPOINT     = "https://arquivo.pt/wayback/cdx"
NOFRAME_BASE     = "https://arquivo.pt/noFrame/replay"
TARGET_DOMAIN    = "cargadetrabalhos.net"
YEAR_START       = 2005
YEAR_END         = 2024
PAGE_BATCH       = 3       
MIN_GAP_DAYS     = 14      

CDX_SEEDS = [
    (f"{TARGET_DOMAIN}/", f"http://www.{TARGET_DOMAIN}/"),
    (f"www.{TARGET_DOMAIN}/", f"https://www.{TARGET_DOMAIN}/"),
]

TIMEOUT_LISTING = aiohttp.ClientTimeout(total=25)

# ─── PADRÕES DE URL WORDPRESS CORRIGIDOS ────────────────────────────────────
# Agora aceita mais formatos de URL, incluindo links mais antigos.
_RE_JOB = re.compile(
    r"(?:https?://)?(?:www\.)?cargadetrabalhos\.net/(?:\d{4}/\d{2}/\d{2}/)?([a-z0-9\-]{5,})/?$",
    re.I,
)
_RE_NOISE = re.compile(r"\.(css|js|gif|jpg|jpeg|png|ico|swf|pdf|xml|rss)(\?|$)", re.I)
_RE_NAV   = re.compile(r"/(page|category|tag|author|contatos|sobre-nos|feed|comments|author)/|\?p=", re.I)

def canonical_job_url(href: str) -> Optional[str]:
    url = href.strip()
    m_replay = re.search(r"/(?:noFrame/replay|wayback)/\d{14}[a-z_]*/(https?://.+)", url, re.I)
    if m_replay:
        url = m_replay.group(1)
        
    if _RE_NOISE.search(url) or _RE_NAV.search(url):
        return None
        
    if _RE_JOB.search(url):
        return url
    return None

# ─── PARSER WORDPRESS CORRIGIDO ─────────────────────────────────────────────
def parse_listing_page(html_bytes: bytes, year_ts: str, year: int, page_wayback_url: str) -> list[dict]:
    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
    except Exception:
        return []

    jobs: dict[str, dict] = {}
    now = datetime.now(timezone.utc).isoformat()

    # ESTRATÉGIA A: Tentar blocos de artigos (Moderno)
    containers = soup.select("article.post, div.post, div.type-post, div.entry")
    
    # ESTRATÉGIA B: Fallback para todos os h2/h3 que tenham links (Antigo)
    if not containers:
        containers = soup.find_all(['h2', 'h3'])

    for container in containers:
        # Se for um article/div, procura o h1/h2/h3 lá dentro. Se for já um H2/H3, usa-o.
        title_tag = container.select_one("a[rel='bookmark'], .entry-title a, h2 a, h1 a, h3 a") if container.name not in ['h2', 'h3'] else container.find('a')
        
        if not title_tag:
            continue
            
        href = title_tag.get("href", "").strip()
        canon = canonical_job_url(href)
        
        if not canon or canon in jobs:
            continue

        title = title_tag.get_text(strip=True)
        # Títulos demasiado curtos ou de navegação são lixo
        if len(title) < 8 or "Leia mais" in title or "Ler mais" in title or "Página" in title:
            continue
            
        date_p = ""
        # Tenta apanhar a data se possível
        if container.name not in ['h2', 'h3']:
            date_tag = container.select_one(".published, .entry-date, time, .date")
            date_p = date_tag.get_text(strip=True) if date_tag else ""

        rid = hashlib.sha256(canon.encode()).hexdigest()[:16]
        jobs[canon] = {
            "record_id":          rid,
            "original_url":       canon,
            "wayback_url":        page_wayback_url,
            "arquivo_timestamp":  year_ts,
            "year":               year,
            "title":              title,
            "company":            "",  
            "location":           "",  
            "date_posted":        date_p,
            "source":             "cargadetrabalhos",
            "scraped_at_utc":     now,
        }

    return list(jobs.values())

# ─── MÁQUINA ASSÍNCRONA & CHECKPOINTS ───────────────────────────────────────
class RateLimiter:
    def __init__(self, rps: float):
        self._interval = 1.0 / max(rps, 0.1)
        self._lock = asyncio.Lock()
        self._next_token = 0.0

    async def acquire(self):
        async with self._lock:
            now = asyncio.get_event_loop().time()
            wait = max(self._next_token - now, 0)
            if wait > 0:
                await asyncio.sleep(wait)
            self._next_token = asyncio.get_event_loop().time() + self._interval

@dataclass
class Checkpoint:
    years_done: list = field(default_factory=list)
    fetched_ids: list = field(default_factory=list)

def load_cp() -> Checkpoint:
    if CHECKPOINT_FILE.exists():
        return Checkpoint(**json.loads(CHECKPOINT_FILE.read_text(encoding="utf-8")))
    return Checkpoint()

def save_cp(cp: Checkpoint):
    CHECKPOINT_FILE.write_text(json.dumps(asdict(cp), ensure_ascii=False), encoding="utf-8")

async def get_timestamps(session, url_pattern: str) -> list[str]:
    params = {"url": url_pattern, "output": "json", "fl": "timestamp,statuscode", "filter": "statuscode:200"}
    try:
        async with session.get(CDX_ENDPOINT, params=params, timeout=60) as resp:
            if resp.status != 200: return []
            raw = await resp.text()
            return sorted([json.loads(line)[0] if isinstance(json.loads(line), list) else json.loads(line).get("timestamp") for line in raw.splitlines() if line.strip() and "timestamp" in line or "[" in line])
    except Exception:
        return []

def merge_timestamps(seed_results: list, y_start: int, y_end: int) -> dict:
    by_year_date = defaultdict(dict)
    for base_url, timestamps in seed_results:
        for ts in timestamps:
            y = int(ts[:4]) if len(ts) >= 4 else 0
            if y_start <= y <= y_end:
                by_year_date[y][ts[:8]] = (ts, base_url)
    return {y: sorted(by_year_date[y].values(), key=lambda p: p[0]) for y in sorted(by_year_date)}

async def fetch_page(session, url: str, rl: RateLimiter) -> Optional[bytes]:
    for attempt in range(3):
        await rl.acquire()
        try:
            async with session.get(url, timeout=TIMEOUT_LISTING, allow_redirects=True) as resp:
                if resp.status == 200: return await resp.read()
                if resp.status == 429: await asyncio.sleep(5)
        except Exception:
            await asyncio.sleep(1)
    return None

async def process_year(session, cp: Checkpoint, year: int, timestamps: list, rl: RateLimiter, pb_anos: tqdm):
    if year in cp.years_done:
        pb_anos.update(1)
        return

    last_dt = None
    saved_this_year = 0

    for ts, base_url in timestamps:
        dt = datetime.strptime(ts[:8], "%Y%m%d")
        if last_dt and (dt - last_dt).days < MIN_GAP_DAYS:
            continue

        page = 1
        empty_pages = 0
        
        while True:
            target = base_url if page == 1 else f"{base_url.rstrip('/')}/page/{page}/"
            url = f"{NOFRAME_BASE}/{ts}/{target}"
            
            body = await fetch_page(session, url, rl)
            if not body:
                break

            jobs = parse_listing_page(body, ts, year, url)
            if not jobs:
                empty_pages += 1
                if empty_pages >= 2: 
                    break
                page += 1
                continue
            
            empty_pages = 0
            for job in jobs:
                if job["record_id"] not in cp.fetched_ids:
                    d = RAW_DIR / str(year)
                    d.mkdir(parents=True, exist_ok=True)
                    (d / f"{ts}_{job['record_id']}.json").write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
                    
                    cp.fetched_ids.append(job["record_id"])
                    saved_this_year += 1
            
            last_dt = dt 
            page += 1

    cp.years_done.append(year)
    save_cp(cp)
    pb_anos.update(1)

def build_csv():
    records = []
    for d in sorted(RAW_DIR.iterdir()):
        if d.is_dir() and not d.name.startswith("_"):
            for f in d.glob("*.json"):
                try: records.append(json.loads(f.read_text(encoding="utf-8")))
                except: pass
                
    if not records: 
        print("\nERRO: O CSV não foi criado porque nenhum registo foi guardado.")
        return
    
    with DATASET_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(records[0].keys()), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)
    print(f"\nCSV Guardado: {DATASET_CSV} ({len(records)} registos)")

async def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    
    # FORÇA O RESET DO CHECKPOINT PARA REPETIR TUDO
    if CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()
        print("Checkpoint anterior apagado. A recomeçar do zero...")
    
    cp = load_cp()
    
    print("A analisar CDX (Arquivo.pt) para cargadetrabalhos.net...")
    async with aiohttp.ClientSession() as session:
        seed_results = []
        for pat, base in CDX_SEEDS:
            ts_list = await get_timestamps(session, pat)
            seed_results.append((base, ts_list))
            
        by_year = merge_timestamps(seed_results, YEAR_START, YEAR_END)
        rl = RateLimiter(rps=3.0)
        
        with tqdm(total=len(by_year), desc="Anos Processados") as pb_anos:
            for year in sorted(by_year):
                await process_year(session, cp, year, by_year[year], rl, pb_anos)

    build_csv()

if __name__ == "__main__":
    asyncio.run(main())
