// ==================== JOB DETECTOR + SMART AUTO-FILL ====================

// Site-specific selectors
const SITE_CONFIGS = {
  'linkedin.com': {
    title: '.top-card-layout__title, .t-24.t-bold, h1.topcard__title',
    company: '.topcard__org-name-link, .top-card-layout__company',
    location: '.topcard__flavor--bullet',
    description: '.show-more-less-html__markup, .description__text'
  },
  'indeed.com': {
    title: '.jobsearch-JobInfoHeader-title, h1.icl-u-xs-mb--xs',
    company: '[data-company-name], .icl-u-lg-mr--sm',
    location: '[data-testid="job-location"]',
    description: '#jobDescriptionText'
  },
  'glassdoor.com': {
    title: '[data-test="jobTitle"]',
    company: '[data-test="employerName"]',
    description: '.jobDescriptionContent'
  },
  'rozee.pk': {
    title: 'h1.job-title',
    company: '.company-name',
    description: '.job-description'
  }
};

// ==================== DOM EXTRACTION ====================
function extractJobFromDOM() {
  const hostname = window.location.hostname.replace('www.', '');
  let config = null;
  for (const [site, cfg] of Object.entries(SITE_CONFIGS)) {
    if (hostname.includes(site)) { config = cfg; break; }
  }

  let result = {};
  if (config) {
    for (const [field, selector] of Object.entries(config)) {
      const el = document.querySelector(selector);
      if (el) result[field] = el.textContent.trim().substring(0, 500);
    }
  }

  // Generic fallback
  if (!result.title) {
    const h1 = document.querySelector('h1, .job-title, [class*="jobTitle"]');
    if (h1) result.title = h1.textContent.trim();
  }

  result.rawText = document.body.innerText.substring(0, 5000);
  result.url = window.location.href;
  return result;
}

// ==================== READ ALL FORM FIELDS ====================
function readFormFields() {
  const fields = [];
  const elements = document.querySelectorAll('input, textarea, select');

  elements.forEach(el => {
    const type = (el.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'file', 'image', 'reset', 'password'].includes(type)) return;

    let value = '';
    if (type === 'checkbox' || type === 'radio') {
      if (!el.checked) return;
      value = el.value || 'checked';
    } else if (el.tagName === 'SELECT') {
      value = el.options[el.selectedIndex]?.text || el.value;
      if (!value || value === 'Select an option' || value === 'Select') return;
    } else {
      value = el.value;
    }

    if (!value || !value.trim()) return;

    const label = getFieldLabel(el);
    if (!label) return;

    fields.push({ label: label.toLowerCase().trim(), value: value.trim(), type: type });
  });

  return fields;
}

// ==================== GET ALL UNFILLED QUESTIONS ====================
function getUnfilledQuestions() {
  const questions = [];
  const elements = document.querySelectorAll('input, textarea, select');

  elements.forEach((el, index) => {
    const type = (el.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'file', 'image', 'reset', 'password'].includes(type)) return;

    // Check if already filled
    let isFilled = false;
    if (type === 'checkbox' || type === 'radio') {
      // Check if any radio in the group is checked
      if (el.name) {
        isFilled = document.querySelector(`input[name="${el.name}"]:checked`) !== null;
      } else {
        isFilled = el.checked;
      }
    } else if (el.tagName === 'SELECT') {
      isFilled = el.selectedIndex > 0;
    } else {
      isFilled = el.value && el.value.trim().length > 0;
    }

    const label = getFieldLabel(el);
    if (!label) return;

    // Get options for select/radio
    let options = [];
    if (el.tagName === 'SELECT') {
      options = Array.from(el.options).map(o => o.text).filter(t => t && t !== 'Select an option' && t !== 'Select' && t !== '');
    } else if (type === 'radio' && el.name) {
      const radios = document.querySelectorAll(`input[name="${el.name}"]`);
      options = Array.from(radios).map(r => {
        const rLabel = getFieldLabel(r);
        return rLabel || r.value;
      });
      // Only add once per radio group
      if (questions.find(q => q.name === el.name)) return;
    }

    questions.push({
      index: index,
      label: label.trim(),
      type: type || el.tagName.toLowerCase(),
      isFilled: isFilled,
      options: options,
      name: el.name || '',
      tagName: el.tagName
    });
  });

  return questions;
}

