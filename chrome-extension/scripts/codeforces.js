// Codeforces problem pair & source fetcher with metadata generation and ZIP download
// NOTE: Codeforces API does NOT expose submission source. Source pages require authentication and
// CORS prevents direct fetch from extension unless user is logged-in and we have host permission.
// We will fetch HTML of submission page and attempt to extract the source code.

const CF_API_BASE = 'https://codeforces.com/api/';

const state = {
  abort: false,
  running: false,
  pairs: [], // Store collected pairs for the chosen problem
  problemMeta: null, // { contestId, index, name, rating }
  abortController: null
};

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

function sleep(ms, signal){
  return new Promise((resolve, reject)=>{
    const id = setTimeout(()=>{
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(){
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
  // Add random variation of ±1 second to the base delay
  const variation = (Math.random() - 0.5) * 2; // Random number between -1 and 1
  const finalDelay = Math.max(0.1, baseDelay + variation); // Ensure minimum 0.1 second delay
  return finalDelay * 1000; // Convert to milliseconds
}

function setProgress(msg){ const p = document.getElementById('progress'); p.textContent = msg; p.classList.remove('hidden'); }

function clearProgress(){ document.getElementById('progress').classList.add('hidden'); }

function updateResultsCount(count) {
  document.getElementById('results-count').textContent = `${count} pair${count !== 1 ? 's' : ''} found`;
  document.getElementById('download-all-btn').disabled = count === 0;
}

async function fetchJSON(url, params, signal){
  const u = new URL(url);
  if (params) Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  const res = await fetch(u.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://codeforces.com/',
      'Origin': 'https://codeforces.com',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
  },
  credentials: 'include',
  signal
  });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const data = await res.json();
  if(data.status !== 'OK') throw new Error(data.comment || 'API Error');
  return data.result;
}

async function fetchProblemStatement(contestId, problemIndex, signal) {
  try {
    const url = `https://codeforces.com/contest/${contestId}/problem/${problemIndex}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://codeforces.com/',
        'Origin': 'https://codeforces.com',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1'
  },
  credentials: 'include',
  signal
    });
    if (!res.ok) return null;
    const html = await res.text();
    
    const div = document.createElement('div');
    div.innerHTML = html;
    
    // Look for the problem statement in the specific structure
    const problemHolder = div.querySelector('.problemindexholder .ttypography .problem-statement');
    if (!problemHolder) return null;
    
    // Convert to markdown-like format
    let markdown = '';
    
    // Title from header
    const titleEl = problemHolder.querySelector('.header .title');
    if (titleEl) {
      markdown += `# ${titleEl.textContent.trim()}\n\n`;
    }
    
    // Time and memory limits from header
    const header = problemHolder.querySelector('.header');
    if (header) {
      const timeLimit = header.querySelector('.time-limit');
      const memoryLimit = header.querySelector('.memory-limit');
      const inputFile = header.querySelector('.input-file');
      const outputFile = header.querySelector('.output-file');
      
      if (timeLimit) {
        const timeLimitText = timeLimit.textContent.replace('time limit per test', '').trim();
        markdown += `**Time limit:** ${timeLimitText}\n`;
      }
      if (memoryLimit) {
        const memoryLimitText = memoryLimit.textContent.replace('memory limit per test', '').trim();
        markdown += `**Memory limit:** ${memoryLimitText}\n`;
      }
      if (inputFile) {
        const inputText = inputFile.textContent.replace('input', '').trim();
        markdown += `**Input:** ${inputText}\n`;
      }
      if (outputFile) {
        const outputText = outputFile.textContent.replace('output', '').trim();
        markdown += `**Output:** ${outputText}\n\n`;
      }
    }
    
    // Problem description (first div after header)
    const problemDesc = problemHolder.querySelector('.header + div');
    if (problemDesc) {
      markdown += `## Problem Statement\n\n${problemDesc.textContent.trim()}\n\n`;
    }
    
    // Input specification
    const inputSpec = problemHolder.querySelector('.input-specification');
    if (inputSpec) {
      const title = inputSpec.querySelector('.section-title');
      if (title) {
        markdown += `## ${title.textContent.trim()}\n\n`;
      }
      // Get all content except the title
      const content = inputSpec.cloneNode(true);
      const titleToRemove = content.querySelector('.section-title');
      if (titleToRemove) titleToRemove.remove();
      markdown += `${content.textContent.trim()}\n\n`;
    }
    
    // Output specification
    const outputSpec = problemHolder.querySelector('.output-specification');
    if (outputSpec) {
      const title = outputSpec.querySelector('.section-title');
      if (title) {
        markdown += `## ${title.textContent.trim()}\n\n`;
      }
      // Get all content except the title
      const content = outputSpec.cloneNode(true);
      const titleToRemove = content.querySelector('.section-title');
      if (titleToRemove) titleToRemove.remove();
      markdown += `${content.textContent.trim()}\n\n`;
    }
    
    // Sample tests
    const sampleTests = problemHolder.querySelector('.sample-tests');
    if (sampleTests) {
      const title = sampleTests.querySelector('.section-title');
      if (title) {
        markdown += `## ${title.textContent.trim()}\n\n`;
      }
      
      // Input samples
      const inputSample = sampleTests.querySelector('.input pre');
      if (inputSample) {
        markdown += `### Input\n\`\`\`\n${inputSample.textContent.trim()}\n\`\`\`\n\n`;
      }
      
      // Output samples
      const outputSample = sampleTests.querySelector('.output pre');
      if (outputSample) {
        markdown += `### Output\n\`\`\`\n${outputSample.textContent.trim()}\n\`\`\`\n\n`;
      }
    }
    
    // Notes section
    const notes = problemHolder.querySelector('.note');
    if (notes) {
      const title = notes.querySelector('.section-title');
      if (title) {
        markdown += `## ${title.textContent.trim()}\n\n`;
      }
      // Get all content except the title
      const content = notes.cloneNode(true);
      const titleToRemove = content.querySelector('.section-title');
      if (titleToRemove) titleToRemove.remove();
      markdown += `${content.textContent.trim()}\n\n`;
    }
    
    return markdown.trim();
  } catch (error) {
    console.error('Error fetching problem statement:', error);
    return null;
  }
}

async function fetchSubmissionSource(contestId, submissionId, signal){
  // Only try contest path since we're excluding gym problems
  const url = `https://codeforces.com/contest/${contestId}/submission/${submissionId}`;
  try {
    const res = await fetch(url, { 
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': `https://codeforces.com/contest/${contestId}`,
        'Origin': 'https://codeforces.com',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1'
  },
  credentials: 'include', 
  signal
    });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    // Submission source is inside <pre id="program-source-text"> or #program-source-text inside a code element
    const div = document.createElement('div');
    div.innerHTML = html;
    const pre = div.querySelector('#program-source-text');
    if(pre){
      // Try to find language in the submission table structure
      let lang = 'Unknown';
      
      // Look for the datatable structure with submission info
      const dataTable = div.querySelector('.datatable table');
      if (dataTable) {
        // Find the row with our submission ID
        const rows = dataTable.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            const idCell = cells[0];
            const langCell = cells[3]; // Language is typically in the 4th column (index 3)
            
            // Check if this row contains our submission ID
            if (idCell && idCell.textContent.trim() === submissionId.toString()) {
              if (langCell && langCell.textContent.trim()) {
                lang = langCell.textContent.trim();
                console.log('Language found in datatable for submission', submissionId, ':', lang);
                break;
              }
            }
          }
        }
      }
      
      // If still unknown, try the old selectors as fallback
      if (lang === 'Unknown') {
        const langSelectors = [
          '.program-source-info a',
          '.roundbox .info a',
          '.submit-source .info a',
          '.program-source .info a',
          '.info a',
          '.lang a'
        ];
        
        for (const selector of langSelectors) {
          const langEl = div.querySelector(selector);
          if (langEl && langEl.textContent.trim() && langEl.textContent.trim() !== '') {
            lang = langEl.textContent.trim();
            console.log('Language found with fallback selector:', selector, '->', lang);
            break;
          }
        }
      }
      
      // If still unknown, try to find language in any text that might contain it
      if (lang === 'Unknown') {
        // Look for common language patterns in the entire HTML
        const htmlText = html.toLowerCase();
        if (htmlText.includes('c++17')) lang = 'C++17 (GCC 7-32)';
        else if (htmlText.includes('c++20')) lang = 'C++20 (GCC 13-64)';
        else if (htmlText.includes('c++14')) lang = 'C++14 (GCC 6-32)';
        else if (htmlText.includes('c++')) lang = 'C++';
        else if (htmlText.includes('python 3')) lang = 'Python 3';
        else if (htmlText.includes('python')) lang = 'Python';
        else if (htmlText.includes('java 21')) lang = 'Java 21';
        else if (htmlText.includes('java 17')) lang = 'Java 17';
        else if (htmlText.includes('java 11')) lang = 'Java 11';
        else if (htmlText.includes('java 8')) lang = 'Java 8';
        else if (htmlText.includes('java')) lang = 'Java';
        else if (htmlText.includes('pypy')) lang = 'PyPy 3';
        else if (htmlText.includes('javascript')) lang = 'JavaScript';
        else if (htmlText.includes('kotlin')) lang = 'Kotlin/JVM';
        else if (htmlText.includes('rust')) lang = 'Rust';
        else if (htmlText.includes('golang') || htmlText.includes(' go ')) lang = 'Go';
        
        if (lang !== 'Unknown') {
          console.log('Language found via text search:', lang);
        }
      }
      
      console.log('Final raw language detected:', lang); // Debug log
      return { source: pre.textContent, lang, url };
    }
    // If we can't find it maybe login required
    if(html.includes('Enter | Register') || html.includes('Register»')){
      throw new Error('Not logged in to Codeforces; source hidden');
    }
  } catch(err){
    throw new Error('Source not found: ' + err.message);
  }
  throw new Error('Source not found');
}

