#!/usr/bin/env python3
"""
AlgoBugs Evaluation Engine
==========================
Evaluates LLM fault-exposure capabilities by:
1. Sending problem + buggy code to an LLM via OpenRouter
2. Receiving a generated test case
3. Compiling & running both correct and buggy solutions
4. Comparing outputs to determine if the bug was exposed

Usage:
  python3 evaluate_models.py --pilot          # Test on 2 problems with Gemini Flash
  python3 evaluate_models.py --model gpt4o    # Full run with GPT-4o
  python3 evaluate_models.py --model all      # Run all models sequentially
"""

import asyncio
import aiohttp
import json
import os
import re
import sys
import time
import random
import zipfile
import tempfile
import subprocess
import argparse
from datetime import datetime, timezone
from pathlib import Path
from tqdm import tqdm

# ============================================================
# CONFIGURATION
# ============================================================

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

DATASET_DIR = Path("dataset-final")
RESULTS_DIR = Path("results")
LOGS_DIR = RESULTS_DIR / "logs"
PILOT_DIR = RESULTS_DIR / "pilot"

# Model definitions
MODELS = {
    "gpt4o": {
        "id": "openai/gpt-4.1",
        "name": "GPT-4.1",
        "tier": "frontier",
        "is_free": False,
        "delay_between_requests": 1.0,
        "max_concurrent": 5,
    },
    "gemini_flash": {
        "id": "google/gemini-2.0-flash-001",
        "name": "Gemini 2.0 Flash",
        "tier": "mid",
        "is_free": False,
        "delay_between_requests": 0.3,
        "max_concurrent": 15,
    },
    "deepseek_v3": {
        "id": "deepseek/deepseek-chat",
        "name": "DeepSeek V3",
        "tier": "reasoning",
        "is_free": False,
        "delay_between_requests": 0.3,
        "max_concurrent": 15,
    },
    "llama70b": {
        "id": "meta-llama/llama-3.3-70b-instruct",
        "name": "LLaMA 3.3 70B",
        "tier": "open-source",
        "is_free": False,
        "delay_between_requests": 0.3,
        "max_concurrent": 15,
    },
    "qwen_coder": {
        "id": "qwen/qwen3-coder-30b-a3b-instruct",
        "name": "Qwen3 Coder 30B",
        "tier": "code-specialist",
        "is_free": False,
        "delay_between_requests": 0.3,
        "max_concurrent": 15,
    },
    "gpt51codex": {
        "id": "openai/gpt-5.1-codex",
        "name": "GPT-5.1-Codex",
        "tier": "frontier",
        "is_free": False,
        "delay_between_requests": 0.3,
        "max_concurrent": 20,
    },
    "minimax_m25": {
        "id": "minimax/minimax-m2.5:free",
        "name": "MiniMax M2.5",
        "tier": "mid",
        "is_free": True,
        "delay_between_requests": 4.0,
        "max_concurrent": 5,
    },
    "gpt51codex_mini": {
        "id": "openai/gpt-5.1-codex-mini",
        "name": "GPT-5.1-Codex-Mini",
        "tier": "frontier",
        "is_free": False,
        "delay_between_requests": 0.5,
        "max_concurrent": 10,
    },
    "gpt51": {
        "id": "openai/gpt-5.1",
        "name": "GPT-5.1",
        "tier": "frontier",
        "is_free": False,
        "delay_between_requests": 0.5,
        "max_concurrent": 15,
    },
}

# Compilation and execution settings
COMPILE_TIMEOUT = 10  # seconds
EXECUTE_TIMEOUT = 10  # seconds
GPP_FLAGS = ["-std=c++20", "-O2", "-o"]

# Rate limit safety
FREE_MODEL_DAILY_LIMIT = 950  # Safety buffer below 1000
MAX_RETRIES = 3
BASE_RETRY_DELAY = 2.0  # seconds

