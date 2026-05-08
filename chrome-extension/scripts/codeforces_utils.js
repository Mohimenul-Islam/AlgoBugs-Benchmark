const CF_API_BASE = 'https://codeforces.com/api/';

const state = {
  abort: false,
  running: false,
  pairs: [],
  problemMeta: null,
  abortController: null,
  cachedStatement: null
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function getRandomDelay(baseDelay) {
  const variation = (Math.random() - 0.5) * 1.5;
  const finalDelay = Math.max(1, baseDelay + variation);
  return finalDelay * 1000;
}

function sanitize(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function parseProblemInput(input) {
  input = (input || '').trim();
  if (!input) throw new Error('Please enter a problem ID or URL');
  try {
    if (input.startsWith('http')) {
      const u = new URL(input);
      const parts = u.pathname.split('/').filter(Boolean);
      const cidIdx = parts.findIndex(p => p.toLowerCase() === 'contest');
      const psetIdx = parts.findIndex(p => p.toLowerCase() === 'problemset');
      if (cidIdx !== -1 && parts[cidIdx + 1] && parts[cidIdx + 3]) {
        return { contestId: parseInt(parts[cidIdx + 1], 10), index: parts[cidIdx + 3].toUpperCase() };
      }
      if (psetIdx !== -1) {
        const cid = parts[psetIdx + 2];
        const pidx = parts[psetIdx + 3];
        if (cid && pidx) return { contestId: parseInt(cid, 10), index: pidx.toUpperCase() };
      }
    }
  } catch {}
  const m = input.match(/^(\d+)\s*-?\s*([A-Za-z][0-9A-Za-z]*)$/);
  if (m) return { contestId: parseInt(m[1], 10), index: m[2].toUpperCase() };
  const m2 = input.match(/^(\d+)([A-Za-z][0-9A-Za-z]*)$/);
  if (m2) return { contestId: parseInt(m2[1], 10), index: m2[2].toUpperCase() };
  throw new Error('Could not parse problem input');
}

function getFileExtension(language) {
  if (!language) return '.txt';
  const langMap = {
    'C++': '.cpp', 'C++14': '.cpp', 'C++17': '.cpp', 'C++20': '.cpp', 'C++23': '.cpp',
    'GNU C++': '.cpp', 'MS C++': '.cpp', 'Clang++': '.cpp',
    'Python': '.py', 'Python 2': '.py', 'Python 3': '.py', 'PyPy': '.py', 'PyPy 2': '.py', 'PyPy 3': '.py',
    'Java': '.java', 'Java 8': '.java', 'Java 11': '.java', 'Java 17': '.java', 'Java 21': '.java',
    'C': '.c', 'GNU C': '.c', 'MS C': '.c',
    'C#': '.cs', 'C# 8': '.cs', 'C# 10': '.cs',
    'JavaScript': '.js', 'Node.js': '.js', 'Go': '.go', 'Rust': '.rs',
    'Kotlin': '.kt', 'Kotlin/JVM': '.kt', 'Kotlin/Native': '.kt',
    'Scala': '.scala', 'Pascal': '.pas', 'Delphi': '.pas', 'PHP': '.php',
    'Ruby': '.rb', 'Perl': '.pl', 'Haskell': '.hs', 'OCaml': '.ml', 'F#': '.fs',
    'D': '.d', 'Nim': '.nim', 'Crystal': '.cr'
  };
  if (langMap[language]) return langMap[language];
  for (const [key, ext] of Object.entries(langMap)) {
    if (language.toLowerCase().includes(key.toLowerCase())) return ext;
  }
  return '.txt';
}

function generateMetadata(problem, acSource, buggySource, pair) {
  const problemId = `CF_${problem.contestId}${problem.index}`;
  const acExtension = acSource && acSource.lang ? getFileExtension(acSource.lang) : '.txt';
  const buggyExtension = buggySource && buggySource.lang ? getFileExtension(buggySource.lang) : '.txt';
  
  return {
    problem_id: problemId,
    problem_title: problem.name,
    problem_url: `https://codeforces.com/contest/${problem.contestId}/problem/${problem.index}`,
    rating: problem.rating || null,
    correct_solution_verdict: "OK",
    buggy_solution_verdict: pair.other.verdict,
    buggy_solution_passed_tests: pair.other.passedTestCount || 0,
    correct_solution_submission_id: pair.accepted.id,
    buggy_solution_submission_id: pair.other.id,
    bug_category: null,
    bug_description_natural_language: null,
    correct_solution_file: `solution_correct${acExtension}`,
    buggy_solution_file: `solution_buggy${buggyExtension}`,
    problem_statement_file: "problem_statement.md"
  };
}

async function fetchJSON(url, params, signal) {
  const u = new URL(url);
  if (params) Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*'
    },
    signal
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error(data.comment || 'API Error');
  return data.result;
}
