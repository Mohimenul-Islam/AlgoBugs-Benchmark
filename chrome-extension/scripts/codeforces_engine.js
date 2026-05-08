class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.baseDelay = 3000;
    this.currentDelay = 3000;
    this.maxDelay = 60000;
    this.requestCount = 0;
    this.burstCount = 0;
    this.burstLimit = 8;
    this.cooldownDuration = 15000;
  }

  async fetchWithRetry(url, options = {}, signal, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      
      this.requestCount++;
      this.burstCount++;
      updateStatusDashboard();

      if (this.burstCount >= this.burstLimit) {
        setStatus('Paused', 'state-paused');
        await this.cooldown(signal);
        this.burstCount = 0;
        setStatus('Running', 'state-running');
      } else {
        const delay = getRandomDelay(this.currentDelay / 1000);
        await sleep(delay, signal);
      }

      try {
        const res = await fetch(url, options);
        if (res.status === 429 || res.status === 403) {
          throw new Error('Rate Limited');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        this.currentDelay = Math.max(2000, this.currentDelay - 500);
        updateStatusDashboard();
        return res;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (err.message === 'Rate Limited' || err.message.includes('HTTP 50')) {
          this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 2);
          setStatus('Rate Limited', 'state-error');
          await sleep(5000 * attempt, signal); // Exponential backoff
          setStatus('Running', 'state-running');
          if (attempt === maxRetries) throw err;
        } else {
          throw err;
        }
      }
    }
  }

  async cooldown(signal) {
    let remain = this.cooldownDuration;
    while (remain > 0) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      document.getElementById('status-cooldown').textContent = `${(remain/1000).toFixed(1)}s`;
      await sleep(1000, signal);
      remain -= 1000;
    }
    document.getElementById('status-cooldown').textContent = '-';
  }
}

const reqQueue = new RequestQueue();

async function getCachedOrFetch(key, fetchFn, signal) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], async (result) => {
      if (result[key] && result[key].data && (Date.now() - result[key].timestamp < 24 * 60 * 60 * 1000)) {
        resolve(result[key].data);
      } else {
        try {
          const data = await fetchFn();
          chrome.storage.local.set({ [key]: { data, timestamp: Date.now() } });
          resolve(data);
        } catch (err) {
          reject(err);
        }
      }
    });
  });
}

async function fetchSubmissionSource(contestId, submissionId, signal) {
  const url = `https://codeforces.com/contest/${contestId}/submission/${submissionId}`;
  const cacheKey = `source_${submissionId}`;
  
  return getCachedOrFetch(cacheKey, async () => {
    const res = await reqQueue.fetchWithRetry(url, {
      method: 'GET',
      headers: {
        'User-Agent': navigator.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal
    });
    
    const html = await res.text();
    const div = document.createElement('div');
    div.innerHTML = html;
    const pre = div.querySelector('#program-source-text');
    
    if (pre) {
      let lang = 'Unknown';
      const dataTable = div.querySelector('.datatable table');
      if (dataTable) {
        const rows = dataTable.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4 && cells[0].textContent.trim() === submissionId.toString()) {
            if (cells[3].textContent.trim()) lang = cells[3].textContent.trim();
            break;
          }
        }
      }
      return { source: pre.textContent, lang, url };
    }
    throw new Error('Source not found. Requires login or rate limited.');
  }, signal);
}