# Prompts
PROMPTS = {
    "zero_shot": """You are given a competitive programming problem and a buggy C++ solution that produces wrong answers for some inputs.

PROBLEM STATEMENT:
{problem_statement}

BUGGY SOLUTION:
```cpp
{buggy_code}
```

Generate a single test input that would cause this buggy solution to produce a wrong answer.
The test input must be valid according to the problem constraints.
Output ONLY the test input wrapped in <test> tags, nothing else.

Example format:
<test>
3
1 2 3
</test>""",

    "cot": """You are given a competitive programming problem and a buggy C++ solution that produces wrong answers for some inputs.

PROBLEM STATEMENT:
{problem_statement}

BUGGY SOLUTION:
```cpp
{buggy_code}
```

Step 1: Carefully analyze the buggy solution and identify the logical flaw that causes it to produce wrong answers on certain inputs.
Step 2: Design a specific test input that triggers this flaw and would make the buggy solution output a different result than a correct solution.
Step 3: Output the test input wrapped in <test> tags.

Think step by step, then provide the test case.
The test input must be valid according to the problem constraints.""",

    "few_shot": """You are a competitive programming expert specializing in fault-exposure testing. Your task is to generate a single test input that causes a specific buggy C++ solution to produce a wrong answer.

Study these three worked examples:

---
EXAMPLE 1 — Integer Overflow (T1)

PROBLEM: Given N (1 ≤ N ≤ 10^6), print the sum of integers from 1 to N.

BUGGY SOLUTION:
```cpp
#include<bits/stdc++.h>
using namespace std;
int main(){{
    int n; cin >> n;
    int sum = n * (n + 1) / 2;  // BUG: n*(n+1) overflows 32-bit int for large n
    cout << sum << endl;
}}
```

ANALYSIS: n*(n+1) for n=100000 equals 10,000,100,000 which exceeds INT_MAX (~2.1×10^9). The product wraps around silently. We need n large enough so n*(n+1) overflows.

<test>
100000
</test>

---
EXAMPLE 2 — Off-by-One / Boundary (T3)

PROBLEM: Given N integers, print the maximum value. (1 ≤ N ≤ 100, -10^9 ≤ a[i] ≤ 10^9)

BUGGY SOLUTION:
```cpp
#include<bits/stdc++.h>
using namespace std;
int main(){{
    int n; cin >> n;
    vector<int> a(n);
    for(int i = 0; i < n; i++) cin >> a[i];
    int mx = a[0];
    for(int i = 1; i < n-1; i++)  // BUG: loop ends at n-2, never checks last element
        if(a[i] > mx) mx = a[i];
    cout << mx << endl;
}}
```

ANALYSIS: The condition `i < n-1` skips index n-1 entirely. The bug triggers when the maximum value is in the last position. Use n=3 with the largest value at position 2.

<test>
3
1 2 5
</test>

---
EXAMPLE 3 — Wrong Conditional Logic (T4)

PROBLEM: Given N integers and threshold K, count elements with value >= K. (1 ≤ N ≤ 100, 1 ≤ K ≤ 10^9)

BUGGY SOLUTION:
```cpp
#include<bits/stdc++.h>
using namespace std;
int main(){{
    int n, k; cin >> n >> k;
    int cnt = 0;
    for(int i = 0; i < n; i++){{
        int x; cin >> x;
        if(x > k) cnt++;  // BUG: strict > instead of >=, misses x==k
    }}
    cout << cnt << endl;
}}
```

ANALYSIS: The operator `>` excludes values exactly equal to k. A correct solution using `>=` would count them. To expose the bug, include at least one element with value exactly k.

<test>
3 5
3 5 7
</test>

---

Now solve the actual problem. Follow the same pattern: identify the exact bug, reason about what input triggers it, then output only the test.

PROBLEM STATEMENT:
{problem_statement}

BUGGY SOLUTION:
```cpp
{buggy_code}
```

Analyze the bug, then output your test input wrapped in <test> tags. The input must satisfy all problem constraints.""",
}

# Pilot problems (1 easy + 1 hard)
PILOT_PROBLEMS = [
    ("1400", "2157c.zip"),
    ("2100", "2149G.zip"),
]


# ============================================================
# DATASET LOADING
# ============================================================

def discover_all_problems():
    """Find all problem zips across all rating brackets."""
    problems = []
    for rating_dir in sorted(DATASET_DIR.iterdir()):
        if not rating_dir.is_dir():
            continue
        rating = rating_dir.name
        for zip_file in sorted(rating_dir.glob("*.zip")):
            problems.append((rating, zip_file.name))
    return problems


