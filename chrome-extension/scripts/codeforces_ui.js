function setProgress(msg) {
  const p = document.getElementById('progress');
  p.textContent = msg;
  p.classList.remove('hidden');
}

function clearProgress() {
  document.getElementById('progress').classList.add('hidden');
}

function updateResultsCount(count) {
  document.getElementById('results-count').textContent = `${count} pair${count !== 1 ? 's' : ''} found`;
  document.getElementById('download-all-btn').disabled = count === 0;
  checkFailedPairs();
}

function setStatus(text, className) {
  const el = document.getElementById('status-state');
  el.textContent = text;
  el.className = `value ${className}`;
}

function updateStatusDashboard() {
  if (reqQueue) {
    document.getElementById('status-delay').textContent = `${(reqQueue.currentDelay / 1000).toFixed(1)}s`;
    document.getElementById('status-requests').textContent = reqQueue.requestCount;
  }
}

function renderPlaceholder() {
  const results = document.getElementById('results');
  results.innerHTML = '<div class="placeholder">No results yet.</div>';
  updateResultsCount(0);
}

function addCopy(block) {
  block.addEventListener('click', () => {
    const text = block.querySelector('pre').textContent;
    navigator.clipboard.writeText(text).then(() => {
      block.classList.add('copied');
      setTimeout(() => block.classList.remove('copied'), 1200);
    });
  });
}

function createSourceHtml(source, type) {
  const div = el('div', 'source');
  if (source) {
    div.innerHTML = `<span class="copy-badge">Copied!</span><div class="lang">${source.lang}</div><pre>${sanitize(source.source)}</pre>`;
    addCopy(div);
  } else {
    div.innerHTML = `<div class="error">${type} source not available</div>`;
  }
  return div;
}

function buildCardContent(problemData, pairIndex) {
  const { problem, pair, acSource, buggySource } = problemData;
  const frag = document.createDocumentFragment();
  
  const header = el('div', 'result-header');
  const title = el('div', 'problem-title', `${problem.contestId}${problem.index}: ${sanitize(problem.name)} <span style="font-weight:400;color:#666">(${problem.rating || '?'})</span> - Pair ${pairIndex + 1}`);
  header.appendChild(title);
  header.appendChild(el('span', 'tag ok', 'AC'));
  header.appendChild(el('span', 'tag bad', `${pair.other.verdict.replace(/_/g, ' ')} (${pair.other.passedTestCount || 0} tests)`));
  frag.appendChild(header);
  
  const links = el('div', 'actions');
  links.appendChild(Object.assign(el('a', 'small-btn', 'Problem'), { href: `https://codeforces.com/contest/${problem.contestId}/problem/${problem.index}`, target: '_blank' }));
  links.appendChild(Object.assign(el('a', 'small-btn', 'AC Sub'), { href: pair.accepted.link, target: '_blank' }));
  links.appendChild(Object.assign(el('a', 'small-btn', 'Other Sub'), { href: pair.other.link, target: '_blank' }));
  
  const downloadBtn = el('button', 'small-btn download', 'Download');
  downloadBtn.addEventListener('click', () => downloadSinglePair(problemData, pairIndex));
  links.appendChild(downloadBtn);

  if (!acSource || !buggySource) {
    const retryBtn = el('button', 'small-btn retry-btn', '⟳ Retry');
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying...';
      await retryFetchSource(pairIndex);
    });
    links.appendChild(retryBtn);
  }
  
  frag.appendChild(links);

  const sourcesContainer = el('div', 'source-blocks');
  sourcesContainer.appendChild(createSourceHtml(acSource, 'AC'));
  sourcesContainer.appendChild(createSourceHtml(buggySource, 'Buggy'));
  frag.appendChild(sourcesContainer);

  return frag;
}

function addResultCard(problemData, pairIndex) {
  const results = document.getElementById('results');
  const wrapper = el('div', 'result-item');
  wrapper.id = `pair-card-${pairIndex}`;
  wrapper.appendChild(buildCardContent(problemData, pairIndex));
  results.appendChild(wrapper);
}

function updateResultCard(pairIndex) {
  const wrapper = document.getElementById(`pair-card-${pairIndex}`);
  if (wrapper && state.pairs[pairIndex]) {
    wrapper.innerHTML = '';
    wrapper.appendChild(buildCardContent(state.pairs[pairIndex], pairIndex));
  }
  checkFailedPairs();
}