async function fetchProblemStatement(contestId, problemIndex, signal) {
  if (state.cachedStatement) return state.cachedStatement;
  
  const cacheKey = `statement_${contestId}_${problemIndex}`;
  const url = `https://codeforces.com/contest/${contestId}/problem/${problemIndex}`;
  
  state.cachedStatement = await getCachedOrFetch(cacheKey, async () => {
    const res = await reqQueue.fetchWithRetry(url, {
      method: 'GET',
      headers: {
        'User-Agent': navigator.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal
    });
    
    const html = await res.text();
    const div = document.createElement('div');
    div.innerHTML = html;
    
    const problemHolder = div.querySelector('.problemindexholder .ttypography .problem-statement');
    if (!problemHolder) return null;
    
    const turndownService = typeof TurndownService !== 'undefined' ? new TurndownService({ headingStyle: 'atx' }) : null;
    if (turndownService) {
      turndownService.addRule('math-inline', {
        filter: function (node) { return node.nodeName === 'SPAN' && node.classList.contains('tex-span'); },
        replacement: function (content, node) { return '$' + node.textContent.trim() + '$'; }
      });
      turndownService.addRule('math-block', {
        filter: function (node) { return node.nodeName === 'DIV' && node.classList.contains('tex-block'); },
        replacement: function (content, node) { return '\n$$\n' + node.textContent.trim() + '\n$$\n'; }
      });
      turndownService.addRule('math-sup', {
        filter: 'sup',
        replacement: function(content, node) { return '^' + node.textContent; }
      });
      turndownService.addRule('math-sub', {
        filter: 'sub',
        replacement: function(content, node) { return '_' + node.textContent; }
      });
    }

    const toMarkdown = (node) => {
      if (!node) return '';
      if (turndownService) {
        const clone = node.cloneNode(true);
        const titleToRemove = clone.querySelector('.section-title');
        if (titleToRemove) titleToRemove.remove();
        return turndownService.turndown(clone);
      }
      return node.textContent.trim();
    };
    
    let markdown = '';
    const titleEl = problemHolder.querySelector('.header .title');
    if (titleEl) markdown += `# ${titleEl.textContent.trim()}\n\n`;
    
    const header = problemHolder.querySelector('.header');
    if (header) {
      const timeLimit = header.querySelector('.time-limit');
      const memoryLimit = header.querySelector('.memory-limit');
      if (timeLimit) markdown += `**Time limit:** ${timeLimit.textContent.replace('time limit per test', '').trim()}\n`;
      if (memoryLimit) markdown += `**Memory limit:** ${memoryLimit.textContent.replace('memory limit per test', '').trim()}\n\n`;
    }

    const problemDesc = problemHolder.querySelector('.header + div');
    if (problemDesc) markdown += `## Problem Statement\n\n${toMarkdown(problemDesc)}\n\n`;
    
    const inputSpec = problemHolder.querySelector('.input-specification');
    if (inputSpec) markdown += `## Input\n\n${toMarkdown(inputSpec)}\n\n`;
    
    const outputSpec = problemHolder.querySelector('.output-specification');
    if (outputSpec) markdown += `## Output\n\n${toMarkdown(outputSpec)}\n\n`;
    
    const sampleTests = problemHolder.querySelector('.sample-tests');
    if (sampleTests) {
      markdown += `## Sample Tests\n\n`;
      const samples = sampleTests.querySelectorAll('.sample-test .input, .sample-test .output');
      samples.forEach(s => {
        const type = s.classList.contains('input') ? 'Input' : 'Output';
        const pre = s.querySelector('pre');
        if (pre) {
          let content = '';
          pre.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) content += child.textContent;
            else if (child.nodeName === 'DIV' || child.nodeName === 'P') content += child.textContent + '\n';
            else if (child.nodeName === 'BR') content += '\n';
            else content += child.textContent;
          });
          markdown += `### ${type}\n\`\`\`\n${content.trim()}\n\`\`\`\n\n`;
        }
      });
    }
    
    const notes = problemHolder.querySelector('.note');
    if (notes) markdown += `## Note\n\n${toMarkdown(notes)}\n\n`;
    
    return markdown.trim() || 'Statement could not be parsed fully.';
  }, signal);
  
  return state.cachedStatement;
}

async function fetchProblemInfo(contestId, index, signal) {
  const res = await fetchJSON(CF_API_BASE+'problemset.problems', undefined, signal);
  const found = res.problems.find(p => p.contestId === contestId && p.index === index);
  return found || { contestId, index, name: `${contestId}${index}`, rating: null };
}

