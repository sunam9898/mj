const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = Number(process.env.PORT) || 3000;
const webFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'],
  ['/__preview-bridge.js', '__preview-bridge.js'],
]);

const lessonInstructions = `You are Bobo, a kind English speaking coach for Korean 6th graders learning Lesson 9, "I'm going to walk the dog." The goal is to practice weekend plans with "be going to + base verb".
Stay on the lesson topic. If a reply is unrelated, rude, or not an English weekend plan/detail, set onTopic=false and politely redirect the student in Korean. Repeat the current lesson question in followUp.
Always preserve the student's chosen activity and details. Never replace their answer with a memorized example. For example, if the student says "I'm playing soccer", correct it to "I'm going to play soccer." If they say "I'm going to see a movie", keep the movie plan.
Correct the student's own sentence to a natural, grammatical "subject + be going to + base verb" sentence. The verb immediately after "to" must be a base form, never an -ing, -ed, or third-person -s form. Preserve the student's chosen activity and details. Praise what is already good and explain one or two useful points in simple Korean.
Put the single corrected English sentence only in the corrected field. Do not include sample English sentences or alternate example sentences in feedback or notes; keep those fields in Korean and explain the rule without inventing another example. For example, "I'm playing soccer" becomes "I'm going to play soccer"; never write "I'm going to playing soccer".
Explain briefly when useful: "will" can express a decision made while speaking or willingness; "be going to" often describes a plan already made. Their uses can overlap depending on context. If a student uses "will", do not say it is always wrong; gently connect it to this lesson's "be going to" target.
For an on-topic reply, ask exactly one short, natural follow-up question about that specific plan. Follow-up kinds must be one of: location, companion, time, activity-detail, extra-plan. Keep language suitable for an elementary student.
Return only one valid JSON object with these fields: onTopic (boolean), feedback (short Korean string), corrected (English sentence or empty string), score (integer 0-100), notes (array of short Korean strings), followUp (short English question), followUpKo (Korean translation), followUpKind (one allowed kind), activity (short English activity phrase). Do not include Markdown fences or any text outside the JSON object.`;

app.disable('x-powered-by');
app.use(express.json({ limit: '24kb' }));

for (const [route, file] of webFiles) {
  app.get(route, (_req, res) => res.sendFile(path.join(__dirname, file)));
}

app.get('/api/status', (_req, res) => {
  res.json({ provider: 'upstage', configured: Boolean(process.env.UPSTAGE_API_KEY) });
});

app.post('/api/chat', async (req, res) => {
  if (!process.env.UPSTAGE_API_KEY) {
    return res.status(503).json({ error: 'API 키가 설정되지 않았습니다.' });
  }

  const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = rawMessages
    .filter(item => ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string')
    .slice(-16)
    .map(item => ({ role: item.role, content: item.content.slice(0, 1200) }));

  if (!messages.length || messages.at(-1).role !== 'user') {
    return res.status(400).json({ error: '영어 답변을 먼저 입력해 주세요.' });
  }

  const question = typeof req.body?.currentQuestion === 'string'
    ? req.body.currentQuestion.slice(0, 240)
    : 'What are you going to do this weekend?';
  const kind = typeof req.body?.questionKind === 'string'
    ? req.body.questionKind.slice(0, 40)
    : 'plan';

  try {
    const upstream = await fetch('https://api.upstage.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.UPSTAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'solar-pro4',
        temperature: 0.3,
        max_tokens: 450,
        messages: [
          {
            role: 'system',
            content: `${lessonInstructions}\nCurrent question kind: ${kind}\nCurrent question: ${question}`,
          },
          ...messages,
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Upstage 응답을 받을 수 없습니다.' });
    }

    const payload = await upstream.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return res.status(502).json({ error: 'Upstage 응답 형식을 확인할 수 없습니다.' });
    }

    const jsonText = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    const result = JSON.parse(jsonText.slice(start, end + 1));
    const allowedKinds = new Set(['plan', 'location', 'companion', 'time', 'activity-detail', 'extra-plan']);

    res.json({
      onTopic: Boolean(result.onTopic),
      feedback: typeof result.feedback === 'string' ? result.feedback.slice(0, 500) : '',
      corrected: typeof result.corrected === 'string' ? result.corrected.slice(0, 300) : '',
      score: Math.max(0, Math.min(100, Math.round(Number(result.score) || 0))),
      notes: Array.isArray(result.notes) ? result.notes.filter(note => typeof note === 'string').slice(0, 4).map(note => note.slice(0, 180)) : [],
      followUp: typeof result.followUp === 'string' ? result.followUp.slice(0, 240) : question,
      followUpKo: typeof result.followUpKo === 'string' ? result.followUpKo.slice(0, 240) : '',
      followUpKind: allowedKinds.has(result.followUpKind) ? result.followUpKind : '',
      activity: typeof result.activity === 'string' ? result.activity.slice(0, 120) : '',
    });
  } catch {
    res.status(502).json({ error: 'Upstage에 연결하는 중 문제가 생겼습니다.' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Malang talk server listening on port ${port}`);
});