// ==================== SMART AUTO-FILL ====================
function smartAutoFill(answers) {
  // answers = [{label, value}, ...] from profile + saved answers + AI answers
  const elements = document.querySelectorAll('input, textarea, select');
  let filled = 0;
  const filledFields = [];

  elements.forEach(el => {
    const type = (el.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'file', 'image', 'reset', 'password'].includes(type)) return;

    const label = getFieldLabel(el);
    if (!label) return;
    const labelLower = label.toLowerCase().trim();

    // Find matching answer
    const match = findBestMatch(labelLower, answers);
    if (!match) return;

    if (type === 'radio') {
      // For radio: find the radio button whose label/value matches
      if (el.name) {
        const radios = document.querySelectorAll(`input[name="${el.name}"]`);
        radios.forEach(radio => {
          const radioLabel = (getFieldLabel(radio) || radio.value || '').toLowerCase();
          if (radioLabel.includes(match.value.toLowerCase()) || match.value.toLowerCase().includes(radioLabel)) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radio.dispatchEvent(new Event('click', { bubbles: true }));
            highlightField(radio);
          }
        });
      }
      filled++;
      filledFields.push(label);
    } else if (el.tagName === 'SELECT') {
      // For select: find matching option
      const options = Array.from(el.options);
      const matchedOpt = options.find(o => {
        const optText = o.text.toLowerCase();
        const val = match.value.toLowerCase();
        return optText.includes(val) || val.includes(optText) || o.value.toLowerCase() === val;
      });
      if (matchedOpt) {
        el.value = matchedOpt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        highlightField(el);
        filled++;
        filledFields.push(label);
      }
    } else if (type === 'checkbox') {
      if (match.value.toLowerCase() === 'yes' || match.value.toLowerCase() === 'true' || match.value.toLowerCase() === 'checked') {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        highlightField(el);
        filled++;
        filledFields.push(label);
      }
    } else {
      // input/textarea
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(el, match.value);
      else el.value = match.value;

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      highlightField(el);
      filled++;
      filledFields.push(label);
    }
  });

  // Show toast
  showToast(filled + ' fields filled!');
  return { filled, filledFields };
}

function findBestMatch(labelLower, answers) {
  // Exact match
  let match = answers.find(a => a.label.toLowerCase() === labelLower);
  if (match) return match;

  // Contains match
  match = answers.find(a => {
    const aLabel = a.label.toLowerCase();
    return labelLower.includes(aLabel) || aLabel.includes(labelLower);
  });
  if (match) return match;

  // Word overlap match (at least 50% words match)
  match = answers.find(a => {
    const aWords = a.label.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const lWords = labelLower.split(/\s+/).filter(w => w.length > 2);
    if (aWords.length === 0 || lWords.length === 0) return false;
    const common = aWords.filter(w => lWords.some(lw => lw.includes(w) || w.includes(lw)));
    return common.length >= Math.min(aWords.length, lWords.length) * 0.5;
  });

  return match || null;
}

function highlightField(el) {
  el.style.outline = '2px solid #6c5ce7';
  el.style.transition = 'outline 0.3s ease';
  setTimeout(() => { el.style.outline = ''; }, 4000);
}

function showToast(message) {
  const existing = document.querySelector('.jobassist-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'jobassist-toast';
  toast.textContent = 'JobAssist AI: ' + message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ==================== GET LABEL ====================
function getFieldLabel(input) {
  // Method 1: <label for="id">
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent.replace(/\*/g, '').trim();
  }

  // Method 2: Parent label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    const text = parentLabel.textContent.replace(/\*/g, '').trim();
    if (text.length > 1 && text.length < 150) return text;
  }

  // Method 3: Previous sibling
  let prev = input.previousElementSibling;
  while (prev) {
    if (['LABEL', 'SPAN', 'P', 'DIV', 'H3', 'H4', 'LEGEND'].includes(prev.tagName)) {
      const text = prev.textContent.replace(/\*/g, '').trim();
      if (text.length > 1 && text.length < 150) return text;
    }
    prev = prev.previousElementSibling;
  }

  // Method 4: Parent's previous sibling or parent's label
  let parent = input.parentElement;
  for (let i = 0; i < 3 && parent; i++) {
    let parentPrev = parent.previousElementSibling;
    if (parentPrev) {
      const text = parentPrev.textContent.replace(/\*/g, '').trim();
      if (text.length > 1 && text.length < 150) return text;
    }
    parent = parent.parentElement;
  }

  // Method 5: aria-label, placeholder, name
  return input.getAttribute('aria-label')
    || input.placeholder
    || input.name?.replace(/[_\-\[\]]/g, ' ').trim()
    || null;
}

// ==================== MESSAGE LISTENER ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'extractJob') {
    try {
      sendResponse({ success: true, data: extractJobFromDOM() });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  if (message.action === 'getVisibleText') {
    const main = document.querySelector('main, article, [role="main"]') || document.body;
    sendResponse({ text: main.innerText.substring(0, 5000) });
  }

  if (message.action === 'saveFormAnswers') {
    try {
      sendResponse({ success: true, fields: readFormFields() });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  if (message.action === 'getUnfilledQuestions') {
    try {
      sendResponse({ success: true, questions: getUnfilledQuestions() });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  if (message.action === 'autoFillFromSaved') {
    try {
      const result = smartAutoFill(message.answers);
      sendResponse({ success: true, ...result });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  return true;
});
