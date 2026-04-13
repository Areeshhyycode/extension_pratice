// ==================== BACKGROUND SERVICE WORKER ====================

// Inline config (importScripts can fail in MV3)
const CONFIG = {
  GROQ_API_KEY: "YOUR_GROQ_API_KEY_HERE",
  GROQ_API_URL: "https://api.groq.com/openai/v1/chat/completions",
  AI_MODEL: "llama-3.3-70b-versatile"
};

// ==================== GROQ AI CALL ====================
async function callGroqAI(systemPrompt, userPrompt) {
  const { settings } = await chrome.storage.local.get('settings');
  const apiKey = settings?.apiKey || CONFIG.GROQ_API_KEY;
  const model = settings?.model || CONFIG.AI_MODEL;

  const response = await fetch(CONFIG.GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 1024
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty AI response');

  // Parse JSON from response
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error('Could not parse AI response as JSON');
  }
}

// ==================== JOB EXTRACTION ====================
async function processJobWithAI(pageData, url) {
  const { cvProfiles } = await chrome.storage.local.get('cvProfiles');
  const cvs = cvProfiles || [];

  let cvContext = '';
  if (cvs.length > 0) {
    cvContext = '\n\nUser has these CV profiles:\n' + cvs.map((cv, i) =>
      `CV ${i + 1}: "${cv.name}" - Skills: ${cv.skills?.join(', ')} | Experience: ${cv.experience} | Education: ${cv.education}`
    ).join('\n');
    cvContext += '\n\nAlso determine which CV is the BEST match for this job and give a match percentage (0-100).';
  }

  const userPrompt = `Extract job details from this webpage content.
Return ONLY valid JSON:
{
  "jobTitle": "title",
  "company": "company",
  "location": "location",
  "experience": "required experience",
  "requirements": ["skill1", "skill2"],
  "salary": "salary or null",
  "jobType": "Full-time/Part-time/Contract/Remote",
  "summary": "2-3 sentence summary"${cvs.length > 0 ? ',\n  "bestCV": { "name": "cv name", "score": 85, "reason": "why" }' : ''}
}

URL: ${url}
${pageData.title ? 'Title: ' + pageData.title : ''}
${pageData.company ? 'Company: ' + pageData.company : ''}

Page content:
${(pageData.rawText || pageData.description || JSON.stringify(pageData)).substring(0, 4000)}
${cvContext}`;

  return await callGroqAI(
    'You are a precise job detail extractor. Always respond with valid JSON only.',
    userPrompt
  );
}

// ==================== CV PARSING ====================
async function parseCVWithAI(text, fileName) {
  const userPrompt = `Parse this CV/Resume and extract details. Return ONLY valid JSON:
{
  "cvName": "short name based on person's role",
  "fullName": "full name",
  "email": "email",
  "phone": "phone",
  "skills": ["skill1", "skill2", "skill3"],
  "experience": "brief work experience summary (2-3 sentences)",
  "education": "highest education with institution"
}

File: ${fileName}
CV Text:
${text.substring(0, 4000)}`;

  return await callGroqAI(
    'You are a CV/Resume parser. Extract structured info. Respond with valid JSON only.',
    userPrompt
  );
}

// ==================== MESSAGE HANDLER ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received:', message.action);

  if (message.action === 'processWithAI') {
    processJobWithAI(message.data, message.url)
      .then(data => {
        console.log('Job processed:', data);
        sendResponse({ success: true, data });
      })
      .catch(err => {
        console.error('processWithAI error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.action === 'parseCV') {
    parseCVWithAI(message.text, message.fileName)
      .then(data => {
        console.log('CV parsed:', data);
        sendResponse({ success: true, data });
      })
      .catch(err => {
        console.error('parseCV error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.action === 'generateAnswer') {
    callGroqAI(
      'You are helping fill a job application form. Give concise, professional answers.',
      message.prompt
    )
      .then(data => sendResponse({ success: true, answer: data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ==================== INSTALL ====================
chrome.runtime.onInstalled.addListener(() => {
  console.log('JobAssist AI installed!');
  chrome.storage.local.get('settings', (data) => {
    if (!data.settings) {
      chrome.storage.local.set({
        settings: {
          apiKey: CONFIG.GROQ_API_KEY,
          model: CONFIG.AI_MODEL,
          defaultAction: 'show'
        }
      });
    }
  });
});
