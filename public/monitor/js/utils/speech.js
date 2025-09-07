export function speak(text, rate = 1, pitch = 1) {
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const pt = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('pt-br'))
            || voices.find(v => v.lang && v.lang.toLowerCase().startsWith('pt'));
  if (pt) utter.voice = pt;
  utter.lang = pt ? pt.lang : 'pt-BR';
  utter.rate = rate;
  utter.pitch = pitch;
  speechSynthesis.speak(utter);
}

export function buildSpeechText(n, opts) {
  const parts = [];

  if (n.tipo === 'Preferencial') parts.push('Preferencial');
  parts.push(`senha ${n.number}`);

  let text = parts.join(', ') + '.';

  const raw = (n.name ?? '').replace(/\s+/g, ' ').trim();
  const name = raw.slice(0, 80);
  if (name.length > 1) {
    text += ' ' + name;
  }

  const g = (n.guiche ?? '').toString().trim();
  if (opts.sayGuiche && g) text += ' ' + g;

  return text;
}