function generateMetadata(problem, acSource, buggySource, pair) {
  const problemId = `CF_${problem.contestId}${problem.index}`;
  
  // Get extensions from available sources, fallback to .txt
  const acExtension = acSource ? getFileExtension(acSource.lang) : '.txt';
  const buggyExtension = buggySource ? getFileExtension(buggySource.lang) : '.txt';
  
  console.log('Generating metadata for:', problemId); // Debug log
  console.log('AC source:', acSource ? acSource.lang : 'null', '->', acExtension); // Debug log
  console.log('Buggy source:', buggySource ? buggySource.lang : 'null', '->', buggyExtension); // Debug log
  
  return {
    problem_id: problemId,
    problem_title: problem.name,
    problem_url: `https://codeforces.com/contest/${problem.contestId}/problem/${problem.index}`,
    rating: problem.rating || null,
    correct_solution_verdict: "OK", // Always OK for accepted solutions
    buggy_solution_verdict: pair.other.verdict, // Exact verdict from Codeforces
    buggy_solution_passed_tests: pair.other.passedTestCount || 0, // Number of test cases passed
    correct_solution_submission_id: pair.accepted.id,
    buggy_solution_submission_id: pair.other.id,
    bug_category: null, // To be added manually later
    bug_description_natural_language: null, // To be added manually later
    correct_solution_file: `solution_correct${acExtension}`,
    buggy_solution_file: `solution_buggy${buggyExtension}`,
    problem_statement_file: "problem_statement.md"
  };
}

