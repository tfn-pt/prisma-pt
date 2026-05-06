#!/usr/bin/env python3
"""clean.py

Pipeline único de enriquecimento para net-empregos + neoexpresso.

  Phase 1 — Deterministic: regex sobre título → gender, internship, remote,
             part-time, seniority, job_category, location, company.
  Phase 2 — LLM Dual-Engine: Google Gemini (primário) + SambaNova fallback
             para linhas ainda ambíguas (Outros / company ou location em
             falta). Checkpoint JSON para retomar sem repetir.
  Phase 3 — Concat: netempregos + neoexpresso → data/dataset_final.csv,
             com coluna source a identificar a origem de cada registo.

Uso:
  python clean.py
"""

from __future__ import annotations

import json
import os
import re
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
import requests
from google import genai
from google.genai import types
from dotenv import load_dotenv
from tqdm import tqdm


# ── Paths ──────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR     = PROJECT_ROOT / "data"
ENV_FILE     = PROJECT_ROOT / ".env"

NET_INPUT   = DATA_DIR / "dataset_all.csv"
NEO_INPUT   = DATA_DIR / "neoexpresso" / "neoexpresso_all.csv"
CARGA_INPUT = DATA_DIR / "cargadetrabalhos" / "cargadetrabalhos_all.csv"
OUTPUT      = DATA_DIR / "dataset_final.csv"
PRE_CLEAN   = DATA_DIR / "dataset_pre_clean.csv"
REJECTED    = DATA_DIR / "rejected_titles.csv"
CHECKPOINT  = DATA_DIR / "llm_checkpoint.json"
CUSTOM_CATS = DATA_DIR / "custom_categories.json"


# ── Categorias ─────────────────────────────────────────────────────────────────
ALLOWED_CATEGORIES: list[str] = [
    "IT",
    "Saúde",
    "Restauração & Hotelaria",
    "Vendas & Comercial",
    "Logística & Armazém",
    "Construção & Obras",
    "Engenharia",
    "Finanças & Contab.",
    "Educação & Formação",
    "Administrativo",
    "Beleza & Estética",
    "Segurança",
    "Marketing & Comunicação",
    "Recursos Humanos",
    "Jurídico & Legal",
    "Design & Criativo",
    "Imobiliário",
    "Outros",
]

# Categorias built-in originais — usado para distinguir das descobertas pelo LLM
_BUILTIN_CATEGORIES: frozenset[str] = frozenset(ALLOWED_CATEGORIES)

# Mapa de consolidação: categorias redundantes/sobrepostas → canónica.
# Qualquer categoria (nova ou existente) que aqui figure será fundida na canónica.
# Adicionar aqui sempre que o LLM inventar um alias de algo que já existe.
CATEGORY_ALIAS_MAP: dict[str, str] = {
    # Hotelaria e turismo — cobertos por "Restauração & Hotelaria"
    "Hotelaria":               "Restauração & Hotelaria",
    "Hospitalidade & Turismo": "Restauração & Hotelaria",
    "Turismo":                 "Restauração & Hotelaria",
    # Finanças — cobertos por "Finanças & Contab."
    "Banca":                   "Finanças & Contab.",
    "Bancos & Finanças":       "Finanças & Contab.",
    # Administrativo — coberto por "Administrativo"
    "Administração":           "Administrativo",
    "Liderança":               "Administrativo",
    "Project Manager":         "Administrativo",
    # Comunicação — coberta por "Marketing & Comunicação"
    "Comunicação":             "Marketing & Comunicação",
    "Audiovisual & Multimédia":"Marketing & Comunicação",
    # Educação — coberta por "Educação & Formação"
    "Formação":                "Educação & Formação",
    "Investigação":            "Educação & Formação",
    # Recursos Humanos — coberto por "Recursos Humanos"
    "Recrutamento":            "Recursos Humanos",
    # Ambiente — coberto por "Agricultura & Ambiente"
    "Ambiente":                "Agricultura & Ambiente",
    # Saúde — coberto por "Saúde"
    "Farmacêutica":            "Saúde",
    # Transversal / sem domínio claro → Outros
    "Estágio":                 "Outros",
    "Relações Internacionais": "Outros",
    "Artes & Artesanato":      "Outros",
}


def load_custom_categories() -> None:
    """Carrega categorias descobertas em runs anteriores e insere antes de 'Outros'."""
    if not CUSTOM_CATS.exists():
        return
    try:
        custom: list[str] = json.loads(CUSTOM_CATS.read_text(encoding="utf-8"))
        added = []
        for cat in custom:
            if not isinstance(cat, str):
                continue
            # Alias → já coberta por outra categoria, ignorar
            canonical = CATEGORY_ALIAS_MAP.get(cat)
            if canonical:
                continue
            if cat not in ALLOWED_CATEGORIES:
                ALLOWED_CATEGORIES.insert(-1, cat)   # antes de "Outros"
                added.append(cat)
        if added:
            print(f"[CATEGORIES] {len(added)} categorias personalizadas carregadas: "
                  f"{', '.join(added)}")
    except Exception as e:
        print(f"[CATEGORIES] Erro ao carregar {CUSTOM_CATS}: {e}")


