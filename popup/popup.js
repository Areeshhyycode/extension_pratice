// ==================== GROQ AI ====================
const GROQ_KEY = "YOUR_GROQ_API_KEY_HERE";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

async function callGroq(systemMsg, userMsg, expectJson = true) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + GROQ_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
      ],
      temperature: 0.3,
      max_tokens: 2048
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Groq ' + res.status + ': ' + err);
  }

  const json = await res.json();
  const content = json.choices[0].message.content;

  if (!expectJson) return content;

  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return { text: content };
  }
}

// ==================== TAB NAVIGATION ====================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
  });
});

// ==================== EXTRACT JOB ====================
document.getElementById('btn-extract').addEventListener('click', async () => {
  const loading = document.getElementById('extraction-loading');
  const result = document.getElementById('extraction-result');
  loading.classList.remove('hidden');
  result.classList.add('hidden');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractJob' });

    if (response && response.success) {
      // Process directly here (avoid service worker)
      const jobData = await processJobDirectly(response.data, tab.url);
      displayJobResult(jobData);
    } else {
      alert('Could not extract from this page.');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    loading.classList.add('hidden');
  }
});

async function processJobDirectly(pageData, url) {
  const cvs = await getCVs();
  let cvContext = '';
  if (cvs.length > 0) {
    cvContext = '\n\nUser CVs:\n' + cvs.map((cv, i) =>
      `CV ${i + 1}: "${cv.name}" - Skills: ${cv.skills?.join(', ')} | Exp: ${cv.experience}`
    ).join('\n') + '\n\nDetermine BEST CV match with score 0-100.';
  }

  const prompt = `Extract job details. Return ONLY JSON:
{"jobTitle":"","company":"","location":"","experience":"","requirements":["s1","s2"],"summary":""${cvs.length > 0 ? ',"bestCV":{"name":"","score":85,"reason":""}' : ''}}

URL: ${url}
${pageData.title ? 'Title: ' + pageData.title : ''}
${pageData.company ? 'Company: ' + pageData.company : ''}

Content:
${(pageData.rawText || '').substring(0, 4000)}
${cvContext}`;

  return await callGroq('You extract job details. Return valid JSON only.', prompt);
}

document.getElementById('btn-screenshot').addEventListener('click', async () => {
  const loading = document.getElementById('extraction-loading');
  const result = document.getElementById('extraction-result');
  loading.classList.remove('hidden');
  result.classList.add('hidden');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getVisibleText' });

    if (response && response.text) {
      const jobData = await processJobDirectly({ rawText: response.text }, tab.url);
      displayJobResult(jobData);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    loading.classList.add('hidden');
  }
});

function displayJobResult(data) {
  const result = document.getElementById('extraction-result');
  result.classList.remove('hidden');

  document.getElementById('result-title').textContent = data.jobTitle || '-';
  document.getElementById('result-company').textContent = data.company || '-';
  document.getElementById('result-location').textContent = data.location || '-';
  document.getElementById('result-experience').textContent = data.experience || '-';

  const reqList = document.getElementById('result-requirements');
  reqList.innerHTML = '';
  if (data.requirements?.length) {
    data.requirements.forEach(req => {
      const li = document.createElement('li');
      li.textContent = req;
      reqList.appendChild(li);
    });
  }

  if (data.bestCV) {
    document.getElementById('matched-cv-name').textContent = data.bestCV.name;
    const score = data.bestCV.score || 0;
    document.getElementById('score-fill').style.width = score + '%';
    document.getElementById('score-text').textContent = score + '%';
  }

  window.currentJobData = data;
}

document.getElementById('btn-autofill').addEventListener('click', doSmartAutoFill);

// ==================== SAVE JOB ====================
document.getElementById('btn-save-job').addEventListener('click', async () => {
  if (!window.currentJobData) return;
  const jobs = await getHistory();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  jobs.unshift({
    ...window.currentJobData,
    url: tab.url,
    savedAt: new Date().toISOString(),
    id: Date.now()
  });
  await chrome.storage.local.set({ savedJobs: jobs });
  alert('Job saved!');
  loadHistory();
});