function checkFailedPairs() {
  const retryAllBtn = document.getElementById('retry-all-btn');
  const hasFailed = state.pairs.some(p => !p.acSource || !p.buggySource);
  if (hasFailed) retryAllBtn.classList.remove('hidden');
  else retryAllBtn.classList.add('hidden');
}

function generatePairZipFolder(folder, problemData, pairIndex) {
  const { problem, metadata, acSource, buggySource, statement } = problemData;
  folder.file('metadata.json', JSON.stringify(metadata, null, 2));
  if (acSource) folder.file(`solution_correct${getFileExtension(acSource.lang)}`, acSource.source);
  if (buggySource) folder.file(`solution_buggy${getFileExtension(buggySource.lang)}`, buggySource.source);
  if (statement) folder.file('problem_statement.md', statement);
}

async function downloadSinglePair(problemData, pairIndex) {
  const zip = new JSZip();
  const folderName = `${problemData.problem.contestId}${problemData.problem.index} - pair${pairIndex + 1}`;
  generatePairZipFolder(zip.folder(folderName), problemData, pairIndex);
  
  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderName}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadAllProblems() {
  if (state.pairs.length === 0) return;
  const format = document.getElementById('export-format').value;
  const zip = new JSZip();
  
  state.pairs.forEach((problemData, idx) => {
    const folderName = `${problemData.problem.contestId}${problemData.problem.index} - pair${idx + 1}`;
    generatePairZipFolder(zip.folder(folderName), problemData, idx);
  });
  
  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `codeforces_dataset_${Date.now()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

function attachEvents() {
  document.getElementById('advanced-toggle').addEventListener('click', () => {
    const el = document.getElementById('advanced-settings');
    el.classList.toggle('hidden');
    document.querySelector('#advanced-toggle .icon').textContent = el.classList.contains('hidden') ? '▼' : '▲';
  });

  const form = document.getElementById('config-form');
  const cancelBtn = document.getElementById('cancel-btn');
  const results = document.getElementById('results');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.running) return;
    state.abort = false; state.running = true; 
    results.innerHTML = '';
    state.pairs = [];
    updateResultsCount(0);
    
    document.getElementById('status-dashboard').classList.remove('hidden');
    setStatus('Running', 'state-running');
    
    const problemInput = document.getElementById('problem-input').value;
    const count = +document.getElementById('pair-count').value;
    const delay = +document.getElementById('api-delay').value;
    const minTestCases = +document.getElementById('min-test-cases').value;
    const targetLanguage = document.getElementById('target-language').value;
    const burstLimit = +document.getElementById('burst-limit').value;
    const cooldownDur = +document.getElementById('cooldown-duration').value;

    cancelBtn.disabled = false;
    try {
      await findPairsForProblem(problemInput, count, delay, minTestCases, targetLanguage, burstLimit, cooldownDur);
      if (state.abort) { setProgress('Stopped'); setStatus('Stopped', 'state-error'); }
      else setStatus('Done', 'state-done');
    } catch(err) {
      if (state.pairs.length > 0) {
        setProgress('Stopped due to error');
        setStatus('Error', 'state-error');
      } else {
        results.innerHTML = `<div class="error">${err.message}</div>`;
        setStatus('Error', 'state-error');
      }
    } finally {
      state.running = false; cancelBtn.disabled = true;
      setTimeout(() => clearProgress(), 1500);
    }
  });
  
  cancelBtn.addEventListener('click', () => {
    if (state.running) {
      state.abort = true;
      state.abortController?.abort();
      setProgress('Stopping...');
      setStatus('Stopping...', 'state-error');
    }
  });
  
  document.getElementById('download-all-btn').addEventListener('click', downloadAllProblems);
  
  document.getElementById('retry-all-btn').addEventListener('click', async () => {
    const btn = document.getElementById('retry-all-btn');
    btn.disabled = true;
    btn.textContent = 'Retrying...';
    setStatus('Retrying', 'state-running');
    
    for (let i = 0; i < state.pairs.length; i++) {
      if (!state.pairs[i].acSource || !state.pairs[i].buggySource) {
        await retryFetchSource(i);
      }
    }
    
    btn.textContent = 'Retry All Failed';
    btn.disabled = false;
    setStatus('Done', 'state-done');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderPlaceholder();
  attachEvents();
});