def load_pairs_from_zip(rating, zip_name):
    """Extract all pairs from a problem zip file."""
    zip_path = DATASET_DIR / rating / zip_name
    pairs = []

    with zipfile.ZipFile(zip_path, 'r') as zf:
        # Find all unique pair folders
        folders = set()
        for name in zf.namelist():
            parts = name.split('/')
            if len(parts) > 1 and parts[0].strip():
                folders.add(parts[0])

        for folder in sorted(folders, key=lambda x: int(re.search(r'pair(\d+)', x).group(1))):
            try:
                # Read all 4 files
                problem_stmt = zf.read(f"{folder}/problem_statement.md").decode('utf-8')
                correct_code = zf.read(f"{folder}/solution_correct.cpp").decode('utf-8')
                buggy_code = zf.read(f"{folder}/solution_buggy.cpp").decode('utf-8')
                metadata = json.loads(zf.read(f"{folder}/metadata.json"))

                pair_num = int(re.search(r'pair(\d+)', folder).group(1))
                pairs.append({
                    "problem_id": metadata.get("problem_id", ""),
                    "pair": pair_num,
                    "rating": int(rating),
                    "bug_category": metadata.get("bug_category", ""),
                    "bug_description": metadata.get("bug_description_natural_language", ""),
                    "problem_statement": problem_stmt,
                    "correct_code": correct_code,
                    "buggy_code": buggy_code,
                    "folder_name": folder,
                })
            except (KeyError, json.JSONDecodeError) as e:
                print(f"  [WARN] Skipping {folder}: {e}")
                continue

    return pairs


# ============================================================
# API CALLING (with defensive rate limiting)
# ============================================================

class RateLimiter:
    """Track free model usage and enforce limits."""
    def __init__(self):
        self.free_calls_today = 0
        self.consecutive_failures = 0
        self.last_request_time = 0

    def can_make_free_call(self):
        return self.free_calls_today < FREE_MODEL_DAILY_LIMIT

    def record_free_call(self):
        self.free_calls_today += 1

    def record_failure(self):
        self.consecutive_failures += 1

    def record_success(self):
        self.consecutive_failures = 0

    def should_circuit_break(self):
        return self.consecutive_failures >= 5


rate_limiter = RateLimiter()


def extract_test_case(response_text):
    """Extract test case from LLM response, handling various formats."""
    # Try <test>...</test> tags first
    match = re.search(r'<test>\s*(.*?)\s*</test>', response_text, re.DOTALL)
    if match:
        return match.group(1).strip()

    # Try ```...``` code blocks
    match = re.search(r'```\s*(.*?)\s*```', response_text, re.DOTALL)
    if match:
        return match.group(1).strip()

    # Try to find just the numeric content (last resort)
    # Look for lines that look like test input (numbers, spaces)
    lines = response_text.strip().split('\n')
    # Find first line that starts with a digit
    start_idx = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and (stripped[0].isdigit() or stripped[0] == '-'):
            start_idx = i
            break

    if start_idx is not None:
        # Take from first numeric line to end (or until non-numeric content)
        test_lines = []
        for line in lines[start_idx:]:
            stripped = line.strip()
            if not stripped:
                continue
            # Stop at lines that look like explanations
            if any(word in stripped.lower() for word in ['explanation', 'note:', 'this ', 'the ', 'because']):
                break
            test_lines.append(stripped)
        if test_lines:
            return '\n'.join(test_lines)

    return None


