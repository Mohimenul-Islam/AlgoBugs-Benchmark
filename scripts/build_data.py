"""
build_data.py — Run once locally to generate the three static JSON data files
for the AlgoBugs web showcase.

Usage:
    cd /home/mohimenul/thesis-final-run/algobugs-web
    python3 scripts/build_data.py

Outputs:
    data/results.json    — chart data from summary_table.csv
    data/dataset.json    — all 1000 pair metadata (no code)
    data/demo_pairs.json — 8 curated pairs with code + real model results
"""

import csv
import json
import os
import zipfile
from collections import defaultdict
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT        = Path("/home/mohimenul/thesis-final-run")
RESULTS_DIR = ROOT / "results"
DATASET_DIR = ROOT / "dataset-final"
OUT_DIR     = Path(__file__).parent.parent / "data"
OUT_DIR.mkdir(exist_ok=True)

MODEL_NAMES = {
    "deepseek/deepseek-chat":               "DeepSeek V3",
    "google/gemini-2.0-flash-001":          "Gemini Flash",
    "meta-llama/llama-3.3-70b-instruct":    "LLaMA 70B",
    "openai/gpt-5.1":                       "GPT-5.1",
    "qwen/qwen3-coder-30b-a3b-instruct":    "Qwen3 Coder",
}
PILOT_MODELS = {"openai/gpt-5.1-codex", "openai/gpt-5.1-codex-mini"}

CATEGORIES = ["T1","T2","T3","T4","T5","T6","T7","T8"]
CATEGORY_NAMES = {
    "T1": "Integer Overflow",
    "T2": "Modular Arithmetic",
    "T3": "Off-by-One",
    "T4": "Wrong Conditional",
    "T5": "Algorithmic Flaw",
    "T6": "State / Init",
    "T7": "Corner Case",
    "T8": "I/O Format",
}

PROMPT_TYPES = ["zero_shot", "cot", "few_shot"]

FILES = {
    "DeepSeek V3":  {pt: RESULTS_DIR / f"deepseek_v3_{pt}.json" for pt in PROMPT_TYPES},
    "Gemini Flash": {pt: RESULTS_DIR / f"gemini_flash_{pt}.json" for pt in PROMPT_TYPES},
    "LLaMA 70B":    {pt: RESULTS_DIR / f"llama70b_{pt}.json" for pt in PROMPT_TYPES},
    "GPT-5.1":      {pt: RESULTS_DIR / f"gpt51_{pt}.json" for pt in PROMPT_TYPES},
    "Qwen3 Coder":  {pt: RESULTS_DIR / f"qwen_coder_{pt}.json" for pt in PROMPT_TYPES},
}

# ── Helper: iter all zips ─────────────────────────────────────────────────────
def iter_zips():
    for rating_dir in sorted(DATASET_DIR.iterdir()):
        if not rating_dir.is_dir():
            continue
        for zpath in sorted(rating_dir.glob("*.zip")):
            yield rating_dir.name, zpath


