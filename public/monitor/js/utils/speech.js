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

  // Fecha a primeira frase com ponto para garantir pausa
  let text = parts.join(', ') + '.';

  // Sanitiza e adiciona nome com vírgula ao final
  const rawName = (n.name ?? '').replace(/\s+/g, ' ').trim();
  const name = rawName.slice(0, 80);
  if (name.length > 1) {
    text += ` ${name},`;
  }

  // Guichê: apenas o conteúdo, sem a palavra
  const g = (n.guiche ?? '').toString().trim();
  if (opts.sayGuiche && g) {
    text += ` ${g}.`;
  } else if (name.length > 1) {
    // Se não houver guichê, finaliza após o nome
    text = text.replace(/,$/, '.');
  }

  return text;
}