function groupPairsByUser(subs, wantedPairs, minTestCasesPassed) {
  const grouped = new Map();
  const allowedBuggyVerdicts = ['WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'RUNTIME_ERROR', 'MEMORY_LIMIT_EXCEEDED'];
  
  subs.forEach(s => {
    const handle = s.author?.members?.[0]?.handle; 
    if(!handle) return;
    if(!grouped.has(handle)) grouped.set(handle, []);
    grouped.get(handle).push(s);
  });
  
  const pairs = [];
  for (const [handle, arr] of grouped) {
    if (pairs.length >= wantedPairs) break;
    arr.sort((a,b)=> a.creationTimeSeconds - b.creationTimeSeconds);
    
    const firstAC = arr.find(s => s.verdict === 'OK');
    if (!firstAC) continue;
    
    const firstACIndex = arr.indexOf(firstAC);
    let precedingBuggy = null;
    
    for (let i = firstACIndex - 1; i >= 0; i--) {
      const submission = arr[i];
      if (submission.verdict && allowedBuggyVerdicts.includes(submission.verdict) &&
          submission.passedTestCount && submission.passedTestCount >= minTestCasesPassed) {
        precedingBuggy = submission;
        break;
      }
    }
    
    if (precedingBuggy) {
      pairs.push({
        accepted: { id: firstAC.id, link: `https://codeforces.com/contest/${firstAC.contestId}/submission/${firstAC.id}` },
        other: { id: precedingBuggy.id, link: `https://codeforces.com/contest/${precedingBuggy.contestId}/submission/${precedingBuggy.id}`, verdict: precedingBuggy.verdict, passedTestCount: precedingBuggy.passedTestCount }
      });
    }
  }
  return pairs.slice(0, wantedPairs);
}

async function warmupSession(signal) {
  try {
    setProgress('Warming up session to avoid detection...');
    await fetch('https://codeforces.com/', { mode: 'no-cors', signal });
    await sleep(2000, signal);
  } catch (e) { }
}

async function findPairsForProblem(problemInput, pairCount, baseDelay, minTestCases, targetLanguage, burstLimit, cooldownDur) {
  state.abortController?.abort();
  state.abortController = new AbortController();
  const { signal } = state.abortController;
  
  reqQueue.baseDelay = baseDelay * 1000;
  reqQueue.currentDelay = baseDelay * 1000;
  reqQueue.burstLimit = burstLimit;
  reqQueue.cooldownDuration = cooldownDur * 1000;
  reqQueue.requestCount = 0;
  reqQueue.burstCount = 0;
  state.cachedStatement = null;
  updateStatusDashboard();
  
  const { contestId, index } = parseProblemInput(problemInput);
  if (!contestId || !index) throw new Error('Invalid problem input');
  if (contestId >= 100000) throw new Error('Gym problems not supported');

  await warmupSession(signal);

  setProgress(`Loading problem ${contestId}${index} info...`);
  const problem = await fetchProblemInfo(contestId, index, signal);
  state.problemMeta = problem;

  setProgress('Fetching submissions...');
  let allList = [];
  let pairs = [];
  let from = 1;
  const fetchSize = 10000;
  
  while (pairs.length < pairCount) {
    if (state.abortController?.signal?.aborted) break;
    setProgress(`Fetching submissions (checked ${from-1}, found ${pairs.length}/${pairCount} pairs)...`);
    
    let subs = [];
    try {
      subs = await fetchJSON(CF_API_BASE+'contest.status', { contestId, from, count: fetchSize }, signal);
    } catch(e) {
      if(e.name === 'AbortError') throw e;
      console.warn('Stopped fetching due to API response:', e.message);
      break;
    }
    
    if (!subs || subs.length === 0) break;
    
    let list = subs.filter(s => s.problem && s.problem.index === index);
    
    if (targetLanguage !== 'all') {
      list = list.filter(s => {
        const lang = (s.programmingLanguage || '').toLowerCase();
        if (targetLanguage === 'cpp') return lang.includes('c++') || lang.includes('g++') || lang.includes('clang');
        if (targetLanguage === 'python') return lang.includes('python') || lang.includes('pypy');
        if (targetLanguage === 'java') return lang.includes('java') && !lang.includes('javascript');
        return true;
      });
    }
    
    allList = allList.concat(list);
    pairs = groupPairsByUser(allList, pairCount, minTestCases);
    
    if (subs.length < fetchSize) break;
    from += fetchSize;
    await sleep(300, signal);
  }

  if (pairs.length === 0) throw new Error('Could not find enough AC/buggy pairs with criteria');

  setProgress(`Fetching statement for ${contestId}${index}...`);
  await fetchProblemStatement(contestId, index, signal);

  const picked = [];
  for (let i = 0; i < pairs.length; i++) {
    if (state.abort) break;
    const pair = pairs[i];
    setProgress(`Fetching sources for pair ${i + 1}/${pairs.length}...`);
    
    let acSource = null, buggySource = null;
    try { acSource = await fetchSubmissionSource(contestId, pair.accepted.id, signal); } catch(e){ if (e.name==='AbortError') throw e; console.error(e); }
    try { buggySource = await fetchSubmissionSource(contestId, pair.other.id, signal); } catch(e){ if (e.name==='AbortError') throw e; console.error(e); }

    const statement = state.cachedStatement;
    const metadata = generateMetadata(problem, acSource, buggySource, pair);
    const problemData = { problem, pair, acSource, buggySource, metadata, statement };
    
    picked.push(problemData);
    state.pairs = picked.slice();
    addResultCard(problemData, i);
    updateResultsCount(picked.length);
  }
  
  state.pairs = picked;
  clearProgress();
  return picked;
}

async function retryFetchSource(pairIndex) {
  if (state.abortController?.signal?.aborted) return;
  const problemData = state.pairs[pairIndex];
  const { contestId } = problemData.problem;
  const signal = state.abortController?.signal;

  let updated = false;
  
  if (!problemData.acSource) {
    try {
      problemData.acSource = await fetchSubmissionSource(contestId, problemData.pair.accepted.id, signal, 3);
      updated = true;
    } catch(e) { console.error('Retry AC failed', e); }
  }
  
  if (!problemData.buggySource) {
    try {
      problemData.buggySource = await fetchSubmissionSource(contestId, problemData.pair.other.id, signal, 3);
      updated = true;
    } catch(e) { console.error('Retry Buggy failed', e); }
  }

  if (updated) {
    problemData.metadata = generateMetadata(problemData.problem, problemData.acSource, problemData.buggySource, problemData.pair);
    updateResultCard(pairIndex);
  }
}