// ==================== SMART AUTO-FILL (Pure AI) ====================
async function doSmartAutoFill() {
  const cvs = await getCVs();
  const savedAnswers = await getSavedAnswers();
  const activeCvName = await getActiveCv();

  if (cvs.length === 0) {
    alert('Pehle My CVs tab mein PDF upload karo!');
    return;
  }

  // Pick active CV (selected one or first)
  const cv = cvs.find(c => c.name === activeCvName) || cvs[0];

  const loading = document.getElementById('autofill-loading');
  const loadingMsg = document.getElementById('autofill-loading-msg');
  loading.classList.remove('hidden');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    loadingMsg.textContent = 'Reading form fields...';
    const questionsResult = await chrome.tabs.sendMessage(tab.id, { action: 'getUnfilledQuestions' });

    if (!questionsResult?.success) {
      throw new Error('Could not read form fields');
    }

    const unfilledQuestions = questionsResult.questions.filter(q => !q.isFilled);

    if (unfilledQuestions.length === 0) {
      alert('All fields are already filled!');
      return;
    }

    loadingMsg.textContent = 'AI is generating answers (' + unfilledQuestions.length + ' questions)...';

    // Build CV context
    const cvContext = `Name: ${cv.fullName}
Email: ${cv.email}
Phone: ${cv.phone}
Skills: ${cv.skills?.join(', ')}
Experience: ${cv.experience}
Education: ${cv.education}`;

    // Build saved answers context
    const savedContext = savedAnswers.length > 0
      ? '\n\nPreviously saved answers:\n' + savedAnswers.map(a => `${a.label}: ${a.value}`).join('\n')
      : '';

    // Build questions context
    const questionsList = unfilledQuestions.map((q, i) => {
      let qStr = `${i + 1}. "${q.label}"`;
      if (q.options && q.options.length > 0) {
        qStr += ` [Options: ${q.options.join(' / ')}]`;
      }
      if (q.type) qStr += ` (type: ${q.type})`;
      return qStr;
    }).join('\n');

    const aiPrompt = `You are filling a job application form.

APPLICANT INFO (from CV):
${cvContext}
${savedContext}

QUESTIONS TO ANSWER:
${questionsList}

Rules:
- Use info from CV when possible
- For Yes/No questions, intelligently answer based on context (e.g. willing to relocate=Yes, own conveyance=Yes)
- For options [A / B / C], pick the BEST one
- For text questions, write 1-2 professional sentences
- For unknown personal info (birthplace, age, etc), make reasonable Pakistani professional answers
- Return ONLY valid JSON: {"question label exactly as given": "answer", ...}

Return JSON now:`;

    const aiAnswers = await callGroq(
      'You answer job application forms intelligently using CV data. Return valid JSON only with question labels as keys.',
      aiPrompt
    );

    if (!aiAnswers || typeof aiAnswers !== 'object' || aiAnswers.text) {
      throw new Error('AI did not return valid answers');
    }

    // Convert AI answers to fillable format
    const answersToFill = [];
    Object.entries(aiAnswers).forEach(([question, answer]) => {
      answersToFill.push({ label: question.toLowerCase(), value: String(answer) });
    });

    // Also add CV basic fields as fallback
    const cvAnswers = [
      { label: 'name', value: cv.fullName },
      { label: 'full name', value: cv.fullName },
      { label: 'first name', value: cv.fullName?.split(' ')[0] || '' },
      { label: 'last name', value: cv.fullName?.split(' ').slice(1).join(' ') || '' },
      { label: 'email', value: cv.email },
      { label: 'phone', value: cv.phone },
      { label: 'mobile', value: cv.phone },
      { label: 'contact', value: cv.phone },
      { label: 'skills', value: cv.skills?.join(', ') || '' },
      { label: 'experience', value: cv.experience || '' },
      { label: 'education', value: cv.education || '' }
    ];
    cvAnswers.forEach(a => { if (a.value) answersToFill.push(a); });

    // Add saved answers
    savedAnswers.forEach(a => answersToFill.push(a));

    loadingMsg.textContent = 'Filling form fields...';
    const fillResult = await chrome.tabs.sendMessage(tab.id, {
      action: 'autoFillFromSaved',
      answers: answersToFill
    });

    const resultDiv = document.getElementById('autofill-result');
    const msg = document.getElementById('autofill-msg');
    resultDiv.classList.remove('hidden', 'success', 'fail');

    if (fillResult && fillResult.filled > 0) {
      msg.textContent = '✓ Filled ' + fillResult.filled + ' fields successfully!';
      resultDiv.classList.add('success');

      // Auto-save these answers for future use
      const newSaved = [...savedAnswers];
      Object.entries(aiAnswers).forEach(([q, a]) => {
        const labelLower = q.toLowerCase();
        if (!newSaved.find(s => s.label === labelLower)) {
          newSaved.push({ label: labelLower, value: String(a) });
        }
      });
      await saveSavedAnswers(newSaved);
      loadSavedAnswers();
    } else {
      msg.textContent = '✗ Could not match any fields on this page';
      resultDiv.classList.add('fail');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    loading.classList.add('hidden');
  }
}

