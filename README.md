# AlgoBugs: Benchmarking LLMs for Corner Case Test Generation in Competitive Programming

**BSc CSE Final Year Design Project** — Daffodil International University, May 2026  
**Author:** Mohimenul Islam

---

## What is AlgoBugs?

Existing LLM code benchmarks reduce model performance to a single aggregate score. AlgoBugs asks a more specific question: *which categories of algorithmic bugs can a model reliably expose, and where does its reasoning break down?*

AlgoBugs is a diagnostic benchmark built on **1,000 paired C++ submissions** from Codeforces. Each pair contains a Wrong Answer (WA) submission and its corresponding Accepted (AC) solution for the same problem. The bug in each pair is manually identified and classified under an 8-category taxonomy. Five LLMs are tasked with generating a test input that exposes the bug — correctness is judged by local g++ compilation and differential execution, not by another LLM.

---

## Repository Contents

| File / Directory | Description |
|------------------|-------------|
| [`report/`](report/) | Thesis PDF + full LaTeX source |
| [`algobugs_dataset.csv`](algobugs_dataset.csv) | Flat CSV of all 1,000 pairs: problem ID, title, URL, difficulty, bug category (T1–T8), natural-language bug description, submission IDs |
| [`dataset/`](dataset/) | 1,000 paired C++ submissions across 40 problems (zip archives with source code + problem statements) |
| [`results/`](results/) | Per-model evaluation JSON files (verdict, generated test, outputs) + `summary_table.csv` (FER per model × prompt × category) |
| [`evaluation-engine/`](evaluation-engine/) | Python pipeline that runs the benchmark |
| [`chrome-extension/`](chrome-extension/) | Browser tool used to collect the dataset |
| [`web-showcase/`](web-showcase/) | Interactive results website |

---

## Key Results

| Model | Zero-Shot | Chain-of-Thought | Few-Shot |
|-------|-----------|-----------------|----------|
| Gemini Flash 2.0 | 15.6% | 15.4% | 14.9% |
| LLaMA 3.3 70B | 17.8% | 20.0% | **21.2%** |
| Qwen3 Coder 30B | **20.2%** | 17.4% | 19.3% |
| DeepSeek V3 | 14.2% | 10.8% | 14.5% |
| GPT-5.1 | 14.6% | 15.1% | 20.2%* |

\* GPT-5.1 few-shot run covered 822 pairs (870 attempted; 48 excluded as compile errors or invalid tests).

**FER = bugs exposed / (bugs exposed + not exposed) x 100%.** Compile errors and invalid tests excluded from denominator.

**Key findings:**
- T3 (Off-by-One) and T4 (Wrong Conditional) are the most exposed categories (~25% avg)
- T1 (Integer Overflow) and T2 (Modular Arithmetic) resist all models (~4–8% avg)
- Chain-of-thought prompting provides no consistent improvement over zero-shot
- Few-shot helps LLaMA (+3.4 pp) and GPT-5.1 (+5.6 pp); no meaningful effect on the other three models

---

## Bug Taxonomy (T1–T8)

| Code | Category | Description |
|------|----------|-------------|
| T1 | Integer Overflow | `int` used where `long long` required; silent overflow at test boundaries |
| T2 | Modular Arithmetic | Missing `% MOD`, wrong modular inverse, or off-by-one in modular reduction |
| T3 | Off-by-One / Boundary | Loop runs one step too many or too few; fence-post error |
| T4 | Wrong Conditional | `<` vs `<=`, wrong branch, inverted condition |
| T5 | Algorithmic Flaw | Greedy strategy incorrect; wrong DP transition |
| T6 | State / Initialization | Variable not reset between test cases; wrong initial value |
| T7 | Corner Case Omission | Edge input (n=0, empty array, single element) not handled |
| T8 | I/O & Output Format | Wrong output format, extra/missing newlines, wrong precision |

---

## Dataset

```
dataset/
  {rating}/           # 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100
    {problem_id}.zip
      "{PROBLEM_ID} - pair{N}/metadata.json"
      "{PROBLEM_ID} - pair{N}/problem_statement.md"
      "{PROBLEM_ID} - pair{N}/solution_buggy.cpp"
      "{PROBLEM_ID} - pair{N}/solution_correct.cpp"
```

- 40 problems, 5 per difficulty bracket (rating 1400–2100)
- 25 pairs per problem = 1,000 pairs total
- All bugs are real WA submissions from Codeforces (post-contest, publicly visible)
- Taxonomic labels validated by inter-rater reliability study (Cohen's kappa)

---

## Running the Evaluation Engine

### Prerequisites

```bash
pip install -r evaluation-engine/requirements.txt
# Also requires: g++ with C++20 support
```

### Set your API key

```bash
export OPENROUTER_API_KEY="your-key-here"   # get one at openrouter.ai
```

### Run a single model

```bash
cd evaluation-engine
python3 evaluate_models.py --model gemini_flash --prompt zero_shot
```

Available model keys: `gemini_flash`, `deepseek_v3`, `llama70b`, `qwen_coder`, `gpt51`  
Available prompt keys: `zero_shot`, `cot`, `few_shot`, `both`

The engine resumes automatically from checkpoints if interrupted. Results are saved to `results/{model}_{prompt}.json`.

### Regenerate the summary table

```bash
python3 evaluate_models.py --summary
```

---

## Chrome Extension (Data Collection)

The extension was used to collect the dataset. Codeforces does not expose submission source code through its public API, and direct scraping is blocked by Cloudflare. The extension runs inside Chrome (where Cloudflare checks pass naturally) and mimics deliberate human browsing — 3-second inter-request delay, burst limit of 8 requests, daily cap of 25 pairs.

**Installation:**
1. Open Chrome → `chrome://extensions/`
2. Enable Developer Mode
3. Click "Load unpacked" → select the `chrome-extension/` folder

See [`chrome-extension/README.md`](chrome-extension/README.md) for usage details.

---

## Web Showcase

An interactive single-page app with results dashboard, dataset browser, and evaluation replay.

**Live Demo:** [mohimenul-islam.github.io/AlgoBugs-Benchmark](https://mohimenul-islam.github.io/AlgoBugs-Benchmark/) · [Vercel Mirror](https://algo-bugs-benchmark.vercel.app/)

***Slide URL***
http://Shorturl.at/RmISu

**Run locally:**
```bash
cd web-showcase
python3 -m http.server 8080
# then open http://localhost:8080
```

**Deploy to Vercel (free):**
1. Push this repository to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import repo
3. Framework: Other → Deploy

---

## Report

The full thesis report is at [`report/FYDP_Report.pdf`](report/FYDP_Report.pdf).  
LaTeX source is in [`report/source/`](report/source/).

---

## License

Dataset and code released for academic use. All Codeforces submissions were publicly accessible at the time of collection (post-contest period). No personally identifiable information is retained.