function getFileExtension(language) {
  console.log('getFileExtension called with language:', language); // Debug log
  if (!language) return '.txt';
  
  const langMap = {
    'C++': '.cpp',
    'C++14': '.cpp',
    'C++17': '.cpp',
    'C++20': '.cpp',
    'C++23': '.cpp',
    'GNU C++': '.cpp',
    'MS C++': '.cpp',
    'Clang++': '.cpp',
    'Python': '.py',
    'Python 2': '.py',
    'Python 3': '.py',
    'PyPy': '.py',
    'PyPy 2': '.py',
    'PyPy 3': '.py',
    'Java': '.java',
    'Java 8': '.java',
    'Java 11': '.java',
    'Java 17': '.java',
    'Java 21': '.java',
    'C': '.c',
    'GNU C': '.c',
    'MS C': '.c',
    'C#': '.cs',
    'C# 8': '.cs',
    'C# 10': '.cs',
    'JavaScript': '.js',
    'Node.js': '.js',
    'Go': '.go',
    'Rust': '.rs',
    'Kotlin': '.kt',
    'Kotlin/JVM': '.kt',
    'Kotlin/Native': '.kt',
    'Scala': '.scala',
    'Pascal': '.pas',
    'Delphi': '.pas',
    'PHP': '.php',
    'Ruby': '.rb',
    'Perl': '.pl',
    'Haskell': '.hs',
    'OCaml': '.ml',
    'F#': '.fs',
    'D': '.d',
    'Nim': '.nim',
    'Crystal': '.cr'
  };
  
  // First try exact match
  if (langMap[language]) {
    console.log('Exact match found:', language, '->', langMap[language]); // Debug log
    return langMap[language];
  }
  
  // Then try partial matches
  for (const [key, ext] of Object.entries(langMap)) {
    if (language.toLowerCase().includes(key.toLowerCase())) {
      console.log('Partial match found:', language, 'matches', key, '->', ext); // Debug log
      return ext;
    }
  }
  
  console.log('No match found for language:', language, 'returning .txt'); // Debug log
  return '.txt'; // fallback
}

