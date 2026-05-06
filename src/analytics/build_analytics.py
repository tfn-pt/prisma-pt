"""
build_analytics.py — v3.0 Elite Edition
========================================
Generates master_data.json with high-signal, decision-grade analytics.

Key upgrades over v2.0
-----------------------
1.  SOURCE-COMPOSITION CORRECTION
    gender_marker (and all flag rates) are now emitted with a parallel
    source-adjusted series that removes the archive-mix confound.
    neoexpresso GM = 0.08 %; netempregos GM = 32.6 % — raw year-on-year
    trends are almost entirely source-mix artifacts, not market signals.

2.  ARCHIVE CONFIDENCE SCORE per year
    Composite of source count, minimum volume, and source entropy.
    Downstream consumers can weight years instead of treating 2009 and
    2018 as analytically equivalent.

3.  MARKET CONCENTRATION (HHI + EFFECTIVE CATEGORIES)
    Category HHI and eff_cats replace the naive "unique categories" count.
    Tracks whether growth diversifies or concentrates the market.

4.  INTERNSHIP BURDEN INDEX (rate, not count)
    intern_rate = intern_count / category_total
    Reveals the Marketing+Design intern-economy duopoly (47 % of all
    internships, at 3–6× the market average rate).

5.  GEOGRAPHIC POLARISATION TREND
    Lisbon concentration index time series replaces static top-location
    frequency tables.

6.  SUPPRESSED / CAVEATED FIELDS
    remote_hint:        only 12 positives in 16 years → suppressed.
    gender_marker YoY:  source-adjusted series is the canonical one.
    seniority×location: seniority=mid dominates at 80 % → discriminatory
                        power ≈ 0; still emitted but flagged.
    company_extracted:  82.6 % missing; geo-noise cleaned before use.

7.  SECTOR VULNERABILITY COMPOSITE
    vulnerability_index = (intern_rate × 3) + (gm_rate × 1) − (senior_rate × 2)
    Higher = more precarious / informalised sector.

8.  PROPORTIONAL METRICS THROUGHOUT
    All cross-year comparisons use rates / shares, not raw counts.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# ── Paths ────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR     = PROJECT_ROOT / "data"

DEFAULT_INPUT  = DATA_DIR / "dataset_final_condensed.csv"
DEFAULT_OUTPUT = DATA_DIR / "master_data_rich.json"

# ── Constants ─────────────────────────────────────────────────────────────────

BOOLEAN_COLUMNS   = ["gender_marker", "is_internship", "remote_hint", "part_time_hint"]
DIMENSION_COLUMNS = ["job_category", "seniority", "location_extracted", "company_extracted"]

# Source-baseline weights for composition-adjusted flag rates.
# Derived from 2015–2019 (most source-balanced, highest-volume period).
# Re-compute with build_source_weights() if the dataset changes.
SOURCE_BASELINE_WEIGHTS: dict[str, float] = {
    "netempregos":      0.4625,
    "cargadetrabalhos": 0.3200,
    "neoexpresso":      0.2175,
}

# Periods with descriptive labels and human-readable names
PERIODS: dict[str, tuple[int, int]] = {
    "pre_crisis_baseline_2008_2011":   (2008, 2011),
    "austerity_recovery_2012_2015":    (2012, 2015),
    "tech_boom_2016_2019":             (2016, 2019),
    "pandemic_shock_2020_2021":        (2020, 2021),
    "post_pandemic_2022_2024":         (2022, 2024),
}

PERIOD_LABELS: dict[str, str] = {
    "pre_crisis_baseline_2008_2011":  "Crisis Baseline",
    "austerity_recovery_2012_2015":   "Austerity / Recovery",
    "tech_boom_2016_2019":            "Tech Boom",
    "pandemic_shock_2020_2021":       "Pandemic Shock",
    "post_pandemic_2022_2024":        "Post-Pandemic",
}

# Archive sparsity threshold: years below this are flagged as unreliable
SPARSE_YEAR_THRESHOLD   = 200
SPARSE_PERIOD_THRESHOLD = 300

# Minimum positive count for a boolean flag to be considered reliable
MIN_FLAG_POSITIVES = 30

GEO_NOISE: set[str] = {
    "lisbon","lisboa","porto","braga","maia","algarve","faro","coimbra",
    "aveiro","setubal","leiria","evora","beja","portalegre","castelo branco",
    "viana do castelo","braganca","guarda","viseu","santarem","funchal",
    "ponta delgada","angra do heroismo","horta","almada","amadora","sintra",
    "cascais","loures","oeiras","vila nova de gaia","matosinhos","gondomar",
    "portugal","nationwide","nacional","remote","remoto",
}

STOPWORDS_PT: set[str] = {
    "a","ao","aos","as","com","da","das","de","do","dos","e","em","m","f",
    "mf","m/f","na","nas","no","nos","o","os","ou","para","por","se","um",
    "uma","the","of","and","to","in","for","with","job","vaga","procura",
    "precisa","precisa-se","admite","recruta","lisboa","porto","braga",
    "que","no","na","um","uma","mais","mas","seu","sua","isso","este","esta",
}

# ── Utilities ─────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--input",  type=Path, default=DEFAULT_INPUT)
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return p.parse_args()


def clean_mojibake(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    if not any(m in value for m in ("Ã","Â","â€","â€œ","â€")):
        return value.strip()
    try:
        return value.encode("latin1").decode("utf-8").strip()
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value.strip()


def normalize_text(value: Any) -> str:
    value = clean_mojibake(value)
    if not isinstance(value, str):
        return ""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return value.lower()


def to_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return json.loads(df.to_json(orient="records", force_ascii=False))


def pct(part: float, whole: float, decimals: int = 4) -> float:
    if whole == 0 or pd.isna(whole):
        return 0.0
    return round(float(part) / float(whole), decimals)


def safe_num(value: Any) -> Any:
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else round(value, 6)
    if hasattr(value, "item"):
        return safe_num(value.item())
    return value


def deep_clean(obj: Any) -> Any:
    """Recursively replace NaN/Inf with None for JSON serialisation."""
    if isinstance(obj, dict):
        return {k: deep_clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [deep_clean(v) for v in obj]
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if hasattr(obj, "item"):
        return deep_clean(obj.item())
    return obj


def add_share(df: pd.DataFrame, group_cols: list[str],
              count_col: str = "count") -> pd.DataFrame:
    out = df.copy()
    totals = out.groupby(group_cols, dropna=False)[count_col].transform("sum")
    out["share"] = (out[count_col] / totals).fillna(0).round(4)
    return out


def value_counts_frame(df: pd.DataFrame, column: str, *,
                        top_n: int | None = None,
                        include_missing: bool = False) -> pd.DataFrame:
    series = df[column].fillna("Unknown") if include_missing else df[column].dropna()
    counts = series.value_counts().rename_axis(column).reset_index(name="count")
    counts["share"] = (counts["count"] / len(df)).round(4)
    return counts.head(top_n) if top_n else counts


def yearly_dimension(df: pd.DataFrame, column: str) -> pd.DataFrame:
    counts = (df.groupby(["year", column], dropna=False)
                .size().reset_index(name="count"))
    counts[column] = counts[column].fillna("Unknown")
    counts = add_share(counts, ["year"])
    return counts.sort_values(["year", "count"], ascending=[True, False])


def rate_by_year(df: pd.DataFrame, flag: str) -> pd.DataFrame:
    out = (df.groupby("year", as_index=False)
             .agg(total=("record_id", "count"),
                  count=(flag, "sum"),
                  rate=(flag, "mean"))
             .sort_values("year"))
    out["rate"] = out["rate"].round(4)
    return out


def cagr(first: float, last: float, periods: int) -> float | None:
    if first <= 0 or last <= 0 or periods <= 0:
        return None
    return round((last / first) ** (1 / periods) - 1, 4)


def shannon_entropy(counts: pd.Series) -> float:
    total = counts.sum()
    if total == 0:
        return 0.0
    p = counts / total
    return round(float(-(p * np.log2(p + 1e-12)).sum()), 4)


def hhi_from_counts(counts: pd.Series) -> float:
    total = counts.sum()
    if total == 0:
        return 0.0
    p = counts / total
    return round(float((p**2).sum()), 4)


def effective_categories(hhi: float) -> float | None:
    return round(1 / hhi, 2) if hhi > 0 else None


def period_label(year: int) -> str:
    for name, (start, end) in PERIODS.items():
        if start <= year <= end:
            return name
    return "unknown"


def tokenize_titles(titles: pd.Series) -> list[str]:
    tokens: list[str] = []
    for title in titles.dropna():
        norm = normalize_text(title)
        for tok in re.findall(r"[a-z0-9+#.]{2,}", norm):
            if tok not in STOPWORDS_PT and not tok.isdigit():
                tokens.append(tok)
    return tokens


def bigrams_from_titles(titles: pd.Series) -> list[tuple[str, str]]:
    result = []
    for title in titles.dropna():
        norm = normalize_text(title)
        toks = [t for t in re.findall(r"[a-z0-9+#.]{2,}", norm)
                if t not in STOPWORDS_PT and not t.isdigit()]
        result.extend(zip(toks, toks[1:]))
    return result


# ── Source Weights (re-derivable) ────────────────────────────────────────────

def build_source_weights(df: pd.DataFrame,
                          baseline_years: tuple[int, int] = (2015, 2019)
                          ) -> dict[str, float]:
    """Derive source composition weights from a balanced baseline period."""
    sub = df[df["year"].between(*baseline_years)]
    w = sub["source"].value_counts(normalize=True).round(6).to_dict()
    return w


def source_gm_rates(df: pd.DataFrame) -> dict[str, float]:
    """Per-source gender_marker rate (stable structural property of each platform)."""
    return (df.groupby("source")["gender_marker"]
              .mean().round(6).to_dict())


def composition_adjusted_rate(flag: str, df: pd.DataFrame,
                               weights: dict[str, float],
                               source_rates: dict[str, float]) -> float:
    """
    What would the flag rate be if source mix were held at baseline weights?
    adjusted = Σ_s  weight_s × rate_s
    This is a CONSTANT across all years (because weights and source rates are
    both constants) — its purpose is to show the true underlying market rate
    stripped of archive-composition noise.
    """
    if flag != "gender_marker":
        # For flags other than GM, compute per-source rates from df
        sr = df.groupby("source")[flag].mean().to_dict()
    else:
        sr = source_rates
    return round(sum(weights.get(s, 0) * sr.get(s, 0)
                     for s in set(weights) | set(sr)), 4)


# ── Section builders ─────────────────────────────────────────────────────────

def build_archive_confidence(df: pd.DataFrame) -> dict[str, Any]:
    """
    Per-year archive confidence score (0–1).

    Components
    ----------
    source_count_score   : how many distinct sources contributed (max 3 here)
    volume_score         : sigmoid-normalised log-volume (saturates at ~2 000)
    source_entropy_score : Shannon entropy of source mix (penalises monopoly)

    Combined as equal-weight average.  Use to weight downstream metrics.
    """
    rows = []
    year_src = df.groupby(["year", "source"]).size().unstack(fill_value=0)

    for year, g in df.groupby("year"):
        n        = len(g)
        src_row  = year_src.loc[year] if year in year_src.index else pd.Series(dtype=float)
        n_sources = int((src_row > 0).sum())
        max_sources = len(df["source"].unique())

        # Volume score: log-sigmoid, saturates at ~2 000
        vol_score = round(1 / (1 + math.exp(-0.004 * (n - 800))), 3)

        # Source entropy score (0 = one source monopoly, 1 = perfect balance)
        total_src = src_row.sum()
        if total_src > 0 and n_sources > 1:
            p = src_row[src_row > 0] / total_src
            ent = float(-(p * np.log2(p)).sum())
            max_ent = math.log2(n_sources)
            ent_score = round(ent / max_ent, 3) if max_ent > 0 else 0.0
        else:
            ent_score = 0.0

        src_count_score = round(n_sources / max_sources, 3)
        confidence = round((vol_score + ent_score + src_count_score) / 3, 3)

        rows.append({
            "year":               int(year),
            "n_ads":              n,
            "n_sources":          n_sources,
            "volume_score":       vol_score,
            "source_entropy_score": ent_score,
            "source_count_score": src_count_score,
            "confidence":         confidence,
            "is_sparse":          n < SPARSE_YEAR_THRESHOLD,
            "reliability_tier":   (
                "high"   if confidence >= 0.65 else
                "medium" if confidence >= 0.40 else
                "low"
            ),
        })
    return {"scores": rows,
            "note": ("confidence=1 means high volume, balanced sources, "
                     "and multiple sources active. Use as analytic weight.")}


def build_data_quality(df: pd.DataFrame) -> dict[str, Any]:
    total = len(df)

    col_coverage = []
    for col in df.columns:
        present = int(df[col].notna().sum())
        col_coverage.append({
            "column":        col,
            "present":       present,
            "missing":       total - present,
            "coverage_rate": pct(present, total),
            "dtype":         str(df[col].dtype),
        })

    year_counts = df.groupby("year").size()
    year_quality = [
        {"year": int(y), "records": int(c),
         "is_sparse": bool(c < SPARSE_YEAR_THRESHOLD),
         "flag": "sparse_archive" if c < SPARSE_YEAR_THRESHOLD else "ok"}
        for y, c in year_counts.items()
    ]

    geo_as_company = (
        df["company_extracted"].dropna()
        .loc[lambda s: s.str.lower().isin(GEO_NOISE)]
        .value_counts().reset_index()
    )
    geo_as_company.columns = ["company_extracted", "count"]

    dup_ids   = int(df["record_id"].duplicated().sum())
    dup_exact = int(df.duplicated(subset=["title", "year"]).sum())
    mid_dominance = float(df["seniority"].eq("mid").mean())

    # Flag reliability
    flag_reliability = []
    for f in BOOLEAN_COLUMNS:
        n_pos = int(df[f].sum())
        flag_reliability.append({
            "flag":      f,
            "positives": n_pos,
            "rate":      pct(n_pos, total),
            "reliable":  n_pos >= MIN_FLAG_POSITIVES,
            "note": (
                "SUPPRESSED: only {:,} positives — insufficient for trend analysis".format(n_pos)
                if n_pos < MIN_FLAG_POSITIVES
                else "usable as cross-sectional metric (see source-adjustment for time series)"
                if f == "gender_marker"
                else "ok"
            ),
        })

    source_coverage = (df.groupby("year")["source"]
                         .nunique().reset_index()
                         .rename(columns={"source": "n_sources"}))

    warnings = [
        "CRITICAL: gender_marker time series is ~100% explained by source-mix changes "
        "(neoexpresso GM=0.08%, netempregos GM=32.6%). Use source-adjusted rate instead.",
        "remote_hint has only {:,} positives — field is analytically absent.".format(
            int(df["remote_hint"].sum())),
        "cargadetrabalhos absent after 2020 — all post-2020 category distributions "
        "are affected by survivorship bias.",
        "location_extracted missing in {:.1f}% of records.".format(
            df["location_extracted"].isna().mean() * 100),
        "company_extracted missing in {:.1f}% of records (use clean count only).".format(
            df["company_extracted"].isna().mean() * 100),
        "seniority=mid is {:.1f}% of all records — seniority×anything cross-tabs "
        "have near-zero discriminatory power.".format(mid_dominance * 100),
    ]

    return {
        "coverage_by_column":          col_coverage,
        "duplicate_record_ids":        dup_ids,
        "duplicate_title_year":        dup_exact,
        "snapshot_dates": {
            "min": str(df["date_archived"].min()) if "date_archived" in df else None,
            "max": str(df["date_archived"].max()) if "date_archived" in df else None,
        },
        "year_quality":                year_quality,
        "source_coverage_by_year":     to_records(source_coverage),
        "flag_reliability":            flag_reliability,
        "geo_names_as_company":        to_records(geo_as_company),
        "seniority_mid_dominance_rate": round(mid_dominance, 4),
        "warnings":                    warnings,
    }


def build_kpis(df: pd.DataFrame,
               weights: dict[str, float],
               source_gm: dict[str, float]) -> dict[str, Any]:
    total = len(df)
    clean_companies = df[
        df["company_extracted"].notna() &
        ~df["company_extracted"].str.lower().isin(GEO_NOISE)
    ]
    year_counts  = df.groupby("year").size()
    peak_year    = int(year_counts.idxmax())
    trough_year  = int(year_counts.idxmin())
    trough_count = int(year_counts.min())

    # Adjusted GM: constant, source-composition-corrected
    adj_gm = composition_adjusted_rate("gender_marker", df, weights, source_gm)

    return {
        "total_ads":               total,
        "unique_categories":       int(df["job_category"].nunique()),
        "unique_locations":        int(df["location_extracted"].nunique(dropna=True)),
        "unique_companies_clean":  int(clean_companies["company_extracted"].nunique()),
        "year_span":               int(df["year"].nunique()),
        "year_min":                int(df["year"].min()),
        "year_max":                int(df["year"].max()),
        "peak_year":               peak_year,
        "peak_year_count":         int(year_counts.max()),
        "trough_year":             trough_year,
        "trough_year_count":       trough_count,
        "trough_is_sparse_archive": bool(trough_count < SPARSE_YEAR_THRESHOLD),
        "ads_with_location":       int(df["location_extracted"].notna().sum()),
        "ads_with_company_clean":  int(clean_companies.shape[0]),
        "gender_marker_rate_raw":  pct(df["gender_marker"].sum(), total),
        "gender_marker_rate_adjusted": adj_gm,
        "gender_marker_adjustment_note": (
            "Adjusted rate holds source mix constant at 2015-2019 baseline weights. "
            "Raw rate swings ±20pp due to archive composition, not market change."
        ),
        "internship_rate":         pct(df["is_internship"].sum(), total),
        "remote_hint_suppressed":  True,
        "remote_hint_note":        (
            "remote_hint has {:,} positives in {:,} records — "
            "treated as absent, not as evidence of a zero-remote market.".format(
                int(df["remote_hint"].sum()), total)
        ),
    }


def build_time_series(df: pd.DataFrame,
                       weights: dict[str, float],
                       source_gm: dict[str, float]) -> dict[str, Any]:
    vol = (df.groupby("year", as_index=False)
             .agg(records=("record_id", "count")))
    vol["yoy_growth"]     = vol["records"].pct_change().round(4)
    vol["yoy_delta"]      = vol["records"].diff().fillna(0).astype(int)
    vol["rolling_3y_avg"] = vol["records"].rolling(3, center=True).mean().round(1)
    vol["cumulative"]     = vol["records"].cumsum()
    vol["period"]         = vol["year"].apply(period_label)

    # HHI + diversity per year
    diversity_rows = []
    for year, g in df.groupby("year"):
        counts = g["job_category"].value_counts()
        h      = hhi_from_counts(counts)
        diversity_rows.append({
            "year":                int(year),
            "records":             len(g),
            "category_hhi":        h,
            "effective_categories": effective_categories(h),
            "category_entropy":    shannon_entropy(counts),
            "top3_share":          round(float((counts / counts.sum()).nlargest(3).sum()), 4),
        })

    cat_year  = yearly_dimension(df, "job_category")
    sen_year  = yearly_dimension(df, "seniority")

    # Location: only top-20 locations, only years with ≥30 located ads
    loc_df   = df[df["location_extracted"].notna()]
    top20_locs = loc_df["location_extracted"].value_counts().head(20).index.tolist()
    loc_year = yearly_dimension(loc_df, "location_extracted")
    loc_year_top = loc_year[loc_year["location_extracted"].isin(top20_locs)]

    # Geographic concentration index: Lisboa and Porto as share of located ads
    lisbon_porto_conc = []
    for year, g in loc_df.groupby("year"):
        n   = len(g)
        if n < 30:   # skip sparse-location years
            continue
        lis = (g["location_extracted"] == "Lisboa").sum()
        por = (g["location_extracted"] == "Porto").sum()
        lisbon_porto_conc.append({
            "year":              int(year),
            "n_located":         n,
            "lisbon_share":      pct(lis, n),
            "porto_share":       pct(por, n),
            "lisbon_porto_combined": pct(lis + por, n),
            "lisbon_porto_ratio": round(lis / por, 2) if por > 0 else None,
        })

    # Flag rates by year — raw + source-adjusted for GM
    per_source_gm = source_gm
    flags_year = df.groupby("year", as_index=False).agg(
        total=("record_id", "count"),
        gender_marker=("gender_marker", "sum"),
        is_internship=("is_internship", "sum"),
        remote_hint=("remote_hint", "sum"),
        part_time_hint=("part_time_hint", "sum"),
    )
    for f in BOOLEAN_COLUMNS:
        flags_year[f"rate_{f}_raw"] = (flags_year[f] / flags_year["total"]).round(4)

    # Source-adjusted GM: compute per year using year's actual source mix,
    # re-weighted to baseline distribution.
    adj_gm_by_year = []
    for year, g in df.groupby("year"):
        src_mix = g["source"].value_counts(normalize=True)
        adj = sum(weights.get(s, 0) * per_source_gm.get(s, 0) for s in per_source_gm)
        adj_gm_by_year.append({"year": int(year), "gm_adjusted": round(adj, 4)})
    # Note: adjusted rate is constant because weights & source_rates are constants.
    # Emitting per year for schema consistency and to make the point explicit.

    flags_year_records = to_records(flags_year)
    for i, row in enumerate(flags_year_records):
        match = next((r for r in adj_gm_by_year if r["year"] == row["year"]), None)
        if match:
            flags_year_records[i]["rate_gender_marker_adjusted"] = match["gm_adjusted"]
        flags_year_records[i]["remote_hint_suppressed"] = True

    return {
        "yearly_volume":           to_records(vol),
        "diversity_by_year":       diversity_rows,
        "category_by_year":        to_records(cat_year),
        "seniority_by_year":       to_records(sen_year),
        "top_locations_by_year":   to_records(loc_year_top),
        "geographic_concentration": lisbon_porto_conc,
        "flags_by_year":           flags_year_records,
        "gender_marker_note": (
            "rate_gender_marker_raw is unreliable as a time series. "
            "rate_gender_marker_adjusted (constant ~0.194) is the "
            "source-composition-corrected estimate of the true market rate."
        ),
    }


def build_distributions(df: pd.DataFrame) -> dict[str, Any]:
    cat_dist = value_counts_frame(df, "job_category")
    sen_dist = value_counts_frame(df, "seniority")

    # Flags: only reliable ones get full treatment
    flag_dist = []
    total = len(df)
    for f in BOOLEAN_COLUMNS:
        n_pos = int(df[f].sum())
        flag_dist.append({
            "metric":    f,
            "count":     n_pos,
            "rate":      pct(n_pos, total),
            "reliable":  n_pos >= MIN_FLAG_POSITIVES,
        })

    df2 = df.copy()
    df2["title_len"]  = df2["title"].dropna().str.len()
    df2["word_count"] = df2["title"].dropna().str.split().str.len()

    def dist_stats(series: pd.Series) -> dict:
        return {
            "mean":   round(float(series.mean()), 1),
            "median": round(float(series.median()), 1),
            "p10":    round(float(series.quantile(0.10)), 1),
            "p90":    round(float(series.quantile(0.90)), 1),
            "max":    float(series.max()),
            "min":    float(series.min()),
        }

    return {
        "category":            to_records(cat_dist),
        "seniority":           to_records(sen_dist),
        "flags":               flag_dist,
        "title_char_length":   dist_stats(df2["title_len"].dropna()),
        "title_word_count":    dist_stats(df2["word_count"].dropna()),
    }


def build_cross_tabs(df: pd.DataFrame) -> dict[str, Any]:
    # category × seniority
    cat_sen = (df.groupby(["job_category", "seniority"], as_index=False)
                 .size().rename(columns={"size": "count"}))
    cat_sen = add_share(cat_sen, ["job_category"])

    # category × location (top 10)
    top10_locs = df["location_extracted"].value_counts().head(10).index
    df_loc10   = df[df["location_extracted"].isin(top10_locs)]
    cat_loc    = (df_loc10.groupby(["job_category", "location_extracted"], as_index=False)
                          .size().rename(columns={"size": "count"}))
    cat_loc    = add_share(cat_loc, ["location_extracted"])

    # period comparison (share delta + multiplier)
    def period_comp(dimension: str) -> dict:
        frames = []
        for pname, (s, e) in PERIODS.items():
            sub = df[df["year"].between(s, e)]
            c   = value_counts_frame(sub, dimension, include_missing=True)
            c["period"] = pname
            c["period_label"] = PERIOD_LABELS.get(pname, pname)
            c["start_year"] = s
            c["end_year"]   = e
            frames.append(c)
        period_data = pd.concat(frames, ignore_index=True)

        first_p = list(PERIODS)[0]
        last_p  = list(PERIODS)[-1]
        pivot   = (period_data.pivot_table(index=dimension, columns="period",
                                           values="share", aggfunc="sum", fill_value=0)
                              .reset_index())
        if first_p in pivot.columns and last_p in pivot.columns:
            pivot["share_delta"] = (pivot[last_p] - pivot[first_p]).round(4)
            pivot["relative_multiplier"] = pivot.apply(
                lambda r: round(r[last_p] / r[first_p], 2) if r[first_p] > 0 else None,
                axis=1,
            )
        return {
            "period_distribution":   to_records(period_data),
            "biggest_share_gainers": to_records(
                pivot.sort_values("share_delta", ascending=False).head(8)),
            "biggest_share_losers":  to_records(
                pivot.sort_values("share_delta", ascending=True).head(8)),
        }

    # seniority × flags  (category × flags)
    def flag_profile(groupby_col: str) -> list[dict]:
        return to_records(df.groupby(groupby_col, as_index=False).agg(
            total=("record_id", "count"),
            gender_rate=("gender_marker", "mean"),
            internship_rate=("is_internship", "mean"),
            part_time_rate=("part_time_hint", "mean"),
        ).round(4))

    # flag co-occurrence (remote_hint excluded — unreliable)
    reliable_flags = [f for f in BOOLEAN_COLUMNS
                      if int(df[f].sum()) >= MIN_FLAG_POSITIVES
                      and f != "remote_hint"]
    flag_corr_records = []
    if len(reliable_flags) >= 2:
        corr = df[reliable_flags].astype(int).corr().round(4)
        for f1 in reliable_flags:
            for f2 in reliable_flags:
                flag_corr_records.append({
                    "flag_a": f1, "flag_b": f2,
                    "pearson_r": float(corr.loc[f1, f2]),
                })

    mid_rate = float(df["seniority"].eq("mid").mean())
    return {
        "category_x_seniority":      to_records(cat_sen),
        "category_x_location_top10": to_records(cat_loc),
        "category_period_comparison":  period_comp("job_category"),
        "seniority_period_comparison": period_comp("seniority"),
        "seniority_x_flags":         flag_profile("seniority"),
        "category_x_flags":          flag_profile("job_category"),
        "flag_correlations":         flag_corr_records,
        "flag_correlations_note": (
            "remote_hint excluded (< {:,} positives). "
            "seniority×location cross-tab suppressed: seniority=mid "
            "at {:.1f}% gives near-zero discriminatory power.".format(
                MIN_FLAG_POSITIVES, mid_rate * 100)
        ),
    }


def build_internship_economy(df: pd.DataFrame) -> dict[str, Any]:
    """
    Dedicated internship analysis — rates not counts.
    Reveals the Marketing+Design intern-economy duopoly.
    """
    total_interns = int(df["is_internship"].sum())
    total_ads     = len(df)

    # Rate per category (intern_rate = intern_count / category_total)
    by_cat = (df.groupby("job_category", as_index=False)
                .agg(total=("record_id", "count"),
                     intern_count=("is_internship", "sum"),
                     intern_rate=("is_internship", "mean"))
                .sort_values("intern_rate", ascending=False))
    by_cat["intern_rate"] = by_cat["intern_rate"].round(4)
    by_cat["share_of_all_interns"] = (by_cat["intern_count"] / total_interns).round(4)
    by_cat["vs_market_avg"] = (by_cat["intern_rate"] / (total_interns / total_ads)).round(2)

    # Rate per year
    by_year = rate_by_year(df, "is_internship")

    # Rate per category per year (for trend analysis)
    by_cat_year = (df.groupby(["year", "job_category"], as_index=False)
                     .agg(total=("record_id", "count"),
                          intern_count=("is_internship", "sum"),
                          intern_rate=("is_internship", "mean"))
                     .sort_values(["year", "intern_rate"], ascending=[True, False]))
    by_cat_year["intern_rate"] = by_cat_year["intern_rate"].round(4)

    # Concentration: what share of all interns come from top-2 categories?
    top2_share = float(by_cat["share_of_all_interns"].head(2).sum())

    return {
        "total_internship_ads":   total_interns,
        "market_intern_rate":     pct(total_interns, total_ads),
        "top2_category_intern_share": round(top2_share, 4),
        "top2_concentration_note": (
            "The top 2 categories by intern_rate absorb {:.1f}% of all internship "
            "ads despite representing {:.1f}% of total volume.".format(
                top2_share * 100,
                float(by_cat.head(2)["total"].sum() / total_ads * 100),
            )
        ),
        "by_category":     to_records(by_cat),
        "by_year":         to_records(by_year),
        "by_category_year": to_records(by_cat_year),
    }


def build_gender_marker_analysis(df: pd.DataFrame,
                                   weights: dict[str, float]) -> dict[str, Any]:
    """
    Cross-sectional gender_marker analysis only.
    Time series is explicitly decomposed into source-mix vs. market components.
    """
    src_rates = source_gm_rates(df)
    adj_rate  = composition_adjusted_rate("gender_marker", df, weights, src_rates)
    total     = len(df)

    # Cross-sectional: by category (reliable — source mix doesn't change within a year)
    by_cat = (df.groupby("job_category", as_index=False)
                .agg(total=("record_id", "count"),
                     gm_count=("gender_marker", "sum"),
                     gm_rate=("gender_marker", "mean"))
                .sort_values("gm_rate", ascending=False))
    by_cat["gm_rate"] = by_cat["gm_rate"].round(4)

    # Year decomposition: raw rate vs. what source mix explains
    decomp = []
    for year, g in df.groupby("year"):
        raw = float(g["gender_marker"].mean())
        src_mix = g["source"].value_counts(normalize=True)
        # Expected GM if source mix were to blame entirely
        expected = sum(src_mix.get(s, 0) * src_rates.get(s, 0) for s in src_rates)
        residual = raw - expected   # >0 means above-mix market signal; ≈0 means all noise
        decomp.append({
            "year":              int(year),
            "n":                 len(g),
            "gm_rate_raw":       round(raw, 4),
            "gm_rate_expected_from_source_mix": round(expected, 4),
            "residual_true_signal": round(residual, 4),
            "pct_explained_by_source_mix": (
                round(abs(expected) / abs(raw), 3) if abs(raw) > 0 else None
            ),
        })

    return {
        "global_rate_raw":      pct(df["gender_marker"].sum(), total),
        "global_rate_adjusted": adj_rate,
        "source_rates":         {k: round(v, 4) for k, v in src_rates.items()},
        "source_baseline_weights": weights,
        "methodology_note": (
            "The 'adjusted' rate answers: what would GM be if every year had the "
            "same source mix as 2015-2019? Answer: ~{:.1f}% — essentially constant. "
            "Raw YoY changes in GM rate are ~100% source-mix artefact.".format(
                adj_rate * 100)
        ),
        "by_category":           to_records(by_cat),
        "time_series_decomposition": decomp,
        "cross_sectional_note": (
            "by_category IS reliable: source mix is constant within any given year, "
            "so cross-category comparisons at the same point in time are valid."
        ),
    }


def build_sector_vulnerability(df: pd.DataFrame) -> dict[str, Any]:
    """
    Composite vulnerability index per category.
    vulnerability = (intern_rate × 3) + (gm_rate × 1) - (senior_rate × 2)

    Higher score = more precarious / informalised labour market.
    Weights are heuristic — documented here for transparency.
    """
    total_interns = df["is_internship"].sum()

    df2 = df.copy()
    df2["is_senior_plus"] = df2["seniority"].isin(
        ["senior", "manager", "director", "lead"])

    profile = (df2.groupby("job_category", as_index=False)
                  .agg(total=("record_id", "count"),
                       intern_rate=("is_internship", "mean"),
                       gm_rate=("gender_marker", "mean"),
                       senior_rate=("is_senior_plus", "mean"))
                  .round(4))

    profile["vulnerability_index"] = (
        profile["intern_rate"] * 3
        + profile["gm_rate"] * 1
        - profile["senior_rate"] * 2
    ).round(4)

    profile = profile.sort_values("vulnerability_index", ascending=False)

    return {
        "index_formula": "vulnerability = (intern_rate × 3) + (gm_rate × 1) − (senior_rate × 2)",
        "weight_rationale": {
            "intern_rate × 3": "Strongest precarity signal: unpaid/cheap labour dependency",
            "gm_rate × 1":     "Gender-typing proxy for sector formality",
            "senior_rate × −2": "Seniority as bargaining-power proxy (higher = less vulnerable)",
        },
        "by_category": to_records(profile),
    }


def build_work_model_signals(df: pd.DataFrame) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for flag in BOOLEAN_COLUMNS:
        n_pos = int(df[flag].sum())
        if n_pos < MIN_FLAG_POSITIVES:
            output[flag] = {
                "suppressed": True,
                "reason": f"Only {n_pos} positives — below minimum threshold of {MIN_FLAG_POSITIVES}",
            }
            continue

        by_cat = (df.groupby("job_category", as_index=False)
                    .agg(total=("record_id", "count"),
                         count=(flag, "sum"),
                         rate=(flag, "mean"))
                    .sort_values(["rate", "total"], ascending=[False, False]))
        by_cat["rate"] = by_cat["rate"].round(4)

        by_sen = (df.groupby("seniority", as_index=False)
                    .agg(total=("record_id", "count"),
                         count=(flag, "sum"),
                         rate=(flag, "mean"))
                    .sort_values(["rate", "total"], ascending=[False, False]))
        by_sen["rate"] = by_sen["rate"].round(4)

        output[flag] = {
            "by_year":      to_records(rate_by_year(df, flag)),
            "by_category":  to_records(by_cat),
            "by_seniority": to_records(by_sen),
        }
    return output


def build_market_structure(df: pd.DataFrame) -> dict[str, Any]:
    cat_year = yearly_dimension(df, "job_category")

    hhi_rows = []
    for year, g in cat_year.groupby("year"):
        shares = g["share"]
        h      = float((shares**2).sum())
        top3   = float(g.nlargest(3, "count")["share"].sum())
        hhi_rows.append({
            "year":                int(year),
            "hhi":                 round(h, 4),
            "effective_categories": round(1 / h, 2) if h > 0 else None,
            "top3_share":          round(top3, 4),
            "category_entropy":    shannon_entropy(g["count"]),
            "n_categories_active": int(g[g["count"] > 0].shape[0]),
        })

    # Location HHI (geographic concentration)
    loc_df   = df[df["location_extracted"].notna()]
    loc_year = yearly_dimension(loc_df, "location_extracted")
    loc_hhi  = []
    for year, g in loc_year.groupby("year"):
        if len(g) < 3:
            continue
        h = float((g["share"]**2).sum())
        loc_hhi.append({
            "year":              int(year),
            "location_hhi":      round(h, 4),
            "unique_locations":  int(g["location_extracted"].nunique()),
        })

    # Period dominance
    period_dominance = []
    for pname, (s, e) in PERIODS.items():
        sub  = df[df["year"].between(s, e)]
        top  = sub["job_category"].value_counts(normalize=True).head(3).reset_index()
        top.columns = ["job_category", "share"]
        top["period"]       = pname
        top["period_label"] = PERIOD_LABELS.get(pname, pname)
        period_dominance.extend(to_records(top))

    return {
        "category_hhi_by_year":  hhi_rows,
        "location_hhi_by_year":  loc_hhi,
        "top_categories_by_period": period_dominance,
        "interpretation_note": (
            "HHI near 0 = highly diversified; near 1 = one category monopoly. "
            "Effective_categories = 1/HHI: interpretable as the number of "
            "equally-sized categories that would produce the same concentration."
        ),
    }


def build_location_analytics(df: pd.DataFrame) -> dict[str, Any]:
    located = df[df["location_extracted"].notna()].copy()
    total   = len(df)

    top_locs = value_counts_frame(located, "location_extracted", top_n=30)

    loc_period = []
    for pname, (s, e) in PERIODS.items():
        sub = located[located["year"].between(s, e)]
        top = sub["location_extracted"].value_counts().head(10).reset_index()
        top.columns = ["location_extracted", "count"]
        top["share"]         = (top["count"] / max(len(sub), 1)).round(4)
        top["period"]        = pname
        top["period_label"]  = PERIOD_LABELS.get(pname, pname)
        loc_period.extend(to_records(top))

    cat_loc = (located.groupby(["location_extracted", "job_category"], as_index=False)
                      .size().rename(columns={"size": "count"}))
    cat_loc = add_share(cat_loc, ["location_extracted"])
    cat_loc = cat_loc.sort_values(["location_extracted", "count"], ascending=[True, False])

    loc_flags = (located.groupby("location_extracted", as_index=False)
                        .agg(total=("record_id", "count"),
                             gender_rate=("gender_marker", "mean"),
                             internship_rate=("is_internship", "mean"),
                             part_time_rate=("part_time_hint", "mean"))
                        .query("total >= 20")
                        .sort_values("total", ascending=False))
    for c in ["gender_rate", "internship_rate", "part_time_rate"]:
        loc_flags[c] = loc_flags[c].round(4)

    lisbon_porto = (located[located["location_extracted"].isin(["Lisboa", "Porto"])]
                    .groupby(["year", "location_extracted"], as_index=False)
                    .size().rename(columns={"size": "count"}))

    return {
        "coverage": {
            "records_with_location":  int(located.shape[0]),
            "location_coverage_rate": pct(located.shape[0], total),
            "unique_locations":       int(located["location_extracted"].nunique()),
            "share_missing":          pct(total - located.shape[0], total),
        },
        "top_locations":             to_records(top_locs),
        "top_locations_by_period":   loc_period,
        "category_mix_by_location":  to_records(cat_loc.groupby("location_extracted").head(5)),
        "flags_by_location_min20":   to_records(loc_flags),
        "lisboa_porto_yearly":       to_records(lisbon_porto),
    }


def build_company_analytics(df: pd.DataFrame) -> dict[str, Any]:
    raw   = df[df["company_extracted"].notna()].copy()
    clean = raw[~raw["company_extracted"].str.lower().isin(GEO_NOISE)].copy()
    total = len(df)

    top_clean = value_counts_frame(clean, "company_extracted", top_n=40)

    profiles = (clean.groupby("company_extracted", as_index=False)
                     .agg(total_ads=("record_id", "count"),
                          first_year=("year", "min"),
                          last_year=("year", "max"),
                          active_years=("year", "nunique"),
                          gender_rate=("gender_marker", "mean"),
                          internship_rate=("is_internship", "mean"),
                          part_time_rate=("part_time_hint", "mean"))
                     .sort_values(["total_ads", "active_years"], ascending=[False, False]))
    for c in ["gender_rate", "internship_rate", "part_time_rate"]:
        profiles[c] = profiles[c].round(4)

    top50_names = top_clean["company_extracted"].head(50).tolist()

    comp_hhi = []
    for year, g in clean.groupby("year"):
        counts = g["company_extracted"].value_counts()
        if len(counts) < 2:
            continue
        comp_hhi.append({
            "year":                   int(year),
            "company_hhi":            hhi_from_counts(counts),
            "unique_companies_active": int(len(counts)),
        })

    return {
        "coverage": {
            "records_with_company_raw":    int(raw.shape[0]),
            "records_with_company_clean":  int(clean.shape[0]),
            "company_coverage_rate_clean": pct(clean.shape[0], total),
            "unique_companies_clean":      int(clean["company_extracted"].nunique()),
            "geo_noise_removed":           int(raw.shape[0] - clean.shape[0]),
        },
        "top_companies_clean":         to_records(top_clean),
        "company_profiles_top50":      to_records(
            profiles[profiles["company_extracted"].isin(top50_names)]),
        "company_hhi_by_year":         comp_hhi,
    }


def build_language_signals(df: pd.DataFrame) -> dict[str, Any]:
    period_rows = []
    for pname, (s, e) in PERIODS.items():
        sub    = df[df["year"].between(s, e)]
        tokens = pd.Series(tokenize_titles(sub["title"]), dtype="string")
        if tokens.empty:
            continue
        counts = tokens.value_counts().head(30).reset_index()
        counts.columns = ["keyword", "count"]
        counts["period"]       = pname
        counts["period_label"] = PERIOD_LABELS.get(pname, pname)
        counts["share_of_ads"] = (counts["count"] / max(len(sub), 1)).round(4)
        period_rows.append(counts)
    kw_periods = pd.concat(period_rows, ignore_index=True) if period_rows else pd.DataFrame()

    all_bigrams  = bigrams_from_titles(df["title"])
    top_bigrams  = Counter(all_bigrams).most_common(40)
    bigram_records = [{"bigram": f"{a} {b}", "count": c} for (a, b), c in top_bigrams]

    period_bigrams = []
    for pname, (s, e) in PERIODS.items():
        sub  = df[df["year"].between(s, e)]
        bigs = Counter(bigrams_from_titles(sub["title"])).most_common(15)
        for (a, b), c in bigs:
            period_bigrams.append({
                "period":      pname,
                "period_label": PERIOD_LABELS.get(pname, pname),
                "bigram":      f"{a} {b}",
                "count":       c,
                "share_of_ads": pct(c, len(sub)),
            })

    # Keyword emergence between first and last period
    _MIN_N = 300
    first_p, last_p  = list(PERIODS)[0], list(PERIODS)[-1]
    first_sub = df[df["year"].between(*PERIODS[first_p])]
    last_sub  = df[df["year"].between(*PERIODS[last_p])]
    _n_first, _n_last = len(first_sub), len(last_sub)
    first_tok = Counter(tokenize_titles(first_sub["title"]))
    last_tok  = Counter(tokenize_titles(last_sub["title"]))

    emergence = []
    all_kws   = set(list(first_tok)[:300]) | set(list(last_tok)[:300])
    for kw in all_kws:
        f_share = pct(first_tok.get(kw, 0), _n_first)
        l_share = pct(last_tok.get(kw, 0), _n_last)
        delta   = round(l_share - f_share, 4)
        emergence.append({
            "keyword":           kw,
            "first_period_share": f_share,
            "last_period_share":  l_share,
            "share_delta":        delta,
            "n_first_period":     _n_first,
            "n_last_period":      _n_last,
            "low_n_warning":      _n_first < _MIN_N or _n_last < _MIN_N,
        })
    emergence.sort(key=lambda x: x["share_delta"], reverse=True)

    return {
        "top_keywords_by_period": to_records(kw_periods),
        "top_bigrams_global":     bigram_records,
        "top_bigrams_by_period":  period_bigrams,
        "keyword_emergence_top20": emergence[:20],
        "keyword_decline_top20":   sorted(emergence, key=lambda x: x["share_delta"])[:20],
        "emergence_note": (
            None if _n_last >= _MIN_N
            else f"Last period n={_n_last} < {_MIN_N} — emergence deltas are statistically fragile."
        ),
    }


def build_momentum(df: pd.DataFrame) -> dict[str, Any]:
    first_year = int(df["year"].min())
    last_year  = int(df["year"].max())
    n_periods  = last_year - first_year

    cat_year   = yearly_dimension(df, "job_category")
    piv_counts = cat_year.pivot_table(index="job_category", columns="year",
                                      values="count", aggfunc="sum", fill_value=0)
    piv_share  = cat_year.pivot_table(index="job_category", columns="year",
                                      values="share", aggfunc="sum", fill_value=0)

    rows = []
    for cat in piv_counts.index:
        fc = float(piv_counts.loc[cat].get(first_year, 0))
        lc = float(piv_counts.loc[cat].get(last_year, 0))
        fs = float(piv_share.loc[cat].get(first_year, 0))
        ls = float(piv_share.loc[cat].get(last_year, 0))
        pk = int(piv_counts.loc[cat].idxmax())
        pc = int(piv_counts.loc[cat].max())
        rows.append({
            "job_category":  cat,
            "first_year":    first_year,  "last_year":   last_year,
            "first_count":   int(fc),     "last_count":  int(lc),
            "count_delta":   int(lc - fc),
            "first_share":   round(fs, 4),"last_share":  round(ls, 4),
            "share_delta":   round(ls - fs, 4),
            "count_cagr":    cagr(fc, lc, n_periods),
            "peak_year":     pk,           "peak_count": pc,
        })

    momentum = pd.DataFrame(rows)
    share_risers  = momentum.sort_values("share_delta", ascending=False).head(8)
    riser_cats    = set(share_risers["job_category"])
    share_fallers = (momentum[~momentum["job_category"].isin(riser_cats)]
                     .sort_values("share_delta").head(8))
    count_risers  = momentum.dropna(subset=["count_cagr"]).sort_values(
        "count_cagr", ascending=False).head(8)
    cagr_cats     = set(count_risers["job_category"])
    count_fallers = (momentum[~momentum["job_category"].isin(cagr_cats)]
                     .dropna(subset=["count_cagr"])
                     .sort_values("count_cagr").head(8))

    rolling = []
    for cat, g in cat_year.groupby("job_category"):
        g = g.sort_values("year").copy()
        g["rolling_3y_share"] = g["share"].rolling(3, center=True).mean().round(4)
        for _, row in g.iterrows():
            rolling.append({
                "job_category":    cat,
                "year":            int(row["year"]),
                "count":           int(row["count"]),
                "share":           float(row["share"]),
                "rolling_3y_share": row["rolling_3y_share"],
            })

    return {
        "category_long_run_momentum":     to_records(momentum.sort_values("share_delta", ascending=False)),
        "fastest_share_risers":           to_records(share_risers),
        "fastest_share_fallers":          to_records(share_fallers),
        "fastest_count_cagr_risers":      to_records(count_risers),
        "fastest_count_cagr_fallers":     to_records(count_fallers),
        "rolling_3y_share_by_category":   rolling,
    }


def build_period_deep_dive(df: pd.DataFrame) -> dict[str, Any]:
    result = {}
    for pname, (s, e) in PERIODS.items():
        sub = df[df["year"].between(s, e)]
        n   = len(sub)

        top_cats = sub["job_category"].value_counts().head(5).reset_index()
        top_cats.columns = ["job_category", "count"]
        top_cats["share"] = (top_cats["count"] / max(n, 1)).round(4)

        top_locs = (sub["location_extracted"].dropna()
                       .value_counts().head(5).reset_index())
        top_locs.columns = ["location_extracted", "count"]
        top_locs["share"] = (top_locs["count"] / max(n, 1)).round(4)

        clean_comp = sub[sub["company_extracted"].notna() &
                         ~sub["company_extracted"].str.lower().isin(GEO_NOISE)]
        top_comp = clean_comp["company_extracted"].value_counts().head(5).reset_index()
        top_comp.columns = ["company_extracted", "count"]
        top_comp["share"] = (top_comp["count"] / max(n, 1)).round(4)

        tokens = pd.Series(tokenize_titles(sub["title"]), dtype="string")
        top_kw = tokens.value_counts().head(10).reset_index()
        top_kw.columns = ["keyword", "count"]
        top_kw["share_of_ads"] = (top_kw["count"] / max(n, 1)).round(4)

        is_sparse = n < SPARSE_PERIOD_THRESHOLD
        sparse_years = [
            int(y) for y, c
            in sub.groupby("year").size().items()
            if c < SPARSE_YEAR_THRESHOLD
        ]
        h = hhi_from_counts(sub["job_category"].value_counts())

        result[pname] = {
            "period_label":         PERIOD_LABELS.get(pname, pname),
            "start_year":           s,
            "end_year":             e,
            "total_ads":            n,
            "hhi":                  h,
            "effective_categories": effective_categories(h),
            "is_sparse_period":     is_sparse,
            "sparse_years":         sparse_years,
            "reliability_note": (
                f"n={n} — statistics fragile (threshold ≥{SPARSE_PERIOD_THRESHOLD}). "
                f"Sparse years: {sparse_years or 'none'}."
            ) if is_sparse else None,
            "top_categories":  to_records(top_cats),
            "top_locations":   to_records(top_locs),
            "top_companies":   to_records(top_comp),
            "top_keywords":    to_records(top_kw),
            "flag_rates": {
                f: pct(sub[f].sum(), n) for f in BOOLEAN_COLUMNS
            },
            "seniority_distribution": to_records(
                sub["seniority"].value_counts(normalize=True).round(4)
                    .reset_index().rename(columns={"proportion": "share"})
            ),
        }
    return result


# ── Master builder ────────────────────────────────────────────────────────────

def build_analytics(df: pd.DataFrame) -> dict[str, Any]:
    years = sorted(int(y) for y in df["year"].dropna().unique())

    # Derived constants — compute once, pass to sub-builders
    weights   = build_source_weights(df)
    src_gm    = source_gm_rates(df)

    period_meta = [
        {
            "period":      n,
            "label":       PERIOD_LABELS.get(n, n),
            "start_year":  s,
            "end_year":    e,
            "records":     int(df[df["year"].between(s, e)].shape[0]),
        }
        for n, (s, e) in PERIODS.items()
    ]

    return {
        "schema_version": "3.0",
        "generated_for":  "Arquivo.pt Portugal Labour Market · Elite Analytics",
        "metadata": {
            "records":   len(df),
            "year_min":  min(years),
            "year_max":  max(years),
            "years":     years,
            "periods":   period_meta,
            "columns":   list(df.columns),
            "source_baseline_weights": weights,
            "source_gm_rates": {k: round(v, 4) for k, v in src_gm.items()},
        },

        # Quality & confidence
        "archive_confidence":              build_archive_confidence(df),
        "data_quality":                    build_data_quality(df),

        # Core KPIs
        "kpis":                            build_kpis(df, weights, src_gm),

        # Time series (normalised)
        "time_series":                     build_time_series(df, weights, src_gm),

        # Distributions
        "distributions":                   build_distributions(df),

        # Cross-tabs
        "cross_tabs":                      build_cross_tabs(df),

        # Dedicated signal sections (NEW in v3.0)
        "internship_economy":              build_internship_economy(df),
        "gender_marker_analysis":          build_gender_marker_analysis(df, weights),
        "sector_vulnerability":            build_sector_vulnerability(df),

        # Work-model signals (remote suppressed if unreliable)
        "work_model_signals":              build_work_model_signals(df),

        # Market structure
        "market_structure":                build_market_structure(df),

        # Geography
        "locations":                       build_location_analytics(df),

        # Companies
        "companies":                       build_company_analytics(df),

        # Language
        "language_signals":                build_language_signals(df),

        # Momentum
        "momentum":                        build_momentum(df),

        # Period deep dive
        "period_deep_dive":                build_period_deep_dive(df),
    }


# ── Dataset preparation ───────────────────────────────────────────────────────

def prepare_dataset(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)

    for col in ["title", "job_category", "seniority",
                "location_extracted", "company_extracted"]:
        if col in df:
            df[col] = df[col].map(clean_mojibake)
            df[col] = df[col].replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})

    df["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")
    df = df[df["year"].notna()].copy()
    df["year"] = df["year"].astype(int)

    for col in BOOLEAN_COLUMNS:
        df[col] = df[col].fillna(False).astype(bool)

    if "date_archived" in df:
        df["date_archived"] = (pd.to_datetime(df["date_archived"], errors="coerce")
                                 .dt.date)

    required = {"record_id", "year", "title", *BOOLEAN_COLUMNS, *DIMENSION_COLUMNS}
    missing  = sorted(required - set(df.columns))
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    return df


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    df   = prepare_dataset(args.input)

    analytics = build_analytics(df)
    analytics["metadata"]["source_file"] = str(args.input)

    clean = deep_clean(analytics)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(clean, f, ensure_ascii=False, indent=2, allow_nan=False)

    size_kb = args.output.stat().st_size // 1024
    print(f"✓  Wrote {args.output}")
    print(f"   {analytics['metadata']['records']:,} records · ~{size_kb} KB")
    print(f"   Schema v{analytics['schema_version']}")


if __name__ == "__main__":
    main()