# ── Output A: results.json ────────────────────────────────────────────────────
def build_results():
    rows = []
    with open(RESULTS_DIR / "summary_table.csv") as f:
        reader = csv.DictReader(f)
        for row in reader:
            model_id = row["model"]
            if model_id in PILOT_MODELS:
                continue
            display = MODEL_NAMES.get(model_id)
            if display is None:
                continue
            entry = {
                "model":    display,
                "strategy": row["prompt_type"],
                "overall":  float(row["overall_fer"]),
            }
            for cat in CATEGORIES:
                val = row.get(f"{cat}_fer", "")
                entry[cat] = float(val) if val else None
            rows.append(entry)

    out = {
        "models":         list(MODEL_NAMES.values()),
        "categories":     CATEGORIES,
        "category_names": CATEGORY_NAMES,
        "summary":        rows,
    }
    with open(OUT_DIR / "results.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"  results.json  — {len(rows)} rows")


# ── Output B: dataset.json ────────────────────────────────────────────────────
def build_dataset():
    problems_map = {}  # problem_id → dict

    for rating, zpath in iter_zips():
        with zipfile.ZipFile(zpath) as zf:
            names = zf.namelist()
            meta_names = [n for n in names if n.endswith("metadata.json")]
            for mname in meta_names:
                meta = json.loads(zf.read(mname))
                pid = meta["problem_id"]
                if pid not in problems_map:
                    problems_map[pid] = {
                        "id":     pid,
                        "title":  meta.get("problem_title", pid),
                        "rating": int(meta.get("rating", rating)),
                        "url":    meta.get("problem_url", ""),
                        "pairs":  [],
                    }
                # pair number from path like "2157C - pair3/metadata.json"
                folder = mname.split("/")[0]
                pair_num = int(folder.split("pair")[-1])
                problems_map[pid]["pairs"].append({
                    "pair_id":         pair_num,
                    "bug_category":    meta.get("bug_category", ""),
                    "bug_description": meta.get("bug_description_natural_language", ""),
                })

    # Sort pairs within each problem
    for p in problems_map.values():
        p["pairs"].sort(key=lambda x: x["pair_id"])

    problems = sorted(problems_map.values(), key=lambda x: (x["rating"], x["id"]))
    out = {"problems": problems}
    with open(OUT_DIR / "dataset.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    total_pairs = sum(len(p["pairs"]) for p in problems)
    print(f"  dataset.json  — {len(problems)} problems, {total_pairs} pairs")


# ── Output C: demo_pairs.json ─────────────────────────────────────────────────
def build_demo_pairs():
    # lookup[(problem_id, pair_num)][prompt_type][model_name] = {verdict, test, correct_out, buggy_out}
    lookup = defaultdict(lambda: defaultdict(dict))
    
    for model_name, pt_map in FILES.items():
        for pt, fpath in pt_map.items():
            if not fpath.exists():
                print(f"  WARNING: missing {fpath}")
                continue
            with open(fpath) as f:
                entries = json.load(f)
            for e in entries:
                key = (e["problem_id"], int(e["pair"]))
                lookup[key][pt][model_name] = {
                    "verdict":     e.get("verdict", "ERROR"),
                    "test":        e.get("generated_test_case") or "",
                    "correct_out": e.get("correct_output") or "",
                    "buggy_out":   e.get("buggy_output") or "",
                    "exec_ms":     e.get("execution_time_ms") or 0,
                    "api_ms":      e.get("api_response_time_ms") or 0,
                }

    # Build a zip lookup for fast code extraction
    zip_map = {}
    for rating, zpath in iter_zips():
        stem = zpath.stem.upper()
        pid_candidate = f"CF_{stem}"
        zip_map[pid_candidate] = (rating, zpath)

    demo_pairs = []

    # Build a category map from the zip metadata or result files
    cat_map = {}  # (pid, pair) → bug_category
    for model_name, pt_map in FILES.items():
        fpath = pt_map["zero_shot"] # use zero_shot as base for categories
        if not fpath.exists():
            continue
        with open(fpath) as f:
            entries = json.load(f)
        for e in entries:
            key = (e["problem_id"], int(e["pair"]))
            if key not in cat_map:
                cat_map[key] = e.get("bug_category", "")

    for cat in CATEGORIES:
        candidates = []
        for (pid, pair_num), pt_results in lookup.items():
            # Ensure we have zero_shot results for all 5 models as a baseline
            if "zero_shot" in pt_results and len(pt_results["zero_shot"]) == len(FILES):
                if cat_map.get((pid, pair_num)) == cat:
                    candidates.append((pid, pair_num, pt_results))

        if not candidates:
            print(f"  WARNING: no complete-coverage pair for {cat}")
            continue

        # Score by interest: number of distinct verdicts in zero_shot
        def score(item):
            _, _, pt_res = item
            mr = pt_res.get("zero_shot", {})
            verdicts = set(v["verdict"] for v in mr.values())
            exposed = sum(1 for v in mr.values() if v["verdict"] == "BUG_EXPOSED")
            mix_score = min(exposed, 5 - exposed)  # 0..2
            variety = len(verdicts)  # 1 or 2+
            return (mix_score * 10) + variety

        candidates.sort(key=score, reverse=True)
        pid, pair_num, pt_results = candidates[0]

        # Extract code from zip
        zinfo = zip_map.get(pid)
        buggy_code = correct_code = problem_intro = ""
        problem_title = pid
        problem_url = ""
        rating_val = 0

        if zinfo:
            rating_str, zpath = zinfo
            rating_val = int(rating_str)
            with zipfile.ZipFile(zpath) as zf:
                names = zf.namelist()
                prefix = None
                for n in names:
                    if f"pair{pair_num}/" in n and "metadata.json" in n:
                        prefix = n.replace("metadata.json", "")
                        break
                if prefix:
                    for n in names:
                        if n.startswith(prefix):
                            if n.endswith("solution_buggy.cpp"):
                                buggy_code = zf.read(n).decode("utf-8", errors="replace")
                            elif n.endswith("solution_correct.cpp"):
                                correct_code = zf.read(n).decode("utf-8", errors="replace")
                            elif n.endswith("metadata.json"):
                                m = json.loads(zf.read(n))
                                problem_title = m.get("problem_title", pid)
                                problem_url   = m.get("problem_url", "")
                            elif n.endswith("problem_statement.md"):
                                raw = zf.read(n).decode("utf-8", errors="replace")
                                problem_intro = raw[:1000]

        # Get bug description from metadata
        bug_desc = ""
        if zinfo:
            _, zpath = zinfo
            with zipfile.ZipFile(zpath) as zf:
                for n in zf.namelist():
                    if f"pair{pair_num}/metadata.json" in n:
                        m = json.loads(zf.read(n))
                        bug_desc = m.get("bug_description_natural_language", "")
                        break

        entry = {
            "category":      cat,
            "category_name": CATEGORY_NAMES[cat],
            "problem_id":    pid,
            "problem_title": problem_title,
            "problem_url":   problem_url,
            "rating":        rating_val,
            "pair_num":      pair_num,
            "bug_description": bug_desc,
            "problem_intro": problem_intro,
            "buggy_code":    buggy_code,
            "correct_code":  correct_code,
            "results":       pt_results,
        }
        demo_pairs.append(entry)
        # Count exposed in zero_shot for reporting
        zs_results = pt_results.get("zero_shot", {})
        exposed_count = sum(1 for v in zs_results.values() if v["verdict"] == "BUG_EXPOSED")
        print(f"  {cat} → {pid} pair{pair_num}  ({exposed_count}/5 models exposed in zero_shot)")

    with open(OUT_DIR / "demo_pairs.json", "w") as f:
        json.dump(demo_pairs, f, separators=(",", ":"))
    print(f"  demo_pairs.json — {len(demo_pairs)} entries")


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Building results.json...")
    build_results()
    print("Building dataset.json...")
    build_dataset()
    print("Building demo_pairs.json...")
    build_demo_pairs()
    print("Done. Files written to data/")

    # Report sizes
    for fname in ["results.json", "dataset.json", "demo_pairs.json"]:
        size = (OUT_DIR / fname).stat().st_size
        print(f"  {fname}: {size/1024:.1f} KB")