async def call_openrouter(session, model_config, prompt, pair_info):
    """Call OpenRouter API with retry logic and rate limiting."""
    model_id = model_config["id"]
    is_free = model_config["is_free"]
    delay = model_config["delay_between_requests"]

    # Pre-flight: check free model quota
    if is_free and not rate_limiter.can_make_free_call():
        return {
            "error": "FREE_DAILY_LIMIT_REACHED",
            "test_case": None,
            "api_response_time_ms": 0,
            "raw_response": None,
        }

    # Circuit breaker check
    if rate_limiter.should_circuit_break():
        print(f"  [CIRCUIT BREAK] 5 consecutive failures — pausing 60s...")
        await asyncio.sleep(60)
        rate_limiter.consecutive_failures = 0

    # Enforce minimum delay between requests
    now = time.time()
    elapsed = now - rate_limiter.last_request_time
    if elapsed < delay:
        await asyncio.sleep(delay - elapsed)
    rate_limiter.last_request_time = time.time()

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/algobugs",
        "X-Title": "AlgoBugs Evaluation",
    }

    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 2048,
    }

    for attempt in range(MAX_RETRIES):
        try:
            start_time = time.time()

            if is_free:
                rate_limiter.record_free_call()

            async with session.post(OPENROUTER_BASE_URL, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                elapsed_ms = int((time.time() - start_time) * 1000)

                if resp.status == 429:
                    rate_limiter.record_failure()
                    retry_delay = BASE_RETRY_DELAY * (2 ** attempt) + random.uniform(0, 1)
                    print(f"  [429] Rate limited — waiting {retry_delay:.1f}s (attempt {attempt+1}/{MAX_RETRIES})")
                    await asyncio.sleep(retry_delay)
                    continue

                if resp.status != 200:
                    body = await resp.text()
                    rate_limiter.record_failure()
                    print(f"  [HTTP {resp.status}] {body[:200]}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(BASE_RETRY_DELAY * (2 ** attempt))
                    continue

                data = await resp.json()
                rate_limiter.record_success()

                # GPT-5.1-Codex and reasoning models can return content=null; fall back to empty string
                raw_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                content = raw_content if isinstance(raw_content, str) else ""
                test_case = extract_test_case(content)

                # Save raw log
                log_entry = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "model": model_id,
                    "problem_id": pair_info.get("problem_id"),
                    "pair": pair_info.get("pair"),
                    "response_status": resp.status,
                    "response_time_ms": elapsed_ms,
                    "raw_content": content[:2000],
                    "extracted_test_case": test_case,
                    "generation_id": data.get("id", ""),
                }

                return {
                    "error": None,
                    "test_case": test_case,
                    "api_response_time_ms": elapsed_ms,
                    "raw_response": content,
                    "log_entry": log_entry,
                }

        except asyncio.TimeoutError:
            rate_limiter.record_failure()
            print(f"  [TIMEOUT] API call timed out (attempt {attempt+1})")
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(BASE_RETRY_DELAY * (2 ** attempt))
        except Exception as e:
            rate_limiter.record_failure()
            print(f"  [ERROR] {type(e).__name__}: {e} (attempt {attempt+1})")
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(BASE_RETRY_DELAY * (2 ** attempt))

    return {
        "error": f"FAILED_AFTER_{MAX_RETRIES}_RETRIES",
        "test_case": None,
        "api_response_time_ms": 0,
        "raw_response": None,
    }


# ============================================================
# C++ COMPILATION & EXECUTION
# ============================================================

def compile_cpp(source_code, output_path):
    """Compile C++ source code. Returns (success, error_message)."""
    source_path = output_path + ".cpp"
    with open(source_path, 'w') as f:
        f.write(source_code)

    try:
        result = subprocess.run(
            ["g++", "-std=c++20", "-O2", "-o", output_path, source_path],
            capture_output=True, text=True, timeout=COMPILE_TIMEOUT
        )
        if result.returncode != 0:
            return False, result.stderr[:500]
        return True, None
    except subprocess.TimeoutExpired:
        return False, "COMPILATION_TIMEOUT"
    except Exception as e:
        return False, str(e)


def execute_binary(binary_path, test_input):
    """Execute compiled binary with test input. Returns (success, stdout, stderr)."""
    try:
        result = subprocess.run(
            [binary_path],
            input=test_input,
            capture_output=True, text=True, timeout=EXECUTE_TIMEOUT
        )
        return True, result.stdout.strip(), result.stderr[:500]
    except subprocess.TimeoutExpired:
        return False, None, "EXECUTION_TIMEOUT"
    except Exception as e:
        return False, None, str(e)


def judge_pair(correct_code, buggy_code, test_case, tmpdir):
    """Compile both solutions, run with test case, compare outputs."""
    correct_bin = os.path.join(tmpdir, "correct")
    buggy_bin = os.path.join(tmpdir, "buggy")

    # Compile correct solution
    ok, err = compile_cpp(correct_code, correct_bin)
    if not ok:
        return "COMPILE_ERROR_CORRECT", None, None, err

    # Compile buggy solution
    ok, err = compile_cpp(buggy_code, buggy_bin)
    if not ok:
        return "COMPILE_ERROR_BUGGY", None, None, err

    # Execute correct solution
    ok, correct_out, err = execute_binary(correct_bin, test_case)
    if not ok:
        return "INVALID_TEST", None, None, f"Correct solution failed: {err}"

    # Execute buggy solution
    ok, buggy_out, err = execute_binary(buggy_bin, test_case)
    if not ok:
        # Buggy solution crashed/TLE'd = bug exposed!
        return "BUG_EXPOSED", correct_out, None, f"Buggy crashed: {err}"

    # Compare outputs
    if correct_out == buggy_out:
        return "NOT_EXPOSED", correct_out, buggy_out, None
    else:
        return "BUG_EXPOSED", correct_out, buggy_out, None


# ============================================================
# MAIN EVALUATION LOOP
# ============================================================

def load_existing_results(result_file):
    """Load already-completed pairs for resume support."""
    completed = set()
    if result_file.exists():
        with open(result_file, 'r') as f:
            results = json.load(f)
        for r in results:
            completed.add((r["problem_id"], r["pair"]))
    return completed


def save_results(result_file, results):
    """Save results to JSON (atomic write)."""
    tmp_file = str(result_file) + ".tmp"
    with open(tmp_file, 'w') as f:
        json.dump(results, f, indent=2)
    os.replace(tmp_file, result_file)


async def evaluate_model(model_key, prompt_type, problems, output_dir, max_pairs=None):
    """Run evaluation for one model + one prompt type across given problems.

    Uses asyncio.Semaphore(max_concurrent) so up to 5 API calls run in parallel.
    Blocking compilation/execution runs in a thread pool via asyncio.to_thread().
    """
    model_config = MODELS[model_key]
    prompt_template = PROMPTS[prompt_type]
    model_name = model_config["name"]
    concurrency = model_config["max_concurrent"]

    result_file = output_dir / f"{model_key}_{prompt_type}.json"
    log_file = LOGS_DIR / f"{model_key}_{prompt_type}_log.jsonl"

    # Resume support
    completed = load_existing_results(result_file)
    existing_results = []
    if result_file.exists():
        with open(result_file, 'r') as f:
            existing_results = json.load(f)

    results = list(existing_results)

    # Load all pairs
    all_pairs = []
    for rating, zip_name in problems:
        all_pairs.extend(load_pairs_from_zip(rating, zip_name))

    if max_pairs:
        all_pairs = all_pairs[:max_pairs]

    pending_pairs = [p for p in all_pairs if (p["problem_id"], p["pair"]) not in completed]

    print(f"\n{'='*70}")
    print(f"  Model: {model_name} ({model_config['id']})")
    print(f"  Prompt: {prompt_type}")
    print(f"  Total pairs: {len(all_pairs)}, Already done: {len(completed)}, Pending: {len(pending_pairs)}")
    print(f"  Concurrency: {concurrency} parallel requests")
    print(f"  Output: {result_file}")
    if model_config['is_free']:
        print(f"  ⚠️  Free model — daily quota: {rate_limiter.free_calls_today}/{FREE_MODEL_DAILY_LIMIT}")
    print(f"{'='*70}\n")

    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    # Shared state — all mutations happen inside `lock`
    sem = asyncio.Semaphore(concurrency)
    lock = asyncio.Lock()
    state = {"done": 0, "exposed": 0, "judged": 0, "stop": False}

    pbar = tqdm(total=len(all_pairs), desc=f"{model_name} [{prompt_type}]",
                ncols=100, initial=len(completed))

    async def process_pair(pair, session):
        # Fast-exit before acquiring semaphore slot
        if state["stop"]:
            return

        if model_config['is_free'] and not rate_limiter.can_make_free_call():
            state["stop"] = True
            tqdm.write(f"  [QUOTA] Free model daily limit reached ({rate_limiter.free_calls_today} calls). Stopping.")
            return

        async with sem:
            prompt = prompt_template.format(
                problem_statement=pair["problem_statement"],
                buggy_code=pair["buggy_code"],
            )

            api_result = await call_openrouter(session, model_config, prompt, pair)

            if api_result["error"] == "FREE_DAILY_LIMIT_REACHED":
                state["stop"] = True
                return

            result_entry = {
                "problem_id": pair["problem_id"],
                "pair": pair["pair"],
                "rating": pair["rating"],
                "bug_category": pair["bug_category"],
                "model": model_config["id"],
                "prompt_type": prompt_type,
                "generated_test_case": None,
                "correct_output": None,
                "buggy_output": None,
                "verdict": "ERROR",
                "compilation_ok": False,
                "execution_time_ms": 0,
                "api_response_time_ms": api_result["api_response_time_ms"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "error": api_result["error"],
            }

            test_case = api_result["test_case"]
            if test_case:
                result_entry["generated_test_case"] = test_case
                start = time.time()
                # Run blocking compile+execute in thread pool so event loop stays free
                with tempfile.TemporaryDirectory() as tmpdir:
                    verdict, correct_out, buggy_out, judge_err = await asyncio.to_thread(
                        judge_pair, pair["correct_code"], pair["buggy_code"], test_case, tmpdir
                    )
                exec_time = int((time.time() - start) * 1000)
                result_entry["verdict"] = verdict
                result_entry["correct_output"] = (correct_out or "")[:500]
                result_entry["buggy_output"] = (buggy_out or "")[:500]
                result_entry["compilation_ok"] = verdict not in ("COMPILE_ERROR_CORRECT", "COMPILE_ERROR_BUGGY")
                result_entry["execution_time_ms"] = exec_time
                result_entry["error"] = judge_err if judge_err else None
            else:
                result_entry["verdict"] = "NO_TEST_GENERATED"
                result_entry["error"] = "Could not extract test case from LLM response"

            # Serialise all state updates
            async with lock:
                results.append(result_entry)
                state["done"] += 1
                if result_entry["verdict"] == "BUG_EXPOSED":
                    state["exposed"] += 1
                if result_entry["verdict"] in ("BUG_EXPOSED", "NOT_EXPOSED"):
                    state["judged"] += 1

                if api_result.get("log_entry"):
                    with open(log_file, 'a') as f:
                        f.write(json.dumps(api_result["log_entry"]) + "\n")

                if state["done"] % 10 == 0:
                    save_results(result_file, results)
                    fer = (state["exposed"] / state["judged"] * 100) if state["judged"] > 0 else 0
                    sys.stdout.write(
                        f"[PROGRESS] {len(results)}/{len(all_pairs)} pairs | "
                        f"FER: {fer:.1f}% ({state['exposed']}/{state['judged']}) | "
                        f"verdict: {result_entry['verdict']}\n"
                    )
                    sys.stdout.flush()

            fer = (state["exposed"] / state["judged"] * 100) if state["judged"] > 0 else 0
            pbar.set_postfix({"FER": f"{fer:.1f}%", "exp": state["exposed"], "n": state["judged"]})
            pbar.update(1)

    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*[process_pair(pair, session) for pair in pending_pairs])

    pbar.close()
    save_results(result_file, results)

    exposed = sum(1 for r in results if r["verdict"] == "BUG_EXPOSED")
    not_exposed = sum(1 for r in results if r["verdict"] == "NOT_EXPOSED")
    invalid = sum(1 for r in results if r["verdict"] == "INVALID_TEST")
    errors = sum(1 for r in results if r["verdict"] in ("ERROR", "NO_TEST_GENERATED", "COMPILE_ERROR_CORRECT", "COMPILE_ERROR_BUGGY"))
    total_judged = exposed + not_exposed

    print(f"\n  ── Results for {model_name} [{prompt_type}] ──")
    print(f"  BUG_EXPOSED:    {exposed}")
    print(f"  NOT_EXPOSED:    {not_exposed}")
    print(f"  INVALID_TEST:   {invalid}")
    print(f"  ERRORS:         {errors}")
    print(f"  FER:            {exposed}/{total_judged} = {(exposed/total_judged*100) if total_judged > 0 else 0:.1f}%")
    print(f"  Saved to:       {result_file}\n")

    return results


# ============================================================
# SUMMARY TABLE GENERATION
# ============================================================

def generate_summary_table(output_dir):
    """Generate summary_table.csv from all result files."""
    import pandas as pd

    all_data = []
    for result_file in output_dir.glob("*.json"):
        if result_file.name.startswith("pilot"):
            continue
        with open(result_file) as f:
            results = json.load(f)
        all_data.extend(results)

    if not all_data:
        print("No results to summarize.")
        return

    df = pd.DataFrame(all_data)
    # Filter to only judged pairs
    judged = df[df["verdict"].isin(["BUG_EXPOSED", "NOT_EXPOSED"])]

    if judged.empty:
        print("No judged results to summarize.")
        return

    # Overall FER per model+prompt
    summary_rows = []
    for (model, prompt), group in judged.groupby(["model", "prompt_type"]):
        row = {
            "model": model,
            "prompt_type": prompt,
            "total_pairs": len(group),
            "bugs_exposed": (group["verdict"] == "BUG_EXPOSED").sum(),
            "overall_fer": round((group["verdict"] == "BUG_EXPOSED").mean() * 100, 1),
        }
        # Per-category FER
        for cat in [f"T{i}" for i in range(1, 9)]:
            cat_group = group[group["bug_category"] == cat]
            if len(cat_group) > 0:
                row[f"{cat}_fer"] = round((cat_group["verdict"] == "BUG_EXPOSED").mean() * 100, 1)
            else:
                row[f"{cat}_fer"] = None
        summary_rows.append(row)

    summary_df = pd.DataFrame(summary_rows)
    summary_path = output_dir / "summary_table.csv"
    summary_df.to_csv(summary_path, index=False)
    print(f"\n  Summary table saved to: {summary_path}")
    print(summary_df.to_string(index=False))


# ============================================================
# CLI
# ============================================================

async def main():
    parser = argparse.ArgumentParser(description="AlgoBugs Evaluation Engine")
    parser.add_argument("--pilot", action="store_true", help="Run pilot test on 2 problems with Gemini Flash")
    parser.add_argument("--model", type=str, choices=list(MODELS.keys()) + ["all"], help="Model to evaluate")
    parser.add_argument("--prompt", type=str, choices=["zero_shot", "cot", "few_shot", "both"], default="both", help="Prompt strategy")
    parser.add_argument("--summary", action="store_true", help="Generate summary table from existing results")
    parser.add_argument("--max-pairs", type=int, default=None, help="Limit number of pairs (for testing)")

    args = parser.parse_args()

    # Create directories
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    PILOT_DIR.mkdir(parents=True, exist_ok=True)

    if args.summary:
        generate_summary_table(RESULTS_DIR)
        return

    if args.prompt == "both":
        prompt_types = ["zero_shot", "cot"]
    else:
        prompt_types = [args.prompt]

    if args.pilot:
        print("\n" + "=" * 70)
        print("  🧪 PILOT TEST — 2 problems × GPT-4o (frontier paid model)")
        print("  Problems: 1400/2157c.zip + 2100/2149G.zip")
        print("=" * 70)

        for p_type in prompt_types:
            await evaluate_model("gpt4o", p_type, PILOT_PROBLEMS, PILOT_DIR)
        generate_summary_table(PILOT_DIR)
        return

    if not args.model:
        parser.print_help()
        return

    # Determine which models to run
    if args.model == "all":
        model_keys = list(MODELS.keys())
    else:
        model_keys = [args.model]

    # Discover all problems
    all_problems = discover_all_problems()
    print(f"\n  Found {len(all_problems)} problems across {len(set(r for r,_ in all_problems))} rating brackets")

    for model_key in model_keys:
        for prompt_type in prompt_types:
            await evaluate_model(model_key, prompt_type, all_problems, RESULTS_DIR, max_pairs=args.max_pairs)

    # Generate summary
    generate_summary_table(RESULTS_DIR)


if __name__ == "__main__":
    asyncio.run(main())