function renderPlaceholder(){
  const results = document.getElementById('results');
  results.innerHTML = '<div class="placeholder">No results yet.</div>';
  updateResultsCount(0);
}

function sanitize(str){
  return str.replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
}

function addResultCard(problemData, pairIndex){
  const { problem, pair, acSource, buggySource, metadata, statement } = problemData;
  const results = document.getElementById('results');
  const wrapper = el('div','result-item');
  const header = el('div','result-header');
  const title = el('div','problem-title', `${problem.contestId}${problem.index}: ${sanitize(problem.name)} <span style="font-weight:400;color:#666">(${problem.rating||'?'})</span> - Pair ${pairIndex+1}`);
  header.appendChild(title);
  header.appendChild(el('span','tag ok','AC'));
  const buggyTag = el('span','tag bad',`${pair.other.verdict.replace(/_/g,' ')} (${pair.other.passedTestCount || 0} tests)`);
  header.appendChild(buggyTag);
  wrapper.appendChild(header);
  
  const links = el('div','actions');
  links.appendChild(Object.assign(el('a','small-btn','Problem'),{href:`https://codeforces.com/contest/${problem.contestId}/problem/${problem.index}`,target:'_blank'}));
  links.appendChild(Object.assign(el('a','small-btn','AC Sub'),{href:pair.accepted.link,target:'_blank'}));
  links.appendChild(Object.assign(el('a','small-btn','Other Sub'),{href:pair.other.link,target:'_blank'}));
  
  // Add download button for individual pair
  const downloadBtn = el('button','small-btn download','Download');
  downloadBtn.addEventListener('click', () => downloadSinglePair(problemData, pairIndex));
  links.appendChild(downloadBtn);
  
  wrapper.appendChild(links);

  const sourcesContainer = el('div','source-blocks');
  const acSourceDiv = el('div','source');
  const otherSourceDiv = el('div','source');
  
  if (acSource) {
    acSourceDiv.innerHTML = `<span class="copy-badge">Copied!</span><div class="lang">${acSource.lang}</div><pre>${sanitize(acSource.source)}</pre>`;
    addCopy(acSourceDiv);
  } else {
    acSourceDiv.innerHTML = '<div class="error">AC source not available</div>';
  }
  
  if (buggySource) {
    otherSourceDiv.innerHTML = `<span class="copy-badge">Copied!</span><div class="lang">${buggySource.lang}</div><pre>${sanitize(buggySource.source)}</pre>`;
    addCopy(otherSourceDiv);
  } else {
    otherSourceDiv.innerHTML = '<div class="error">Buggy source not available</div>';
  }
  
  sourcesContainer.appendChild(acSourceDiv);
  sourcesContainer.appendChild(otherSourceDiv);
  wrapper.appendChild(sourcesContainer);

  results.appendChild(wrapper);
}

