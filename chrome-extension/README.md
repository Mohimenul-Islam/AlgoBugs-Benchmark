# Codeforces Submission Extractor

A Chrome extension built for the **AlgoBugs** thesis project (BSc CSE, Daffodil International University, 2026) to automate collection of WA/AC submission pairs from Codeforces for dataset construction.

---

## The Problem It Solves

Codeforces does not provide submission source code through its public API. Two options existed:

1. **Manual copy-paste** — infeasible for 1,000 pairs across 40 problems
2. **Web scraping** — blocked by Cloudflare's bot-detection layer

This extension solves the problem by running inside Chrome, where Cloudflare's checks pass naturally. It mimics deliberate human browsing behaviour: a configurable inter-request delay (default 3 seconds), a burst limit after which the engine pauses for a mandatory cooldown, and a daily soft cap of 25 pairs maximum to avoid imposing load on Codeforces infrastructure.

---

## Features

- **Pair mining**: For a given problem ID, finds WA to AC submission pairs from the same user
- **Quality filtering**: Only keeps buggy solutions that pass the minimum number of sample test cases, ensuring the bug is a genuine corner case rather than a trivial error
- **Language filter**: C++ only, Python only, Java only, or all languages
- **Export options**: Individual ZIP per pair (default) or single ZIP containing all pairs
- **Rate limiting**: Configurable burst limit (default: 8 requests), cooldown duration (default: 15 s), and per-request delay (default: 3 s)
- **Output format**: Each pair is packaged as a ZIP containing `metadata.json`, `solution_correct.cpp`, `solution_buggy.cpp`, and `problem_statement.md`

---

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top-right toggle)
4. Click "Load unpacked" and select the `dataset-downloader/` directory
5. The extension icon will appear in the Chrome toolbar

---

## Usage

1. Click the extension icon to open the popup
2. Enter a Codeforces problem ID (e.g. `1705A`) or a full problem URL
3. Set the desired number of pairs, language filter, and export format
4. Click **Fetch** — the extension collects pairs and offers ZIP downloads as they are ready
5. Click **Download All** once complete to save all pairs at once

**Advanced settings** (expand gear icon): adjust burst limit, cooldown duration, and max retries.

---

## Output Format

Each downloaded ZIP contains:

```
{PROBLEM_ID} - pair{N}/
  metadata.json             # bug_category (T1-T8), bug_description, problem_id, pair_id
  problem_statement.md      # full problem text converted from HTML to Markdown
  solution_correct.cpp      # the accepted (AC) submission
  solution_buggy.cpp        # the wrong-answer (WA) submission
```

This format is directly compatible with the AlgoBugs evaluation engine (`evaluate_models.py`).

---

## File Structure

```
dataset-downloader/
  manifest.json             # Extension manifest (Manifest V3)
  background.js             # Service worker: opens popup page on icon click
  pages/
    codeforces.html         # Extension popup UI
  scripts/
    codeforces_engine.js    # Core: request queue, rate limiter, submission fetcher
    codeforces_ui.js        # UI event handlers, result rendering, download logic
    codeforces_utils.js     # Utilities: language detection, file naming, metadata
    jszip.min.js            # Third-party: JSZip library for ZIP generation
    turndown.js             # Third-party: HTML to Markdown for problem statements
  styles/
    common.css              # Shared styles
    codeforces.css          # Extension-specific styles
```

---

## Ethical Use

This extension was designed with respect for Codeforces infrastructure:
- All submissions accessed are publicly visible on Codeforces after the contest period
- Inter-request delays and burst limits prevent high-frequency automated access
- No authentication bypass or private data access is performed
- The dataset was collected once for academic research; the extension is not intended for continuous or mass scraping