def save_custom_categories() -> None:
    """Persiste categorias novas (não built-in, não aliased) para o próximo run."""
    custom = [c for c in ALLOWED_CATEGORIES
              if c not in _BUILTIN_CATEGORIES
              and c != "Outros"
              and c not in CATEGORY_ALIAS_MAP]
    CUSTOM_CATS.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_CATS.write_text(
        json.dumps(custom, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if custom:
        print(f"[CATEGORIES] {len(custom)} categorias guardadas em {CUSTOM_CATS}: "
              f"{', '.join(custom)}")


def consolidate_categories(df: pd.DataFrame) -> pd.DataFrame:
    """Aplica CATEGORY_ALIAS_MAP ao dataframe para fundir categorias redundantes."""
    before = df["job_category"].nunique()
    df = df.copy()
    df["job_category"] = df["job_category"].map(
        lambda x: CATEGORY_ALIAS_MAP.get(x, x)
    )
    after = df["job_category"].nunique()
    merged = before - after
    if merged:
        print(f"[CONSOLIDATE] {merged} categorias redundantes fundidas → {after} categorias únicas.")
    return df

# Regex determinísticos — ordem importa, primeiro match ganha.
CATEGORIES: list[tuple[str, str]] = [
    ("IT",
     r"\b(programador|developer|devops|sysadmin|sql|java|python|\.net|php|"
     r"javascript|typescript|react|angular|vue|node\.?js|software|infra|"
     r"redes|network|cloud|data.?base|machine.learning|deep.learning|"
     r"ia\b|ai\b|backend|frontend|fullstack|scrum|agile|qa\b|tester|"
     r"it\s|tech\b|noc\b|ciberseguran[cç]a|cybersecurity|erp|sap|"
     r"salesforce|outsystems|liferay|sharepoint|wordpress|linux|"
     r"windows.server|suporte.inform[aá]tico|helpdesk|sistemas|"
     r"analista.de.sistemas|arquiteto.de.software|ux\b|ui\b)\b"),
    ("Saúde",
     r"\b(enfermeir[oa]|m[eé]dic[oa]|farmac[eê]utic[oa]|"
     r"t[eé]cnico.de.sa[uú]de|auxiliar.de.sa[uú]de|fisioterapeuta|"
     r"nutricionista|psic[oó]log[oa]|cuidador|cuidados.continuados|"
     r"cl[ií]nica|hospital|optometrista|terapeuta|ortoptista|"
     r"radiologista|imagiologia|laborat[oó]rio.cl[ií]nico)\b"),
    ("Restauração & Hotelaria",
     r"\b(empregad[oa].de.mesa|cozinheir[oa]|chef|barista|barman|"
     r"bartender|hotel|hotelaria|rececionista|recepcionista|restaurante|"
     r"restaura[cç][aã]o|turismo|housekeeping|f&b|food.and.beverage)\b"),
    ("Vendas & Comercial",
     r"\b(comercial|vendas|sales\b|account.manager|key.account|"
     r"gestor.de.conta|representante.comercial|promotor|loja|retalho|"
     r"call.center|telemarketing|business.development|distribuidor)\b"),
    ("Marketing & Comunicação",
     r"\b(marketing|comunica[cç][aã]o|social.media|community.manager|"
     r"seo\b|sem\b|copywriter|content.manager|conte[uú]do|"
     r"rela[cç][oõ]es.p[uú]blicas|\brp\b|publicidade|branding|"
     r"growth.hacker|digital.marketing|e.?mail.marketing|newsletter|"
     r"campanhas|media.buyer)\b"),
    ("Recursos Humanos",
     r"\b(recursos.humanos|\brh\b|\bhr\b|recrutamento|recruiter|"
     r"talent.acquisition|people.manager|hrbp|gest[aã]o.de.pessoas|"
     r"payroll|processamento.salarial|forma[cç][aã]o.e.desenvolvimento|"
     r"\bl&d\b|onboarding|employer.branding)\b"),
    ("Jurídico & Legal",
     r"\b(advogad[oa]|jurista|legal\b|jur[ií]dic[oa]|solicitador|"
     r"not[aá]rio|compliance|gdpr|rgpd|direito|contencioso|paralegal|"
     r"assessor.jur[ií]dico)\b"),
    ("Design & Criativo",
     r"\b(designer|design.gr[aá]fico|motion.designer|illustrator|"
     r"photoshop|figma|sketch|adobe|criativ[oa]|art.director|"
     r"diretor.de.arte|produ[cç][aã]o.audiovisual|fot[oó]grafo|"
     r"anima[cç][aã]o|3d.artist|arquiteto.de.interiores)\b"),
    ("Imobiliário",
     r"\b(imobili[aá]ri[oa]|mediador.imobili[aá]rio|"
     r"consultor.imobili[aá]rio|angariador|arrendamento|"
     r"gest[aã]o.de.condom[ií]nio|property.manager|real.estate)\b"),
    ("Logística & Armazém",
     r"\b(log[ií]stica|armaz[eé]m|operador.de.armaz[eé]m|empilhador|"
     r"distribui[cç][aã]o|motorista|entregas|expedi[cç][aã]o|"
     r"supply.chain|procurement|compras)\b"),
    ("Construção & Obras",
     r"\b(constru[cç][aã]o|obras|pedreiro|serralheir[oa]|canalizador|"
     r"eletricista|electricista|carpinteir[oa]|pintor|trolha|"
     r"top[oó]grafo|medidor.or[cç]amentista)\b"),
    ("Engenharia",
     r"\b(engenheir[oa]|engineering|mec[aâ]nic[oa]|electrot[eé]cnic[oa]|"
     r"eletrot[eé]cnic[oa]|civil\b|industrial\b|qualidade|processos|"
     r"manuten[cç][aã]o.industrial|instrumenta[cç][aã]o|automa[cç][aã]o)\b"),
    ("Finanças & Contab.",
     r"\b(contabilist[ao]|contabilidade|financeir[ao]|finan[cç]as|"
     r"tesouraria|auditor|fiscal\b|controller|controlling|\bcfo\b|"
     r"fundo\b|investimento|banco|banca|seguros|actuar)\b"),
    ("Educação & Formação",
     r"\b(professor|formador|formadora|educa[cç][aã]o|forma[cç][aã]o|"
     r"explicador|instrutor|coordenador.pedag[oó]gico|"
     r"diretor.de.escola|docente)\b"),
    ("Administrativo",
     r"\b(administrativ[oa]|secret[aá]ri[ao]|assistente.administrativo|"
     r"rece[cç][aã]o|backoffice|front.?office|apoio.ao.cliente|"
     r"atendimento|fatura[cç][aã]o)\b"),
    ("Beleza & Estética",
     r"\b(cabeleireir[oa]|esteticista|manicure|t[eé]cnico.de.est[eé]tica|"
     r"\bspa\b|estetica|beauty|depila[cç][aã]o|tatuador)\b"),
    ("Segurança",
     r"\b(vigilante|seguran[cç]a\b|security.guard|porteiro|rondista|"
     r"guarda.noturno)\b"),
    ("Outros", r".*"),
]


# ── Normalização ───────────────────────────────────────────────────────────────
def _norm(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.lower())
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def parse_timestamp(ts: Any) -> str | None:
    try:
        s = str(int(ts))
    except Exception:
        return None
    if len(s) >= 8:
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return None


# ── Regex flags ────────────────────────────────────────────────────────────────
GENDER_RE     = re.compile(r"\([MmFf]/[MmFf]\)", re.IGNORECASE)
INTERNSHIP_RE = re.compile(
    r"\b(?:est[aá]gio|trainee|internship|estagi[aá]ri[oa]|est[aá]gios)\b", re.I)
REMOTE_RE     = re.compile(
    r"\b(?:remoto|remote|teletrabalho|teletrabalhador|work.from.home|wfh)\b", re.I)
PARTTIME_RE   = re.compile(
    r"\b(?:part.time|part time|meio.tempo|parcial|tempo parcial|horas?\s+semanais)\b", re.I)

SENIORITY_PATTERNS = [
    ("director", r"\b(diretor|diretora|director|directora|head of|chief|cto|cfo|ceo|coo)\b"),
    ("manager",  r"\b(manager|gestor|gestora|gerente|coordenador|coordenadora|respons[aá]vel|supervisor|supervisora)\b"),
    ("lead",     r"\b(lead|l[ií]der|team leader|tech lead|scrum master)\b"),
    ("senior",   r"\b(senior|s[eé]nior|sr\.?\s|pleno)\b"),
    ("junior",   r"\b(junior|j[uú]nior|jr\.?\s|est[aá]gio|trainee|internship|entry.level|rec[eé]m.licenciado)\b"),
]


def classify_seniority(title: Any) -> str:
    if not isinstance(title, str):
        return "na"
    t = title.lower()
    for label, pattern in SENIORITY_PATTERNS:
        if re.search(pattern, t, re.I):
            return label
    return "mid"


def classify_category(title: Any) -> str:
    if not isinstance(title, str):
        return "Outros"
    for label, pattern in CATEGORIES:
        if re.search(pattern, title, re.I):
            return label
    return "Outros"


# ── Location ───────────────────────────────────────────────────────────────────
LOCATION_BLACKLIST = {
    "part time", "part-time", "m/f", "f/m", "full time", "fulltime",
    "urgente", "imediato", "varios", "varias", "disponiveis", "disponivel",
    "oportunidade", "excelente", "horario", "turnos", "noturno", "remoto",
    "teletrabalho", "junior", "senior", "lead", "head",
    "the netherlands", "netherlands", "espana", "france", "uk", "london",
    "luxemburgo", "angola", "mocambique", "brasil", "suica", "alemanha",
    "holanda", "belgica",
}

PT_LOCATIONS = [
    "Lisboa", "Porto", "Braga", "Coimbra", "Setúbal", "Aveiro", "Faro",
    "Leiria", "Santarém", "Viseu", "Évora", "Guarda", "Bragança",
    "Castelo Branco", "Portalegre", "Viana do Castelo", "Vila Real", "Beja",
    "Funchal", "Ponta Delgada", "Sintra", "Cascais", "Almada", "Amadora",
    "Loures", "Odivelas", "Matosinhos", "Gaia",
]

PT_LOC_RE = re.compile(
    r"\b(" + "|".join(re.escape(c) for c in sorted(PT_LOCATIONS, key=len, reverse=False)) + r")\b",
    re.I,
)


def clean_location(loc: str | None) -> str | None:
    if not loc:
        return None
    loc = loc.strip(" -–/\\,()")
    loc = re.sub(r"\s+\d+h.*$", "", loc).strip()
    loc = re.sub(r"\s*\([MmFf]/[MmFf]\)", "", loc).strip()
    if not loc or len(loc) < 3:
        return None
    if _norm(loc) in LOCATION_BLACKLIST:
        return None
    if re.fullmatch(r"[\d\s\-]+", loc):
        return None
    return loc.title() if loc.isupper() else loc


def extract_location(title: Any) -> str | None:
    if not isinstance(title, str):
        return None
    m = re.search(r"[-–]\s*([A-ZÀ-Öa-zà-ö][A-ZÀ-Öa-zà-ö\s\./]{2,40})\s*$", title)
    if m:
        loc = clean_location(m.group(1).strip())
        if loc and PT_LOC_RE.search(loc):
            return loc
    m2 = re.search(
        r"\b(?:para|em|na|no|zona de|area de|regiao de)\s+(" +
        "|".join(re.escape(c) for c in sorted(PT_LOCATIONS, key=len, reverse=True)) + r")\b",
        title, re.I,
    )
    if m2:
        return m2.group(1).title()
    m3 = PT_LOC_RE.search(title)
    if m3:
        return m3.group(1).title()
    return None


# ── Company ────────────────────────────────────────────────────────────────────
COMPANY_BLACKLIST = LOCATION_BLACKLIST | {
    "urgente", "gestao", "comercial", "tecnico", "tecnica", "assistente",
    "consultor", "consultora", "engenheiro", "engenheira", "portugal",
    "portugues", "iberia", "iberica", "europa", "nacional", "internacional",
    "grupo", "empresa", "entidade", "organizacao", "cliente", "clientes",
    "projecto", "projeto", "area", "zona", "sector", "setor",
}


def extract_company(title: Any, location: str | None) -> str | None:
    if not isinstance(title, str):
        return None
    m = re.search(
        r"^([A-ZÀ-Ö][A-Za-zÀ-Öà-ö\s\-&\.,]{2,40}?)\s+"
        r"(?:está a recrutar|recruta|procura|admite|contrata|precisa de|precisa-se de)\b",
        title, re.I,
    )
    if m:
        c = m.group(1).strip()
        if _norm(c) not in COMPANY_BLACKLIST and len(c) >= 3:
            return c
    m2 = re.search(
        r"\b(?:para a?|na|no|com a?|grupo)\s+([A-ZÀ-Ö][A-Za-zÀ-Öà-ö\s\-&\.]{2,35})\s*$",
        title, re.I,
    )
    if m2:
        c = m2.group(1).strip()
        if _norm(c) not in COMPANY_BLACKLIST and _norm(c) != _norm(location or "") and len(c) >= 3:
            return c
    m3 = re.search(r"[-–]\s*([A-ZÀ-Öa-zà-ö][A-Za-zÀ-Öà-ö\s\-&\.]{2,35})\s*$", title)
    if m3:
        c = m3.group(1).strip()
        if (
            re.match(r"^[A-ZÀ-Ö]", c)
            and _norm(c) not in COMPANY_BLACKLIST
            and not PT_LOC_RE.search(c)
            and _norm(c) != _norm(location or "")
            and len(c) >= 3
        ):
            return c
    return None


# ── Filtro mínimo: só lixo óbvio ──────────────────────────────────────────────
# Apenas remove o que CLARAMENTE não é uma vaga e nunca deveria chegar ao LLM.
# Tudo o resto passa — o LLM trata de filtrar e categorizar.

# Strings de navegação exactas (normalized) que nunca são vagas
_NAV_EXACT = {
    "pesquisa avancada", "mapa do site", "pagina inicial", "todos os anuncios",
    "my portal", "termos de uso", "politica de privacidade", "faq", "sitemap",
    "sobre nos", "emprego e carreiras", "bolsa de emprego", "ofertas de emprego",
    "ver mais ofertas", "ver todas as ofertas", "login", "registo",
}

# Prefixos de URL que aparecem como título (scraper captou o href em vez do texto)
_URL_PREFIX_RE = re.compile(r"^https?://", re.I)

# Mobijake — plataforma que injeta a sua marca nos títulos
_MOBIJAKE_RE = re.compile(r"\s*[\-|]\s*mobijake\b.*$", re.I)


def _strip_noise(title: str) -> str:
    """Remove ruído de plataformas do título antes de avaliar."""
    title = _MOBIJAKE_RE.sub("", title).strip()
    return title


def is_job_title(title: Any) -> bool:
    """Devolve False APENAS para lixo óbvio que nunca é uma vaga."""
    if not isinstance(title, str):
        return False
    t = _strip_noise(title.strip())
    if len(t) < 4:
        return False                              # título demasiado curto
    if _URL_PREFIX_RE.match(t):
        return False                              # é um URL, não um título
    if _norm(t) in _NAV_EXACT:
        return False                              # navegação exacta
    return True


def filter_jobs(df: pd.DataFrame, source: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Separa vagas reais de ruído. Devolve (df_vagas, df_rejeitados)."""
    # Aplica strip do mobijake no próprio dataset antes de filtrar
    df = df.copy()
    df["title"] = df["title"].apply(
        lambda t: _strip_noise(t.strip()) if isinstance(t, str) else t
    )
    mask = df["title"].apply(is_job_title)
    n_rejected = (~mask).sum()
    if n_rejected:
        print(f"  [FILTER] {source}: {n_rejected:,} títulos rejeitados (lixo óbvio).")
    return df[mask].copy(), df[~mask].copy()


# ── Phase 1 ────────────────────────────────────────────────────────────────────
def phase1_deterministic(df: pd.DataFrame, source: str) -> pd.DataFrame:
    df = df.copy()
    df["source"]             = source
    df["date_archived"]      = df["arquivo_timestamp"].apply(parse_timestamp)
    df["gender_marker"]      = df["title"].astype(str).str.contains(GENDER_RE, na=False)
    df["is_internship"]      = df["title"].astype(str).str.contains(INTERNSHIP_RE, na=False)
    df["remote_hint"]        = df["title"].astype(str).str.contains(REMOTE_RE, na=False)
    df["part_time_hint"]     = df["title"].astype(str).str.contains(PARTTIME_RE, na=False)
    df["seniority"]          = df["title"].apply(classify_seniority)
    df["job_category"]       = df["title"].apply(classify_category)
    df["location_extracted"] = df["title"].apply(extract_location)
    df["company_extracted"]  = df.apply(
        lambda r: extract_company(r.get("title"), r.get("location_extracted")), axis=1
    )
    return df


# ── SambaNova Rotator ──────────────────────────────────────────────────────────
@dataclass
class SambaNovaRotator:
    """31 keys, ordem reversa (31 → 1). Roda em 429/402."""
    keys: list[str]
    idx:  int = 0

    @classmethod
    def from_env(cls) -> "SambaNovaRotator":
        keys: list[str] = []
        for i in range(1, 32):
            key = os.getenv(f"SAMBANOVA_API_KEY_{i}")
            if key and key.strip():
                keys.append(key.strip())
        if not keys:
            single = os.getenv("SAMBANOVA_API_KEY")
            if single and single.strip():
                keys.append(single.strip())
        if not keys:
            raise ValueError("Nenhuma SambaNova key encontrada no .env (SAMBANOVA_API_KEY_1..31).")
        print(f"[SambaNova] {len(keys)} keys carregadas.")
        return cls(keys=keys)

    def current(self) -> str:
        return self.keys[self.idx]

    def next_key(self) -> str:
        self.idx = (self.idx + 1) % len(self.keys)
        return self.current()


def _endpoint_from_base(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


def _extract_json_object(text: str) -> dict[str, Any] | None:
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else None
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not m:
        return None
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, dict) else None
    except Exception:
        return None


# ── Elite prompt ───────────────────────────────────────────────────────────────
# Nota: _CATS_STR é calculado dinamicamente em _build_prompt para incluir
# categorias novas descobertas pelo LLM em batches anteriores do mesmo run.

# Limiar de confiança abaixo do qual o fix NÃO é aplicado (configurável via .env)
CONFIDENCE_THRESHOLD = float(os.getenv("SAMBANOVA_CONFIDENCE_THRESHOLD", "0.75"))

# Limiar separado para categoria — pode ser mais baixo pois é menos crítico
# que empresa/localização e queremos reduzir "Outros" ao mínimo.
CATEGORY_CONFIDENCE_THRESHOLD = float(os.getenv("SAMBANOVA_CATEGORY_THRESHOLD", "0.65"))

_SYSTEM = (
    "You are a deterministic extraction engine. "
    "Return only a valid JSON object. No markdown. No prose. No code fences."
)


def _build_prompt(rows: list[dict[str, Any]]) -> str:
    _CATS_STR = " | ".join(ALLOWED_CATEGORIES)
    items = "\n".join(
        f"- id={r['record_id']} | title={r.get('title') or ''} | url={r.get('original_url') or ''}"
        for r in rows
    )
    return f"""\
<role>
You are a deterministic data extraction engine for Portuguese job advertisements.
You extract exactly three fields per listing, and for each field you report your
extraction confidence as a float in [0.0, 1.0].
You never hallucinate. You never add commentary. You never output prose.
</role>

<output_contract>
Return ONLY a JSON object.
  - Top-level keys: job IDs as strings (matching the id= values in <items>).
  - Each value is an object with exactly seven keys:
      "is_job"        → boolean (true if this is a genuine job listing)
      "company"       → string | null
      "company_conf"  → float 0.0–1.0
      "location"      → string | null
      "location_conf" → float 0.0–1.0
      "category"      → string (never null)
      "category_conf" → float 0.0–1.0
  - No extra keys. No markdown fences. No trailing text. No comments.
</output_contract>

<confidence_semantics>
Confidence reflects how certain you are that the extracted value is correct,
based ONLY on what is explicitly present in the title or URL.

  1.0  → Unambiguous. The value is stated verbatim (e.g. "Lisboa" in title).
  0.9  → Very likely correct. Strong contextual signal (e.g. company name clearly isolated).
  0.75 → Probable. Reasonable inference from available text.
  0.5  → Uncertain. Multiple plausible values or weak signal.
  0.0  → No signal at all. Value is null.

Rules:
  - null values MUST have confidence 0.0.
  - If you are guessing, confidence MUST be ≤ 0.5.
  - "Outros" as category MUST have confidence ≤ 0.6 (it is a fallback, not a conclusion).
  - Never inflate confidence to appear decisive. Honest low confidence is correct behaviour.
</confidence_semantics>

<fields>
is_job   → true if the title describes a genuine job offer. false if it is navigation,
           editorial content, a news headline, a section title, or any non-job content.
           When false, set company/location to null, category to "Outros", all confs to 0.0.
company  → Exact hiring company name from title or URL. null if unidentifiable.
           Ignore platform subdomains (e.g. empresa.net-empregos.com → ignore).
           Ignore generic words: Grupo, Empresa, Cliente, Portugal, Internacional.
location → Portuguese city or district only (e.g. Lisboa, Porto, Braga, Faro, Setúbal).
           null if absent, ambiguous, or foreign country.
category → MUST be exactly one value from <categories>, OR a new concise Portuguese
           job-domain name (max 4 words, Title Case) if none of the listed categories fit.
           Never null. Use "Outros" ONLY as a last resort when the listing is genuinely
           uncategorisable (e.g. "Colaborador Polivalente" with no further context).
           Pick the CLOSEST match before creating a new category; create a new category
           before defaulting to "Outros".
</fields>

<categories>
{_CATS_STR}

If none of these fit, you MAY propose a NEW category name in Portuguese (Title Case,
max 4 words). Examples of acceptable new categories: "Agricultura & Ambiente",
"Ciência & Investigação", "Serviços Domésticos", "Animação & Eventos".
Do NOT create a new category for something already covered above.
Do NOT create vague categories like "Serviços Gerais" — be specific.
</categories>

<rules>
1. Extract only what is explicitly present in title or URL — do not infer.
2. Noise words to ignore in all fields: M/F, Urgente, Part-time, Full-time,
   Sénior, Júnior, (m/f), Ref., nº.
3. If a URL slug contains a job description (e.g. /emprego/programador-java),
   use it only to disambiguate category — never as source for company/location.
4. Foreign locations (UK, France, Brasil, Angola…) → location = null, location_conf = 0.0.
5. category must never be null. Hierarchy: existing category > new specific category > "Outros".
6. New categories: only create if the job domain is clear, distinct, and NOT already covered
   by an existing category. Set category_conf >= 0.80 when proposing a new category.
   Keep the name concise and in Portuguese.
7. "Outros" MUST have category_conf <= 0.5. If you are assigning "Outros" with high confidence,
   reconsider — you should be creating a new category instead.
8. CRITICAL — do NOT create aliases or subcategories of existing ones. Specifically:
   - "Hotelaria", "Hospitalidade & Turismo", "Turismo" → use "Restauração & Hotelaria"
   - "Banca", "Bancos & Finanças" → use "Finanças & Contab."
   - "Administração", "Liderança", "Project Manager" → use "Administrativo"
   - "Comunicação", "Audiovisual & Multimédia" → use "Marketing & Comunicação"
   - "Formação", "Investigação" → use "Educação & Formação"
   - "Recrutamento" → use "Recursos Humanos"
   - "Ambiente" → use "Agricultura & Ambiente"
   - "Farmacêutica" → use "Saúde"
   - "Estágio", "Relações Internacionais" → use "Outros"
</rules>

<few_shot_examples>
id=1  | title=Programador Java Sénior - Novabase | url=.../programador-java-senior
→ {{"1": {{"company": "Novabase", "company_conf": 0.95, "location": null, "location_conf": 0.0, "category": "IT", "category_conf": 1.0}}}}

id=2  | title=Empregado de Mesa (M/F) - Porto | url=...
→ {{"2": {{"company": null, "company_conf": 0.0, "location": "Porto", "location_conf": 1.0, "category": "Restauração & Hotelaria", "category_conf": 1.0}}}}

id=3  | title=Gestor de Marketing Digital Urgente Lisboa | url=...
→ {{"3": {{"company": null, "company_conf": 0.0, "location": "Lisboa", "location_conf": 1.0, "category": "Marketing & Comunicação", "category_conf": 0.95}}}}

id=4  | title=Técnico de RH - Grupo Jerónimo Martins - Setúbal | url=...
→ {{"4": {{"company": "Grupo Jerónimo Martins", "company_conf": 0.95, "location": "Setúbal", "location_conf": 1.0, "category": "Recursos Humanos", "category_conf": 1.0}}}}

id=5  | title=Advogado Fiscalista (M/F) | url=...
→ {{"5": {{"company": null, "company_conf": 0.0, "location": null, "location_conf": 0.0, "category": "Jurídico & Legal", "category_conf": 0.95}}}}

id=6  | title=Colaborador Polivalente | url=...
→ {{"6": {{"company": null, "company_conf": 0.0, "location": null, "location_conf": 0.0, "category": "Outros", "category_conf": 0.45}}}}

id=7  | title=Motorista de Distribuição Porto | url=...
→ {{"7": {{"company": null, "company_conf": 0.0, "location": "Porto", "location_conf": 1.0, "category": "Logística & Armazém", "category_conf": 0.95}}}}

id=8  | title=Mediador Imobiliário - ERA - Braga | url=...
→ {{"8": {{"company": "ERA", "company_conf": 0.92, "location": "Braga", "location_conf": 1.0, "category": "Imobiliário", "category_conf": 1.0}}}}
</few_shot_examples>

<items>
{items}
</items>"""


# ── LLM batch — rotação simples, sem backoff ───────────────────────────────────
def sambanova_batch_correct(
    rotator: SambaNovaRotator,
    rows: list[dict[str, Any]],
    model: str,
    base_url: str,
    timeout_s: int = 60,
) -> dict[str, dict[str, str]]:
    """Chama SambaNova. Em 429/402 roda key imediatamente (sem backoff).
    Nunca crasha — devolve {} se todas as keys estiverem esgotadas."""
    endpoint = _endpoint_from_base(base_url)
    payload = {
        "model": model,
        "temperature": 0.01,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user",   "content": _build_prompt(rows)},
        ],
    }

    attempts = 0
    while attempts < len(rotator.keys):
        api_key = rotator.current()
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        try:
            resp = requests.post(endpoint, headers=headers, json=payload, timeout=timeout_s)
        except Exception as exc:
            print(f"[ERROR] Rede: {exc}. A saltar batch de {len(rows)} vagas.")
            return {}

        if resp.status_code in (402, 429):
            print(f"[WARN] SambaNova {resp.status_code} — a rodar key...")
            rotator.next_key()
            attempts += 1
            time.sleep(2)
            continue

        if resp.status_code >= 500:
            print(f"[ERROR] SambaNova {resp.status_code} — a saltar batch.")
            return {}

        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError as e:
            print(f"[ERROR] HTTP {e} — a saltar batch.")
            print(f"[DEBUG] API Response: {resp.text}")
            return {}

        data = resp.json()
        try:
            content = data["choices"][0]["message"]["content"] or ""
        except Exception:
            content = ""

        parsed = _extract_json_object(content)
        if not parsed:
            return {}

        out: dict[str, dict[str, Any]] = {}
        for rid, fix in parsed.items():
            if not isinstance(fix, dict):
                continue

            def _conf(key: str) -> float:
                """Parse confidence float safely, clamp to [0.0, 1.0]."""
                try:
                    return max(0.0, min(1.0, float(fix.get(key, 0.0))))
                except (TypeError, ValueError):
                    return 0.0

            company       = fix.get("company")
            company_conf  = _conf("company_conf")
            location      = fix.get("location")
            location_conf = _conf("location_conf")
            category      = fix.get("category")
            category_conf = _conf("category_conf")

            if category not in ALLOWED_CATEGORIES:
                # Verificar alias antes de aceitar como nova categoria
                aliased = CATEGORY_ALIAS_MAP.get(category)
                if aliased:
                    category      = aliased
                    # manter category_conf, a categoria de destino é válida
                elif (
                    isinstance(category, str)
                    and 3 <= len(category) <= 60
                    and category_conf >= CONFIDENCE_THRESHOLD
                    and category.lower() not in ("outros", "other", "n/a", "none", "null")
                    and not re.search(r"[{}\[\]\"'\\]", category)   # sem JSON escapado
                ):
                    # Aceitar e registar categoria nova
                    ALLOWED_CATEGORIES.insert(-1, category)          # antes de "Outros"
                    print(f"[NEW CAT] Nova categoria: '{category}' "
                          f"(conf={category_conf:.2f})")
                else:
                    category      = "Outros"
                    category_conf = 0.0

            out[str(rid)] = {
                "company":       company  if isinstance(company, str)  and company.strip()  else "",
                "company_conf":  company_conf,
                "location":      location if isinstance(location, str) and location.strip() else "",
                "location_conf": location_conf,
                "category":      category,
                "category_conf": category_conf,
            }
        return out

    print("[CRITICAL] Todas as keys SambaNova esgotadas — a saltar batch.")
    return {}


def dual_engine_batch_correct(
    google_client: genai.Client,
    rotator: SambaNovaRotator,
    rows: list[dict[str, Any]],
    google_model: str,
    sambanova_model: str,
    sambanova_base_url: str,
    timeout_s: int = 60,
) -> dict[str, dict[str, str]]:
    """Google primário com fallback automático para SambaNova."""
    try:
        resp = google_client.models.generate_content(
            model=google_model,
            contents=_build_prompt(rows),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.01,
            ),
        )
        content = (resp.text or "").strip()
        parsed = _extract_json_object(content)
        if not parsed:
            raise ValueError("Resposta Google sem JSON válido.")
        time.sleep(0.5)
        out: dict[str, dict[str, Any]] = {}
        for rid, fix in parsed.items():
            if not isinstance(fix, dict):
                continue

            def _conf(key: str) -> float:
                try:
                    return max(0.0, min(1.0, float(fix.get(key, 0.0))))
                except (TypeError, ValueError):
                    return 0.0

            company = fix.get("company")
            company_conf = _conf("company_conf")
            location = fix.get("location")
            location_conf = _conf("location_conf")
            category = fix.get("category")
            category_conf = _conf("category_conf")

            if category not in ALLOWED_CATEGORIES:
                aliased = CATEGORY_ALIAS_MAP.get(category)
                if aliased:
                    category = aliased
                elif (
                    isinstance(category, str)
                    and 3 <= len(category) <= 60
                    and category_conf >= CONFIDENCE_THRESHOLD
                    and category.lower() not in ("outros", "other", "n/a", "none", "null")
                    and not re.search(r"[{}\[\]\"'\\]", category)
                ):
                    ALLOWED_CATEGORIES.insert(-1, category)
                    print(f"[NEW CAT] Nova categoria: '{category}' (conf={category_conf:.2f})")
                else:
                    category = "Outros"
                    category_conf = 0.0

            out[str(rid)] = {
                "company": company if isinstance(company, str) and company.strip() else "",
                "company_conf": company_conf,
                "location": location if isinstance(location, str) and location.strip() else "",
                "location_conf": location_conf,
                "category": category,
                "category_conf": category_conf,
            }
        return out
    except Exception as exc:
        print(f"[WARN] Google falhou ({exc}). A acionar SambaNova...")
        return sambanova_batch_correct(
            rotator=rotator,
            rows=rows,
            model=sambanova_model,
            base_url=sambanova_base_url,
            timeout_s=timeout_s,
        )


def chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i: i + size]


# ── Checkpoint ─────────────────────────────────────────────────────────────────
def load_checkpoint() -> dict[str, dict[str, str]]:
    if CHECKPOINT.exists():
        try:
            data = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
            print(f"[CHECKPOINT] {len(data):,} record_ids já processados — a retomar.")
            return data
        except Exception as e:
            print(f"[CHECKPOINT] Erro ao ler: {e}. A começar do zero.")
    return {}


def save_checkpoint(fixes: dict[str, dict[str, str]]) -> None:
    CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINT.write_text(json.dumps(fixes, ensure_ascii=False), encoding="utf-8")


# ── Phase 2 ────────────────────────────────────────────────────────────────────
def phase2_llm(df: pd.DataFrame) -> pd.DataFrame:
    google_key = os.getenv("GOOGLE_KEY")
    if not google_key or not google_key.strip():
        raise ValueError("GOOGLE_KEY não encontrada no .env.")
    google_client = genai.Client(api_key=google_key.strip())
    google_model = os.getenv("GOOGLE_MODEL", "gemini-2.5-flash")

    rotator = SambaNovaRotator.from_env()
    sambanova_model = os.getenv("SAMBANOVA_MODEL", "Meta-Llama-3.3-70B-Instruct")
    sambanova_base_url = os.getenv("SAMBANOVA_BASE_URL", "https://api.sambanova.ai")
    batch_size = max(1, int(os.getenv("SAMBANOVA_BATCH_SIZE", "50")))

    mask = (
        df["company_extracted"].isna()
        | df["location_extracted"].isna()
        | (df["job_category"].fillna("Outros") == "Outros")
    )
    to_fix = df.loc[mask, ["record_id", "title", "original_url"]].copy()

    if len(to_fix) == 0:
        print("[LLM] Nenhuma linha ambígua — a saltar phase 2.")
        return df

    fixes = load_checkpoint()
    already = set(fixes.keys())
    pending = to_fix[~to_fix["record_id"].astype(str).isin(already)]
    print(f"[LLM] {len(pending):,} linhas a enriquecer ({len(already):,} já no checkpoint) | batch_size={batch_size}")

    batches = list(chunked(pending.to_dict(orient="records"), batch_size))
    for i, batch in enumerate(tqdm(batches, desc="LLM batches", unit="batch")):
        result = dual_engine_batch_correct(
            google_client=google_client,
            rotator=rotator,
            rows=batch,
            google_model=google_model,
            sambanova_model=sambanova_model,
            sambanova_base_url=sambanova_base_url,
        )
        fixes.update(result)
        if (i + 1) % 10 == 0:
            save_checkpoint(fixes)
            print(f"  [CHECKPOINT] {len(fixes):,} fixes guardados.")
        time.sleep(0.05)

    save_checkpoint(fixes)
    print(f"[LLM] Completo — {len(fixes):,} fixes.")
    print(f"[LLM] Limiares: company/location={CONFIDENCE_THRESHOLD:.2f} | "
          f"category={CATEGORY_CONFIDENCE_THRESHOLD:.2f} "
          f"(SAMBANOVA_CONFIDENCE_THRESHOLD / SAMBANOVA_CATEGORY_THRESHOLD no .env)")

    # Estatísticas de confiança
    all_cat_confs  = [v["category_conf"]  for v in fixes.values() if "category_conf"  in v]
    all_loc_confs  = [v["location_conf"]  for v in fixes.values() if "location_conf"  in v]
    all_comp_confs = [v["company_conf"]   for v in fixes.values() if "company_conf"   in v]
    if all_cat_confs:
        below = sum(1 for c in all_cat_confs if c < CONFIDENCE_THRESHOLD)
        print(f"  category : média={sum(all_cat_confs)/len(all_cat_confs):.2f} | "
              f"abaixo do limiar={below:,}/{len(all_cat_confs):,}")
    if all_loc_confs:
        below = sum(1 for c in all_loc_confs if c < CONFIDENCE_THRESHOLD)
        print(f"  location : média={sum(all_loc_confs)/len(all_loc_confs):.2f} | "
              f"abaixo do limiar={below:,}/{len(all_loc_confs):,}")
    if all_comp_confs:
        below = sum(1 for c in all_comp_confs if c < CONFIDENCE_THRESHOLD)
        print(f"  company  : média={sum(all_comp_confs)/len(all_comp_confs):.2f} | "
              f"abaixo do limiar={below:,}/{len(all_comp_confs):,}")

    thr      = CONFIDENCE_THRESHOLD
    cat_thr  = CATEGORY_CONFIDENCE_THRESHOLD

    def _merge(row: pd.Series) -> pd.Series:
        fix = fixes.get(str(row["record_id"]))
        if not fix:
            return row
        # company — só aplica se confiança >= limiar
        if (pd.isna(row.get("company_extracted"))
                and fix.get("company")
                and fix.get("company_conf", 0.0) >= thr):
            row["company_extracted"] = fix["company"]
        # location — só aplica se confiança >= limiar
        if (pd.isna(row.get("location_extracted"))
                and fix.get("location")
                and fix.get("location_conf", 0.0) >= thr):
            row["location_extracted"] = fix["location"]
        # category — usa limiar mais baixo para reduzir "Outros"
        if (row.get("job_category") == "Outros"
                and fix.get("category")
                and fix["category"] != "Outros"
                and fix.get("category_conf", 0.0) >= cat_thr):
            row["job_category"] = fix["category"]
        return row

    return df.apply(_merge, axis=1)


# ── Schema final ───────────────────────────────────────────────────────────────
FINAL_COLS = [
    "record_id", "year", "title", "company", "location", "date_posted",
    "original_url", "wayback_url", "arquivo_timestamp", "source",
    "scraped_at_utc", "date_archived", "gender_marker", "is_internship",
    "remote_hint", "part_time_hint", "seniority", "job_category",
    "location_extracted", "company_extracted",
]


def _align(df: pd.DataFrame) -> pd.DataFrame:
    for col in FINAL_COLS:
        if col not in df.columns:
            df[col] = None
    return df[FINAL_COLS]


# ── Main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    load_dotenv(ENV_FILE)
    load_custom_categories()   # ← categorias guardadas em runs anteriores

    frames: list[pd.DataFrame] = []
    rejected_frames: list[pd.DataFrame] = []

    # ── net-empregos ──────────────────────────────────────────────────────────
    if NET_INPUT.exists():
        net = pd.read_csv(NET_INPUT, low_memory=False)
        print(f"[INFO] netempregos : {len(net):,} vagas ({NET_INPUT})")
        net, rej_net = filter_jobs(net, "netempregos")
        rej_net["source"] = "netempregos"
        print(f"[INFO] netempregos : {len(net):,} vagas após filtro")
        net = phase1_deterministic(net, source="netempregos")
        frames.append(net)
        rejected_frames.append(rej_net)
    else:
        print(f"[WARN] {NET_INPUT} não encontrado — a saltar.")

    # ── neoexpresso ───────────────────────────────────────────────────────────
    if NEO_INPUT.exists():
        neo = pd.read_csv(NEO_INPUT, low_memory=False)
        print(f"[INFO] neoexpresso : {len(neo):,} vagas ({NEO_INPUT})")
        neo, rej_neo = filter_jobs(neo, "neoexpresso")
        rej_neo["source"] = "neoexpresso"
        print(f"[INFO] neoexpresso : {len(neo):,} vagas após filtro")
        neo = phase1_deterministic(neo, source="neoexpresso")
        frames.append(neo)
        rejected_frames.append(rej_neo)
    else:
        print(f"[WARN] {NEO_INPUT} não encontrado — a saltar.")

    # ── carga de trabalhos ───────────────────────────────────────────────────
    if CARGA_INPUT.exists():
        carga = pd.read_csv(CARGA_INPUT, low_memory=False)
        print(f"[INFO] cargadetrabalhos : {len(carga):,} vagas ({CARGA_INPUT})")
        carga, rej_carga = filter_jobs(carga, "cargadetrabalhos")
        rej_carga["source"] = "cargadetrabalhos"
        print(f"[INFO] cargadetrabalhos : {len(carga):,} vagas após filtro")
        carga = phase1_deterministic(carga, source="cargadetrabalhos")
        frames.append(carga)
        rejected_frames.append(rej_carga)
    else:
        print(f"[WARN] {CARGA_INPUT} não encontrado — a saltar.")

    if not frames:
        raise RuntimeError("Nenhum dataset encontrado. Verifica os paths.")

    # ── Guardar rejeitados ────────────────────────────────────────────────────
    if rejected_frames:
        rej_all = pd.concat(rejected_frames, ignore_index=True)
        REJECTED.parent.mkdir(parents=True, exist_ok=True)
        rej_all.to_csv(REJECTED, index=False, encoding="utf-8-sig")
        print(f"[INFO] {len(rej_all):,} títulos rejeitados → {REJECTED}")

    # ── Concat pré-LLM ────────────────────────────────────────────────────────
    df = pd.concat(frames, ignore_index=True)
    print(f"\n[INFO] Total combinado (pré-LLM): {len(df):,} vagas")

    dist1 = df["job_category"].value_counts()
    print("\n  Categorias (phase 1):")
    print(dist1.to_string())
    print(f"  → Outros: {dist1.get('Outros', 0) / len(df) * 100:.1f}% (LLM vai tentar reduzir)\n")

    # ── Guardar dataset pré-clean ─────────────────────────────────────────────
    PRE_CLEAN.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(PRE_CLEAN, index=False, encoding="utf-8-sig")
    print(f"[INFO] Dataset pré-clean guardado → {PRE_CLEAN}")

    # ── Phase 2 LLM ───────────────────────────────────────────────────────────
    print("[FASE 2] Enriquecimento LLM...")
    df = phase2_llm(df)
    save_custom_categories()   # ← persiste categorias novas descobertas

    # ── Consolidar categorias redundantes ────────────────────────────────────
    df = consolidate_categories(df)

    # ── Dedup por record_id ───────────────────────────────────────────────────
    before = len(df)
    df = df.drop_duplicates(subset=["record_id"], keep="first")
    if before != len(df):
        print(f"[DEDUP] Removidos {before - len(df):,} duplicados por record_id.")

    # ── Alinhar schema e guardar ──────────────────────────────────────────────
    df = _align(df)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT, index=False, encoding="utf-8-sig")

    net_n = (df["source"] == "netempregos").sum()
    neo_n = (df["source"] == "neoexpresso").sum()
    carga_n = (df["source"] == "cargadetrabalhos").sum()
    print(f"\n[OK] → {OUTPUT}")
    print(
        f"      Total: {len(df):,} | netempregos: {net_n:,} | "
        f"neoexpresso: {neo_n:,} | cargadetrabalhos: {carga_n:,}"
    )
    print("\n  Categorias (final):")
    print(df["job_category"].value_counts().to_string())
    print("\n  Por fonte:")
    print(df["source"].value_counts().to_string())


if __name__ == "__main__":
    main()