async function downloadSinglePair(problemData, pairIndex) {
  const { problem, metadata, acSource, buggySource, statement } = problemData;
  const zip = new JSZip();
  const folderName = `${problem.contestId}${problem.index} - pair${pairIndex+1}`;
  const folder = zip.folder(folderName);
  
  // Add metadata.json
  folder.file('metadata.json', JSON.stringify(metadata, null, 2));
  
  // Add source files
  if (acSource) {
    const ext = getFileExtension(acSource.lang);
    folder.file(`solution_correct${ext}`, acSource.source);
  }
  
  if (buggySource) {
    const ext = getFileExtension(buggySource.lang);
    folder.file(`solution_buggy${ext}`, buggySource.source);
  }
  
  // Add problem statement if available
  if (statement) {
    folder.file('problem_statement.md', statement);
  }
  
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
  
  const zip = new JSZip();
  
  state.pairs.forEach((problemData, idx) => {
    const { problem, metadata, acSource, buggySource, statement } = problemData;
    const folderName = `${problem.contestId}${problem.index} - pair${idx+1}`;
    const folder = zip.folder(folderName);
    
    // Add metadata.json
    folder.file('metadata.json', JSON.stringify(metadata, null, 2));
    
    // Add source files
    if (acSource) {
      const ext = getFileExtension(acSource.lang);
      folder.file(`solution_correct${ext}`, acSource.source);
    }
    
    if (buggySource) {
      const ext = getFileExtension(buggySource.lang);
      folder.file(`solution_buggy${ext}`, buggySource.source);
    }
    
    // Add problem statement if available
    if (statement) {
      folder.file('problem_statement.md', statement);
    }
  });
  
  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `codeforces_problems_${Date.now()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

function addCopy(block){
  block.addEventListener('click', ()=>{
    const text = block.querySelector('pre').textContent;
    navigator.clipboard.writeText(text).then(()=>{
      block.classList.add('copied');
      setTimeout(()=>block.classList.remove('copied'), 1200);
    });
  });
}

function parseProblemInput(input) {
  // Accept formats: "1705A" or "1705 A" or full URL
  input = (input || '').trim();
  if (!input) throw new Error('Please enter a problem ID or URL');
  // URL case
  try {
    if (input.startsWith('http')) {
      const u = new URL(input);
      const parts = u.pathname.split('/').filter(Boolean);
      // /contest/1705/problem/A or /problemset/problem/1705/A
      const cidIdx = parts.findIndex(p => p.toLowerCase() === 'contest');
      const psetIdx = parts.findIndex(p => p.toLowerCase() === 'problemset');
      if (cidIdx !== -1 && parts[cidIdx+1] && parts[cidIdx+3]) {
        return { contestId: parseInt(parts[cidIdx+1], 10), index: parts[cidIdx+3].toUpperCase() };
      }
      if (psetIdx !== -1) {
        // Expect: problemset/problem/<contestId>/<index>
        const cid = parts[psetIdx+2];
        const pidx = parts[psetIdx+3];
        if (cid && pidx) {
          return { contestId: parseInt(cid, 10), index: pidx.toUpperCase() };
        }
      }
    }
  } catch {}
  // ID case like 1705A or "1705 A"
  const m = input.match(/^(\d+)\s*-?\s*([A-Za-z][0-9A-Za-z]*)$/);
  if (m) return { contestId: parseInt(m[1],10), index: m[2].toUpperCase() };
  // Fallback simple like 1705A no space
  const m2 = input.match(/^(\d+)([A-Za-z][0-9A-Za-z]*)$/);
  if (m2) return { contestId: parseInt(m2[1],10), index: m2[2].toUpperCase() };
  throw new Error('Could not parse problem input');
}

async function fetchProblemInfo(contestId, index, signal) {
  // Pull problemset to get name/rating quickly (cached by CF/CDN)
  const res = await fetchJSON(CF_API_BASE+'problemset.problems', undefined, signal);
  const found = res.problems.find(p => p.contestId === contestId && p.index === index);
  if (found) return found;
  // If not found in problemset (rare), minimal fallback
  return { contestId, index, name: `${contestId}${index}`, rating: null };
}

function groupPairsByUser(subs, wantedPairs, minTestCasesPassed) {
  const grouped = new Map();
  
  // Define allowed verdicts for buggy solutions
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
    
    // Sort by time ascending (earliest first)
    arr.sort((a,b)=> a.creationTimeSeconds - b.creationTimeSeconds);
    
    // Find first AC submission
    const firstAC = arr.find(s => s.verdict === 'OK');
    if (!firstAC) continue; // Skip users with no AC submissions
    
    // Find the first AC index
    const firstACIndex = arr.indexOf(firstAC);
    
    // Look backwards from first AC to find immediately preceding valid buggy submission
    let precedingBuggy = null;
    for (let i = firstACIndex - 1; i >= 0; i--) {
      const submission = arr[i];
      
      // Check if this submission meets our buggy criteria
      if (submission.verdict && 
          allowedBuggyVerdicts.includes(submission.verdict) &&
          submission.passedTestCount && 
          submission.passedTestCount >= minTestCasesPassed) {
        precedingBuggy = submission;
        break; // Take the first (most recent) valid buggy submission before AC
      }
    }
    
    // If we found a valid pair, add it
    if (precedingBuggy) {
      pairs.push({
        accepted: { 
          id: firstAC.id, 
          link: `https://codeforces.com/contest/${firstAC.contestId}/submission/${firstAC.id}` 
        },
        other: { 
          id: precedingBuggy.id, 
          link: `https://codeforces.com/contest/${precedingBuggy.contestId}/submission/${precedingBuggy.id}`, 
          verdict: precedingBuggy.verdict,
          passedTestCount: precedingBuggy.passedTestCount
        }
      });
    }
    // If no valid preceding buggy found, skip this user entirely
  }
  
  return pairs.slice(0, wantedPairs);
}