document.getElementById('btn-do-autofill').addEventListener('click', doSmartAutoFill);

// ==================== ACTIVE CV ====================
async function getActiveCv() {
  return (await chrome.storage.local.get('activeCv')).activeCv || '';
}

async function loadActiveCvSelector() {
  const cvs = await getCVs();
  const select = document.getElementById('active-cv-select');
  const activeCv = await getActiveCv();

  select.innerHTML = '<option value="">First CV (default)</option>' +
    cvs.map(cv => `<option value="${cv.name}" ${cv.name === activeCv ? 'selected' : ''}>${cv.name}</option>`).join('');
}

document.getElementById('active-cv-select').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ activeCv: e.target.value });
});

// ==================== SAVE FORM ANSWERS ====================
document.getElementById('btn-save-form').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.tabs.sendMessage(tab.id, { action: 'saveFormAnswers' });

    if (result?.success && result.fields.length > 0) {
      const existing = await getSavedAnswers();
      result.fields.forEach(f => {
        const idx = existing.findIndex(e => e.label === f.label);
        if (idx >= 0) existing[idx].value = f.value;
        else existing.push(f);
      });
      await saveSavedAnswers(existing);
      loadSavedAnswers();
      alert('Saved ' + result.fields.length + ' answers!');
    } else {
      alert('No filled fields found. Fill some fields first.');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

// ==================== SAVED ANSWERS ====================
async function getSavedAnswers() {
  return (await chrome.storage.local.get('savedAnswers')).savedAnswers || [];
}

async function saveSavedAnswers(answers) {
  await chrome.storage.local.set({ savedAnswers: answers });
}

document.getElementById('btn-add-answer').addEventListener('click', () => {
  document.getElementById('answer-form').classList.remove('hidden');
});

document.getElementById('btn-cancel-answer').addEventListener('click', () => {
  document.getElementById('answer-form').classList.add('hidden');
  document.getElementById('answer-field').value = '';
  document.getElementById('answer-value').value = '';
});

document.getElementById('btn-save-answer').addEventListener('click', async () => {
  const field = document.getElementById('answer-field').value.trim();
  const value = document.getElementById('answer-value').value.trim();
  if (!field || !value) return alert('Fill both fields!');

  const answers = await getSavedAnswers();
  const idx = answers.findIndex(a => a.label.toLowerCase() === field.toLowerCase());
  if (idx >= 0) answers[idx].value = value;
  else answers.push({ label: field.toLowerCase(), value: value });

  await saveSavedAnswers(answers);
  document.getElementById('answer-form').classList.add('hidden');
  document.getElementById('answer-field').value = '';
  document.getElementById('answer-value').value = '';
  loadSavedAnswers();
});

async function loadSavedAnswers() {
  const answers = await getSavedAnswers();
  const list = document.getElementById('saved-answers-list');

  if (answers.length === 0) {
    list.innerHTML = '<p class="empty-state">No learned answers yet. AI will learn as you use it!</p>';
    return;
  }

  list.innerHTML = answers.map((ans, i) => `
    <div class="answer-item">
      <div class="answer-item-info">
        <div class="answer-field">${ans.label}</div>
        <div class="answer-value">${ans.value.length > 50 ? ans.value.substring(0, 50) + '...' : ans.value}</div>
      </div>
      <div class="answer-item-actions">
        <button class="btn-delete" data-index="${i}">Del</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const answers = await getSavedAnswers();
      answers.splice(parseInt(btn.dataset.index), 1);
      await saveSavedAnswers(answers);
      loadSavedAnswers();
    });
  });
}

// ==================== PDF UPLOAD ====================
let editingCVIndex = -1;

document.getElementById('cv-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const cvs = await getCVs();
  if (cvs.length >= 3) {
    alert('Maximum 3 CVs! Delete one first.');
    e.target.value = '';
    return;
  }

  const progress = document.getElementById('upload-progress');
  const status = document.getElementById('upload-status');
  progress.classList.remove('hidden');
  status.textContent = 'Reading PDF...';

  try {
    const pdfText = await readPDF(file);
    if (pdfText.length < 10) throw new Error('PDF has no readable text.');

    status.textContent = 'AI is analyzing your CV...';
    const data = await callGroq(
      'You are a CV parser. Return valid JSON only.',
      'Parse this CV. Return ONLY JSON: {"cvName":"role name","fullName":"name","email":"email","phone":"phone","skills":["s1","s2"],"experience":"summary","education":"degree"}\n\nCV:\n' + pdfText.substring(0, 3500)
    );

    document.getElementById('cv-name').value = data.cvName || file.name.replace('.pdf', '');
    document.getElementById('cv-fullname').value = data.fullName || '';
    document.getElementById('cv-email').value = data.email || '';
    document.getElementById('cv-phone').value = data.phone || '';
    document.getElementById('cv-skills').value = (data.skills || []).join(', ');
    document.getElementById('cv-experience').value = data.experience || '';
    document.getElementById('cv-education').value = data.education || '';

    document.getElementById('cv-preview').classList.remove('hidden');
    editingCVIndex = -1;
  } catch (err) {
    alert('ERROR: ' + err.message);
  } finally {
    progress.classList.add('hidden');
    e.target.value = '';
  }
});

async function readPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function(event) {
      try {
        const arr = new Uint8Array(event.target.result);
        pdfjsLib.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument(arr).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(item => item.str).join(' ') + '\n';
        }
        resolve(text);
      } catch (err) {
        reject(new Error('PDF.js error: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ==================== CV MANAGEMENT ====================
document.getElementById('btn-save-cv').addEventListener('click', async () => {
  const cv = {
    name: document.getElementById('cv-name').value.trim(),
    fullName: document.getElementById('cv-fullname').value.trim(),
    email: document.getElementById('cv-email').value.trim(),
    phone: document.getElementById('cv-phone').value.trim(),
    skills: document.getElementById('cv-skills').value.split(',').map(s => s.trim()).filter(Boolean),
    experience: document.getElementById('cv-experience').value.trim(),
    education: document.getElementById('cv-education').value.trim()
  };

  if (!cv.name || !cv.fullName) return alert('Fill CV Name and Full Name.');

  const cvs = await getCVs();
  if (editingCVIndex >= 0) cvs[editingCVIndex] = cv;
  else {
    if (cvs.length >= 3) return alert('Maximum 3 CVs!');
    cvs.push(cv);
  }

  await chrome.storage.local.set({ cvProfiles: cvs });
  document.getElementById('cv-preview').classList.add('hidden');
  clearCVForm();
  loadCVs();
  loadActiveCvSelector();
  alert('CV saved!');
});

document.getElementById('btn-cancel-cv').addEventListener('click', () => {
  document.getElementById('cv-preview').classList.add('hidden');
  clearCVForm();
});

async function getCVs() {
  return (await chrome.storage.local.get('cvProfiles')).cvProfiles || [];
}

async function loadCVs() {
  const cvs = await getCVs();
  const list = document.getElementById('cv-list');

  if (cvs.length === 0) {
    list.innerHTML = '<p class="empty-state">No CVs uploaded yet. Upload your first PDF!</p>';
    return;
  }

  list.innerHTML = cvs.map((cv, i) => `
    <div class="cv-item">
      <div class="cv-item-info">
        <h4>${cv.name} <span class="cv-item-badge">PDF</span></h4>
        <p>${cv.fullName} · ${cv.skills.slice(0, 3).join(', ')}</p>
      </div>
      <div class="cv-item-actions">
        <button class="btn-edit" data-index="${i}">Edit</button>
        <button class="btn-delete" data-index="${i}">Del</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.btn-edit').forEach(btn =>
    btn.addEventListener('click', () => editCV(parseInt(btn.dataset.index))));
  list.querySelectorAll('.btn-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteCV(parseInt(btn.dataset.index))));
}

async function editCV(i) {
  const cv = (await getCVs())[i];
  editingCVIndex = i;
  document.getElementById('cv-name').value = cv.name;
  document.getElementById('cv-fullname').value = cv.fullName;
  document.getElementById('cv-email').value = cv.email;
  document.getElementById('cv-phone').value = cv.phone;
  document.getElementById('cv-skills').value = cv.skills.join(', ');
  document.getElementById('cv-experience').value = cv.experience;
  document.getElementById('cv-education').value = cv.education;
  document.getElementById('cv-preview').classList.remove('hidden');
}

async function deleteCV(i) {
  if (!confirm('Delete this CV?')) return;
  const cvs = await getCVs();
  cvs.splice(i, 1);
  await chrome.storage.local.set({ cvProfiles: cvs });
  loadCVs();
  loadActiveCvSelector();
}

function clearCVForm() {
  ['cv-name', 'cv-fullname', 'cv-email', 'cv-phone', 'cv-skills', 'cv-experience', 'cv-education']
    .forEach(id => document.getElementById(id).value = '');
}

// ==================== HISTORY ====================
async function getHistory() {
  return (await chrome.storage.local.get('savedJobs')).savedJobs || [];
}

async function loadHistory() {
  const jobs = await getHistory();
  const list = document.getElementById('history-list');

  if (jobs.length === 0) {
    list.innerHTML = '<p class="empty-state">No saved jobs yet.</p>';
    return;
  }

  list.innerHTML = jobs.map(job => `
    <div class="history-item" data-url="${job.url || '#'}">
      <h4>${job.jobTitle || 'Unknown Job'}</h4>
      <div class="history-meta">
        <span>${job.company || 'Unknown'}</span>
        <span class="match-badge">${job.bestCV?.score || 0}%</span>
        <span>${new Date(job.savedAt).toLocaleDateString()}</span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const url = item.dataset.url;
      if (url && url !== '#') chrome.tabs.create({ url });
    });
  });
}

document.getElementById('btn-clear-history').addEventListener('click', async () => {
  if (!confirm('Clear all?')) return;
  await chrome.storage.local.set({ savedJobs: [] });
  loadHistory();
});

// ==================== INIT ====================
loadCVs();
loadHistory();
loadSavedAnswers();
loadActiveCvSelector();