async function findPairsForProblem(problemInput, pairCount, delay, minTestCasesPassed){
  state.abortController?.abort();
  state.abortController = new AbortController();
  const { signal } = state.abortController;
  const { contestId, index } = parseProblemInput(problemInput);
  if (!contestId || !index) throw new Error('Invalid problem input');
  if (contestId >= 100000) throw new Error('Gym problems are not supported');

  setProgress(`Loading problem ${contestId}${index} info...`);
  const problem = await fetchProblemInfo(contestId, index, signal);
  state.problemMeta = problem;

  setProgress('Fetching recent submissions...');
  const submissions = await fetchJSON(CF_API_BASE+'contest.status',{ contestId, count: 5000 }, signal);
  // Filter to this problem index
  const list = submissions.filter(s=> s.problem && s.problem.index === index);
  if (list.length === 0) throw new Error('No submissions found for this problem');

  // Build user pairs
  const pairs = groupPairsByUser(list, pairCount, minTestCasesPassed);
  if (pairs.length === 0) throw new Error('Could not find AC/buggy pairs from the same user with specified criteria');

  const picked = [];
  for (let i=0; i<pairs.length; i++){
    if (state.abort) break;
    const pair = pairs[i];
    setProgress(`Fetching sources for pair ${i+1}/${pairs.length}...`);
    const randomDelay = getRandomDelay(delay);
  await sleep(randomDelay, signal);
    let acSource=null, buggySource=null;
  try { acSource = await fetchSubmissionSource(contestId, pair.accepted.id, signal); } catch(e){ if (e.name==='AbortError') throw e; console.error('AC fetch failed', e); }
  try { buggySource = await fetchSubmissionSource(contestId, pair.other.id, signal); } catch(e){ if (e.name==='AbortError') throw e; console.error('Buggy fetch failed', e); }

    setProgress(`Fetching statement for ${contestId}${index}...`);
  const statement = await fetchProblemStatement(contestId, index, signal);
    const metadata = generateMetadata(problem, acSource, buggySource, pair);
    const problemData = { problem, pair, acSource, buggySource, metadata, statement };
    picked.push(problemData);
  // Update shared state incrementally so partial results remain available on Stop
  state.pairs = picked.slice();
    addResultCard(problemData, i);
    updateResultsCount(picked.length);
  }
  state.pairs = picked;
  clearProgress();
  return picked;
}

function attachForm(){
  const form = document.getElementById('config-form');
  const cancelBtn = document.getElementById('cancel-btn');
  const downloadAllBtn = document.getElementById('download-all-btn');
  const results = document.getElementById('results');
  
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(state.running){ return; }
    state.abort=false; state.running=true; 
    results.innerHTML='';
    state.pairs = [];
    updateResultsCount(0);
    const problemInput = document.getElementById('problem-input').value;
    const count = +document.getElementById('pair-count').value;
    const delay = +document.getElementById('api-delay').value;
    const minTestCases = +document.getElementById('min-test-cases').value;

    cancelBtn.disabled=false;
    try {
      await findPairsForProblem(problemInput, count, delay, minTestCases);
      if(state.abort){ setProgress('Stopped'); }
    } catch(err){
      // If we already have some results, keep them and just show a progress message
      if (state.pairs && state.pairs.length > 0) {
        setProgress('Stopped');
      } else {
        results.innerHTML = `<div class="error">${err.message}</div>`;
      }
    } finally {
      state.running=false; cancelBtn.disabled=true;
      setTimeout(()=>clearProgress(),1500);
    }
  });
  
  cancelBtn.addEventListener('click', ()=>{
    if(state.running){
      state.abort = true;
      state.abortController?.abort();
      setProgress('Stopping...');
    }
  });
  
  downloadAllBtn.addEventListener('click', downloadAllProblems);
}

document.addEventListener('DOMContentLoaded', ()=>{
  renderPlaceholder();
  attachForm();
});
